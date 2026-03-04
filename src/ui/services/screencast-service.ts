/**
 * ScreencastService — manages CDP-based live browser streaming and input forwarding.
 *
 * For Chromium: uses Page.startScreencast for real-time JPEG frame streaming.
 * For Firefox/WebKit: falls back to periodic page.screenshot() at ~2fps.
 */

import type { Page } from 'playwright-core';
import type { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../../utils/index.js';

const logger = createLogger('screencast');

export interface ScreencastOptions {
  format?: 'jpeg' | 'png';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface MouseEventParams {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle' | 'none';
  clickCount?: number;
  modifiers?: number; // bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
}

export interface KeyEventParams {
  type: 'keyDown' | 'keyUp' | 'char';
  key: string;
  code?: string;
  text?: string;
  modifiers?: number;
}

export interface ScrollEventParams {
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

export interface ElementHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  tagName: string;
  id?: string;
  className?: string;
  textContent?: string;
}

export interface NetworkEntry {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  contentLength?: number;
  timestamp: number;
  duration?: number;
  failed?: boolean;
  errorText?: string;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: number;
  source?: string;
  lineNumber?: number;
}

export class ScreencastService {
  private cdpSession: any | null = null;
  private isStreaming = false;
  private activePage: Page | null = null;
  private wss: WebSocketServer | null = null;
  private fallbackInterval: ReturnType<typeof setInterval> | null = null;
  private isCDP = false;
  private viewportWidth = 1280;
  private viewportHeight = 720;

  // Phase 2: tracking for CDP domains
  private networkEnabled = false;
  private consoleEnabled = false;
  private pendingRequests = new Map<string, { url: string; method: string; timestamp: number }>();

  /**
   * Start screencast on the given page. Uses CDP for Chromium, periodic screenshots otherwise.
   */
  async startScreencast(
    page: Page,
    wss: WebSocketServer,
    browserType: string | null,
    options?: ScreencastOptions,
  ): Promise<void> {
    // Stop any existing screencast first (silently — don't broadcast 'stopped'
    // because we're immediately restarting; avoids race condition where the
    // frontend receives 'stopped' and tears down the canvas before new frames arrive)
    await this.internalStop();

    this.activePage = page;
    this.wss = wss;
    this.isCDP = browserType === 'chromium';

    // Capture viewport size
    const viewport = page.viewportSize();
    if (viewport) {
      this.viewportWidth = viewport.width;
      this.viewportHeight = viewport.height;
    }

    // Broadcast viewport info
    this.broadcast({
      type: 'screencast-viewport',
      width: this.viewportWidth,
      height: this.viewportHeight,
    });

    if (this.isCDP) {
      await this.startCDPScreencast(page, options);
    } else {
      this.startFallbackScreencast(page);
    }

    this.isStreaming = true;
    logger.info(`Screencast started (${this.isCDP ? 'CDP' : 'fallback'}) — ${this.viewportWidth}x${this.viewportHeight}`);
  }

  /**
   * Stop the active screencast and clean up resources.
   * Broadcasts 'screencast-stopped' to clients so they know it's done.
   */
  async stopScreencast(): Promise<void> {
    const wasStreaming = this.isStreaming;
    await this.internalStop();
    // Broadcast to clients only on explicit stop (not during internal restart)
    if (wasStreaming) {
      this.broadcast({ type: 'screencast-stopped', reason: 'stopped' });
    }
  }

  /**
   * Internal stop — cleans up all resources WITHOUT broadcasting 'stopped'.
   * Used by startScreencast (restart) and switchPage to avoid race conditions
   * where the frontend receives 'stopped' and tears down the canvas mid-restart.
   */
  private async internalStop(): Promise<void> {
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }

    // Disable Phase 2 monitoring before detaching CDP session
    if (this.networkEnabled && this.cdpSession) {
      try { await this.cdpSession.send('Network.disable'); } catch { /* ok */ }
    }
    if (this.consoleEnabled && this.cdpSession) {
      try { await this.cdpSession.send('Runtime.disable'); } catch { /* ok */ }
    }
    this.networkEnabled = false;
    this.consoleEnabled = false;
    this.pendingRequests.clear();

    if (this.cdpSession) {
      try {
        await this.cdpSession.send('Page.stopScreencast');
        await this.cdpSession.detach();
      } catch {
        // Session may already be detached
      }
      this.cdpSession = null;
    }

    if (this.isStreaming) {
      this.isStreaming = false;
      logger.info('Screencast stopped');
    }

    this.activePage = null;
    this.wss = null;
  }

  /**
   * Forward a mouse event to the browser via CDP or Playwright.
   */
  async forwardMouseEvent(params: MouseEventParams): Promise<void> {
    if (this.cdpSession) {
      const cdpButton = params.button === 'right' ? 'right' : params.button === 'middle' ? 'middle' : 'left';
      await this.cdpSession.send('Input.dispatchMouseEvent', {
        type: params.type,
        x: params.x,
        y: params.y,
        button: params.type === 'mouseMoved' ? 'none' : cdpButton,
        clickCount: params.clickCount || (params.type === 'mouseMoved' ? 0 : 1),
        modifiers: params.modifiers || 0,
      });
    } else if (this.activePage) {
      // Fallback: use Playwright mouse API
      if (params.type === 'mousePressed') {
        await this.activePage.mouse.move(params.x, params.y);
        await this.activePage.mouse.down({ button: params.button === 'right' ? 'right' : 'left' });
      } else if (params.type === 'mouseReleased') {
        await this.activePage.mouse.up({ button: params.button === 'right' ? 'right' : 'left' });
      } else if (params.type === 'mouseMoved') {
        await this.activePage.mouse.move(params.x, params.y);
      }
    }
  }

  /**
   * Forward a keyboard event to the browser via CDP or Playwright.
   */
  async forwardKeyEvent(params: KeyEventParams): Promise<void> {
    if (this.cdpSession) {
      const cdpParams: Record<string, unknown> = {
        type: params.type,
        modifiers: params.modifiers || 0,
      };

      if (params.type === 'char') {
        cdpParams.text = params.text || params.key;
      } else {
        cdpParams.key = params.key;
        cdpParams.code = params.code || '';
        if (params.type === 'keyDown' && params.text) {
          cdpParams.text = params.text;
        }
      }

      await this.cdpSession.send('Input.dispatchKeyEvent', cdpParams);
    } else if (this.activePage) {
      // Fallback: use Playwright keyboard API for keyDown only
      if (params.type === 'keyDown') {
        if (params.text && params.text.length === 1) {
          await this.activePage.keyboard.press(params.key);
        } else {
          await this.activePage.keyboard.down(params.key);
        }
      } else if (params.type === 'keyUp') {
        await this.activePage.keyboard.up(params.key);
      }
    }
  }

  /**
   * Forward a scroll (wheel) event to the browser via CDP or Playwright.
   */
  async forwardScrollEvent(params: ScrollEventParams): Promise<void> {
    if (this.cdpSession) {
      await this.cdpSession.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: params.x,
        y: params.y,
        deltaX: params.deltaX,
        deltaY: params.deltaY,
        modifiers: 0,
      });
    } else if (this.activePage) {
      await this.activePage.mouse.wheel(params.deltaX, params.deltaY);
    }
  }

  /**
   * Switch screencast to a different page (tab switch).
   * Saves wss reference before internal stop since stop nulls it.
   */
  async switchPage(newPage: Page): Promise<void> {
    if (!this.wss || !this.isStreaming) return;
    const savedWss = this.wss;
    const browserType = this.isCDP ? 'chromium' : 'other';
    await this.internalStop();
    await this.startScreencast(newPage, savedWss, browserType);
  }

  isActive(): boolean {
    return this.isStreaming;
  }

  getViewportSize(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight };
  }

  // ── Phase 2: Element Highlighting ─────────────────────────────────────────

  /**
   * Get element information at a given page coordinate using CDP DOM inspection.
   * Returns bounding box + metadata for highlighting on the canvas overlay.
   */
  async getElementAtPoint(x: number, y: number): Promise<ElementHighlight | null> {
    if (!this.cdpSession) {
      // Fallback: use Playwright's evaluate for non-CDP browsers
      return this.getElementAtPointFallback(x, y);
    }

    try {
      // Enable DOM domain if not already
      await this.cdpSession.send('DOM.enable').catch(() => {});

      // Get the node at the given coordinates
      const nodeResult = await this.cdpSession.send('DOM.getNodeForLocation', {
        x: Math.round(x),
        y: Math.round(y),
        includeUserAgentShadowDOM: false,
      });

      if (!nodeResult?.backendNodeId) return null;

      // Get the box model for the node
      const boxResult = await this.cdpSession.send('DOM.getBoxModel', {
        backendNodeId: nodeResult.backendNodeId,
      });

      if (!boxResult?.model) return null;

      // Border quad gives us the visible bounding rect
      const border = boxResult.model.border;
      // border is 8 values: x1,y1, x2,y2, x3,y3, x4,y4 (quad corners)
      const bx = Math.min(border[0], border[2], border[4], border[6]);
      const by = Math.min(border[1], border[3], border[5], border[7]);
      const bw = Math.max(border[0], border[2], border[4], border[6]) - bx;
      const bh = Math.max(border[1], border[3], border[5], border[7]) - by;

      // Describe the node
      const descResult = await this.cdpSession.send('DOM.describeNode', {
        backendNodeId: nodeResult.backendNodeId,
      }).catch(() => null);

      const node = descResult?.node;

      return {
        x: bx,
        y: by,
        width: bw,
        height: bh,
        tagName: node?.localName || node?.nodeName || 'unknown',
        id: node?.attributes ? getAttr(node.attributes, 'id') : undefined,
        className: node?.attributes ? getAttr(node.attributes, 'class') : undefined,
        textContent: undefined, // Don't fetch full text to keep it fast
      };
    } catch (err) {
      logger.debug(`getElementAtPoint CDP failed: ${err}`);
      return null;
    }
  }

  private async getElementAtPointFallback(x: number, y: number): Promise<ElementHighlight | null> {
    if (!this.activePage) return null;
    try {
      const result = await this.activePage.evaluate(`(() => {
        const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className && typeof el.className === 'string' ? el.className : undefined,
        };
      })()`);
      return result as ElementHighlight | null;
    } catch {
      return null;
    }
  }

  // ── Phase 2: Viewport Resize ──────────────────────────────────────────────

  /**
   * Resize the browser viewport and broadcast the new dimensions.
   */
  async resizeViewport(width: number, height: number): Promise<void> {
    if (!this.activePage) return;
    try {
      await this.activePage.setViewportSize({ width, height });
      this.viewportWidth = width;
      this.viewportHeight = height;

      // If using CDP screencast, restart with new dimensions
      if (this.cdpSession && this.isStreaming) {
        try {
          await this.cdpSession.send('Page.stopScreencast');
          await this.cdpSession.send('Page.startScreencast', {
            format: 'jpeg',
            quality: 50,
            maxWidth: width,
            maxHeight: height,
            everyNthFrame: 1,
          });
        } catch { /* ignore restart errors */ }
      }

      this.broadcast({
        type: 'screencast-viewport',
        width,
        height,
      });

      logger.info(`Viewport resized to ${width}x${height}`);
    } catch (err) {
      logger.warn(`Viewport resize failed: ${err}`);
    }
  }

  // ── Phase 2: Network Monitoring ───────────────────────────────────────────

  /**
   * Enable CDP Network domain to track HTTP requests/responses.
   */
  async enableNetworkMonitoring(): Promise<void> {
    if (this.networkEnabled) return;

    if (this.cdpSession) {
      try {
        await this.cdpSession.send('Network.enable');

        this.cdpSession.on('Network.requestWillBeSent', (event: any) => {
          this.pendingRequests.set(event.requestId, {
            url: event.request?.url || '',
            method: event.request?.method || 'GET',
            timestamp: Date.now(),
          });
          this.broadcast({
            type: 'screencast-network-request',
            entry: {
              id: event.requestId,
              url: event.request?.url || '',
              method: event.request?.method || 'GET',
              timestamp: Date.now(),
            },
          });
        });

        this.cdpSession.on('Network.responseReceived', (event: any) => {
          const pending = this.pendingRequests.get(event.requestId);
          const duration = pending ? Date.now() - pending.timestamp : undefined;
          this.pendingRequests.delete(event.requestId);
          this.broadcast({
            type: 'screencast-network-response',
            entry: {
              id: event.requestId,
              url: event.response?.url || pending?.url || '',
              method: pending?.method || 'GET',
              status: event.response?.status,
              statusText: event.response?.statusText,
              mimeType: event.response?.mimeType,
              contentLength: event.response?.headers?.['content-length']
                ? parseInt(event.response.headers['content-length'], 10)
                : undefined,
              timestamp: Date.now(),
              duration,
            },
          });
        });

        this.cdpSession.on('Network.loadingFailed', (event: any) => {
          const pending = this.pendingRequests.get(event.requestId);
          const duration = pending ? Date.now() - pending.timestamp : undefined;
          this.pendingRequests.delete(event.requestId);
          this.broadcast({
            type: 'screencast-network-response',
            entry: {
              id: event.requestId,
              url: pending?.url || '',
              method: pending?.method || 'GET',
              timestamp: Date.now(),
              duration,
              failed: true,
              errorText: event.errorText,
            },
          });
        });

        this.networkEnabled = true;
        logger.info('Network monitoring enabled');
      } catch (err) {
        logger.warn(`Failed to enable network monitoring: ${err}`);
      }
    } else {
      // Fallback: use Playwright's route API — limited info
      this.networkEnabled = true;
      logger.info('Network monitoring enabled (limited — non-CDP)');
    }
  }

  async disableNetworkMonitoring(): Promise<void> {
    if (!this.networkEnabled) return;
    if (this.cdpSession) {
      try { await this.cdpSession.send('Network.disable'); } catch { /* ok */ }
    }
    this.networkEnabled = false;
    this.pendingRequests.clear();
    logger.info('Network monitoring disabled');
  }

  // ── Phase 2: Console Monitoring ───────────────────────────────────────────

  /**
   * Enable CDP Runtime domain to capture console messages.
   */
  async enableConsoleMonitoring(): Promise<void> {
    if (this.consoleEnabled) return;

    if (this.cdpSession) {
      try {
        await this.cdpSession.send('Runtime.enable');

        this.cdpSession.on('Runtime.consoleAPICalled', (event: any) => {
          const level = mapConsoleLevel(event.type);
          const text = (event.args || [])
            .map((arg: any) => arg.value ?? arg.description ?? String(arg.type))
            .join(' ');

          this.broadcast({
            type: 'screencast-console-message',
            entry: {
              level,
              text,
              timestamp: Date.now(),
              source: event.stackTrace?.callFrames?.[0]?.url || undefined,
              lineNumber: event.stackTrace?.callFrames?.[0]?.lineNumber || undefined,
            },
          });
        });

        this.cdpSession.on('Runtime.exceptionThrown', (event: any) => {
          const desc = event.exceptionDetails?.exception?.description
            || event.exceptionDetails?.text
            || 'Unknown exception';
          this.broadcast({
            type: 'screencast-console-message',
            entry: {
              level: 'error',
              text: desc,
              timestamp: Date.now(),
              source: event.exceptionDetails?.url || undefined,
              lineNumber: event.exceptionDetails?.lineNumber || undefined,
            },
          });
        });

        this.consoleEnabled = true;
        logger.info('Console monitoring enabled');
      } catch (err) {
        logger.warn(`Failed to enable console monitoring: ${err}`);
      }
    } else {
      // Fallback: use Playwright's page.on('console') event
      if (this.activePage) {
        this.activePage.on('console', (msg) => {
          this.broadcast({
            type: 'screencast-console-message',
            entry: {
              level: mapConsoleLevel(msg.type()),
              text: msg.text(),
              timestamp: Date.now(),
              source: msg.location()?.url || undefined,
              lineNumber: msg.location()?.lineNumber || undefined,
            },
          });
        });
      }
      this.consoleEnabled = true;
      logger.info('Console monitoring enabled (Playwright fallback)');
    }
  }

  async disableConsoleMonitoring(): Promise<void> {
    if (!this.consoleEnabled) return;
    if (this.cdpSession) {
      try { await this.cdpSession.send('Runtime.disable'); } catch { /* ok */ }
    }
    this.consoleEnabled = false;
    logger.info('Console monitoring disabled');
  }

  // ── CDP Screencast ──────────────────────────────────────────────────────────

  private async startCDPScreencast(page: Page, options?: ScreencastOptions): Promise<void> {
    try {
      this.cdpSession = await page.context().newCDPSession(page);

      // Listen for screencast frames
      this.cdpSession.on('Page.screencastFrame', (event: any) => {
        // Broadcast frame to all connected clients
        this.broadcast({
          type: 'screencast-frame',
          data: event.data, // base64-encoded JPEG
          metadata: {
            width: event.metadata?.deviceWidth || this.viewportWidth,
            height: event.metadata?.deviceHeight || this.viewportHeight,
            offsetTop: event.metadata?.offsetTop || 0,
            pageScaleFactor: event.metadata?.pageScaleFactor || 1,
            timestamp: Date.now(),
          },
        });

        // Acknowledge the frame to receive the next one
        this.cdpSession?.send('Page.screencastFrameAck', {
          sessionId: event.sessionId,
        }).catch(() => {});
      });

      await this.cdpSession.send('Page.startScreencast', {
        format: options?.format || 'jpeg',
        quality: options?.quality ?? 50,
        maxWidth: options?.maxWidth || this.viewportWidth,
        maxHeight: options?.maxHeight || this.viewportHeight,
        everyNthFrame: 1,
      });
    } catch (err) {
      logger.warn(`CDP screencast failed, falling back to periodic screenshots: ${err}`);
      this.cdpSession = null;
      this.isCDP = false;
      this.startFallbackScreencast(page);
    }
  }

  // ── Fallback: Periodic Screenshots ──────────────────────────────────────────

  private startFallbackScreencast(page: Page): void {
    let capturing = false;
    this.fallbackInterval = setInterval(async () => {
      if (capturing || !this.isStreaming) return;
      capturing = true;
      try {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 50 });
        const base64 = buffer.toString('base64');
        this.broadcast({
          type: 'screencast-frame',
          data: base64,
          metadata: {
            width: this.viewportWidth,
            height: this.viewportHeight,
            offsetTop: 0,
            pageScaleFactor: 1,
            timestamp: Date.now(),
          },
        });
      } catch {
        // Page may have been closed — ignore
      }
      capturing = false;
    }, 500); // ~2fps fallback
  }

  // ── Broadcast Helper ────────────────────────────────────────────────────────

  private broadcast(message: object): void {
    if (!this.wss) return;
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if ((client as WebSocket).readyState === 1) {
        client.send(data);
      }
    }
  }
}

// ── Utility helpers ──────────────────────────────────────────────────────────

/** Extract attribute from CDP flat attributes array [name, value, name, value, ...] */
function getAttr(attrs: string[], name: string): string | undefined {
  for (let i = 0; i < attrs.length - 1; i += 2) {
    if (attrs[i] === name) return attrs[i + 1] || undefined;
  }
  return undefined;
}

/** Map console API type strings to our ConsoleEntry level */
function mapConsoleLevel(type: string): ConsoleEntry['level'] {
  switch (type) {
    case 'warning': return 'warn';
    case 'error': return 'error';
    case 'debug': return 'debug';
    case 'info': return 'info';
    default: return 'log';
  }
}
