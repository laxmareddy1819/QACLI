import type { Express } from 'express';
import type { WebSocketServer, WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { generateId } from '../../utils/index.js';
import type { ProjectScanner } from '../scanner/project-scanner.js';
import type { UIServerOptions } from '../server.js';
import { buildRunCommand } from '../scanner/framework-adapters.js';
import { getReporterArgs, getResultPath } from '../parsers/reporter-config.js';
import { parseTestResults } from '../parsers/index.js';
import { detectFrameworkFromStdout } from '../parsers/stdout-parser.js';
import type { TestResultsStore } from '../store/test-results-store.js';
import type { CloudConfigStore, CloudProviderId } from '../store/cloud-config-store.js';
import type { CloudArtifactFetcher } from '../services/cloud-artifact-fetcher.js';
import type { GitService } from '../services/git-service.js';
import type { RunResult, StoredRun } from '../types.js';
import { audit } from './audit-helper.js';

// Active runs
const activeRuns = new Map<string, { process: ChildProcess; result: RunResult; stdout: string; stderr: string; framework: string | null; cloudProvider?: string; source: 'manual' | 'scheduler' | 'cli' }>();
const runHistory: RunResult[] = [];
const MAX_HISTORY = 50;

export function mountRunnerRoutes(
  app: Express,
  wss: WebSocketServer,
  scanner: ProjectScanner,
  options: UIServerOptions,
  resultsStore: TestResultsStore,
  cloudConfigStore?: CloudConfigStore,
  artifactFetcher?: CloudArtifactFetcher,
  pushActivity?: (entry: { type: string; exitCode?: number; duration?: number; passed?: number; failed?: number; timestamp: string }) => void,
  gitService?: GitService,
): void {

  // POST /api/runner/run — Start a test execution
  app.post('/api/runner/run', async (req, res) => {
    try {
      const { files, framework, args, env, headless, command: rawCommand, cloudProvider, buildName, source: reqSource } = req.body;

      // Auto-detect framework if not specified
      let fw = framework;
      if (!fw) {
        const info = await scanner.getInfo();
        fw = info.framework;
      }

      let command: string;
      const isRawCommand = rawCommand && typeof rawCommand === 'string' && rawCommand.trim();

      if (isRawCommand) {
        // User provided a raw command — detect framework from the command text
        // so we can inject reporter args for structured result capture
        command = rawCommand.trim();
        const detectedFw = detectFrameworkFromCommand(command) || fw;
        fw = detectedFw;
        console.log(`[qabot-runner] Framework detected: ${fw || 'unknown'} (from command: ${detectedFw ? 'yes' : 'no, fallback to scanner'})`);

        // Inject reporter args into the raw command for structured output,
        // but only if the user hasn't already specified a reporter/format flag
        const hasReporter = /--format\s|--reporter[=\s]|--json\b|--junit-xml|--logger\s/i.test(command);
        if (!hasReporter) {
          const reporterArgs = getReporterArgs(fw);
          if (reporterArgs.length > 0) {
            command = `${command} ${reporterArgs.join(' ')}`;
            console.log(`[qabot-runner] Reporter injected: ${reporterArgs.join(' ')}`);
          }
        } else {
          console.log(`[qabot-runner] Reporter already specified in command, skipping injection`);
        }
      } else {
        // Build from framework/files/args
        const reporterArgs = getReporterArgs(fw);
        const combinedArgs = [args || '', ...reporterArgs].filter(Boolean).join(' ');
        command = buildRunCommand(fw, files, combinedArgs).command;
      }

      const runId = generateId();
      const result: RunResult = {
        runId,
        command,
        startTime: new Date().toISOString(),
        status: 'running',
      };

      // Add headless env var if requested
      const runEnv: Record<string, string | undefined> = { ...process.env, ...(env || {}) };
      if (headless !== undefined) {
        runEnv.HEADLESS = headless ? 'true' : 'false';
      }

      // Cloud grid: inject provider env vars + generate config + wrap command
      let runSource: 'local' | 'cloud' = 'local';
      let runCloudProvider: string | undefined;
      let runCloudBuildName: string | undefined;
      if (cloudProvider && cloudConfigStore) {
        const cloudEnv = cloudConfigStore.getCloudEnvVars(
          cloudProvider as CloudProviderId,
          buildName,
        );
        if (Object.keys(cloudEnv).length > 0) {
          Object.assign(runEnv, cloudEnv);
          runSource = 'cloud';
          runCloudProvider = cloudProvider;
          // Capture the build name for artifact fetching later
          runCloudBuildName = buildName || cloudEnv.BROWSERSTACK_BUILD_NAME || cloudEnv.LT_BUILD_NAME || cloudEnv.SAUCE_BUILD_NAME;

          // Generate the provider's config file (browserstack.yml, etc.)
          // so SDK wrappers can pick up credentials + platform settings
          try {
            const configPath = cloudConfigStore.generateConfigFile(
              cloudProvider as CloudProviderId,
              options.projectPath,
              buildName,
            );
            if (configPath) {
              console.log(`[qabot] Generated cloud config: ${configPath}`);
            }
          } catch (err) {
            console.error('[qabot] Failed to generate cloud config:', err);
          }

          // Wrap command with provider SDK for transparent cloud execution.
          // The SDK intercepts browser launch calls and redirects to the cloud grid.
          // e.g., "pnpm test" → "npx browserstack-node-sdk pnpm test"
          command = wrapCommandForCloud(cloudProvider as CloudProviderId, command);
        }
      }

      // Playwright: redirect JSON reporter output to a file so stdout stays
      // human-readable (list reporter). Without this, JSON goes to stdout.
      if (fw === 'playwright') {
        const jsonPath = join(options.projectPath, '.qabot-results.json');
        runEnv.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonPath;
        console.log(`[qabot-runner] PLAYWRIGHT_JSON_OUTPUT_NAME → ${jsonPath}`);
      }

      // Clean up stale result files from previous runs so parsers don't
      // read outdated data if the new run fails to produce output
      cleanupResultFiles(options.projectPath, fw);

      // Use spawn with shell:true — Node handles platform-specific quoting
      // correctly for both cmd.exe (Windows) and /bin/sh (Unix), including
      // commands with embedded double quotes like --name "scenario name".
      const proc = spawn(command, [], {
        cwd: options.projectPath,
        env: runEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      const runSourceType: 'manual' | 'scheduler' | 'cli' = reqSource === 'scheduler' ? 'scheduler' : reqSource === 'cli' ? 'cli' : 'manual';
      activeRuns.set(runId, { process: proc, result, stdout: '', stderr: '', framework: fw, cloudProvider: runCloudProvider, source: runSourceType });

      // Broadcast run-started to all clients for global active run tracking
      broadcast(wss, {
        type: 'run-started',
        runId,
        command,
        startTime: result.startTime,
        framework: fw,
        cloudProvider: runCloudProvider,
        source: runSourceType,
      });

      // Track test progress from stdout
      let testCount = 0;

      // Stream stdout
      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        const active = activeRuns.get(runId);
        if (active) active.stdout += text;

        broadcast(wss, { type: 'output', runId, data: text, stream: 'stdout' });

        // Real-time test progress detection
        detectTestProgress(wss, runId, text, fw, () => ++testCount);
      });

      // Stream stderr
      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        const active = activeRuns.get(runId);
        if (active) active.stderr += text;

        broadcast(wss, { type: 'output', runId, data: text, stream: 'stderr' });
      });

      // Completion
      const startMs = Date.now();
      proc.on('close', async (code) => {
        const duration = Date.now() - startMs;
        result.endTime = new Date().toISOString();
        result.exitCode = code ?? 1;
        result.status = code === 0 ? 'completed' : 'failed';
        result.duration = duration;

        // Parse and store test results BEFORE broadcasting 'complete'.
        // This ensures 'test-results' arrives while the frontend still has
        // activeRunId set (useLiveProgress unsubscribes when activeRun → null).
        let parsedPassed = 0;
        let parsedFailed = 0;
        const active = activeRuns.get(runId);
        if (active) {
          try {
            // Auto-detect framework from stdout if not known (raw command)
            const effectiveFw = fw || detectFrameworkFromStdout(active.stdout);
            console.log(`[qabot-runner] Parsing results (framework: ${effectiveFw}, project: ${options.projectPath})`);
            const parsed = parseTestResults(effectiveFw, options.projectPath, active.stdout, active.stderr);
            parsedPassed = parsed.summary.passed;
            parsedFailed = parsed.summary.failed;
            console.log(`[qabot-runner] Results: ${parsed.summary.total} tests (${parsedPassed} passed, ${parsedFailed} failed, ${parsed.summary.skipped} skipped)`);
            if (parsed.tests.length > 0) {
              const withScreenshots = parsed.tests.filter(t => t.screenshotPath).length;
              const withVideos = parsed.tests.filter(t => t.videoPath).length;
              const withTraces = parsed.tests.filter(t => t.tracePath).length;
              const withErrors = parsed.tests.filter(t => t.errorMessage).length;
              console.log(`[qabot-runner] Artifacts: ${withScreenshots} screenshots, ${withVideos} videos, ${withTraces} traces, ${withErrors} errors`);
            }

            // Capture git metadata (non-blocking)
            let gitCommitSha: string | undefined;
            let gitBranch: string | undefined;
            let gitAuthor: string | undefined;
            let gitCommitMessage: string | undefined;
            try {
              if (gitService && gitService.isAvailable()) {
                const gitStatus = await gitService.getStatus();
                gitBranch = gitStatus?.branch;
                if (gitStatus?.lastCommit) {
                  gitCommitSha = gitStatus.lastCommit.shortSha;
                  gitAuthor = gitStatus.lastCommit.author;
                  gitCommitMessage = gitStatus.lastCommit.message;
                }
              }
            } catch { /* ignore git errors */ }

            const storedRun: StoredRun = {
              runId,
              framework: effectiveFw,
              command,
              projectPath: options.projectPath,
              startTime: result.startTime,
              endTime: result.endTime,
              exitCode: result.exitCode,
              status: result.status,
              duration,
              summary: parsed.summary,
              tests: parsed.tests,
              // Cloud grid metadata
              source: runSource,
              cloudProvider: runCloudProvider as any,
              cloudBuildName: runCloudBuildName,
              // Git metadata
              gitCommitSha,
              gitBranch,
              gitAuthor,
              gitCommitMessage,
            };

            resultsStore.saveRun(storedRun);

            // Async cloud operations (non-blocking — runs in background)
            if (runSource === 'cloud' && artifactFetcher && runCloudProvider && runCloudBuildName) {
              // Mark cloud build as complete so provider dashboard reflects correct status
              artifactFetcher
                .markBuildComplete(runCloudProvider as CloudProviderId, runCloudBuildName, code ?? 1)
                .catch(err => console.error('[qabot] Cloud build completion failed:', err));

              // Fetch artifacts after a delay — cloud providers need time to process video recordings
              setTimeout(() => {
                artifactFetcher!
                  .fetchArtifacts(runId, runCloudProvider as CloudProviderId, runCloudBuildName!)
                  .then(artifacts => {
                    if (artifacts) {
                      broadcast(wss, { type: 'cloud-artifacts' as any, runId, artifacts });
                    }
                  })
                  .catch(err => console.error('[qabot] Artifact fetch failed:', err));
              }, 5000);
            }

            // Broadcast parsed results summary BEFORE 'complete' so the
            // frontend picks it up while the run is still considered active
            broadcast(wss, {
              type: 'test-results',
              runId,
              summary: { ...parsed.summary, duration },
            });
          } catch (parseErr) {
            // Parse failure is non-fatal — log for debugging
            console.error('[qabot] Test result parsing failed:', parseErr);
          }
        }

        // Now broadcast 'complete' with test counts (belt-and-suspenders for banner)
        broadcast(wss, { type: 'complete', runId, exitCode: code ?? 1, duration, passed: parsedPassed, failed: parsedFailed });
        pushActivity?.({ type: 'complete', exitCode: code ?? 1, duration, passed: parsedPassed, failed: parsedFailed, timestamp: new Date().toISOString() });

        activeRuns.delete(runId);
        runHistory.unshift(result);
        if (runHistory.length > MAX_HISTORY) runHistory.pop();
      });

      proc.on('error', (err) => {
        result.endTime = new Date().toISOString();
        result.status = 'failed';
        result.exitCode = 1;

        broadcast(wss, { type: 'error', runId, message: `Process error: ${err.message}` });

        activeRuns.delete(runId);
        runHistory.unshift(result);
        if (runHistory.length > MAX_HISTORY) runHistory.pop();
      });

      audit(req, 'run.start', { resourceType: 'test-run', resourceId: runId, details: { command, framework: fw } });
      res.json({ runId, command, status: 'running' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/runner/active — List all currently active runs
  app.get('/api/runner/active', (_req, res) => {
    const active = Array.from(activeRuns.entries()).map(([id, entry]) => ({
      runId: id,
      command: entry.result.command,
      startTime: entry.result.startTime,
      status: entry.result.status,
      framework: entry.framework,
      cloudProvider: entry.cloudProvider,
      source: entry.source,
    }));
    res.json({ runs: active });
  });

  // GET /api/runner/status/:id — Get run status
  app.get('/api/runner/status/:id', (req, res) => {
    const runId = req.params.id!;

    // Check active runs
    const active = activeRuns.get(runId);
    if (active) {
      res.json(active.result);
      return;
    }

    // Check history
    const hist = runHistory.find(r => r.runId === runId);
    if (hist) {
      res.json(hist);
      return;
    }

    res.status(404).json({ error: 'Run not found' });
  });

  // POST /api/runner/cancel/:id — Cancel a running test
  app.post('/api/runner/cancel/:id', (req, res) => {
    const runId = req.params.id!;
    const active = activeRuns.get(runId);

    if (!active) {
      res.status(404).json({ error: 'Run not found or already completed' });
      return;
    }

    active.process.kill('SIGTERM');
    active.result.status = 'cancelled';
    active.result.endTime = new Date().toISOString();

    activeRuns.delete(runId);
    runHistory.unshift(active.result);

    audit(req, 'run.cancel', { resourceType: 'test-run', resourceId: runId });
    res.json({ runId, status: 'cancelled' });
  });

  // GET /api/runner/history — Get run history
  app.get('/api/runner/history', (_req, res) => {
    res.json({ history: runHistory, count: runHistory.length });
  });
}

/**
 * Check if text looks like a BDD step (Given/When/Then/And/But).
 * These are sub-steps of a scenario, not individual tests.
 */
function isBddStep(text: string): boolean {
  return /^(Given|When|Then|And|But|After|Before)\s/i.test(text);
}

/**
 * Detect individual test pass/fail from stdout and broadcast progress.
 * Skips BDD step lines — only counts actual tests/scenarios.
 */
/**
 * Strip ANSI escape codes from text.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\].*?\x07/g, '');
}

function detectTestProgress(
  wss: WebSocketServer,
  runId: string,
  text: string,
  framework: string | null,
  counter: () => number,
): void {
  const fw = framework?.toLowerCase();
  const lines = stripAnsi(text).split('\n');

  for (const line of lines) {
    // Playwright: ✓ N [browser] › file › test name (duration)
    // This pattern with "›" separators is Playwright-specific and NOT step-level
    if (fw === 'playwright' || /›.*›/.test(line)) {
      const passMatch = line.match(/[✓]\s+\d+\s+.*›\s+(.+?)(?:\s+\(\d+[ms]+\))?$/);
      if (passMatch) {
        const count = counter();
        broadcast(wss, { type: 'test-passed', runId, testName: passMatch[1]!.trim(), duration: 0 });
        broadcast(wss, { type: 'test-progress', runId, current: count, total: 0, testName: passMatch[1]!.trim(), status: 'passed' });
      }
      const failMatch = line.match(/[✗✘×]\s+\d+\s+.*›\s+(.+?)(?:\s+\(\d+[ms]+\))?$/);
      if (failMatch) {
        const count = counter();
        broadcast(wss, { type: 'test-failed', runId, testName: failMatch[1]!.trim(), duration: 0, error: '' });
        broadcast(wss, { type: 'test-progress', runId, current: count, total: 0, testName: failMatch[1]!.trim(), status: 'failed' });
      }
      if (passMatch || failMatch) continue;
    }

    // Cucumber: detect "Scenario:" lines as test boundaries (not steps)
    const scenarioLine = line.match(/^\s*Scenario(?:\s+Outline)?:\s*(.+)/);
    if (scenarioLine) {
      const count = counter();
      broadcast(wss, { type: 'test-progress', runId, current: count, total: 0, testName: scenarioLine[1]!.trim(), status: 'running' });
      continue;
    }

    // Cucumber progress formatter: dots like ".F-.FU" (each char = a step)
    // Count 'F' markers as step-level failures for live progress indication
    if (fw === 'cucumber' && /^[.FU\-P?]+$/.test(line.trim()) && line.trim().length > 0) {
      const dots = line.trim();
      const stepsPassed = (dots.match(/\./g) || []).length;
      const stepsFailed = (dots.match(/F/g) || []).length;
      if (stepsPassed + stepsFailed > 0) {
        const count = counter();
        broadcast(wss, {
          type: 'test-progress', runId,
          current: count, total: 0,
          testName: `${stepsPassed + stepsFailed} steps (${stepsFailed} failed)`,
          status: stepsFailed > 0 ? 'failed' : 'running',
        });
      }
      continue;
    }

    // Jest/Mocha: ✓ test name (duration) — but skip BDD steps
    const jestPass = line.match(/^\s+[✓✔]\s+(.+?)(?:\s+\((\d+)\s*ms\))?$/);
    if (jestPass) {
      const testName = jestPass[1]!.trim();
      if (isBddStep(testName)) continue; // Skip Given/When/Then steps
      const count = counter();
      broadcast(wss, { type: 'test-passed', runId, testName, duration: 0 });
      broadcast(wss, { type: 'test-progress', runId, current: count, total: 0, testName, status: 'passed' });
    }
    const jestFail = line.match(/^\s+[✗✘×]\s+(.+?)$/);
    if (jestFail) {
      const testName = jestFail[1]!.trim();
      if (isBddStep(testName)) continue; // Skip Given/When/Then steps
      const count = counter();
      broadcast(wss, { type: 'test-failed', runId, testName, duration: 0, error: '' });
      broadcast(wss, { type: 'test-progress', runId, current: count, total: 0, testName, status: 'failed' });
    }

    // pytest: test_file.py::test_name PASSED/FAILED
    const pytestMatch = line.match(/^([\w/.]+\.py)::(\S+)\s+(PASSED|FAILED)/);
    if (pytestMatch) {
      const count = counter();
      const status = pytestMatch[3] === 'PASSED' ? 'passed' as const : 'failed' as const;
      broadcast(wss, { type: 'test-progress', runId, current: count, total: 0, testName: pytestMatch[2]!, status });
    }
  }
}

/**
 * Remove stale result files from previous runs so parsers don't
 * accidentally read outdated data from a prior execution.
 */
function cleanupResultFiles(projectPath: string, framework: string | null): void {
  // Clean the framework-specific result file
  const resultPath = getResultPath(framework, projectPath);
  if (resultPath) {
    try { if (existsSync(resultPath)) unlinkSync(resultPath); } catch { /* ignore */ }
  }

  // Also clean the generic .qabot-results files (covers framework mis-detection)
  const genericFiles = ['.qabot-results.json', '.qabot-results.xml'];
  for (const f of genericFiles) {
    const fullPath = join(projectPath, f);
    try { if (existsSync(fullPath)) unlinkSync(fullPath); } catch { /* ignore */ }
  }
}

/**
 * Detect test framework from a raw command string.
 * e.g., "npx cucumber-js features/" → "cucumber"
 *       "npx playwright test" → "playwright"
 */
function detectFrameworkFromCommand(command: string): string | null {
  const cmd = command.toLowerCase();

  if (/\bcucumber-js\b|\bcucumber\b/.test(cmd)) return 'cucumber';
  if (/\bplaywright\b/.test(cmd)) return 'playwright';
  if (/\bcypress\b/.test(cmd)) return 'cypress';
  if (/\bjest\b/.test(cmd)) return 'jest';
  if (/\bvitest\b/.test(cmd)) return 'vitest';
  if (/\bmocha\b/.test(cmd)) return 'mocha';
  if (/\bpytest\b/.test(cmd)) return 'pytest';
  if (/\brobot\b/.test(cmd)) return 'robot';
  if (/\bwdio\b|\bwebdriverio\b/.test(cmd)) return 'webdriverio';
  if (/\bmvn\s+test\b|\bmaven\b/.test(cmd)) return 'maven';
  if (/\bdotnet\s+test\b/.test(cmd)) return 'dotnet';

  return null;
}

/**
 * Wrap the user's test command with the cloud provider's SDK/CLI.
 *
 * Strategy per provider:
 *
 * BrowserStack:
 *   - `npx playwright test` → `npx browserstack-node-sdk npx playwright test`
 *     (SDK intercepts chromium.launch() and redirects to BrowserStack)
 *   - `cucumber-js` / `pnpm test` / other → command stays unchanged
 *     (cloud connection is handled via SELENIUM_REMOTE_URL env var or
 *      cloud-aware hooks that detect BROWSERSTACK_USERNAME and use chromium.connect())
 *
 * LambdaTest:
 *   - Cypress → `npx lambdatest-cypress run`
 *   - Others → env vars (SELENIUM_REMOTE_URL, LT_USERNAME, LT_ACCESS_KEY) handle it
 *
 * SauceLabs:
 *   - Direct Playwright/Cypress → `npx saucectl run` (reads .sauce/config.yml)
 *   - Others → env vars handle it
 *
 * For Cucumber, Maven, pytest, Robot Framework, etc.: the command is NOT wrapped.
 * These frameworks rely on env vars (SELENIUM_REMOTE_URL, provider credentials)
 * and cloud-aware test hooks to connect to the grid.
 */
function wrapCommandForCloud(provider: CloudProviderId, command: string): string {
  const cmd = command.toLowerCase();

  // Detect if this is a direct Playwright test runner command (not Cucumber/npm script)
  const isDirectPlaywright = /\bplaywright\s+test\b/.test(cmd);
  const isCypress = /\bcypress\b/.test(cmd);

  switch (provider) {
    case 'browserstack':
      // Only wrap direct `npx playwright test` commands with the SDK.
      // For Cucumber, npm scripts, etc., env vars + cloud-aware hooks handle it.
      if (isDirectPlaywright) {
        return `npx browserstack-node-sdk ${command}`;
      }
      // All other commands: env vars (BROWSERSTACK_USERNAME, BROWSERSTACK_ACCESS_KEY,
      // SELENIUM_REMOTE_URL) are already injected — hooks use chromium.connect()
      return command;

    case 'lambdatest':
      if (isCypress) {
        return `npx lambdatest-cypress run`;
      }
      if (isDirectPlaywright) {
        return `npx lambdatest-node-sdk ${command}`;
      }
      return command;

    case 'saucelabs':
      if (isDirectPlaywright || isCypress) {
        return `npx saucectl run`;
      }
      return command;

    default:
      return command;
  }
}

function broadcast(wss: WebSocketServer, message: object): void {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if ((client as WebSocket).readyState === 1 /* OPEN */) {
      client.send(data);
    }
  }
}
