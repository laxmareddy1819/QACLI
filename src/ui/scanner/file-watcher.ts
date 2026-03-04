import type { FSWatcher } from 'chokidar';
import type { WebSocketServer, WebSocket } from 'ws';
import { relative } from 'node:path';
import type { ProjectScanner } from './project-scanner.js';

/**
 * Create a file system watcher that broadcasts changes to WebSocket clients
 * and triggers module rescans when the project structure changes.
 */
export async function createFileWatcher(
  projectPath: string,
  wss: WebSocketServer,
  scanner: ProjectScanner,
): Promise<FSWatcher> {
  // Dynamic import chokidar to keep it optional until /buildUI is used
  const { watch } = await import('chokidar');

  const watcher = watch(projectPath, {
    ignored: [
      '**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**',
      '**/coverage/**', '**/__pycache__/**', '**/target/**', '**/.next/**',
      '**/.nuxt/**', '**/out/**', '**/.tox/**', '**/.mypy_cache/**',
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  // Debounce rescan to avoid rapid-fire during batch file operations
  let rescanTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRescan = () => {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(async () => {
      scanner.invalidateCache();
      try {
        const info = await scanner.scan();
        broadcast(wss, { type: 'modules-updated', modules: info.modules });
      } catch { /* ignore scan errors */ }
    }, 1000);
  };

  const broadcastChange = (event: 'add' | 'change' | 'unlink', fullPath: string) => {
    const relPath = relative(projectPath, fullPath).replace(/\\/g, '/');
    broadcast(wss, { type: 'file-change', event, path: relPath });
  };

  watcher.on('add', (path) => {
    broadcastChange('add', path);
    scheduleRescan(); // New file might create a new module
  });

  watcher.on('change', (path) => {
    broadcastChange('change', path);
  });

  watcher.on('unlink', (path) => {
    broadcastChange('unlink', path);
    scheduleRescan(); // Deleted file might remove a module
  });

  return watcher;
}

function broadcast(wss: WebSocketServer, message: object): void {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if ((client as WebSocket).readyState === 1 /* OPEN */) {
      client.send(data);
    }
  }
}
