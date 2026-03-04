import type { ToolCall, ToolResult, StreamChunk, CompletionRequest, FinishReason } from '../types/index.js';
import { LLMRouter, getRouter } from '../llm/index.js';
import { ConversationManager } from './conversation.js';
import { EventEmitter, getEventEmitter } from './events.js';
import { ToolRegistry, getToolRegistry, registerCoreTools, type ToolExecutionContext } from './tools/index.js';
import { buildSystemPrompt } from './system-prompt.js';
import { createLogger } from '../utils/index.js';
import { getConfig } from '../config/index.js';

const logger = createLogger('orchestrator');

// ── Callback Types ────────────────────────────────────────────────────────────

export type PermissionCallback = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<{ granted: boolean; remember?: boolean }>;

export type ToolExecutionCallback = (
  phase: 'start' | 'complete' | 'error' | 'denied',
  toolName: string,
  args: Record<string, unknown>,
  result?: unknown,
  error?: Error,
) => void;

// ── Orchestrator Response ─────────────────────────────────────────────────────

export interface OrchestratorResponse {
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class Orchestrator {
  private router: LLMRouter;
  private conversation: ConversationManager;
  private events: EventEmitter;
  private toolRegistry: ToolRegistry;
  private permissionCallback?: PermissionCallback;
  private toolExecutionCallback?: ToolExecutionCallback;
  private toolContext: ToolExecutionContext;
  private browserManager: unknown = null;

  // Phase 3: Pause/resume support
  private pauseRequested = false;
  private pauseResolve: (() => void) | null = null;
  private currentToolName: string | null = null;
  private isProcessing = false;

  constructor(
    private workingDirectory: string,
  ) {
    this.router = getRouter();
    this.events = getEventEmitter();
    this.toolRegistry = getToolRegistry();
    this.toolContext = { workingDirectory };

    // Build system prompt with registered tools
    const systemPrompt = buildSystemPrompt({
      workingDirectory,
      tools: this.toolRegistry.getDefinitions(),
    });
    this.conversation = new ConversationManager(systemPrompt);
  }

  async initialize(): Promise<void> {
    registerCoreTools(this.toolRegistry);
    await this.router.initialize();

    // Rebuild system prompt now that tools are registered
    const systemPrompt = buildSystemPrompt({
      workingDirectory: this.workingDirectory,
      tools: this.toolRegistry.getDefinitions(),
    });
    this.conversation.setSystemPrompt(systemPrompt);

    await this.events.emit('system:ready', undefined as never);
    logger.info('Orchestrator initialized');
  }

  setPermissionCallback(cb: PermissionCallback): void {
    this.permissionCallback = cb;
  }

  setToolExecutionCallback(cb: ToolExecutionCallback): void {
    this.toolExecutionCallback = cb;
  }

  setBrowserManager(manager: unknown): void {
    this.browserManager = manager;
  }

  async *processStream(userMessage: string): AsyncGenerator<StreamChunk> {
    this.isProcessing = true;
    try {
    this.conversation.addUserMessage(userMessage);
    await this.events.emit('conversation:message:user', { content: userMessage });

    const maxIterations = getConfig().getMaxToolIterations();
    let iterations = 0;
    const MAX_CONTINUATIONS = 5; // Max auto-continuations for truncated responses

    while (iterations < maxIterations) {
      iterations++;

      // Show thinking indicator while waiting for LLM
      yield { type: 'status', message: iterations === 1 ? 'Thinking...' : `Analyzing results and planning next step... (iteration ${iterations})` };

      const messages = this.conversation.buildMessages();

      const request: CompletionRequest = {
        messages,
        tools: this.toolRegistry.getDefinitions(),
      };

      let accumulatedText = '';
      const collectedToolCalls: ToolCall[] = [];
      let streamFinishReason: FinishReason | undefined;

      await this.events.emit('llm:stream:start', {
        provider: this.router.getDefaultProviderName(),
      });

      for await (const chunk of this.router.stream(request)) {
        if (chunk.type === 'text') {
          accumulatedText += chunk.content;
          yield chunk;
        } else if (chunk.type === 'tool_call') {
          collectedToolCalls.push(chunk.toolCall);
        } else if (chunk.type === 'error') {
          yield chunk;
          return;
        } else if (chunk.type === 'done') {
          streamFinishReason = chunk.finishReason;
          yield chunk;
        }
      }

      await this.events.emit('llm:stream:end', {
        provider: this.router.getDefaultProviderName(),
        duration: 0,
      });

      // Emit event for assistant response
      if (accumulatedText) {
        await this.events.emit('conversation:message:assistant', {
          content: accumulatedText,
        });
      }

      // Handle truncation due to max output tokens (finish_reason: 'length')
      // When the LLM runs out of output tokens mid-generation, we auto-continue
      // by saving the partial response and asking the LLM to continue
      if (streamFinishReason === 'length' && collectedToolCalls.length === 0 && accumulatedText) {
        let continuations = 0;
        let fullText = accumulatedText;

        while (continuations < MAX_CONTINUATIONS) {
          continuations++;
          logger.info(`Response truncated (finish_reason: length), auto-continuing (${continuations}/${MAX_CONTINUATIONS})...`);

          // Save the partial assistant text and inject a continuation prompt
          this.conversation.addAssistantMessage(fullText);
          this.conversation.addUserMessage(
            'Your previous response was cut off due to length limits. Please continue EXACTLY from where you stopped. ' +
            'Do NOT repeat any content — pick up from the last character of your previous message. ' +
            'If you were in the middle of a tool call (like write_file), re-issue the COMPLETE tool call with the FULL content.'
          );

          yield { type: 'status', message: `Response was truncated, auto-continuing... (${continuations}/${MAX_CONTINUATIONS})` };

          const contMessages = this.conversation.buildMessages();
          const contRequest: CompletionRequest = {
            messages: contMessages,
            tools: this.toolRegistry.getDefinitions(),
          };

          let contText = '';
          const contToolCalls: ToolCall[] = [];
          let contFinishReason: FinishReason | undefined;

          for await (const chunk of this.router.stream(contRequest)) {
            if (chunk.type === 'text') {
              contText += chunk.content;
              yield chunk;
            } else if (chunk.type === 'tool_call') {
              contToolCalls.push(chunk.toolCall);
            } else if (chunk.type === 'error') {
              yield chunk;
              return;
            } else if (chunk.type === 'done') {
              contFinishReason = chunk.finishReason;
              yield chunk;
            }
          }

          if (contText) {
            await this.events.emit('conversation:message:assistant', {
              content: contText,
            });
          }

          // If continuation produced tool calls, process them normally
          if (contToolCalls.length > 0) {
            const toolResults: ToolResult[] = [];
            for (const toolCall of contToolCalls) {
              const result = await this.executeToolWithPermission(toolCall);
              toolResults.push(result);
            }
            this.conversation.addToolStep(contText, contToolCalls, toolResults);

            // Context window management
            const estimated = this.conversation.estimateTokens();
            if (estimated > 100000) {
              const removed = this.conversation.truncateToFit(80000);
              if (removed > 0) {
                await this.events.emit('conversation:truncate', { removedTurns: removed });
              }
            }
            // Break out of continuation loop, continue in the main tool loop
            break;
          }

          // If continuation finished normally (not truncated), we're done
          if (contFinishReason !== 'length') {
            fullText = contText; // The last continuation text
            this.conversation.addAssistantMessage(contText);
            return;
          }

          // Still truncated — loop again
          fullText = contText;
        }

        if (continuations >= MAX_CONTINUATIONS) {
          logger.warn(`Max continuations (${MAX_CONTINUATIONS}) reached for truncated response`);
          this.conversation.addAssistantMessage(fullText);
          return;
        }

        // If we broke out of the continuation loop due to tool calls,
        // continue in the main tool execution loop
        continue;
      }

      // No tool calls = done, save the final assistant message
      if (collectedToolCalls.length === 0) {
        this.conversation.addAssistantMessage(accumulatedText);
        return;
      }

      // Execute tool calls
      const toolResults: ToolResult[] = [];

      for (const toolCall of collectedToolCalls) {
        // Phase 3: Pause checkpoint — block before each tool if pause requested
        await this.checkpoint();
        this.currentToolName = toolCall.name;
        const result = await this.executeToolWithPermission(toolCall);
        this.currentToolName = null;
        toolResults.push(result);
      }

      // Record this as a complete tool step (preserves interleaved structure
      // so the LLM can correlate tool results with the correct tool calls)
      this.conversation.addToolStep(accumulatedText, collectedToolCalls, toolResults);

      // Context window management
      const estimated = this.conversation.estimateTokens();
      if (estimated > 100000) {
        const removed = this.conversation.truncateToFit(80000);
        if (removed > 0) {
          await this.events.emit('conversation:truncate', { removedTurns: removed });
        }
      }
    }

    logger.warn(`Max tool iterations (${maxIterations}) reached`);
    yield { type: 'error', error: `Reached maximum tool iterations (${maxIterations}). The task may be too complex for a single request.` };
    } finally {
      this.isProcessing = false;
      this.currentToolName = null;
      this.pauseRequested = false;
      this.pauseResolve = null;
    }
  }

  async process(userMessage: string): Promise<OrchestratorResponse> {
    let content = '';
    const toolCalls: ToolCall[] = [];
    let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

    for await (const chunk of this.processStream(userMessage)) {
      if (chunk.type === 'text') {
        content += chunk.content;
      } else if (chunk.type === 'tool_call') {
        toolCalls.push(chunk.toolCall);
      } else if (chunk.type === 'done' && chunk.usage) {
        usage = chunk.usage;
      }
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage };
  }

  private async executeToolWithPermission(toolCall: ToolCall): Promise<ToolResult> {
    // Check permission
    if (this.permissionCallback) {
      await this.events.emit('tool:permission:request', {
        name: toolCall.name,
        args: toolCall.arguments,
      });

      const { granted } = await this.permissionCallback(
        toolCall.name,
        toolCall.arguments,
      );

      if (!granted) {
        this.toolExecutionCallback?.('denied', toolCall.name, toolCall.arguments);
        await this.events.emit('tool:permission:denied', { name: toolCall.name });
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: 'Permission denied by user.',
          isError: true,
        };
      }
      await this.events.emit('tool:permission:granted', { name: toolCall.name });
    }

    // Execute
    this.toolExecutionCallback?.('start', toolCall.name, toolCall.arguments);
    await this.events.emit('tool:call:start', {
      name: toolCall.name,
      args: toolCall.arguments,
    });

    const ctx: ToolExecutionContext = {
      ...this.toolContext,
      browserSession: undefined,
    };

    // Inject browser manager into context for browser tools
    if (this.browserManager) {
      (ctx as any)._browserManager = this.browserManager;
    }

    const result = await this.toolRegistry.executeToolCall(toolCall, ctx);

    if (result.isError) {
      const error = new Error(result.result as string);
      this.toolExecutionCallback?.('error', toolCall.name, toolCall.arguments, undefined, error);
      await this.events.emit('tool:call:error', { name: toolCall.name, error });
    } else {
      this.toolExecutionCallback?.('complete', toolCall.name, toolCall.arguments, result.result);
      await this.events.emit('tool:call:complete', {
        name: toolCall.name,
        result: result.result,
        duration: 0,
      });
    }

    return result;
  }

