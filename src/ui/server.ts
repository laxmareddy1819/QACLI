import { createServer, type Server } from 'node:http';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { Orchestrator } from '../core/orchestrator.js';
import type { BrowserManager } from '../browser/index.js';
import { ProjectScanner } from './scanner/project-scanner.js';
import { createFileWatcher } from './scanner/file-watcher.js';
import { TestResultsStore } from './store/test-results-store.js';
import { ChatHistoryStore } from './store/chat-history-store.js';
import { CloudConfigStore } from './store/cloud-config-store.js';
import { FailureAnalyzer } from './services/failure-analyzer.js';
import { CloudArtifactFetcher } from './services/cloud-artifact-fetcher.js';
import { SchedulerService } from './services/scheduler-service.js';
import { GitService } from './services/git-service.js';
import { GitCacheStore } from './store/git-cache-store.js';
import { UserStore } from './store/user-store.js';
import { AuditLogStore } from './store/audit-log-store.js';
import { TokenManager } from './auth/token-manager.js';
import { createAuthMiddleware } from './auth/auth-middleware.js';
import { HealingStore } from '../healing/store.js';
import { getQabotDir } from '../utils/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface UIServerOptions {
  port: number;
  projectPath: string;
  orchestrator: Orchestrator;
  browserManager: BrowserManager;
}

export interface UIServerInstance {
  httpServer: Server;
  port: number;
  close: () => Promise<void>;
}

