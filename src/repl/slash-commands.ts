import chalk from 'chalk';
import type { Renderer } from './renderer.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { PermissionManager } from './permissions.js';
import type { History } from './history.js';
import type { BrowserManager } from '../browser/index.js';
import { getConfig } from '../config/index.js';
import type { ProviderName } from '../types/index.js';
import { ActionRecorder, analyzeProject, scanProjectStructure, buildCodegenPrompt } from '../recorder/index.js';

// ── Slash Command Types ───────────────────────────────────────────────────────

export interface SlashCommandContext {
  orchestrator: Orchestrator;
  renderer: Renderer;
  permissions: PermissionManager;
  history: History;
  browserManager: BrowserManager;
  exit: () => void;
}

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  usage?: string;
  handler: (args: string[], ctx: SlashCommandContext) => Promise<void>;
}

// ── Slash Command Registry ────────────────────────────────────────────────────

export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommand>();
  private aliasMap = new Map<string, string>();

  register(command: SlashCommand): void {
    this.commands.set(command.name.toLowerCase(), command);
    for (const alias of command.aliases) {
      this.aliasMap.set(alias.toLowerCase(), command.name.toLowerCase());
    }
  }

  async execute(input: string, ctx: SlashCommandContext): Promise<boolean> {
    const parts = input.slice(1).split(/\s+/);
    const cmdName = parts[0]?.toLowerCase() || '';
    const args = parts.slice(1);

    const resolvedName = this.aliasMap.get(cmdName) || cmdName;
    const command = this.commands.get(resolvedName);

    if (!command) {
      ctx.renderer.renderWarning(`Unknown command: /${cmdName}. Type /help for available commands.`);
      return true;
    }

    await command.handler(args, ctx);
    return true;
  }

  getAll(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  getNames(): string[] {
    const names: string[] = [];
    for (const cmd of this.commands.values()) {
      names.push(cmd.name, ...cmd.aliases);
    }
    return names;
  }
}

// ── Shared stream helper ─────────────────────────────────────────────────────

/**
 * Stream a prompt through the orchestrator and render the output.
 * Handles startStream/endStream lifecycle, error chunks, and done chunks.
 * All slash commands that delegate to the LLM should use this.
 */
