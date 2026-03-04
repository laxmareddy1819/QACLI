import { z } from 'zod';
import { ElementSelectorSchema } from './adapter.js';

// ── Recording Actions ─────────────────────────────────────────────────────────

export const RecordedActionTypeSchema = z.enum([
  'navigate',
  'click',
  'dblclick',
  'type',
  'fill',
  'press',
  'select',
  'check',
  'uncheck',
  'hover',
  'scroll',
  'drag',
  'upload',
  'screenshot',
  'wait',
  'assert',
]);
export type RecordedActionType = z.infer<typeof RecordedActionTypeSchema>;

export const AssertTypeSchema = z.enum([
  // ── Positive assertions ──
  'text',        // Element contains/equals text
  'visible',     // Element is visible on page
  'hidden',      // Element is NOT visible
  'value',       // Input field has specific value
  'attribute',   // Element has specific attribute value
  'url',         // Page URL contains/equals pattern
  'title',       // Page title contains/equals pattern
  'count',       // Number of matching elements
  'enabled',     // Element is enabled (not disabled)
  'disabled',    // Element is disabled
  'checked',     // Checkbox/radio is checked
  'unchecked',   // Checkbox/radio is not checked
  'class',       // Element has CSS class
  'placeholder', // Input placeholder matches
  'href',        // Link href contains pattern
  'min-count',   // At least N matching elements
  // ── Negative assertions ──
  'not-text',    // Element does NOT contain text
  'not-visible', // Element is NOT visible
  'not-value',   // Input does NOT have specific value
  'not-enabled', // Element is NOT enabled
  'not-checked', // Element is NOT checked
  'not-url',     // URL does NOT contain pattern
  'not-title',   // Title does NOT contain pattern
  'not-count',   // Element count does NOT equal N
  'not-class',   // Element does NOT have CSS class
]);
export type AssertType = z.infer<typeof AssertTypeSchema>;

export const RecordedActionSchema = z.object({
  id: z.string(),
  type: RecordedActionTypeSchema,
  timestamp: z.number(),
  selector: ElementSelectorSchema.optional(),
  value: z.string().optional(),
  url: z.string().optional(),
  key: z.string().optional(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  description: z.string().optional(),
  screenshot: z.string().optional(),
  /** Tab index for multi-tab recording (0-based) */
  tabIndex: z.number().optional(),
  /** Frame name for iframe recording (omitted = main frame) */
  frameName: z.string().optional(),
  /** Assertion type — only when type === 'assert' */
  assertType: AssertTypeSchema.optional(),
  /** Expected value for assertion (text, attribute value, URL pattern, count) */
  expectedValue: z.string().optional(),
  /** Attribute name for attribute assertions (e.g. 'class', 'href', 'data-state') */
  assertAttribute: z.string().optional(),
  /** Actual value captured at recording time (for UI display) */
  actualValue: z.string().optional(),
});
export type RecordedAction = z.infer<typeof RecordedActionSchema>;

// ── Recording Session ─────────────────────────────────────────────────────────

export const RecordingOptionsSchema = z.object({
  url: z.string().optional(),
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  headless: z.boolean().default(false),
  viewport: z
    .object({
      width: z.number().default(1280),
      height: z.number().default(720),
    })
    .optional(),
  outputFormat: z
    .enum(['playwright', 'cypress', 'selenium', 'puppeteer'])
    .default('playwright'),
  outputLanguage: z.string().default('typescript'),
  includeAssertions: z.boolean().default(true),
});
export type RecordingOptions = z.infer<typeof RecordingOptionsSchema>;

export const RecordingSessionSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  url: z.string(),
  actions: z.array(RecordedActionSchema),
  duration: z.number().optional(),
});
export type RecordingSession = z.infer<typeof RecordingSessionSchema>;

// ── Output Formatting ─────────────────────────────────────────────────────────

export const OutputFormatSchema = z.enum([
  'playwright',
  'cypress',
  'selenium',
  'puppeteer',
]);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

export const FormatterOptionsSchema = z.object({
  format: OutputFormatSchema,
  language: z.string().default('typescript'),
  includeComments: z.boolean().default(true),
  includeImports: z.boolean().default(true),
  testName: z.string().optional(),
  suiteName: z.string().optional(),
});
export type FormatterOptions = z.infer<typeof FormatterOptionsSchema>;
