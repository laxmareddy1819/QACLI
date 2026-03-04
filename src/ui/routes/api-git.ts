import type { Express } from 'express';
import type { GitService } from '../services/git-service.js';
import type { GitCacheStore } from '../store/git-cache-store.js';
import type { TestResultsStore } from '../store/test-results-store.js';
import { audit } from './audit-helper.js';

export function mountGitRoutes(
  app: Express,
  gitService: GitService,
  gitCache: GitCacheStore,
  resultsStore: TestResultsStore,
): void {

  // ── GET /api/git/status ────────────────────────────────────────────────

  app.get('/api/git/status', async (_req, res) => {
    try {
      // Check cache first
      const cached = gitCache.getStatus();
      if (cached) {
        res.json(cached);
        return;
      }

      const status = await gitService.getStatus();
      if (status.available) {
        gitCache.setStatus(status);
      }
      res.json(status);
    } catch {
      res.json({ available: false });
    }
  });

  // ── GET /api/git/blame?file=<path> ────────────────────────────────────

  app.get('/api/git/blame', async (req, res) => {
    try {
      const filePath = req.query.file as string;
      if (!filePath) {
        res.status(400).json({ error: 'Missing file query parameter' });
        return;
      }

      if (!(await gitService.checkAvailability())) {
        res.json({ available: false });
        return;
      }

      // Check cache
      const headSha = await gitService.getCurrentHeadSha();
      if (headSha) {
        const cached = gitCache.getBlame(filePath, headSha);
        if (cached) {
          res.json(cached);
          return;
        }
      }

      const blameResult = await gitService.blame(filePath);
      if (!blameResult) {
        res.json({ filePath, entries: [], lastModifiedBy: '', lastModifiedAt: '', lastCommitSha: '', lastCommitMessage: '' });
        return;
      }

      // Cache result
      if (headSha) {
        gitCache.setBlame(filePath, headSha, blameResult);
      }

      res.json(blameResult);
    } catch {
      res.json({ filePath: req.query.file || '', entries: [], lastModifiedBy: '', lastModifiedAt: '', lastCommitSha: '', lastCommitMessage: '' });
    }
  });

  // ── GET /api/git/log?limit=20&file=<path> ─────────────────────────────

  app.get('/api/git/log', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const file = req.query.file as string | undefined;

      if (!(await gitService.checkAvailability())) {
        res.json({ commits: [], available: false });
        return;
      }

      // Check log cache
      const cacheKey = `log:${file || 'all'}:${limit}`;
      const cached = gitCache.getLog(cacheKey);
      if (cached) {
        res.json(cached);
        return;
      }

      let commits;
      if (file) {
        commits = await gitService.getFileHistory(file, limit);
      } else {
        commits = await gitService.getRecentCommits(limit);
      }

      const result = { commits, available: true };
      gitCache.setLog(cacheKey, result);
      res.json(result);
    } catch {
      res.json({ commits: [], available: false });
    }
  });

  // ── GET /api/git/diff/uncommitted?file=<path> ───────────────────────
  // MUST be registered BEFORE /api/git/diff/:sha to avoid matching "uncommitted" as a sha

  app.get('/api/git/diff/uncommitted', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.json({ files: [], stagedCount: 0, unstagedCount: 0, available: false });
        return;
      }

      const filePath = req.query.file as string | undefined;
      const result = await gitService.getUncommittedDiff(filePath || undefined);
      res.json({ ...result, available: true });
    } catch {
      res.json({ files: [], stagedCount: 0, unstagedCount: 0, available: false });
    }
  });

  // ── GET /api/git/diff/:sha ────────────────────────────────────────────

  app.get('/api/git/diff/:sha', async (req, res) => {
    try {
      const { sha } = req.params;
      if (!sha) {
        res.status(400).json({ error: 'Missing sha parameter' });
        return;
      }

      if (!(await gitService.checkAvailability())) {
        res.json({ available: false });
        return;
      }

      const diff = await gitService.getCommitDiff(sha);
      if (!diff) {
        res.json({ sha, files: [], available: true });
        return;
      }

      res.json({ ...diff, available: true });
    } catch {
      res.json({ sha: req.params.sha, files: [], available: false });
    }
  });

  // ── GET /api/git/churn?file=<path>&days=30 ────────────────────────────

  app.get('/api/git/churn', async (req, res) => {
    try {
      const filePath = req.query.file as string;
      const days = parseInt(req.query.days as string) || 30;

      if (!filePath) {
        res.status(400).json({ error: 'Missing file query parameter' });
        return;
      }

      if (!(await gitService.checkAvailability())) {
        res.json({ available: false });
        return;
      }

      const churn = await gitService.getChurnScore(filePath, days);
      res.json(churn || { filePath, editCount: 0, daysSpan: days, churnScore: 0, contributors: [] });
    } catch {
      res.json({ filePath: req.query.file || '', editCount: 0, daysSpan: 30, churnScore: 0, contributors: [] });
    }
  });

  // ── GET /api/git/correlate/:runId ─────────────────────────────────────

  app.get('/api/git/correlate/:runId', async (req, res) => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: 'Missing runId parameter' });
        return;
      }

      if (!(await gitService.checkAvailability())) {
        res.json({ correlations: [], available: false });
        return;
      }

      const currentRun = resultsStore.getRun(runId);
      if (!currentRun) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      // Find previous run
      const { runs } = resultsStore.getRunHistory(100, 0);
      const currentIdx = runs.findIndex(r => r.runId === runId);
      const previousRun = currentIdx >= 0 && currentIdx < runs.length - 1
        ? resultsStore.getRun(runs[currentIdx + 1]!.runId)
        : null;

      const correlations = await gitService.correlateFailures(currentRun, previousRun || null);
      res.json({ correlations, available: true });
    } catch {
      res.json({ correlations: [], available: false });
    }
  });

  // ── GET /api/git/ownership/:runId ─────────────────────────────────────

  app.get('/api/git/ownership/:runId', async (req, res) => {
    try {
      const { runId } = req.params;
      if (!runId) {
        res.status(400).json({ error: 'Missing runId parameter' });
        return;
      }

      if (!(await gitService.checkAvailability())) {
        res.json({ ownership: [], available: false });
        return;
      }

      const run = resultsStore.getRun(runId);
      if (!run) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      const failedTests = run.tests.filter(t => t.status === 'failed');
      const ownership = [];

      for (const test of failedTests) {
        const result = await gitService.getFailureOwnership(test);
        if (result) ownership.push(result);
      }

      res.json({ ownership, available: true });
    } catch {
      res.json({ ownership: [], available: false });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ── Git Write Operations (POST) ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ── POST /api/git/stage ───────────────────────────────────────────────

  app.post('/api/git/stage', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.status(400).json({ error: 'Git not available' });
        return;
      }

      const { files } = req.body;
      if (!Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: 'files must be a non-empty array' });
        return;
      }

      const result = await gitService.stageFiles(files);
      gitCache.invalidateAll();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/git/unstage ─────────────────────────────────────────────

  app.post('/api/git/unstage', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.status(400).json({ error: 'Git not available' });
        return;
      }

      const { files } = req.body;
      if (!Array.isArray(files) || files.length === 0) {
        res.status(400).json({ error: 'files must be a non-empty array' });
        return;
      }

      const result = await gitService.unstageFiles(files);
      gitCache.invalidateAll();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/git/commit ──────────────────────────────────────────────

  app.post('/api/git/commit', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.status(400).json({ error: 'Git not available' });
        return;
      }

      const { message } = req.body;
      if (!message || typeof message !== 'string' || !message.trim()) {
        res.status(400).json({ error: 'Commit message is required' });
        return;
      }

      const result = await gitService.commitChanges(message.trim());
      gitCache.invalidateAll();
      audit(req, 'git.commit', { resourceType: 'git', details: { message: message.trim().slice(0, 100) } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/git/fetch ───────────────────────────────────────────────

  app.post('/api/git/fetch', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.status(400).json({ error: 'Git not available' });
        return;
      }

      const { remote } = req.body || {};
      const result = await gitService.fetchRemote(remote);
      gitCache.invalidateAll();
      audit(req, 'git.fetch', { resourceType: 'git', details: { remote } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/git/pull ────────────────────────────────────────────────

  app.post('/api/git/pull', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.status(400).json({ error: 'Git not available' });
        return;
      }

      const { remote, branch } = req.body || {};
      const result = await gitService.pull(remote, branch);
      gitCache.invalidateAll();
      audit(req, 'git.pull', { resourceType: 'git', details: { remote, branch } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/git/push ────────────────────────────────────────────────

  app.post('/api/git/push', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.status(400).json({ error: 'Git not available' });
        return;
      }

      const { remote, branch } = req.body || {};
      const result = await gitService.push(remote, branch);
      gitCache.invalidateAll();
      audit(req, 'git.push', { resourceType: 'git', details: { remote, branch } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── GET /api/git/branches ─────────────────────────────────────────────

  app.get('/api/git/branches', async (_req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.json({ current: '', all: [], branches: [], available: false });
        return;
      }

      const result = await gitService.getBranches();
      res.json({ ...result, available: true });
    } catch {
      res.json({ current: '', all: [], branches: [], available: false });
    }
  });

  // ── POST /api/git/branch/create ───────────────────────────────────────

  app.post('/api/git/branch/create', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.status(400).json({ error: 'Git not available' });
        return;
      }

      const { name, checkout } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Branch name is required' });
        return;
      }

      const result = await gitService.createBranch(name.trim(), checkout !== false);
      gitCache.invalidateAll();
      audit(req, 'git.branch_create', { resourceType: 'git', details: { name: name.trim() } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── POST /api/git/branch/switch ───────────────────────────────────────

  app.post('/api/git/branch/switch', async (req, res) => {
    try {
      if (!(await gitService.checkAvailability())) {
        res.status(400).json({ error: 'Git not available' });
        return;
      }

      const { name } = req.body;
      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'Branch name is required' });
        return;
      }

      const result = await gitService.switchBranch(name.trim());
      gitCache.invalidateAll();
      audit(req, 'git.branch_switch', { resourceType: 'git', details: { name: name.trim() } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
