import type { Express } from 'express';
import type { WebSocketServer, WebSocket } from 'ws';
import { readFile as readFileAsync } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import type { UIServerOptions } from '../server.js';
import type { Orchestrator, PermissionCallback, ToolExecutionCallback } from '../../core/orchestrator.js';
import type { BrowserManager } from '../../browser/index.js';
import { ScreencastService } from '../services/screencast-service.js';

// ── Permission resolution for browser-driven AI requests ─────────────────────
const pendingPermissions = new Map<string, {
  resolve: (result: { granted: boolean; remember?: boolean }) => void;
  requestId: string;
}>();

// Singleton screencast service instance
const screencastService = new ScreencastService();

export function mountBrowserRoutes(
  app: Express,
  wss: WebSocketServer,
  options: UIServerOptions,
): void {
  const orchestrator = options.orchestrator;
  const browserManager = options.browserManager;

  // ── Disconnect listener: browser closed externally → stop screencast + notify frontend
  // IMPORTANT: Broadcast browser-closed FIRST, then cleanup. When the browser is
  // externally closed, CDP session is dead — sending commands to it may hang.
  browserManager.onDisconnect(() => {
    console.log('[qabot] Browser disconnect callback in api-browser — broadcasting browser-closed to', wss.clients.size, 'client(s)');
    // Notify frontend immediately (synchronous — no await needed)
    broadcast(wss, { type: 'browser-closed' });
    // Force-stop screencast without CDP commands (browser is already dead)
    screencastService.forceStop();
    console.log('[qabot] Browser disconnect handling complete');
  });

  // ── Tab switch listener: switch screencast + broadcast to frontend ─────────
  browserManager.onTabSwitch(async (index: number) => {
    try {
      const page = browserManager.getPage();
      if (page && screencastService.isActive()) {
        await screencastService.switchPage(page);
      }
      // Broadcast updated tab state to all frontend clients
      let tabs: Array<{ index: number; url: string; title: string; active: boolean }> = [];
      let url = '';
      let title = '';
      try { tabs = await browserManager.listTabs(); } catch { /* ok */ }
      try { url = await browserManager.getUrl(); } catch { /* ok */ }
      try { title = await browserManager.getTitle(); } catch { /* ok */ }
      broadcast(wss, {
        type: 'browser-tab-switched',
        index,
        url,
        title,
        tabs,
      });
    } catch { /* ignore tab switch errors */ }
  });

  // GET /api/browser/status — Get current browser session status
  app.get('/api/browser/status', async (_req, res) => {
    try {
      if (!browserManager.hasActiveSession()) {
        res.json({ active: false });
        return;
      }

      let url = '';
      let title = '';
      let tabs: Array<{ index: number; url: string; title: string; active: boolean }> = [];

      try { url = await browserManager.getUrl(); } catch { /* no page */ }
      try { title = await browserManager.getTitle(); } catch { /* no page */ }
      try { tabs = await browserManager.listTabs(); } catch { /* no tabs */ }

      res.json({ active: true, url, title, tabs });
    } catch (error) {
      res.json({ active: false, error: String(error) });
    }
  });

  // POST /api/browser/close — Close the browser session
  app.post('/api/browser/close', async (_req, res) => {
    try {
      if (!browserManager.hasActiveSession()) {
        res.json({ closed: false, message: 'No active browser session' });
        return;
      }
      // Stop screencast first
      if (screencastService.isActive()) {
        await screencastService.stopScreencast();
      }
      await browserManager.close();
      broadcast(wss, { type: 'browser-closed' });
      res.json({ closed: true });
    } catch (error) {
      res.json({ closed: false, error: String(error) });
    }
  });

  // GET /api/browser/viewport — Get current viewport dimensions + browser type
  app.get('/api/browser/viewport', async (_req, res) => {
    try {
      if (!browserManager.hasActiveSession()) {
        res.json({ width: 1280, height: 720, browserType: null });
        return;
      }
      const page = browserManager.getPage();
      const viewport = page?.viewportSize() || { width: 1280, height: 720 };
      const browserType = browserManager.getBrowserType();
      res.json({ width: viewport.width, height: viewport.height, browserType });
    } catch {
      res.json({ width: 1280, height: 720, browserType: null });
    }
  });

  // POST /api/browser/screenshot — Take a screenshot, return base64 PNG
  app.post('/api/browser/screenshot', async (_req, res) => {
    try {
      if (!browserManager.hasActiveSession()) {
        res.status(400).json({ error: 'No active browser session' });
        return;
      }

      const tmpPath = resolve(options.projectPath, `.qabot-screenshot-${Date.now()}.png`);
      await browserManager.screenshot(tmpPath, false);

      // Read file and convert to base64
      const buffer = await readFileAsync(tmpPath);
      const base64 = buffer.toString('base64');

      // Clean up temp file
      try { const { unlink } = await import('node:fs/promises'); await unlink(tmpPath); } catch { /* ok */ }

      res.json({ screenshot: base64 });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/browser/chat — AI-driven browser interaction via natural language
  // Uses scoped streaming with tool events and permission handling.
  app.post('/api/browser/chat', async (req, res) => {
    try {
      const { requestId, message, context } = req.body;
      if (!requestId || !message) {
        res.status(400).json({ error: 'requestId and message required' });
        return;
      }

      const prompt = buildBrowserChatPrompt({
        message,
        context: context || {},
        projectPath: options.projectPath,
      });

      // Stream with full tool events & permissions so user sees browser actions in UI
      streamBrowserWithToolEvents(orchestrator, browserManager, wss, prompt, requestId, options.projectPath);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/browser/ai-status — Get AI orchestrator running/paused status
  app.get('/api/browser/ai-status', (_req, res) => {
    res.json({
      running: orchestrator.isRunning(),
      paused: orchestrator.isPaused(),
      currentTool: orchestrator.getCurrentToolName(),
    });
  });

  // Handle WebSocket messages for permissions + screencast control
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Permission responses
        if (msg.type === 'ai-fix-permission-response') {
          const permId = msg.permissionId as string;
          const pending = pendingPermissions.get(permId);
          if (pending) {
            pendingPermissions.delete(permId);
            pending.resolve({
              granted: msg.granted === true,
              remember: msg.remember === true,
            });
          }
          return;
        }

        // ── Screencast control messages ─────────────────────────────────────

        if (msg.type === 'screencast-start') {
          if (!browserManager.hasActiveSession()) {
            ws.send(JSON.stringify({ type: 'screencast-error', error: 'No active browser session' }));
            return;
          }
          const page = browserManager.getPage();
          if (!page) {
            ws.send(JSON.stringify({ type: 'screencast-error', error: 'No active page' }));
            return;
          }
          const browserType = browserManager.getBrowserType();
          await screencastService.startScreencast(page, wss, browserType, msg.options);
          return;
        }

        if (msg.type === 'screencast-stop') {
          await screencastService.stopScreencast();
          return;
        }

        // ── Input forwarding messages ───────────────────────────────────────

        if (msg.type === 'screencast-mouse') {
          if (!screencastService.isActive()) return;
          await screencastService.forwardMouseEvent({
            type: msg.mouseType,
            x: msg.x,
            y: msg.y,
            button: msg.button || 'left',
            clickCount: msg.clickCount || 1,
            modifiers: msg.modifiers || 0,
          });
          // On mouseMoved, query cursor style and send back to the requesting client
          if (msg.mouseType === 'mouseMoved') {
            const cursor = await screencastService.getCursorAtPoint(msg.x, msg.y);
            if (cursor) {
              ws.send(JSON.stringify({ type: 'screencast-cursor', cursor }));
            }
          }
          return;
        }

        if (msg.type === 'screencast-key') {
          if (!screencastService.isActive()) return;
          await screencastService.forwardKeyEvent({
            type: msg.keyType,
            key: msg.key,
            code: msg.code,
            text: msg.text,
            modifiers: msg.modifiers || 0,
          });
          return;
        }

        if (msg.type === 'screencast-scroll') {
          if (!screencastService.isActive()) return;
          await screencastService.forwardScrollEvent({
            x: msg.x,
            y: msg.y,
            deltaX: msg.deltaX || 0,
            deltaY: msg.deltaY || 0,
          });
          return;
        }

        // ── Navigation + tab switching from live view ───────────────────────

        if (msg.type === 'screencast-navigate') {
          if (!browserManager.hasActiveSession()) return;
          try {
            await browserManager.navigateActive(msg.url);
          } catch { /* ignore nav errors */ }
          return;
        }

        if (msg.type === 'screencast-go-back') {
          if (!browserManager.hasActiveSession()) return;
          try {
            const page = browserManager.getPage();
            if (page) await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
          } catch { /* ignore */ }
          return;
        }

        if (msg.type === 'screencast-go-forward') {
          if (!browserManager.hasActiveSession()) return;
          try {
            const page = browserManager.getPage();
            if (page) await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
          } catch { /* ignore */ }
          return;
        }

        // ── Close browser session from live view ─────────────────────────
        if (msg.type === 'screencast-close-browser') {
          try {
            if (screencastService.isActive()) {
              await screencastService.stopScreencast();
            }
            if (browserManager.hasActiveSession()) {
              await browserManager.close();
            }
            broadcast(wss, { type: 'browser-closed' });
          } catch { /* ignore */ }
          return;
        }

        if (msg.type === 'screencast-tab') {
          if (!browserManager.hasActiveSession()) return;
          try {
            // switchTab triggers onTabSwitch callback which handles screencast switch + broadcast
            browserManager.switchTab(msg.index);
          } catch { /* ignore tab errors */ }
          return;
        }

        // ── Phase 2: Element highlight on hover ──────────────────────────────

        if (msg.type === 'screencast-hover') {
          if (!screencastService.isActive()) return;
          try {
            const highlight = await screencastService.getElementAtPoint(msg.x, msg.y);
            if (highlight) {
              ws.send(JSON.stringify({ type: 'screencast-highlight', highlight }));
            } else {
              ws.send(JSON.stringify({ type: 'screencast-highlight', highlight: null }));
            }
          } catch { /* ignore hover errors */ }
          return;
        }

        // ── Phase 2: Viewport resize presets ─────────────────────────────────

        if (msg.type === 'screencast-resize-viewport') {
          if (!screencastService.isActive()) return;
          const w = Number(msg.width) || 1280;
          const h = Number(msg.height) || 720;
          await screencastService.resizeViewport(w, h);
          return;
        }

        // ── Phase 2: Network monitoring toggle ───────────────────────────────

        if (msg.type === 'screencast-network-enable') {
          if (!screencastService.isActive()) return;
          await screencastService.enableNetworkMonitoring();
          return;
        }

        if (msg.type === 'screencast-network-disable') {
          if (!screencastService.isActive()) return;
          await screencastService.disableNetworkMonitoring();
          return;
        }

        // ── Phase 2: Console monitoring toggle ───────────────────────────────

        if (msg.type === 'screencast-console-enable') {
          if (!screencastService.isActive()) return;
          await screencastService.enableConsoleMonitoring();
          return;
        }

        if (msg.type === 'screencast-console-disable') {
          if (!screencastService.isActive()) return;
          await screencastService.disableConsoleMonitoring();
          return;
        }

        // ── Phase 3: Pause/resume AI orchestrator ────────────────────────────

        if (msg.type === 'screencast-pause') {
          orchestrator.pause();
          broadcast(wss, { type: 'ai-orchestrator-paused' });
          return;
        }

        if (msg.type === 'screencast-resume') {
          orchestrator.resume();
          broadcast(wss, { type: 'ai-orchestrator-resumed' });
          return;
        }

      } catch { /* ignore malformed messages */ }
    });
  });
}

/**
 * Stream AI browser interaction scoped to a requestId, with full tool event
 * streaming, UI-driven permission handling, and auto-screenshot after key actions.
 */
async function streamBrowserWithToolEvents(
  orchestrator: Orchestrator,
  browserManager: BrowserManager,
  wss: WebSocketServer,
  prompt: string,
  requestId: string,
  projectPath: string,
): Promise<void> {
  const origPermission = (orchestrator as any).permissionCallback as PermissionCallback | undefined;
  const origToolExec = (orchestrator as any).toolExecutionCallback as ToolExecutionCallback | undefined;

  let permCounter = 0;

  // UI-driven permission callback
  const uiPermissionCallback: PermissionCallback = async (toolName, args) => {
    // Auto-approve read-level tools
    const readTools = [
      'read_file', 'file_exists', 'list_directory', 'glob_search', 'grep',
      'system_info', 'browser_get_text', 'browser_get_url', 'browser_get_title',
      'browser_inspect', 'browser_screenshot', 'get_test_results',
      'browser_list_tabs', 'browser_list_frames',
    ];
    if (readTools.includes(toolName)) {
      return { granted: true };
    }

    const permissionId = `${requestId}-perm-${++permCounter}`;

    broadcast(wss, {
      type: 'ai-fix-permission',
      requestId,
      permissionId,
      toolName,
      args: formatToolArgs(toolName, args),
    });

    return new Promise<{ granted: boolean; remember?: boolean }>((resolve) => {
      const timeout = setTimeout(() => {
        pendingPermissions.delete(permissionId);
        resolve({ granted: false });
      }, 120_000);

      pendingPermissions.set(permissionId, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        requestId,
      });
    });
  };

  // Tools that trigger auto-screenshot after completion
  const screenshotTriggerTools = new Set([
    'browser_navigate', 'browser_click', 'browser_type', 'browser_select',
    'browser_hover', 'browser_press_key', 'browser_launch',
  ]);

  // UI-driven tool execution callback with auto-screenshot + Phase 3: raw args & AI cursor
  const uiToolCallback: ToolExecutionCallback = (phase, toolName, args, result, error) => {
    // Phase 3: Include raw args for browser tools so frontend can extract coordinates
    const rawArgs = toolName.startsWith('browser_') ? args : undefined;

    broadcast(wss, {
      type: 'ai-fix-tool',
      requestId,
      phase,
      toolName,
      args: formatToolArgs(toolName, args),
      rawArgs,
      result: phase === 'complete' ? truncateResult(result) : undefined,
      error: phase === 'error' ? (error?.message || String(error)) : undefined,
    });

    // Phase 3: Broadcast AI cursor position for browser interaction tools
    if (phase === 'start' && toolName.startsWith('browser_') && screencastService.isActive()) {
      const x = typeof args.x === 'number' ? args.x : undefined;
      const y = typeof args.y === 'number' ? args.y : undefined;
      // Extract coordinates from selector-based tools after action completes
      broadcast(wss, {
        type: 'ai-cursor-action',
        requestId,
        toolName,
        action: getAIActionType(toolName),
        x,
        y,
        selector: typeof args.selector === 'string' ? args.selector : undefined,
        text: typeof args.text === 'string' ? args.text : undefined,
        url: typeof args.url === 'string' ? args.url : undefined,
      });
    }

    // Auto-capture screenshot after key browser actions complete
    if (phase === 'complete' && screenshotTriggerTools.has(toolName) && browserManager.hasActiveSession()) {
      captureAndBroadcastScreenshot(browserManager, wss, requestId, projectPath).catch(() => {});
    }

    // Broadcast browser lifecycle events so LiveBrowserWrapper in any tab can detect them
    if (phase === 'complete' && toolName === 'browser_launch') {
      broadcast(wss, { type: 'browser-launched', url: (args.url as string) || '' });
    }
    if (phase === 'complete' && toolName === 'browser_close') {
      broadcast(wss, { type: 'browser-closed' });
    }
  };

  // Install UI callbacks
  orchestrator.setPermissionCallback(uiPermissionCallback);
  orchestrator.setToolExecutionCallback(uiToolCallback);

  try {
    for await (const chunk of orchestrator.processStream(prompt)) {
      if (chunk.type === 'text') {
        broadcast(wss, { type: 'ai-fix-stream', requestId, content: chunk.content });
      } else if (chunk.type === 'status') {
        broadcast(wss, { type: 'ai-fix-status', requestId, message: chunk.message });
      } else if (chunk.type === 'done') {
        // Intermediate LLM turn — don't forward as final done
      } else if (chunk.type === 'error') {
        broadcast(wss, { type: 'ai-fix-error', requestId, message: chunk.error });
      }
    }
    broadcast(wss, { type: 'ai-fix-done', requestId });
  } catch (error) {
    broadcast(wss, { type: 'ai-fix-error', requestId, message: String(error) });
  } finally {
    if (origPermission) orchestrator.setPermissionCallback(origPermission);
    if (origToolExec) orchestrator.setToolExecutionCallback(origToolExec);

    for (const [id, pending] of pendingPermissions) {
      if (pending.requestId === requestId) {
        pendingPermissions.delete(id);
      }
    }
  }
}

