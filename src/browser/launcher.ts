import type { BrowserSession, SessionOptions, TabInfo, FrameInfo } from '../types/index.js';
import { PlaywrightAdapter } from './playwright-adapter.js';
import type { WebAdapter } from './adapter.js';
import { createLogger } from '../utils/index.js';
import { getConfig } from '../config/index.js';

const logger = createLogger('browser-manager');

/**
 * BrowserManager wraps the adapter and provides a simplified API
 * that browser tools use. It manages the active session lifecycle.
 */
export class BrowserManager {
  private adapter: PlaywrightAdapter;
  private activeSession: BrowserSession | null = null;

  constructor() {
    this.adapter = new PlaywrightAdapter();
  }

  async launch(options?: Partial<SessionOptions>): Promise<BrowserSession> {
    if (this.activeSession) {
      logger.info('Closing existing session before launching new one');
      await this.close();
    }

    await this.adapter.initialize();
    const config = getConfig().getAutomationConfig();

    this.activeSession = await this.adapter.createSession({
      browser: options?.browser || config.browser,
      headless: options?.headless ?? config.headless,
      timeout: options?.timeout || config.timeout,
      slowMo: options?.slowMo || config.slowMo,
      ...options,
    });

    return this.activeSession;
  }

  async navigateActive(url: string): Promise<void> {
    await this.ensureSession();
    const result = await this.adapter.navigate(url);
    if (!result.success) throw new Error(result.error || 'Navigation failed');
  }

  async click(selector: string, strategy?: string): Promise<void> {
    await this.ensureSession();
    const result = await this.adapter.click(selector, strategy);
    if (!result.success) throw new Error(result.error || 'Click failed');
  }

  async type(selector: string, text: string, clear = true): Promise<void> {
    await this.ensureSession();
    const result = await this.adapter.type(selector, text, clear);
    if (!result.success) throw new Error(result.error || 'Type failed');
  }

  async press(key: string): Promise<void> {
    await this.ensureSession();
    const result = await this.adapter.press(key);
    if (!result.success) throw new Error(result.error || 'Key press failed');
  }

  async hover(selector: string, strategy?: string): Promise<void> {
    await this.ensureSession();
    const result = await this.adapter.hover(selector, strategy);
    if (!result.success) throw new Error(result.error || 'Hover failed');
  }

  async select(selector: string, value: string): Promise<void> {
    await this.ensureSession();
    const result = await this.adapter.select(selector, value);
    if (!result.success) throw new Error(result.error || 'Select failed');
  }

  async screenshot(path?: string, fullPage?: boolean): Promise<string> {
    await this.ensureSession();
    return this.adapter.screenshot(path, fullPage);
  }

  async inspectElements(selector: string, maxResults?: number): Promise<unknown[]> {
    await this.ensureSession();
    return this.adapter.inspectElements(selector, maxResults);
  }

  async evaluate(script: string): Promise<unknown> {
    await this.ensureSession();
    // If the script contains bare `return` statements, it's intended as a function body.
    // Wrap it in an IIFE so Playwright can execute it — bare `return` is illegal in
    // expression context and causes "Illegal return statement" errors.
    const trimmed = script.trim();
    const alreadyWrapped = /^\s*\(?\s*(function\b|(\([^)]*\)|\w+)\s*=>)/.test(trimmed);
    const normalizedScript = !alreadyWrapped && /\breturn\s/.test(trimmed)
      ? `(() => { ${script} })()`
      : script;
    return this.adapter.evaluate(normalizedScript);
  }

  async waitFor(selector: string, state?: string, timeout?: number): Promise<void> {
    await this.ensureSession();
    const result = await this.adapter.waitFor(selector, state, timeout);
    if (!result.success) throw new Error(result.error || 'Wait failed');
  }

  async getText(selector?: string): Promise<string> {
    await this.ensureSession();
    return this.adapter.getText(selector);
  }

  async getUrl(): Promise<string> {
    await this.ensureSession();
    return this.adapter.getUrl();
  }

  async getTitle(): Promise<string> {
    await this.ensureSession();
    return this.adapter.getTitle();
  }

  async navigate(_sessionId: string, url: string): Promise<void> {
    return this.navigateActive(url);
  }

  async close(): Promise<void> {
    if (this.activeSession) {
      await this.adapter.closeSession();
      this.activeSession = null;
    }
  }

  hasActiveSession(): boolean {
    return this.activeSession !== null;
  }

  getAdapter(): WebAdapter {
    return this.adapter;
  }

  // ── Tab/Window Management ───────────────────────────────────────────────────

  async listTabs(): Promise<TabInfo[]> {
    await this.ensureSession();
    return this.adapter.listTabs();
  }

  switchTab(index: number): void {
    if (!this.activeSession) throw new Error('No active session');
    this.adapter.switchTab(index);
  }

  async newTab(url?: string, switchTo?: boolean): Promise<number> {
    await this.ensureSession();
    return this.adapter.newTab(url, switchTo);
  }

  async closeTab(index?: number): Promise<void> {
    await this.ensureSession();
    return this.adapter.closeTab(index);
  }

  // ── Frame/IFrame Management ─────────────────────────────────────────────────

  listFrames(): FrameInfo[] {
    if (!this.activeSession) throw new Error('No active session');
    return this.adapter.listFrames();
  }

  switchToFrame(identifier: string | number): void {
    if (!this.activeSession) throw new Error('No active session');
    this.adapter.switchToFrame(identifier);
  }

  switchToMainFrame(): void {
    if (!this.activeSession) throw new Error('No active session');
    this.adapter.switchToMainFrame();
  }

  // ── Page/Context Exposure ───────────────────────────────────────────────────

  /**
   * Expose the raw Playwright Page for the recorder to attach
   * event listeners via exposeFunction/addInitScript.
   */
  getPage(): import('playwright-core').Page | null {
    return this.adapter.getPage();
  }

  /**
   * Expose all tracked pages (for recorder multi-tab support).
   */
  getAllPages(): import('playwright-core').Page[] {
    return this.adapter.getAllPages();
  }

  /**
   * Expose the browser context (for recorder popup listening).
   */
  getContext(): import('playwright-core').BrowserContext | null {
    return this.adapter.getContext();
  }

  /**
   * Expose the browser type name (chromium/firefox/webkit) for CDP capability detection.
   */
  getBrowserType(): string | null {
    return this.adapter.getBrowserType();
  }

  private async ensureSession(): Promise<void> {
    if (!this.activeSession) {
      // Auto-launch if no session exists
      logger.info('Auto-launching browser session');
      await this.launch();
    }
  }
}
