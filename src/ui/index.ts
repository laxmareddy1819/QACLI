import { createUIServer, type UIServerOptions, type UIServerInstance } from './server.js';

export type { UIServerOptions, UIServerInstance };

let activeServer: UIServerInstance | null = null;

/**
 * Start the UI dashboard server.
 * Only one instance can be active at a time.
 */
export async function startUIServer(options: UIServerOptions): Promise<UIServerInstance> {
  if (activeServer) {
    return activeServer;
  }

  activeServer = await createUIServer(options);
  return activeServer;
}

/**
 * Stop the active UI dashboard server.
 */
export async function stopUIServer(): Promise<void> {
  if (activeServer) {
    await activeServer.close();
    activeServer = null;
  }
}

/**
 * Check if the UI server is running.
 */
export function isUIServerRunning(): boolean {
  return activeServer !== null;
}
