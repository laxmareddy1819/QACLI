import { z } from 'zod';
import { ElementSelectorSchema } from './adapter.js';

// ── Element Fingerprint ───────────────────────────────────────────────────────

export const ElementFingerprintSchema = z.object({
  tagName: z.string(),
  id: z.string().optional(),
  testId: z.string().optional(),
  className: z.string().optional(),
  ariaLabel: z.string().optional(),
  ariaRole: z.string().optional(),
  name: z.string().optional(),
  placeholder: z.string().optional(),
  textContent: z.string().optional(),
  href: z.string().optional(),
  type: z.string().optional(),
  attributes: z.record(z.string()).optional(),
  boundingBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  computedStyles: z.record(z.string()).optional(),
  parentTag: z.string().optional(),
  siblingIndex: z.number().optional(),
  childCount: z.number().optional(),
});
export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;

// ── Healing ───────────────────────────────────────────────────────────────────

export const HealingStrategySchema = z.enum([
  'fingerprint',
  'similarSelector',
  'textMatch',
  'positionMatch',
  'ancestorSearch',
  'aiHealing',
  'visionHealing',
]);
export type HealingStrategy = z.infer<typeof HealingStrategySchema>;

export const HealingAttemptSchema = z.object({
  strategy: HealingStrategySchema,
  originalSelector: ElementSelectorSchema,
  healedSelector: ElementSelectorSchema.optional(),
  confidence: z.number().min(0).max(1),
  success: z.boolean(),
  duration: z.number(),
});
export type HealingAttempt = z.infer<typeof HealingAttemptSchema>;

export const HealingResultSchema = z.object({
  healed: z.boolean(),
  originalSelector: ElementSelectorSchema,
  healedSelector: ElementSelectorSchema.optional(),
  confidence: z.number().min(0).max(1),
  strategy: HealingStrategySchema.optional(),
  attempts: z.array(HealingAttemptSchema),
  duration: z.number(),
});
export type HealingResult = z.infer<typeof HealingResultSchema>;

export const StoredFingerprintSchema = z.object({
  id: z.string(),
  selectorKey: z.string(),
  url: z.string(),
  fingerprint: ElementFingerprintSchema,
  successCount: z.number().default(0),
  failureCount: z.number().default(0),
  // Test context — helps identify which scenario/step uses this selector
  scenarioName: z.string().optional(),
  stepName: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type StoredFingerprint = z.infer<typeof StoredFingerprintSchema>;

export const HealingOptionsSchema = z.object({
  enabled: z.boolean().default(true),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  strategies: z.array(HealingStrategySchema).optional(),
  maxAttempts: z.number().default(5),
  updateFingerprints: z.boolean().default(true),
  dbPath: z.string().optional(),
});
export type HealingOptions = z.infer<typeof HealingOptionsSchema>;

// ── Universal Healing — Cross-Framework Events ─────────────────────────────

export const HealingEventSchema = z.object({
  id: z.string(),
  selectorKey: z.string(),
  url: z.string(),
  framework: z.string(),
  language: z.string().optional(),
  strategyUsed: HealingStrategySchema.optional(),
  originalSelector: z.string(),
  healedSelector: z.string().optional(),
  confidence: z.number().min(0).max(1),
  success: z.boolean(),
  durationMs: z.number(),
  aiUsed: z.boolean().default(false),
  domSnapshotSize: z.number().optional(),
  // Test context — helps identify which test/step triggered the healing
  scenarioName: z.string().optional(),
  stepName: z.string().optional(),
  actionType: z.string().optional(),
  createdAt: z.number(),
});
export type HealingEvent = z.infer<typeof HealingEventSchema>;

// ── Universal Healing — Injection Tracking ─────────────────────────────────

export const HealingInjectionStatusSchema = z.enum(['active', 'disabled', 'removed']);
export type HealingInjectionStatus = z.infer<typeof HealingInjectionStatusSchema>;

export const HealingInjectionSchema = z.object({
  id: z.string(),
  projectPath: z.string(),
  framework: z.string(),
  language: z.string(),
  filesCreated: z.array(z.string()),
  healingServerUrl: z.string(),
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  aiEnabled: z.boolean().default(true),
  injectedAt: z.number(),
  lastActivityAt: z.number().optional(),
  status: HealingInjectionStatusSchema.default('active'),
});
export type HealingInjection = z.infer<typeof HealingInjectionSchema>;

// ── Universal Healing — Analytics ──────────────────────────────────────────

export const HealingAnalyticsSchema = z.object({
  totalEvents: z.number(),
  totalHealed: z.number(),
  totalFailed: z.number(),
  overallSuccessRate: z.number(),
  averageConfidence: z.number(),
  averageDurationMs: z.number(),
  aiHealingRate: z.number(),
  strategyBreakdown: z.array(
    z.object({
      strategy: z.string(),
      count: z.number(),
      successRate: z.number(),
    }),
  ),
  frameworkBreakdown: z.array(
    z.object({
      framework: z.string(),
      count: z.number(),
      successRate: z.number(),
    }),
  ),
  timeline: z.array(
    z.object({
      date: z.string(),
      total: z.number(),
      healed: z.number(),
      failed: z.number(),
    }),
  ),
  topFailures: z.array(
    z.object({
      selectorKey: z.string(),
      url: z.string(),
      failureCount: z.number(),
      lastSeen: z.number(),
    }),
  ),
});
export type HealingAnalytics = z.infer<typeof HealingAnalyticsSchema>;

// ── Universal Healing — Resolve Request/Response ───────────────────────────

export const HealingTestContextSchema = z.object({
  testName: z.string().optional(),
  stepName: z.string().optional(),
  scenarioName: z.string().optional(),
  testFilePath: z.string().optional(),
  actionType: z.string().optional(),
});
export type HealingTestContext = z.infer<typeof HealingTestContextSchema>;

export const HealResolveRequestSchema = z.object({
  selector: z.string(),
  selectorStrategy: z.string().default('css'),
  fingerprint: ElementFingerprintSchema.optional(),
  domSnapshot: z.string().optional(),
  pageUrl: z.string(),
  framework: z.string(),
  language: z.string().optional(),
  errorMessage: z.string().optional(),
  requestAI: z.boolean().optional(),
  testContext: HealingTestContextSchema.optional(),
});
export type HealResolveRequest = z.infer<typeof HealResolveRequestSchema>;

export const HealResolveResponseSchema = z.object({
  healed: z.boolean(),
  selector: z.string().optional(),
  selectorStrategy: z.string().optional(),
  confidence: z.number(),
  strategy: HealingStrategySchema.optional(),
  durationMs: z.number(),
  aiUsed: z.boolean().default(false),
  candidates: z.array(z.object({ selector: z.string(), strategy: z.string() })).optional(),
});
export type HealResolveResponse = z.infer<typeof HealResolveResponseSchema>;