/**
 * Capture a screenshot and broadcast it as base64 to frontend.
 */
async function captureAndBroadcastScreenshot(
  browserManager: BrowserManager,
  wss: WebSocketServer,
  requestId: string,
  projectPath: string,
): Promise<void> {
  const tmpPath = resolve(projectPath, `.qabot-autoscreenshot-${Date.now()}.png`);
  try {
    await browserManager.screenshot(tmpPath, false);
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(tmpPath);
    const base64 = buffer.toString('base64');

    broadcast(wss, {
      type: 'ai-browser-screenshot',
      requestId,
      data: base64,
    });

    // Clean up
    try { const { unlink } = await import('node:fs/promises'); await unlink(tmpPath); } catch { /* ok */ }
  } catch {
    // Screenshot failed — not critical, just skip
  }
}

/**
 * Build a prompt for conversational browser interaction.
 */
function buildBrowserChatPrompt(ctx: {
  message: string;
  context: {
    currentUrl?: string;
    currentTitle?: string;
    tabCount?: number;
  };
  projectPath: string;
}): string {
  const hasSession = ctx.context.currentUrl || ctx.context.tabCount;

  const sessionInfo = hasSession
    ? `## Current Browser State
- **URL:** ${ctx.context.currentUrl || 'unknown'}
- **Page Title:** ${ctx.context.currentTitle || 'unknown'}
- **Open Tabs:** ${ctx.context.tabCount || 1}
`
    : `## Browser State
No active browser session. If the user wants to interact with a web page, launch a browser first using \`browser_launch\`.
`;

  return `You are a browser automation assistant. The user will give you natural language instructions to interact with web pages. Execute their request using the browser tools available to you.

${sessionInfo}

## User's Instruction

${ctx.message}

## CRITICAL TOOL SELECTION RULES — READ BEFORE EVERY ACTION

You MUST use the specific browser tool for each action. DO NOT use browser_evaluate for any of these:

| Action | CORRECT Tool | WRONG (NEVER use browser_evaluate for this) |
|--------|-------------|---------------------------------------------|
| Click an element | **browser_click** | ~~browser_evaluate with .click()~~ |
| Type into input | **browser_type** | ~~browser_evaluate with .value= or .innerText=~~ |
| Press a key | **browser_press_key** | ~~browser_evaluate with KeyboardEvent~~ |
| Hover over element | **browser_hover** | ~~browser_evaluate with mouseover~~ |
| Select dropdown | **browser_select** | ~~browser_evaluate with .selectedIndex~~ |
| Get page text | **browser_get_text** | ~~browser_evaluate with .innerText~~ |
| Get page URL | **browser_get_url** | ~~browser_evaluate with location.href~~ |
| Get page title | **browser_get_title** | ~~browser_evaluate with document.title~~ |
| Wait for element | **browser_wait_for** | ~~browser_evaluate with polling loops~~ |
| Take screenshot | **browser_screenshot** | ~~N/A~~ |
| Inspect elements | **browser_inspect** | ~~browser_evaluate with querySelectorAll~~ |

**browser_evaluate is BANNED** except for:
- Reading computed CSS styles that no other tool can access
- Complex DOM calculations that no other tool handles
- Scrolling to specific coordinates (when browser_click with scroll isn't enough)

If you catch yourself about to use browser_evaluate, STOP and find the correct tool from the table above.

## Available Browser Tools

- **browser_launch** — Launch a new browser (chromium, firefox, webkit). Use headless=false for visual mode.
- **browser_navigate** — Navigate to a URL
- **browser_click** — Click an element (supports CSS, text, testId, role, label, placeholder, xpath strategies)
- **browser_type** — Type text into an input field (set clear=true to clear first)
- **browser_press_key** — Press keyboard keys (Enter, Tab, Escape, arrow keys, Ctrl+A, etc.)
- **browser_hover** — Hover over an element to trigger dropdowns/tooltips
- **browser_select** — Select a dropdown option by value or text
- **browser_wait_for** — Wait for an element to appear/disappear (state: visible, hidden, attached, detached)
- **browser_screenshot** — Take a screenshot of the current page
- **browser_inspect** — Inspect elements matching a selector (returns tag, id, classes, attributes, text, data-testid, aria-label, role)
- **browser_get_text** — Get text content of the page or a specific element
- **browser_get_url** — Get the current page URL
- **browser_get_title** — Get the page title
- **browser_list_tabs** — List all open tabs
- **browser_switch_tab** — Switch to a different tab
- **browser_new_tab** — Open a new tab
- **browser_close_tab** — Close a tab
- **browser_list_frames** — List iframes on the page
- **browser_switch_frame** — Switch to an iframe
- **browser_close** — Close the browser session

## Rules

1. **NEVER use browser_evaluate for clicking, typing, hovering, selecting, reading text, or getting URLs/titles.** Use the dedicated tools above. This rule is absolute.
2. **Be conversational** — briefly explain what you're doing and what you observe.
3. **Handle errors gracefully** — if an element isn't found, use browser_inspect to discover what's on the page, then try an alternative selector strategy.
4. **Selector priority** — text content > data-testid > aria role/label > placeholder > CSS > XPath. Try text first since it's most human-readable.
5. **Wait when needed** — use browser_wait_for before interacting with elements that may not be immediately available after navigation or clicks.
6. **Check for iframes** — if elements can't be found, use browser_list_frames to check for iframes and browser_switch_frame if needed.
7. **Keep responses concise** — the user is in a chat interface. Be helpful but brief. No lengthy explanations unless asked.
8. **If no browser session exists and the user wants to browse**, launch chromium (not headless) automatically.
9. **After navigation**, wait briefly for the page to load before interacting with elements.
10. **On selector failure**, try alternative strategies in order: text → testId → role → label → placeholder → CSS → XPath.`;
}

