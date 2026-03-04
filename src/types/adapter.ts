import { z } from 'zod';

// ── Element Selectors ─────────────────────────────────────────────────────────

export const SelectorStrategySchema = z.enum([
  'css',
  'xpath',
  'text',
  'testId',
  'role',
  'label',
  'name',
  'placeholder',
]);
export type SelectorStrategy = z.infer<typeof SelectorStrategySchema>;

export const ElementSelectorSchema = z.object({
  strategy: SelectorStrategySchema,
  value: z.string(),
  fallbacks: z
    .array(
      z.object({
        strategy: SelectorStrategySchema,
        value: z.string(),
      }),
    )
    .optional(),
});
export type ElementSelector = z.infer<typeof ElementSelectorSchema>;

// ── Browser Session ───────────────────────────────────────────────────────────

export const BrowserTypeSchema = z.enum(['chromium', 'firefox', 'webkit']);
export type BrowserType = z.infer<typeof BrowserTypeSchema>;

export const SessionOptionsSchema = z.object({
  browser: BrowserTypeSchema.default('chromium'),
  headless: z.boolean().default(false),
  viewport: z
    .object({
      width: z.number().default(1280),
      height: z.number().default(720),
    })
    .optional(),
  timeout: z.number().default(30000),
  baseUrl: z.string().optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  deviceName: z.string().optional(),
  slowMo: z.number().optional(),
});
export type SessionOptions = z.infer<typeof SessionOptionsSchema>;

export const BrowserSessionSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  active: z.boolean(),
  metadata: z.record(z.any()).optional(),
});
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;

// ── Action Results ────────────────────────────────────────────────────────────

export const ActionResultSchema = z.object({
  success: z.boolean(),
  duration: z.number(),
  error: z.string().optional(),
  data: z.any().optional(),
});
export type ActionResult = z.infer<typeof ActionResultSchema>;

export const ScreenshotOptionsSchema = z.object({
  fullPage: z.boolean().default(false),
  path: z.string().optional(),
  format: z.enum(['png', 'jpeg']).default('png'),
  quality: z.number().min(0).max(100).optional(),
});
export type ScreenshotOptions = z.infer<typeof ScreenshotOptionsSchema>;

// ── Tab/Page Info ────────────────────────────────────────────────────────────

export const TabInfoSchema = z.object({
  /** Tab index (0-based, in order of creation) */
  index: z.number(),
  /** Page URL */
  url: z.string(),
  /** Page title */
  title: z.string(),
  /** Whether this is the currently active (focused) tab */
  active: z.boolean(),
});
export type TabInfo = z.infer<typeof TabInfoSchema>;

// ── Frame Info ───────────────────────────────────────────────────────────────

export const FrameInfoSchema = z.object({
  /** Index among sibling frames (0 = main frame) */
  index: z.number(),
  /** Frame name attribute, if any */
  name: z.string().optional(),
  /** Frame URL */
  url: z.string(),
  /** Whether this is the main frame */
  isMainFrame: z.boolean(),
});
export type FrameInfo = z.infer<typeof FrameInfoSchema>;

// ── Adapter Config ────────────────────────────────────────────────────────────

export const AdapterConfigSchema = z.object({
  type: z.enum(['web', 'mobile', 'api', 'database']).default('web'),
  options: SessionOptionsSchema.optional(),
});
export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;
