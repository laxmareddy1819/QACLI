import * as readline from 'node:readline';
import { Orchestrator } from '../core/orchestrator.js';
import { Renderer } from './renderer.js';
import { PermissionManager } from './permissions.js';
import { History } from './history.js';
import { Autocomplete } from './autocomplete.js';
import {
  SlashCommandRegistry,
  registerBuiltinCommands,
  type SlashCommandContext,
} from './slash-commands.js';
import { getConfig } from '../config/index.js';
import { BrowserManager } from '../browser/index.js';

// Visible separator used when joining pasted multi-line input into a single
// editable readline line. On submit we split on this to recover newlines.
const PASTE_NEWLINE = ' ↵ ';

export class REPL {
  private orchestrator: Orchestrator;
  private renderer: Renderer;
  private permissions: PermissionManager;
  private history: History;
  private autocomplete: Autocomplete;
  private commandRegistry: SlashCommandRegistry;
  private browserManager: BrowserManager;
  private rl!: readline.Interface;
  private running = false;
  private shuttingDown = false;
  private abortController: AbortController | null = null;
  private awaitingPermission = false;
  // Multi-line paste detection: buffer rapid-fire line events.
  // When a paste is detected (>1 lines within PASTE_DEBOUNCE_MS),
  // we join them with a visible separator (↵) and write them back
  // into the readline buffer as a single editable line.
  private pasteBuffer: string[] = [];
  private pasteTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PASTE_DEBOUNCE_MS = 50;
  // Flag: when true the next 'line' event is the user pressing Enter
  // after we injected pasted text into the readline buffer — we need
  // to restore newlines from the ↵ separator before submitting.
  private pastedLine = false;

  constructor(workingDirectory: string) {
    this.orchestrator = new Orchestrator(workingDirectory);
    this.renderer = new Renderer();
    this.permissions = new PermissionManager();
    this.history = new History();
    this.autocomplete = new Autocomplete();
    this.commandRegistry = new SlashCommandRegistry();
    this.browserManager = new BrowserManager();

    registerBuiltinCommands(this.commandRegistry);
    this.autocomplete.setCommands(this.commandRegistry.getNames());
  }

