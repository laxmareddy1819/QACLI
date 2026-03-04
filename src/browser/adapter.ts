import type {
  ActionResult,
  BrowserSession,
  SessionOptions,
  ElementFingerprint,
  TabInfo,
  FrameInfo,
} from '../types/index.js';

export interface WebAdapter {
  readonly name: string;

  initialize(): Promise<void>;
  isReady(): boolean;

  createSession(options?: Partial<SessionOptions>): Promise<BrowserSession>;
  closeSession(): Promise<void>;

  navigate(url: string): Promise<ActionResult>;
  click(selector: string, strategy?: string): Promise<ActionResult>;
  fill(selector: string, text: string, clear?: boolean): Promise<ActionResult>;
  type(selector: string, text: string, clear?: boolean): Promise<ActionResult>;
  press(key: string): Promise<ActionResult>;
  select(selector: string, value: string): Promise<ActionResult>;
  hover(selector: string, strategy?: string): Promise<ActionResult>;
  check(selector: string): Promise<ActionResult>;
  uncheck(selector: string): Promise<ActionResult>;

  waitFor(selector: string, state?: string, timeout?: number): Promise<ActionResult>;
  waitForNavigation(timeout?: number): Promise<ActionResult>;

  getTitle(): Promise<string>;
  getUrl(): Promise<string>;
  getText(selector?: string): Promise<string>;
  getAttribute(selector: string, attribute: string): Promise<string | null>;
  isVisible(selector: string): Promise<boolean>;
  isEnabled(selector: string): Promise<boolean>;

  screenshot(path?: string, fullPage?: boolean): Promise<string>;
  evaluate<T = unknown>(script: string): Promise<T>;

  getElementFingerprint(selector: string): Promise<ElementFingerprint>;

  // Tab/Window management (optional — not all adapters may support)
  listTabs?(): Promise<TabInfo[]>;
  switchTab?(index: number): void;
  newTab?(url?: string, switchTo?: boolean): Promise<number>;
  closeTab?(index?: number): Promise<void>;

  // Frame/IFrame management (optional)
  listFrames?(): FrameInfo[];
  switchToFrame?(identifier: string | number): void;
  switchToMainFrame?(): void;

  dispose(): Promise<void>;
}