/**
 * Format tool arguments for display.
 */
function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file') {
    return String(args.path || args.filePath || '');
  }
  if (toolName === 'run_command' || toolName === 'run_tests') {
    return String(args.command || '');
  }
  if (toolName === 'glob_search' || toolName === 'grep') {
    return String(args.pattern || '');
  }
  if (toolName === 'create_directory') {
    return String(args.path || '');
  }
  if (toolName.startsWith('browser_')) {
    return String(args.url || args.selector || args.text || args.key || '');
  }
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.length > 0) return v.length > 80 ? v.slice(0, 77) + '...' : v;
  }
  return '';
}

/**
 * Truncate tool result for UI display.
 */
function truncateResult(result: unknown): string {
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (!str) return '';
  return str.length > 300 ? str.slice(0, 297) + '...' : str;
}

/**
 * Map browser tool names to UI action types for the watch mode overlay.
 */
function getAIActionType(toolName: string): string {
  switch (toolName) {
    case 'browser_click': return 'click';
    case 'browser_type': return 'type';
    case 'browser_hover': return 'hover';
    case 'browser_select': return 'select';
    case 'browser_press_key': return 'key';
    case 'browser_navigate': return 'navigate';
    case 'browser_screenshot': return 'screenshot';
    case 'browser_scroll': return 'scroll';
    case 'browser_wait_for': return 'wait';
    case 'browser_launch': return 'launch';
    case 'browser_close': return 'close';
    default: return 'action';
  }
}

function broadcast(wss: WebSocketServer, message: object): void {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if ((client as WebSocket).readyState === 1) {
      client.send(data);
    }
  }
}