  resetConversation(): void {
    this.conversation.reset();
    const systemPrompt = buildSystemPrompt({
      workingDirectory: this.workingDirectory,
      tools: this.toolRegistry.getDefinitions(),
    });
    this.conversation.setSystemPrompt(systemPrompt);
    this.events.emitSync('conversation:reset', undefined as never);
  }

  getRouter(): LLMRouter {
    return this.router;
  }

  getConversation(): ConversationManager {
    return this.conversation;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  // ── Phase 3: Pause/resume control ──────────────────────────────────────────

  /**
   * Request the orchestrator to pause before the next tool execution.
   * The processStream loop will block at the checkpoint until resume() is called.
   */
  pause(): void {
    if (!this.isProcessing) return;
    this.pauseRequested = true;
    logger.info('Pause requested — will pause before next tool execution');
  }

  /**
   * Resume a paused orchestrator.
   */
  resume(): void {
    if (!this.pauseRequested && !this.pauseResolve) return;
    this.pauseRequested = false;
    if (this.pauseResolve) {
      const resolve = this.pauseResolve;
      this.pauseResolve = null;
      resolve();
      logger.info('Orchestrator resumed');
    }
  }

  isPaused(): boolean {
    return this.pauseResolve !== null;
  }

  isRunning(): boolean {
    return this.isProcessing;
  }

  getCurrentToolName(): string | null {
    return this.currentToolName;
  }

  /**
   * Checkpoint — if a pause was requested, block here until resume() is called.
   * Emits events so the UI can show paused state.
   */
  private async checkpoint(): Promise<void> {
    if (!this.pauseRequested) return;

    logger.info('Orchestrator paused at checkpoint');
    await this.events.emit('orchestrator:paused', undefined as never);

    await new Promise<void>((resolve) => {
      this.pauseResolve = resolve;
    });

    await this.events.emit('orchestrator:resumed', undefined as never);
  }

  async dispose(): Promise<void> {
    // If paused, resume so processStream can exit cleanly
    this.resume();
    await this.router.dispose();
    await this.events.emit('system:shutdown', undefined as never);
  }
}