async function streamToRenderer(ctx: SlashCommandContext, prompt: string): Promise<void> {
  ctx.renderer.startStream();
  try {
    for await (const chunk of ctx.orchestrator.processStream(prompt)) {
      switch (chunk.type) {
        case 'status':
          ctx.renderer.startSpinner(chunk.message);
          break;
        case 'text':
          ctx.renderer.renderStreamChunk(chunk.content);
          break;
        case 'error':
          ctx.renderer.stopSpinner();
          ctx.renderer.endStream();
          ctx.renderer.renderError(chunk.error);
          return;
        case 'done':
          break;
      }
    }
    ctx.renderer.stopSpinner();
    ctx.renderer.endStream();
  } catch (error) {
    ctx.renderer.stopSpinner();
    ctx.renderer.endStream();
    ctx.renderer.renderError(
      'Command failed',
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

// ── Built-in Commands ─────────────────────────────────────────────────────────

export function registerBuiltinCommands(registry: SlashCommandRegistry): void {
  registry.register({
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show available commands',
    handler: async (_args, ctx) => {
      const slashCommands = registry.getAll().map((c) => ({
        name: c.name,
        description: c.description,
      }));
      ctx.renderer.renderHelp(slashCommands);
    },
  });

  registry.register({
    name: 'clear',
    aliases: ['cls'],
    description: 'Clear the terminal screen',
    handler: async (_args, ctx) => {
      ctx.renderer.clear();
    },
  });

  registry.register({
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit qabot',
    handler: async (_args, ctx) => {
      ctx.renderer.renderInfo('Goodbye!');
      ctx.exit();
    },
  });

  registry.register({
    name: 'reset',
    aliases: [],
    description: 'Reset conversation context',
    handler: async (_args, ctx) => {
      ctx.orchestrator.resetConversation();
      ctx.permissions.reset();
      ctx.renderer.renderSuccess('Conversation and permissions reset.');
    },
  });

  registry.register({
    name: 'history',
    aliases: [],
    description: 'Show recent command history',
    handler: async (args, ctx) => {
      const count = parseInt(args[0] || '10', 10);
      const entries = ctx.history.getRecent(count);
      if (entries.length === 0) {
        ctx.renderer.renderInfo('No history yet.');
        return;
      }
      console.log('');
      entries.forEach((entry, i) => {
        console.log(chalk.dim(`  ${i + 1}. `) + entry);
      });
      console.log('');
    },
  });

  registry.register({
    name: 'config',
    aliases: [],
    description: 'View or set configuration',
    usage: '/config [set <key> <value>] [reset]',
    handler: async (args, ctx) => {
      const config = getConfig();

      if (args[0] === 'set' && args[1] && args[2]) {
        const key = args[1];
        const value = args.slice(2).join(' ');
        try {
          const parsed = JSON.parse(value);
          config.set(key, parsed);
        } catch {
          config.set(key, value);
        }
        ctx.renderer.renderSuccess(`Set ${key} = ${args.slice(2).join(' ')}`);
        return;
      }

      if (args[0] === 'reset') {
        config.reset();
        ctx.renderer.renderSuccess('Configuration reset to defaults.');
        return;
      }

      if (args[0] === 'path') {
        ctx.renderer.renderInfo(`Config file: ${config.getPath()}`);
        return;
      }

      const current = config.get();
      ctx.renderer.renderBox('Configuration', JSON.stringify(current, null, 2));
    },
  });

  registry.register({
    name: 'provider',
    aliases: ['p'],
    description: 'Switch or show LLM provider',
    usage: '/provider [name]',
    handler: async (args, ctx) => {
      const router = ctx.orchestrator.getRouter();

      if (!args[0]) {
        const current = router.getDefaultProviderName();
        const available = router.getAvailableProviders();
        ctx.renderer.renderInfo(
          `Current provider: ${chalk.yellow(current)}\nAvailable: ${available.join(', ')}`,
        );
        return;
      }

      try {
        const name = args[0] as ProviderName;
        if (!router.getAvailableProviders().includes(name)) {
          await router.addProvider(name);
        }
        router.setDefaultProvider(name);
        ctx.renderer.renderSuccess(
          `Switched to ${chalk.yellow(name)} (model: ${chalk.yellow(router.getDefaultModel())})`,
        );
      } catch (error) {
        ctx.renderer.renderError(`Failed to switch provider: ${error}`);
      }
    },
  });

  registry.register({
    name: 'model',
    aliases: ['m'],
    description: 'Switch or show current model',
    usage: '/model [name]',
    handler: async (args, ctx) => {
      const router = ctx.orchestrator.getRouter();

      if (!args[0]) {
        ctx.renderer.renderInfo(
          `Current model: ${chalk.yellow(router.getDefaultModel())}\nProvider: ${chalk.yellow(router.getDefaultProviderName())}`,
        );
        return;
      }

      router.setModel(router.getDefaultProviderName(), args[0]);
      ctx.renderer.renderSuccess(`Model set to: ${chalk.yellow(args[0])}`);
    },
  });

  registry.register({
    name: 'trust',
    aliases: [],
    description: 'Toggle trust mode (auto-approve all tools)',
    handler: async (_args, ctx) => {
      const enabled = ctx.permissions.toggleTrustMode();
      if (enabled) {
        ctx.renderer.renderWarning('Trust mode ON — all tool executions will be auto-approved.');
      } else {
        ctx.renderer.renderSuccess('Trust mode OFF — tools will require permission.');
      }
    },
  });

  // ── Shared recorder instance (persists across /record and /stop) ──
  let activeRecorder: ActionRecorder | null = null;

  registry.register({
    name: 'record',
    aliases: ['rec'],
    description: 'Start browser recording session',
    usage: '/record [url] [--format playwright|cypress|selenium|puppeteer]',
    handler: async (args, ctx) => {
      if (activeRecorder?.isRecording()) {
        ctx.renderer.renderWarning('Recording already in progress. Use /stop to end it.');
        return;
      }

      // Parse args: URL and optional --format flag
      let url = '';
      let format: 'playwright' | 'cypress' | 'selenium' | 'puppeteer' = 'playwright';
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--format' && args[i + 1]) {
          format = args[++i] as typeof format;
        } else if (!url) {
          url = args[i]!;
        }
      }

      activeRecorder = new ActionRecorder();
      let actionCount = 0;

      // Live-log captured actions to the terminal
      activeRecorder.onAction((action) => {
        actionCount++;
        const desc = action.description || action.type;
        console.log(
          chalk.dim(`  ${chalk.green('●')} [${actionCount}] `) + chalk.cyan(desc),
        );
      });

      try {
        ctx.renderer.renderInfo('Starting recording session...');
        await activeRecorder.start(
          {
            url: url || undefined,
            browser: 'chromium',
            headless: false,
            outputFormat: format,
          },
          ctx.browserManager,
        );

        console.log('');
        console.log(chalk.bold.cyan('  🔴 Recording — interact with the browser'));
        console.log(chalk.dim('  Your clicks, typing, and navigation are being captured live.'));
        console.log(chalk.dim('  Type ') + chalk.yellow('/stop') + chalk.dim(' to end recording and generate test code.'));
        if (url) {
          console.log(chalk.dim('  Started at: ') + chalk.underline(url));
        }
        console.log('');
      } catch (error) {
        activeRecorder = null;
        ctx.renderer.renderError(
          'Failed to start recording',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
  });

  registry.register({
    name: 'stop',
    aliases: [],
    description: 'Stop recording and generate test code',
    usage: '/stop [--format playwright|cypress|selenium|puppeteer] [--name test-name]',
    handler: async (args, ctx) => {
      if (!activeRecorder || !activeRecorder.isRecording()) {
        ctx.renderer.renderWarning('No recording in progress. Use /record [url] to start one.');
        return;
      }

      // Parse optional flags
      let format: 'playwright' | 'cypress' | 'selenium' | 'puppeteer' | undefined;
      let testName = 'recorded test';
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--format' && args[i + 1]) {
          format = args[++i] as 'playwright' | 'cypress' | 'selenium' | 'puppeteer';
        } else if (args[i] === '--name' && args[i + 1]) {
          testName = args[++i]!;
        }
      }

      try {
        const session = await activeRecorder.stop();
        const actionCount = session.actions.length;
        const duration = session.duration ? `${(session.duration / 1000).toFixed(1)}s` : 'unknown';

        console.log('');
        ctx.renderer.renderSuccess(
          `Recording stopped: ${actionCount} action(s) captured in ${duration}`,
        );

        if (actionCount === 0) {
          ctx.renderer.renderWarning('No interactions were recorded.');
          activeRecorder = null;
          return;
        }

        // 1. Analyze project structure (fast metadata scan)
        ctx.renderer.startSpinner('Analyzing project structure...');
        const projectCtx = await analyzeProject(process.cwd());
        ctx.renderer.stopSpinner(true);

        // Show detected context
        console.log('');
        if (projectCtx.framework) {
          console.log(
            chalk.dim('  Framework: ') + chalk.yellow(projectCtx.framework) +
            chalk.dim(' | Language: ') + chalk.yellow(projectCtx.language),
          );
          if (projectCtx.basePage) {
            console.log(
              chalk.dim('  Base page: ') + chalk.cyan(projectCtx.basePage.className) +
              chalk.dim(` (${projectCtx.basePage.methods.length} methods)`),
            );
          }
          if (projectCtx.existingPages.length > 0) {
            console.log(
              chalk.dim('  Existing POMs: ') + chalk.cyan(String(projectCtx.existingPages.length)),
            );
          }
        } else {
          console.log(chalk.dim('  No framework detected — generating standalone test file'));
        }

        // 2. Scan project structure (file map for LLM to explore)
        const projectStructure = scanProjectStructure(process.cwd(), projectCtx);

        // 3. Build rich prompt with recorded actions + project map
        const prompt = buildCodegenPrompt(session, projectCtx, projectStructure, { testName, format });

        // 4. Delegate to LLM — it analyzes the code, generates files, and writes them via write_file tool
        console.log('');
        ctx.renderer.renderInfo('Generating code with AI (analyzing your project patterns)...');
        await streamToRenderer(ctx, prompt);

        // 5. Show recorded actions summary
        console.log('');
        console.log(chalk.dim('  Recorded Actions:'));
        for (let i = 0; i < session.actions.length; i++) {
          const a = session.actions[i]!;
          console.log(
            chalk.dim(`    ${i + 1}. `) +
            chalk.yellow(a.type.padEnd(10)) +
            chalk.dim(a.description || ''),
          );
        }
        console.log('');
      } catch (error) {
        ctx.renderer.stopSpinner(false);
        ctx.renderer.renderError(
          'Failed to stop recording',
          error instanceof Error ? error : new Error(String(error)),
        );
      } finally {
        activeRecorder = null;
      }
    },
  });

  registry.register({
    name: 'run',
    aliases: [],
    description: 'Run test files',
    usage: '/run [files...] [--framework name]',
    handler: async (args, ctx) => {
      const files = args.filter((a) => !a.startsWith('--'));
      const frameworkIdx = args.indexOf('--framework');
      const framework = frameworkIdx >= 0 ? args[frameworkIdx + 1] : undefined;

      const prompt = framework
        ? `Run the following tests using ${framework}: ${files.join(' ') || 'all tests'}`
        : `Run the following tests: ${files.join(' ') || 'all tests in the project'}`;

      await streamToRenderer(ctx, prompt);
    },
  });

  registry.register({
    name: 'fix',
    aliases: [],
    description: 'Analyze and fix a failing test',
    usage: '/fix [file]',
    handler: async (args, ctx) => {
      const file = args[0];
      const prompt = file
        ? `Analyze the failing test in "${file}", identify the issue, and fix it.`
        : `Analyze the most recent test failures, identify the issues, and fix them.`;

      await streamToRenderer(ctx, prompt);
    },
  });

  registry.register({
    name: 'scan',
    aliases: [],
    description: 'Detect test frameworks in current project',
    handler: async (_args, ctx) => {
      const prompt =
        'Scan the current project directory to detect what test frameworks, programming languages, and testing tools are being used. List the findings.';

      await streamToRenderer(ctx, prompt);
    },
  });

  registry.register({
    name: 'scaffold',
    aliases: ['new'],
    description: 'Create a new test framework project',
    usage: '/scaffold <framework> [name]',
    handler: async (args, ctx) => {
      const framework = args[0];
      const name = args[1] || 'my-test-project';

      if (!framework) {
        ctx.renderer.renderWarning(
          'Usage: /scaffold <framework> [project-name]\nFrameworks: playwright, cypress, selenium-java, selenium-python, puppeteer, appium',
        );
        return;
      }

      const prompt = `Create a new ${framework} test automation project named "${name}" with proper directory structure, configuration files, and a sample test.`;

      await streamToRenderer(ctx, prompt);
    },
  });

  registry.register({
    name: 'browser',
    aliases: ['b'],
    description: 'Launch an interactive browser session',
    handler: async (_args, ctx) => {
      const prompt =
        'Launch a browser (chromium, not headless) so I can give you instructions to interact with web pages.';

      await streamToRenderer(ctx, prompt);
    },
  });

  registry.register({
    name: 'heal',
    aliases: ['healing'],
    description: 'Self-healing: inject into projects, view status, reports',
    usage: '/heal [inject <path>] [status] [report [days]] [remove <path>] [adapters]',
    handler: async (args, ctx) => {
      const subcommand = args[0]?.toLowerCase() || 'status';

      if (subcommand === 'inject') {
        const projectPath = args[1] || process.cwd();
        const prompt =
          `Inject self-healing into the test project at "${projectPath}". ` +
          `Use the heal_project tool. Auto-detect framework and language. ` +
          `After injection, explain what files were created and how to use them.`;
        await streamToRenderer(ctx, prompt);
        return;
      }

      if (subcommand === 'status') {
        try {
          const { HealingStore } = await import('../healing/store.js');
          const store = new HealingStore(process.cwd());
          const stats = store.getStats();
          const eventStats = store.getEventStats();
          const injections = store.getInjections('active');

          const lines = [
            chalk.bold('Self-Healing Status'),
            '',
            `${chalk.cyan('Fingerprints stored:')} ${stats.total}`,
            `${chalk.cyan('Healing events:')} ${eventStats.total} (${chalk.green(String(eventStats.healed) + ' healed')}, ${chalk.red(String(eventStats.failed) + ' failed')})`,
            `${chalk.cyan('Success rate:')} ${eventStats.total > 0 ? Math.round((eventStats.healed / eventStats.total) * 100) : 0}%`,
          ];

          if (injections.length > 0) {
            lines.push('', chalk.bold(`Injected projects (${injections.length}):`));
            for (const inj of injections) {
              lines.push(
                `  ${chalk.green('●')} ${inj.projectPath} — ${inj.framework}/${inj.language}`,
              );
            }
          } else {
            lines.push('', chalk.dim('No projects injected. Use /heal inject <path> to get started.'));
          }

          store.close();
          ctx.renderer.renderBox('Self-Healing', lines.join('\n'));
        } catch (error) {
          ctx.renderer.renderError(`Failed to get healing status: ${error}`);
        }
        return;
      }

      if (subcommand === 'report') {
        const days = args[1] ? parseInt(args[1], 10) : 30;
        try {
          const { HealingStore } = await import('../healing/store.js');
          const store = new HealingStore(process.cwd());
          const analytics = store.getAnalytics(days);

          const lines = [
            chalk.bold(`Healing Report (last ${days} days)`),
            '',
            `Total events: ${analytics.totalEvents}`,
            `Healed: ${chalk.green(String(analytics.totalHealed))}  Failed: ${chalk.red(String(analytics.totalFailed))}`,
            `Success rate: ${analytics.overallSuccessRate}%`,
            `Avg confidence: ${analytics.averageConfidence}`,
            `Avg duration: ${analytics.averageDurationMs}ms`,
            `AI healing rate: ${analytics.aiHealingRate}%`,
          ];

          if (analytics.strategyBreakdown.length > 0) {
            lines.push('', chalk.bold('Strategy breakdown:'));
            for (const s of analytics.strategyBreakdown) {
              lines.push(`  ${s.strategy}: ${s.count} (${s.successRate}% success)`);
            }
          }

          if (analytics.frameworkBreakdown.length > 0) {
            lines.push('', chalk.bold('Framework breakdown:'));
            for (const f of analytics.frameworkBreakdown) {
              lines.push(`  ${f.framework}: ${f.count} (${f.successRate}% success)`);
            }
          }

          if (analytics.topFailures.length > 0) {
            lines.push('', chalk.bold('Top failures:'));
            for (const f of analytics.topFailures.slice(0, 5)) {
              lines.push(`  ${chalk.red(f.selectorKey)} — ${f.failureCount} failures`);
            }
          }

          store.close();
          ctx.renderer.renderBox('Healing Report', lines.join('\n'));
        } catch (error) {
          ctx.renderer.renderError(`Failed to generate report: ${error}`);
        }
        return;
      }

      if (subcommand === 'remove') {
        const projectPath = args[1];
        if (!projectPath) {
          ctx.renderer.renderWarning('Usage: /heal remove <project-path>');
          return;
        }
        try {
          const { HealingStore } = await import('../healing/store.js');
          const store = new HealingStore(process.cwd());
          const inj = store.getInjectionByProject(projectPath);
          if (inj) {
            store.updateInjectionStatus(inj.id, 'removed');
            ctx.renderer.renderSuccess(`Removed healing from ${projectPath}`);
          } else {
            ctx.renderer.renderWarning(`No active healing injection found for ${projectPath}`);
          }
          store.close();
        } catch (error) {
          ctx.renderer.renderError(`Failed to remove healing: ${error}`);
        }
        return;
      }

      if (subcommand === 'adapters') {
        try {
          const { getSupportedAdapters } = await import('../healing/adapters/index.js');
          const adapters = getSupportedAdapters();
          const lines = [
            chalk.bold('Supported Healing Adapters:'),
            '',
            ...adapters.map(
              (a) => `  ${chalk.green('●')} ${a.displayName} (${a.framework}/${a.language})`,
            ),
          ];
          ctx.renderer.renderBox('Healing Adapters', lines.join('\n'));
        } catch (error) {
          ctx.renderer.renderError(`Failed to list adapters: ${error}`);
        }
        return;
      }

      // Unknown subcommand — show help
      ctx.renderer.renderBox(
        'Self-Healing Commands',
        [
          `${chalk.cyan('/heal')}              — Show healing status`,
          `${chalk.cyan('/heal inject [path]')} — Inject healing into a project`,
          `${chalk.cyan('/heal status')}        — Show healing statistics`,
          `${chalk.cyan('/heal report [days]')} — Generate analytics report`,
          `${chalk.cyan('/heal remove <path>')} — Remove healing from a project`,
          `${chalk.cyan('/heal adapters')}      — List supported frameworks`,
        ].join('\n'),
      );
    },
  });

  registry.register({
    name: 'cost',
    aliases: [],
    description: 'Show token usage and estimated cost',
    handler: async (_args, ctx) => {
      const router = ctx.orchestrator.getRouter();
      const stats = router.getTotalStats();
      ctx.renderer.renderBox(
        'Token Usage',
        `Total tokens: ${stats.totalTokens.toLocaleString()}\nTotal requests: ${stats.totalRequests}`,
      );
    },
  });

  // ── UI Dashboard ────────────────────────────────────────────────────────

  let uiServerActive = false;

  registry.register({
    name: 'buildUI',
    aliases: ['ui', 'dashboard'],
    description: 'Launch the test management UI dashboard',
    usage: '/buildUI [--port 3700] [--project <path>]',
    handler: async (args, ctx) => {
      if (uiServerActive) {
        ctx.renderer.renderWarning('UI Dashboard is already running.');
        return;
      }

      // Parse args
      let port = 3700;
      let projectPath = process.cwd();
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) {
          port = parseInt(args[++i]!, 10);
        } else if (args[i] === '--project' && args[i + 1]) {
          projectPath = args[++i]!;
        }
      }

      try {
        ctx.renderer.renderInfo('Starting UI Dashboard...');

        const { startUIServer } = await import('../ui/index.js');
        const server = await startUIServer({
          port,
          projectPath,
          orchestrator: ctx.orchestrator,
          browserManager: ctx.browserManager,
        });

        uiServerActive = true;
        const url = `http://localhost:${server.port}`;

        console.log('');
        ctx.renderer.renderSuccess(`UI Dashboard running at ${chalk.underline(url)}`);
        console.log(chalk.dim('  Open this URL in your browser to access the dashboard.'));
        console.log(chalk.dim('  The dashboard auto-updates when project files change.'));
        console.log('');

        // Try to auto-open browser
        try {
          const open = (await import('open')).default;
          await open(url);
        } catch {
          // 'open' package not available — user can open manually
        }
      } catch (error) {
        uiServerActive = false;
        ctx.renderer.renderError(
          'Failed to start UI Dashboard',
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
  });
}