export async function createUIServer(options: UIServerOptions): Promise<UIServerInstance> {
  // Dynamic imports to keep these dependencies optional
  const express = (await import('express')).default;
  const { WebSocketServer } = await import('ws');

  const app = express();
  const httpServer = createServer(app);

  // WebSocket server on /ws path
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // Scanner + Stores
  const scanner = new ProjectScanner(options.projectPath);
  const resultsStore = new TestResultsStore(options.projectPath);
  const chatHistoryStore = new ChatHistoryStore(options.projectPath);
  const cloudConfigStore = new CloudConfigStore(options.projectPath);
  const failureAnalyzer = new FailureAnalyzer(resultsStore);
  const artifactFetcher = new CloudArtifactFetcher(cloudConfigStore, resultsStore);
  const scheduler = new SchedulerService(cloudConfigStore);
  const gitService = new GitService(options.projectPath);
  const gitCacheStore = new GitCacheStore(options.projectPath);
  const userStore = new UserStore(options.projectPath);
  const auditLogStore = new AuditLogStore(options.projectPath);
  const tokenManager = new TokenManager(options.projectPath);
  // Initialize git availability check in background
  gitService.checkAvailability().catch(() => {});
  // Prune expired sessions and old audit entries on startup
  userStore.pruneExpiredSessions();
  auditLogStore.prune();

  // Activity buffer — persisted to ~/.qabot/activity.json
  type ActivityEntry = { type: string; event?: string; path?: string; exitCode?: number; duration?: number; passed?: number; failed?: number; timestamp: string };
  const MAX_ACTIVITIES = 50;
  const activityFilePath = join(getQabotDir(), 'activity.json');
  let activityBuffer: ActivityEntry[] = [];

  // Load from disk on startup
  try {
    if (existsSync(activityFilePath)) {
      activityBuffer = JSON.parse(readFileSync(activityFilePath, 'utf-8'));
    }
  } catch { activityBuffer = []; }

  let activitySaveTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleSaveActivity(): void {
    if (activitySaveTimer) return;
    activitySaveTimer = setTimeout(() => {
      activitySaveTimer = null;
      try {
        const dir = getQabotDir();
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(activityFilePath, JSON.stringify(activityBuffer), 'utf-8');
      } catch { /* ignore write errors */ }
    }, 2000);
  }

  function pushActivity(entry: ActivityEntry): void {
    activityBuffer.unshift(entry);
    if (activityBuffer.length > MAX_ACTIVITIES) activityBuffer.length = MAX_ACTIVITIES;
    scheduleSaveActivity();
  }

  // Middleware
  app.use(express.json({ limit: '5mb' }));

  // CORS for development (Vite dev server on port 3701)
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') { res.sendStatus(200); return; }
    next();
  });

  // Auth middleware — protects all /api/* routes (except public auth endpoints)
  app.use(createAuthMiddleware(tokenManager, userStore));

  // Expose auditLogStore on app.locals so route handlers can use audit-helper
  app.locals.auditLogStore = auditLogStore;

  // Mount auth routes (before other API routes)
  const { mountAuthRoutes } = await import('./routes/api-auth.js');
  const { mountAuditRoutes } = await import('./routes/api-audit.js');
  mountAuthRoutes(app, userStore, tokenManager, auditLogStore);
  mountAuditRoutes(app, auditLogStore);

  // Mount API routes
  const { mountProjectRoutes } = await import('./routes/api-project.js');
  const { mountFileRoutes } = await import('./routes/api-files.js');
  const { mountConfigRoutes } = await import('./routes/api-config.js');
  const { mountRunnerRoutes } = await import('./routes/api-runner.js');
  const { mountAIRoutes } = await import('./routes/api-ai.js');
  const { mountResultsRoutes } = await import('./routes/api-results.js');
  const { mountHealingRoutes } = await import('./routes/api-healing.js');
  const { mountExplorerRoutes } = await import('./routes/api-explorer.js');
  const { mountCICDRoutes } = await import('./routes/api-cicd.js');
  const { mountBrowserRoutes } = await import('./routes/api-browser.js');
  const { mountUploadRoutes } = await import('./routes/api-upload.js');
  const { mountChatHistoryRoutes } = await import('./routes/api-chat-history.js');
  const { mountRecorderRoutes } = await import('./routes/api-recorder.js');
  const { mountCloudRoutes } = await import('./routes/api-cloud.js');
  const { mountApiTestingRoutes } = await import('./routes/api-api-testing.js');
  const { mountGitRoutes } = await import('./routes/api-git.js');
  const { mountLLMRoutes } = await import('./routes/api-llm.js');

  // Instantiate API collections store
  const { ApiCollectionsStore } = await import('./store/api-collections-store.js');
  const apiCollectionsStore = new ApiCollectionsStore(options.projectPath);

  mountProjectRoutes(app, scanner, options);
  mountFileRoutes(app, scanner, options);
  mountConfigRoutes(app, options);
  mountRunnerRoutes(app, wss, scanner, options, resultsStore, cloudConfigStore, artifactFetcher, pushActivity, gitService);
  mountAIRoutes(app, wss, options);
  mountBrowserRoutes(app, wss, options);
  mountRecorderRoutes(app, wss, options);
  mountResultsRoutes(app, resultsStore, artifactFetcher);
  mountExplorerRoutes(app, scanner, options, resultsStore);
  mountCICDRoutes(app, scanner, options);
  mountUploadRoutes(app);
  mountChatHistoryRoutes(app, chatHistoryStore);
  mountCloudRoutes(app, cloudConfigStore, scanner, options.projectPath, scheduler);
  mountApiTestingRoutes(app, apiCollectionsStore);
  mountGitRoutes(app, gitService, gitCacheStore, resultsStore);
  mountLLMRoutes(app);

  // Mount healing routes — connect to project-specific healing store
  let healingStore: HealingStore | null = null;
  try {
    const resolvedProjectPath = resolve(options.projectPath);
    healingStore = new HealingStore(resolvedProjectPath);
  } catch (healErr) {
    console.error('[qabot-ui] Healing store init failed:', healErr);
  }
  mountHealingRoutes(app, healingStore);

  // Mount universal healing API routes (cross-framework self-healing bridge)
  const { mountUniversalHealingRoutes } = await import('./routes/api-healing-universal.js');
  mountUniversalHealingRoutes(app, healingStore, wss);

  // POST /api/results/runs/:id/analyze — Trigger AI failure analysis
  app.post('/api/results/runs/:id/analyze', async (req, res) => {
    try {
      const groups = await failureAnalyzer.analyze(req.params.id!);
      res.json({ groups, count: groups.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Activity feed API
  app.get('/api/activity', (_req, res) => res.json({ activities: activityBuffer }));

  // Serve static React app
  // When bundled by tsup, __dirname is dist/ — try both locations
  const staticCandidates = [
    join(__dirname, 'static'),          // development (src/ui/static)
    join(__dirname, '..', 'src', 'ui', 'static'),  // bundled (dist/../src/ui/static)
  ];
  const staticDir = staticCandidates.find(d => existsSync(d)) ?? staticCandidates[0]!;
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    // SPA fallback
    app.get('*', (_req, res) => {
      const indexPath = join(staticDir, 'index.html');
      if (existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).json({ error: 'UI not built. Run: pnpm run build:ui' });
      }
    });
  } else {
    // No static files — serve a helpful message
    app.get('*', (_req, res) => {
      res.status(200).send(getPlaceholderHtml(options.port));
    });
  }

  // WebSocket authentication
  wss.on('connection', (ws, req) => {
    // In setup mode (no users), allow all connections
    if (!userStore.hasAnyUsers()) {
      (ws as any).__user = null;
      return;
    }

    // Extract token from query string: /ws?token=xxx
    try {
      const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Authentication required');
        return;
      }

      const payload = tokenManager.verify(token);
      if (!payload) {
        ws.close(4001, 'Invalid token');
        return;
      }

      const session = userStore.getSession(payload.jti);
      if (!session || session.revoked || session.expiresAt < Date.now()) {
        ws.close(4001, 'Session expired');
        return;
      }

      (ws as any).__user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
      };
    } catch {
      ws.close(4001, 'Authentication error');
    }
  });

  // Periodic cleanup intervals
  const sessionPruneInterval = setInterval(() => {
    try { userStore.pruneExpiredSessions(); } catch { /* ignore */ }
  }, 60 * 60 * 1000); // Every hour

  const auditPruneInterval = setInterval(() => {
    try { auditLogStore.prune(); } catch { /* ignore */ }
  }, 24 * 60 * 60 * 1000); // Every 24 hours

  // File watcher for real-time updates
  let watcherInstance: import('chokidar').FSWatcher | null = null;
  try {
    watcherInstance = await createFileWatcher(options.projectPath, wss, scanner);
  } catch {
    // chokidar not available — file watching disabled
  }

  // Push file-change events to activity buffer
  if (watcherInstance) {
    for (const event of ['add', 'change', 'unlink'] as const) {
      watcherInstance.on(event, (fullPath: string) => {
        const relPath = relative(options.projectPath, fullPath).replace(/\\/g, '/');
        pushActivity({ type: 'file-change', event, path: relPath, timestamp: new Date().toISOString() });
      });
    }
  }

  // Find available port
  const actualPort = await findPort(httpServer, options.port);

  // Start scheduler with the resolved port
  scheduler.setPort(actualPort);
  scheduler.setWss(wss);
  scheduler.start();

  return {
    httpServer,
    port: actualPort,
    close: async () => {
      scheduler.stop();
      clearInterval(sessionPruneInterval);
      clearInterval(auditPruneInterval);
      if (watcherInstance) await watcherInstance.close();
      for (const client of wss.clients) client.close();
      wss.close();
      httpServer.close();
      userStore.close();
      auditLogStore.close();
    },
  };
}

