import { existsSync, statSync, createReadStream } from 'node:fs';
import { join, extname, isAbsolute, resolve } from 'node:path';
import type { Express } from 'express';
import type { TestResultsStore } from '../store/test-results-store.js';
import type { CloudArtifactFetcher } from '../services/cloud-artifact-fetcher.js';
import type { CloudProviderId } from '../store/cloud-config-store.js';

export function mountResultsRoutes(
  app: Express,
  resultsStore: TestResultsStore,
  artifactFetcher?: CloudArtifactFetcher,
): void {

  // GET /api/results/runs — List all runs (paginated)
  app.get('/api/results/runs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;
    const { runs, total } = resultsStore.getRunHistory(limit, offset);

    // Return runs without full test arrays for list view
    const summary = runs.map(r => ({
      runId: r.runId,
      framework: r.framework,
      command: r.command,
      startTime: r.startTime,
      endTime: r.endTime,
      exitCode: r.exitCode,
      status: r.status,
      duration: r.duration,
      summary: r.summary,
      hasAnalysis: !!r.failureAnalysis,
      source: r.source,
      cloudProvider: r.cloudProvider,
      cloudBuildName: r.cloudBuildName,
      hasCloudArtifacts: !!r.cloudArtifacts,
    }));

    res.json({ runs: summary, total, limit, offset });
  });

  // GET /api/results/runs/:id — Single run with summary
  app.get('/api/results/runs/:id', (req, res) => {
    const run = resultsStore.getRun(req.params.id!);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(run);
  });

  // GET /api/results/runs/:id/tests — Test cases for a run
  app.get('/api/results/runs/:id/tests', (req, res) => {
    const status = req.query.status as string | undefined;
    const tests = resultsStore.getTestCases(req.params.id!, status);
    res.json({ tests, count: tests.length });
  });

  // GET /api/results/runs/:id/failures — Failed tests only
  app.get('/api/results/runs/:id/failures', (req, res) => {
    const failures = resultsStore.getFailures(req.params.id!);
    res.json({ failures, count: failures.length });
  });

  // GET /api/results/trends — Pass/fail/skip over last N runs
  app.get('/api/results/trends', (req, res) => {
    const count = Math.min(parseInt(req.query.count as string) || 20, 100);
    const trends = resultsStore.getTrends(count);
    res.json({ trends });
  });

  // GET /api/results/flaky — Flaky tests
  app.get('/api/results/flaky', (req, res) => {
    const threshold = parseFloat(req.query.threshold as string) || 0.2;
    const flaky = resultsStore.getFlaky(threshold);
    res.json({ flaky, count: flaky.length });
  });

  // GET /api/results/slowest — Slowest tests
  app.get('/api/results/slowest', (req, res) => {
    const count = Math.min(parseInt(req.query.count as string) || 20, 50);
    const slowest = resultsStore.getSlowest(count);
    res.json({ slowest });
  });

  // GET /api/results/top-failures — Most frequently failing tests
  app.get('/api/results/top-failures', (req, res) => {
    const count = Math.min(parseInt(req.query.count as string) || 20, 50);
    const topFailures = resultsStore.getTopFailures(count);
    res.json({ topFailures });
  });

  // GET /api/results/runs/:id/analysis — Get AI failure analysis
  app.get('/api/results/runs/:id/analysis', (req, res) => {
    const analysis = resultsStore.getFailureAnalysis(req.params.id!);
    if (!analysis) {
      res.status(404).json({ error: 'No analysis available for this run' });
      return;
    }
    res.json({ groups: analysis });
  });

  // GET /api/results/test/:name/history — Per-test history
  app.get('/api/results/test/:name/history', (req, res) => {
    const testName = decodeURIComponent(req.params.name!);
    const history = resultsStore.getTestHistory(testName);
    res.json({ testName, history, count: history.length });
  });

  // POST /api/results/runs/:id/fetch-artifacts — Manually fetch cloud artifacts
  app.post('/api/results/runs/:id/fetch-artifacts', async (req, res) => {
    if (!artifactFetcher) {
      res.status(503).json({ error: 'Cloud artifact fetcher not available' });
      return;
    }

    const run = resultsStore.getRun(req.params.id!);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (run.source !== 'cloud' || !run.cloudProvider) {
      res.status(400).json({ error: 'This is not a cloud run' });
      return;
    }

    if (!run.cloudBuildName) {
      res.status(400).json({ error: 'Cloud build name not available for this run' });
      return;
    }

    try {
      const artifacts = await artifactFetcher.fetchArtifacts(
        run.runId,
        run.cloudProvider as CloudProviderId,
        run.cloudBuildName,
      );

      if (artifacts) {
        res.json({ artifacts, message: `Fetched ${artifacts.sessions?.length || 0} sessions from ${run.cloudProvider}` });
      } else {
        res.json({ artifacts: null, message: 'No artifacts found. The build may not have completed yet on the cloud provider.' });
      }
    } catch (error) {
      res.status(500).json({ error: `Failed to fetch artifacts: ${String(error)}` });
    }
  });

  // GET /api/results/runs/:id/report — Generate downloadable HTML report
  app.get('/api/results/runs/:id/report', async (req, res) => {
    const run = resultsStore.getRun(req.params.id!);
    if (!run) { res.status(404).json({ error: 'Run not found' }); return; }
    try {
      const { generateHtmlReport } = await import('../services/report-generator.js');

      // Pre-compute human-readable steps for tests that don't have BDD execution steps
      const humanStepsMap = new Map<string, import('../services/report-generator.js').HumanStep[]>();
      try {
        const { scanAllTests } = await import('../scanner/test-scanner.js');
        const { generateHumanSteps } = await import('../services/step-generator.js');
        const { readFileSync, existsSync } = await import('node:fs');
        const { resolve, basename } = await import('node:path');

        const scanResult = scanAllTests(run.projectPath);
        const allScannedTests = scanResult.suites.flatMap(s => s.tests);

        for (const t of (run.tests || [])) {
          // Skip tests that already have BDD execution steps
          if (t.steps && t.steps.length > 0) continue;
          if (!t.file) continue;

          const fileBasename = basename(t.file);
          const matchedTest = allScannedTests.find(st =>
            st.name === t.name && (
              st.file === t.file ||
              basename(st.file) === fileBasename ||
              st.file.endsWith(t.file!) ||
              t.file!.endsWith(st.file)
            ),
          );

          if (matchedTest?.line) {
            const fullPath = resolve(run.projectPath, matchedTest.file);
            if (existsSync(fullPath)) {
              const content = readFileSync(fullPath, 'utf-8');
              const allLines = content.split('\n');
              const endLine = Math.min(matchedTest.endLine || matchedTest.line + 50, allLines.length);
              const source = allLines.slice(matchedTest.line - 1, endLine).join('\n');
              const steps = generateHumanSteps(source, matchedTest.framework, matchedTest.line);
              if (steps.length > 0) {
                humanStepsMap.set(t.name, steps);
              }
            }
          }
        }
      } catch {
        // Step generation is best-effort — continue without human steps
      }

      const html = generateHtmlReport(run, {
        embedScreenshots: req.query.screenshots !== 'false',
        projectPath: run.projectPath,
        humanStepsMap,
      });
      const timestamp = new Date(run.startTime).toISOString().slice(0, 10);
      const framework = run.framework || 'tests';
      const filename = `qabot-report-${framework}-${timestamp}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(html);
    } catch (error) {
      res.status(500).json({ error: `Report generation failed: ${String(error)}` });
    }
  });

  // ── Artifact serving ────────────────────────────────────────────────────
  // GET /api/results/artifact?path=relative/path&project=projectPath
  // Serves screenshots, videos, traces, and other binary test artifacts.
  const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.zip': 'application/zip',
    '.html': 'text/html',
    '.json': 'application/json',
    '.txt': 'text/plain',
  };

  app.get('/api/results/artifact', (req, res) => {
    let relPath = req.query.path as string;
    const projectPath = req.query.project as string;
    const download = req.query.download === 'true';
    if (!relPath) { res.status(400).json({ error: 'path query parameter required' }); return; }

    // Normalize forward slashes from URLs to OS-native separators (Windows needs backslashes)
    if (process.platform === 'win32') {
      relPath = relPath.replace(/\//g, '\\');
    }

    // Resolve the full path — artifacts are relative to the project directory
    let fullPath: string;
    if (isAbsolute(relPath)) {
      fullPath = relPath;
    } else if (projectPath) {
      fullPath = resolve(projectPath, relPath);
    } else {
      res.status(400).json({ error: 'project query parameter required for relative paths' });
      return;
    }

    // Security: block path traversal
    if (fullPath.includes('..')) {
      res.status(403).json({ error: 'Path traversal not allowed' });
      return;
    }

    if (!existsSync(fullPath)) {
      console.error(`[qabot-artifact] Not found: ${fullPath}`);
      res.status(404).json({ error: 'Artifact not found', path: fullPath });
      return;
    }

    const ext = extname(fullPath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = statSync(fullPath);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    // CORS — allow trace.playwright.dev and other external viewers to fetch artifacts
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Only force download when explicitly requested (e.g., download button)
    if (download) {
      const filename = fullPath.split(/[\\/]/).pop() || 'artifact';
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    }

    // Stream the file directly — more reliable than sendFile on Windows
    // (sendFile can fail with drive-letter paths like D:\path\to\file)
    const stream = createReadStream(fullPath);
    stream.on('error', (err) => {
      console.error(`[qabot-artifact] Stream error for ${fullPath}:`, err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read artifact' });
      }
    });
    stream.pipe(res);
  });
}
