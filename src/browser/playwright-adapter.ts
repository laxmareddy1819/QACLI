import type { Browser, BrowserContext, Page, Frame, Locator } from 'playwright-core';
import { chromium, firefox, webkit } from 'playwright-core';
import type {
  ActionResult,
  BrowserSession,
  SessionOptions,
  ElementFingerprint,
  BrowserType,
  TabInfo,
  FrameInfo,
} from '../types/index.js';
import type { WebAdapter } from './adapter.js';
import { generateId, createLogger } from '../utils/index.js';

const logger = createLogger('playwright');

export class PlaywrightAdapter implements WebAdapter {
  readonly name = 'playwright';

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Page[] = [];
  private activePageIndex = 0;
  private activeFrame: Frame | null = null;
  private sessionId: string | null = null;
  private browserTypeName: string | null = null;
  private initialized = false;
  private newPageCallback: ((index: number) => void) | null = null;
  private disconnectCallback: (() => void) | null = null;
  private disconnectNotified = false;
  private disconnectPollInterval: ReturnType<typeof setInterval> | null = null;

  /** Register callback for when a new tab/popup is auto-detected by the browser context. */
  onNewPage(cb: (index: number) => void): void {
    this.newPageCallback = cb;
  }

  /** Register callback for when the browser is externally disconnected (user closed the window). */
  onDisconnect(cb: () => void): void {
    this.disconnectCallback = cb;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  isReady(): boolean {
    return this.initialized;
  }

  async createSession(options?: Partial<SessionOptions>): Promise<BrowserSession> {
    const browserType = options?.browser || 'chromium';
    const headless = options?.headless ?? false;

    const browserEngine = this.getBrowserEngine(browserType);
    this.browser = await browserEngine.launch({
      headless,
      slowMo: options?.slowMo,
    });

    // Reset disconnect guard for new session
    this.disconnectNotified = false;

    // Detect when user closes the browser window externally
    this.browser.on('disconnected', () => {
      logger.info('Browser disconnected event fired');
      this.handleDisconnect('event');
    });

    this.context = await this.browser.newContext({
      viewport: options?.viewport || { width: 1280, height: 720 },
      locale: options?.locale,
      timezoneId: options?.timezone,
    });

    const firstPage = await this.context.newPage();
    this.pages = [firstPage];
    this.activePageIndex = 0;
    this.activeFrame = null;
    this.sessionId = generateId('session');
    this.browserTypeName = browserType;

    // Attach close listener to the FIRST page (context.on('page') only catches later pages)
    this.attachPageCloseListener(firstPage);

    // Start a heartbeat that polls browser.isConnected() every 2 seconds.
    // This is a fallback for platforms where browser.on('disconnected') may not fire
    // reliably (e.g. Windows headed Chromium).
    this.startDisconnectPoll();

    // Listen for new pages (popups, window.open, target=_blank)
    this.context.on('page', (newPage: Page) => {
      if (!this.pages.includes(newPage)) {
        this.pages.push(newPage);
      }
      const idx = this.pages.indexOf(newPage);
      logger.info(`New tab/popup detected (index ${idx}): ${newPage.url()}`);

      // Notify BrowserManager about the new tab so screencast can switch
      if (this.newPageCallback) {
        try { this.newPageCallback(idx); } catch { /* ignore */ }
      }

      // Clean up when the page is closed
      this.attachPageCloseListener(newPage);
    });

    if (options?.baseUrl) {
      await firstPage.goto(options.baseUrl);
    }

    logger.info(`Browser session created: ${this.sessionId}`);

    return {
      id: this.sessionId,
      createdAt: Date.now(),
      active: true,
    };
  }

  async closeSession(): Promise<void> {
    this.stopDisconnectPoll();
    this.disconnectNotified = true; // Prevent poll/event from firing during programmatic close
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.context = null;
      this.pages = [];
      this.activePageIndex = 0;
      this.activeFrame = null;
      this.sessionId = null;
    }
  }

  // ── Navigation & Interaction ────────────────────────────────────────────────