  async start(): Promise<void> {
    // Initialize the orchestrator (loads LLM providers)
    this.renderer.startSpinner('Initializing qabot...');

    try {
      await this.orchestrator.initialize();
      this.renderer.stopSpinner(true);
    } catch (error) {
      this.renderer.stopSpinner(false);
      this.renderer.renderError(
        'Failed to initialize',
        error instanceof Error ? error : new Error(String(error)),
      );
      console.log('');
      console.log(
        '  Make sure you have at least one LLM provider configured:',
      );
      console.log('    export OPENAI_API_KEY=sk-...');
      console.log('    export ANTHROPIC_API_KEY=sk-ant-...');
      console.log('    Or start Ollama for local models');
      console.log('');
      process.exit(1);
    }

    // Wire browser manager so browser tools can access it
    this.orchestrator.setBrowserManager(this.browserManager);

    // Set up callbacks
    this.orchestrator.setPermissionCallback(
      (toolName, args) => this.permissions.requestPermission(toolName, args),
    );

    this.orchestrator.setToolExecutionCallback(
      (phase, toolName, args, result, error) => {
        switch (phase) {
          case 'start':
            this.renderer.renderToolCallStart(toolName, args);
            break;
          case 'complete':
            this.renderer.renderToolCallResult(toolName, result);
            break;
          case 'error':
            this.renderer.renderToolCallResult(toolName, error?.message || 'Unknown error', true);
            break;
          case 'denied':
            this.renderer.renderToolCallResult(toolName, 'Permission denied', true);
            break;
        }
      },
    );

    // Show welcome
    const router = this.orchestrator.getRouter();
    this.renderer.renderWelcome(
      router.getDefaultProviderName(),
      router.getDefaultModel(),
    );

    // Start readline loop
    this.running = true;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.renderer.getPrompt(),
      completer: (line: string) => this.autocomplete.complete(line),
      terminal: true,
    });

    // Wire up permission prompts through the REPL's own readline.
    // The awaitingPermission flag prevents the 'line' handler from also
    // processing the answer — rl.question() and rl.on('line') both fire
    // for the same input, so we must guard against double-dispatch.
    // We also explicitly resume stdin before asking, because ora's
    // stdin-discarder may have paused it behind readline's back (Windows bug).
    this.permissions.setPromptWriter((question: string) => {
      return new Promise((resolve) => {
        this.awaitingPermission = true;
        this.renderer.stopSpinner();
        process.stdin.resume();
        this.rl.question(question, (answer) => {
          this.awaitingPermission = false;
          resolve(answer);
        });
      });
    });

    this.rl.prompt();

    this.rl.on('line', (input: string) => {
      // When a permission prompt is active, rl.question() handles the
      // answer via its own callback. Ignore the duplicate 'line' event
      // to prevent the answer from being processed as a new query.
      if (this.awaitingPermission) {
        return;
      }

      // ── Paste detection: buffer rapid-fire line events ──
      // When pasting, readline fires 'line' for every \n in rapid succession.
      // We buffer lines that arrive within PASTE_DEBOUNCE_MS of each other.
      // After the burst ends:
      //   • 1 line  → check if it contains ↵ separators (user submitting a
      //               previously-pasted editable line) or plain typed text.
      //   • N lines → paste detected. Join them with ↵ separator and write
      //               back into the readline buffer as a single editable
      //               line so the user can review / edit before pressing Enter.
      this.pasteBuffer.push(input);

      if (this.pasteTimer) {
        clearTimeout(this.pasteTimer);
      }

      this.pasteTimer = setTimeout(() => {
        this.pasteTimer = null;
        const lines = this.pasteBuffer.splice(0);

        if (lines.length === 1) {
          // Single line arrived — either typed normally or the user
          // pressed Enter after editing a pasted line (which contains ↵).
          let text = lines[0]!;

          // If this was a pasted-then-edited line, restore real newlines
          if (this.pastedLine && text.includes(PASTE_NEWLINE)) {
            text = text.split(PASTE_NEWLINE).join('\n');
          }
          this.pastedLine = false;

          const trimmed = text.trim();
          if (!trimmed) {
            this.rl.prompt();
            return;
          }
          this.submitInput(trimmed);
        } else {
          // Multiple lines arrived in a burst = paste detected.
          // Join them with a visible ↵ separator and inject back into
          // the readline buffer as a single editable line. The user can
          // use arrow keys / backspace / Home / End to edit, then Enter
          // to submit, or Ctrl+C to clear the line — no special mode.
          const joined = lines
            .filter(l => l.trim() !== '')
            .join(PASTE_NEWLINE);

          if (!joined.trim()) {
            this.rl.prompt();
            return;
          }

          // Mark that the next submitted line may contain ↵ separators
          this.pastedLine = true;

          // Clear the current readline line and write the joined text
          // into the editable buffer. The user sees one long line with
          // ↵ markers and can edit it freely before pressing Enter.
          this.rl.write(null as any, { ctrl: true, name: 'u' }); // clear line
          this.rl.write(joined);
        }
      }, this.PASTE_DEBOUNCE_MS);
    });

    this.rl.on('close', () => {
      this.shutdown();
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      // If we're streaming, abort the current stream
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
        this.renderer.stopSpinner();
        this.renderer.endStream();
        this.renderer.renderWarning('Request cancelled.');
        if (this.running) {
          this.rl.prompt();
        }
        return;
      }

      // Reset paste state if user Ctrl+C's while editing a pasted line
      this.pastedLine = false;

      if (this.running) {
        console.log('');
        this.renderer.renderInfo('Press Ctrl+C again or type /exit to quit.');
        this.rl.prompt();
      }
    });
  }

  /**
   * Submit a (possibly multi-line) input string for processing.
   * Adds to history, then runs through slash commands or LLM.
   */
  private submitInput(input: string): void {
    this.history.add(input);

    this.processInput(input)
      .catch((error) => {
        this.renderer.renderError(
          'Unexpected error',
          error instanceof Error ? error : new Error(String(error)),
        );
      })
      .finally(() => {
        if (this.running) {
          this.rl.setPrompt(this.renderer.getPrompt());
          this.rl.prompt();
        }
      });
  }

  private async processInput(input: string): Promise<void> {
    // Slash commands
    if (input.startsWith('/')) {
      const ctx: SlashCommandContext = {
        orchestrator: this.orchestrator,
        renderer: this.renderer,
        permissions: this.permissions,
        history: this.history,
        browserManager: this.browserManager,
        exit: () => this.shutdown(),
      };
      await this.commandRegistry.execute(input, ctx);
      return;
    }

    // Natural language processing
    await this.processNaturalLanguage(input);
  }

  private async processNaturalLanguage(input: string): Promise<void> {
    this.renderer.startStream();
    this.abortController = new AbortController();

    try {
      for await (const chunk of this.orchestrator.processStream(input)) {
        // Check if the user cancelled via Ctrl+C
        if (this.abortController?.signal.aborted) {
          break;
        }

        switch (chunk.type) {
          case 'status':
            this.renderer.startSpinner(chunk.message);
            break;
          case 'text':
            // Text chunks accumulate in the buffer while spinner shows progress.
            // The spinner (started by 'status' chunk) keeps running and
            // renderStreamChunk updates its text with a character count.
            this.renderer.renderStreamChunk(chunk.content);
            break;
          case 'tool_call':
            // Tool calls are handled via the toolExecutionCallback.
            // renderToolCallStart flushes the buffer and stops the spinner.
            break;
          case 'error':
            this.renderer.stopSpinner();
            this.renderer.endStream();
            this.renderer.renderError(chunk.error);
            this.abortController = null;
            return;
          case 'done':
            // Stream complete: endStream will flush the buffer as
            // rendered markdown and stop the spinner.
            if (chunk.usage) {
              const config = getConfig();
              if (config.getUIConfig().showTokenUsage) {
                this.renderer.endStream();
                this.renderer.renderTokenUsage(
                  chunk.usage.inputTokens,
                  chunk.usage.outputTokens,
                );
              }
            }
            break;
        }
      }

      this.renderer.stopSpinner();
      this.renderer.endStream();
    } catch (error) {
      this.renderer.stopSpinner();
      this.renderer.endStream();
      // Don't display abort errors when user cancelled
      if (!this.abortController?.signal.aborted) {
        this.renderer.renderError(
          'Processing failed',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    } finally {
      this.abortController = null;
    }
  }

  private async shutdown(): Promise<void> {
    // Prevent re-entrant shutdown (rl.close triggers 'close' event)
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.running = false;

    try {
      // Close browser if it has an active session
      if (this.browserManager.hasActiveSession()) {
        await this.browserManager.close();
      }
    } catch {
      // Ignore browser cleanup errors
    }
    try {
      await this.orchestrator.dispose();
    } catch {
      // Ignore cleanup errors
    }
    this.rl?.close();
    process.exit(0);
  }
}