async function findPort(server: Server, startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return port;
    } catch (err: any) {
      if (err?.code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`No available port found (tried ${startPort}–${startPort + 9})`);
}

function getPlaceholderHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>qabot Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f23; color: #e2e8f0; display: flex; align-items: center;
      justify-content: center; min-height: 100vh; }
    .container { text-align: center; max-width: 600px; padding: 2rem; }
    h1 { font-size: 2rem; margin-bottom: 1rem; background: linear-gradient(135deg, #6366f1, #8b5cf6);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #94a3b8; margin-bottom: 0.75rem; line-height: 1.6; }
    code { background: #1e293b; padding: 0.2em 0.5em; border-radius: 4px; font-size: 0.9em; color: #a5b4fc; }
    .status { margin-top: 2rem; padding: 1rem; background: #1e293b; border-radius: 8px; }
    .dot { display: inline-block; width: 8px; height: 8px; background: #22c55e;
      border-radius: 50%; margin-right: 0.5rem; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>qabot Dashboard</h1>
    <p>The API server is running. The React UI needs to be built.</p>
    <p>Run <code>pnpm run build:ui</code> to build the UI, then refresh this page.</p>
    <p>Or run <code>pnpm run dev:ui</code> for development mode on port 3701.</p>
    <div class="status">
      <span class="dot"></span>
      <span>API Server Active on port ${port}</span>
    </div>
    <p style="margin-top: 1rem; font-size: 0.85em; color: #64748b;">
      API endpoints available at <code>/api/project</code>, <code>/api/files</code>, etc.
    </p>
  </div>
</body>
</html>`;
}