  async navigate(url: string): Promise<ActionResult> {
    const start = Date.now();
    try {
      await this.ensurePage().goto(url, { waitUntil: 'domcontentloaded' });
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  async click(selector: string, strategy?: string): Promise<ActionResult> {
    const start = Date.now();
    try {
      const locator = this.getLocator(selector, strategy);
      await locator.click({ timeout: 10000 });
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  async fill(selector: string, text: string, clear = true): Promise<ActionResult> {
    const start = Date.now();
    try {
      const locator = this.getLocator(selector);
      if (clear) {
        await locator.fill(text);
      } else {
        await locator.pressSequentially(text);
      }
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  async type(selector: string, text: string, clear = true): Promise<ActionResult> {
    return this.fill(selector, text, clear);
  }

  async press(key: string): Promise<ActionResult> {
    const start = Date.now();
    try {
      // Keyboard is page-level, not frame-level
      await this.ensurePage().keyboard.press(key);
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  async select(selector: string, value: string): Promise<ActionResult> {
    const start = Date.now();
    try {
      const locator = this.getLocator(selector);
      await locator.selectOption(value);
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  async hover(selector: string, strategy?: string): Promise<ActionResult> {
    const start = Date.now();
    try {
      const locator = this.getLocator(selector, strategy);
      await locator.hover();
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  async check(selector: string): Promise<ActionResult> {
    const start = Date.now();
    try {
      const locator = this.getLocator(selector);
      await locator.check();
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  async uncheck(selector: string): Promise<ActionResult> {
    const start = Date.now();
    try {
      const locator = this.getLocator(selector);
      await locator.uncheck();
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  // ── Wait ────────────────────────────────────────────────────────────────────

  async waitFor(selector: string, state = 'visible', timeout = 30000): Promise<ActionResult> {
    const start = Date.now();
    try {
      const locator = this.getLocator(selector);
      await locator.waitFor({
        state: state as 'visible' | 'hidden' | 'attached' | 'detached',
        timeout,
      });
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  async waitForNavigation(timeout = 30000): Promise<ActionResult> {
    const start = Date.now();
    try {
      await this.ensurePage().waitForLoadState('domcontentloaded', { timeout });
      return { success: true, duration: Date.now() - start };
    } catch (error) {
      return { success: false, duration: Date.now() - start, error: String(error) };
    }
  }

  // ── Query & Inspection ──────────────────────────────────────────────────────

  async getTitle(): Promise<string> {
    return this.ensurePage().title();
  }

  async getUrl(): Promise<string> {
    return this.ensurePage().url();
  }

  async getText(selector?: string): Promise<string> {
    if (!selector) {
      // Use interaction target so getText() works inside frames too
      const target = this.getInteractionTarget();
      return target.locator('body').innerText();
    }
    const locator = this.getLocator(selector);
    return locator.innerText();
  }

  async getAttribute(selector: string, attribute: string): Promise<string | null> {
    const locator = this.getLocator(selector);
    return locator.getAttribute(attribute);
  }

  async isVisible(selector: string): Promise<boolean> {
    const locator = this.getLocator(selector);
    return locator.isVisible();
  }

  async isEnabled(selector: string): Promise<boolean> {
    const locator = this.getLocator(selector);
    return locator.isEnabled();
  }

  async screenshot(path?: string, fullPage = false): Promise<string> {
    const savePath = path || `screenshot-${Date.now()}.png`;
    await this.ensurePage().screenshot({ path: savePath, fullPage });
    return savePath;
  }

  async evaluate<T = unknown>(script: string): Promise<T> {
    // Evaluate in the active frame context (frame-scoped)
    const target = this.getInteractionTarget();
    return target.evaluate(script) as Promise<T>;
  }

  async getElementFingerprint(selector: string): Promise<ElementFingerprint> {
    // Run in the active frame context (frame-scoped)
    const target = this.getInteractionTarget();
    /* eslint-disable no-eval -- runs in browser context via evaluate */
    return target.evaluate(`
      (function(sel) {
        var el = document.querySelector(sel);
        if (!el) throw new Error('Element not found: ' + sel);

        var rect = el.getBoundingClientRect();
        var attrs = {};
        for (var i = 0; i < el.attributes.length; i++) {
          attrs[el.attributes[i].name] = el.attributes[i].value;
        }

        return {
          tagName: el.tagName.toLowerCase(),
          id: el.id || undefined,
          testId: el.getAttribute('data-testid') || undefined,
          className: el.className || undefined,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          ariaRole: el.getAttribute('role') || undefined,
          name: el.getAttribute('name') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          textContent: el.textContent ? el.textContent.trim().slice(0, 100) : undefined,
          href: el.href || undefined,
          type: el.type || undefined,
          attributes: attrs,
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : undefined,
          siblingIndex: el.parentElement
            ? Array.from(el.parentElement.children).indexOf(el)
            : undefined,
          childCount: el.children.length,
        };
      })(${JSON.stringify(selector)})
    `) as Promise<ElementFingerprint>;
  }

  /**
   * Inspect elements matching a CSS selector. Returns structured info about
   * each matching element: tag, id, classes, attributes, text, and nearby
   * siblings — everything needed for building Page Object selectors without
   * resorting to browser_evaluate.
   */
  async inspectElements(selector: string, maxResults = 10): Promise<unknown[]> {
    // Run in the active frame context (frame-scoped)
    const target = this.getInteractionTarget();
    return target.evaluate(`
      (function(sel, max) {
        var els = document.querySelectorAll(sel);
        var results = [];
        for (var i = 0; i < Math.min(els.length, max); i++) {
          var el = els[i];
          var attrs = {};
          for (var a = 0; a < el.attributes.length; a++) {
            attrs[el.attributes[a].name] = el.attributes[a].value;
          }
          var siblings = [];
          if (el.parentElement) {
            var children = el.parentElement.children;
            for (var s = 0; s < Math.min(children.length, 10); s++) {
              var sib = children[s];
              siblings.push({
                tag: sib.tagName.toLowerCase(),
                id: sib.id || undefined,
                className: sib.className || undefined,
                text: (sib.textContent || '').trim().slice(0, 50)
              });
            }
          }
          results.push({
            index: i,
            tag: el.tagName.toLowerCase(),
            id: el.id || undefined,
            className: el.className || undefined,
            name: el.getAttribute('name') || undefined,
            type: el.type || undefined,
            placeholder: el.getAttribute('placeholder') || undefined,
            href: el.href || undefined,
            text: (el.textContent || '').trim().slice(0, 100),
            value: el.value || undefined,
            dataTestId: el.getAttribute('data-testid') || undefined,
            ariaLabel: el.getAttribute('aria-label') || undefined,
            role: el.getAttribute('role') || undefined,
            isVisible: el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0,
            attributes: attrs,
            parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : undefined,
            parentClass: el.parentElement ? (el.parentElement.className || undefined) : undefined,
            siblings: siblings
          });
        }
        return results;
      })(${JSON.stringify(selector)}, ${maxResults})
    `) as Promise<unknown[]>;
  }

  // ── Tab/Window Management ───────────────────────────────────────────────────

  /**
   * List all open tabs/pages with their index, URL, title, and active status.
   */
  async listTabs(): Promise<TabInfo[]> {
    const result: TabInfo[] = [];
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i]!;
      result.push({
        index: i,
        url: p.url(),
        title: await p.title().catch(() => ''),
        active: i === this.activePageIndex,
      });
    }
    return result;
  }

  /**
   * Switch the active tab by index. Resets frame context to main frame.
   */
  switchTab(index: number): void {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(
        `Tab index ${index} out of range. Open tabs: 0-${this.pages.length - 1}`,
      );
    }
    this.activePageIndex = index;
    this.activeFrame = null; // always reset to main frame when switching tabs
    logger.info(`Switched to tab ${index}`);
  }

  /**
   * Open a new empty tab and optionally switch to it.
   */
  async newTab(url?: string, switchTo = true): Promise<number> {
    if (!this.context) throw new Error('No browser context');
    const page = await this.context.newPage();
    // context.on('page') may or may not fire for context.newPage() —
    // ensure we track it either way
    if (!this.pages.includes(page)) {
      this.pages.push(page);
    }
    const idx = this.pages.indexOf(page);
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }
    if (switchTo) {
      this.activePageIndex = idx;
      this.activeFrame = null;
    }
    return idx;
  }

  /**
   * Close a specific tab by index. Cannot close the last tab.
   */
  async closeTab(index?: number): Promise<void> {
    const idx = index ?? this.activePageIndex;
    if (idx < 0 || idx >= this.pages.length) {
      throw new Error(`Tab index ${idx} out of range`);
    }
    if (this.pages.length <= 1) {
      throw new Error('Cannot close the last tab. Use browser_close to end the session.');
    }
    const page = this.pages[idx]!;
    await page.close();
    // The 'close' event handler on the page cleans up this.pages and adjusts activePageIndex
  }

  // ── Frame/IFrame Management ─────────────────────────────────────────────────

  /**
   * List all frames in the current page.
   */
  listFrames(): FrameInfo[] {
    const page = this.ensurePage();
    return page.frames().map((frame, index) => ({
      index,
      name: frame.name() || undefined,
      url: frame.url(),
      isMainFrame: frame === page.mainFrame(),
    }));
  }

  /**
   * Switch interaction context to a specific frame.
   * Accepts: frame name (string), URL substring (string), or numeric index.
   */
  switchToFrame(identifier: string | number): void {
    const page = this.ensurePage();
    const frames = page.frames();

    let target: Frame | null = null;

    if (typeof identifier === 'number') {
      if (identifier < 0 || identifier >= frames.length) {
        throw new Error(
          `Frame index ${identifier} out of range. Frames: 0-${frames.length - 1}`,
        );
      }
      target = frames[identifier]!;
    } else {
      // By name (exact match)
      target = page.frame({ name: identifier });
      if (!target) {
        // By URL substring
        target = frames.find((f) => f.url().includes(identifier)) || null;
      }
    }

    if (!target) {
      throw new Error(
        `Frame not found: "${identifier}". Use browser_list_frames to see available frames.`,
      );
    }

    this.activeFrame = target === page.mainFrame() ? null : target;
    logger.info(`Switched to frame: ${target.name() || target.url()}`);
  }

  /**
   * Switch interaction context back to the main frame.
   */
  switchToMainFrame(): void {
    this.activeFrame = null;
    logger.info('Switched to main frame');
  }

  // ── Page/Context Exposure ───────────────────────────────────────────────────

  /**
   * Expose the raw Playwright Page for advanced use cases (e.g. recorder
   * injecting event listeners via exposeFunction + addInitScript).
   * Returns null if no session is active.
   */
  getPage(): Page | null {
    return this.pages.length > 0 ? this.pages[this.activePageIndex] : null;
  }

  /** Get the current active page index. */
  getActivePageIndex(): number {
    return this.activePageIndex;
  }

  /**
   * Expose all tracked pages (for recorder multi-tab support).
   */
  getAllPages(): Page[] {
    return [...this.pages];
  }

  /**
   * Expose the browser context (for recorder popup listening).
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  getBrowserType(): string | null {
    return this.browserTypeName;
  }

  async dispose(): Promise<void> {
    await this.closeSession();
    this.initialized = false;
  }

  // ── Disconnect Detection Helpers ────────────────────────────────────────────

  /**
   * Central disconnect handler with dedup guard.
   * Called by: browser 'disconnected' event, heartbeat poll, last-page-close detection.
   * Only executes ONCE per session thanks to `disconnectNotified` flag.
   */
  private handleDisconnect(source: string): void {
    if (this.disconnectNotified) {
      logger.info(`Disconnect already handled (ignoring duplicate from ${source})`);
      return;
    }
    this.disconnectNotified = true;
    this.stopDisconnectPoll();
    logger.info(`Browser disconnect detected via ${source} — cleaning up`);

    this.pages = [];
    this.activePageIndex = 0;
    this.activeFrame = null;
    this.context = null;
    this.browser = null;
    this.sessionId = null;

    if (this.disconnectCallback) {
      try {
        this.disconnectCallback();
        logger.info('Disconnect callback executed successfully');
      } catch (err) {
        logger.info(`Disconnect callback error: ${err}`);
      }
    } else {
      logger.info('No disconnect callback registered');
    }
  }

  /**
   * Attach a close listener to a page. When the last page closes,
   * treat it as a browser disconnect (fallback for when browser.on('disconnected') is slow).
   */
  private attachPageCloseListener(page: Page): void {
    page.on('close', () => {
      const closeIdx = this.pages.indexOf(page);
      if (closeIdx >= 0) {
        this.pages.splice(closeIdx, 1);
        // Adjust activePageIndex if needed
        if (this.activePageIndex >= this.pages.length) {
          this.activePageIndex = Math.max(0, this.pages.length - 1);
        }
        if (this.activePageIndex === closeIdx) {
          this.activeFrame = null;
        }
      }

      // If ALL pages are gone and this wasn't a programmatic close, the browser is effectively disconnected
      if (this.pages.length === 0 && !this.disconnectNotified) {
        logger.info('All pages closed — triggering disconnect via last-page-close');
        // Small delay to let browser.on('disconnected') fire first if it's going to
        setTimeout(() => {
          this.handleDisconnect('last-page-close');
        }, 500);
      }
    });
  }

  /**
   * Start polling browser.isConnected() every 2 seconds.
   * Catches disconnects that the event listener misses (Windows edge cases).
   */
  private startDisconnectPoll(): void {
    this.stopDisconnectPoll();
    this.disconnectPollInterval = setInterval(() => {
      try {
        if (!this.browser || !this.browser.isConnected()) {
          logger.info('Heartbeat detected browser disconnected');
          this.handleDisconnect('heartbeat-poll');
        }
      } catch {
        // browser object might be in a bad state
        logger.info('Heartbeat error — treating as disconnect');
        this.handleDisconnect('heartbeat-poll-error');
      }
    }, 2000);
  }

  /**
   * Stop the disconnect heartbeat poll.
   */
  private stopDisconnectPoll(): void {
    if (this.disconnectPollInterval) {
      clearInterval(this.disconnectPollInterval);
      this.disconnectPollInterval = null;
    }
  }

  // ── Internal Helpers ──────────────────────────────────────────────────────

  private ensurePage(): Page {
    if (this.pages.length === 0) {
      throw new Error('No browser page. Call createSession() first or use browser_launch tool.');
    }
    return this.pages[this.activePageIndex] || this.pages[0]!;
  }

  /**
   * Returns the current interaction scope: either the active frame (if
   * switched into an iframe) or the active page's main frame.
   * All locator-building and frame-scoped methods should use this.
   */
  private getInteractionTarget(): Page | Frame {
    if (this.activeFrame) {
      if (this.activeFrame.isDetached()) {
        logger.warn('Active frame was detached. Switching to main frame.');
        this.activeFrame = null;
      } else {
        return this.activeFrame;
      }
    }
    return this.ensurePage();
  }

  private getLocator(selector: string, strategy?: string): Locator {
    // Use interaction target so locators work inside frames too
    const target = this.getInteractionTarget();

    switch (strategy) {
      case 'text':
        return target.locator(`text=${selector}`).first();
      case 'testId':
        return target.locator(`[data-testid="${selector}"]`);
      case 'role':
        return target.locator(`role=${selector}`);
      case 'label':
        return target.locator(`[aria-label="${selector}"]`);
      case 'placeholder':
        return target.locator(`[placeholder="${selector}"]`);
      case 'xpath':
        return target.locator(`xpath=${selector}`);
      case 'css':
      default:
        // Auto-detect: if starts with // or .. it's xpath
        if (selector.startsWith('//') || selector.startsWith('..')) {
          return target.locator(`xpath=${selector}`);
        }
        // If it looks like plain text (no CSS special chars), try text
        if (!/[.#\[\]:>~+*=|^$]/.test(selector) && !selector.includes('<')) {
          return target.locator(`text=${selector}`).first();
        }
        return target.locator(selector);
    }
  }

  private getBrowserEngine(type: BrowserType) {
    switch (type) {
      case 'firefox':
        return firefox;
      case 'webkit':
        return webkit;
      case 'chromium':
      default:
        return chromium;
    }
  }
}
