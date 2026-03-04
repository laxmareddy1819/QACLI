import { z } from 'zod';
import { ProviderNameSchema } from './llm.js';
import { BrowserTypeSchema } from './adapter.js';
import { OutputFormatSchema } from './recording.js';

// ── Configuration Schema ──────────────────────────────────────────────────────

export const QabotConfigSchema = z.object({
  llm: z.object({
    defaultProvider: ProviderNameSchema.default('openai'),
    defaultModel: z.string().optional(),
    maxToolIterations: z.number().min(1).max(100).default(30),
    providers: z
      .record(
        z.object({
          apiKey: z.string().optional(),
          baseUrl: z.string().optional(),
          model: z.string().optional(),
          timeout: z.number().optional(),
          maxRetries: z.number().optional(),
          temperature: z.number().min(0).max(2).optional(),
          maxTokens: z.number().optional(),
        }),
      )
      .default({}),
    fallback: z.array(ProviderNameSchema).optional(),
  }),
  automation: z.object({
    defaultAdapter: z.string().default('playwright'),
    browser: BrowserTypeSchema.default('chromium'),
    headless: z.boolean().default(false),
    timeout: z.number().default(30000),
    slowMo: z.number().optional(),
  }),
  recording: z.object({
    outputFormat: OutputFormatSchema.default('playwright'),
    outputLanguage: z.string().default('typescript'),
    includeComments: z.boolean().default(true),
  }),
  healing: z.object({
    enabled: z.boolean().default(true),
    confidenceThreshold: z.number().min(0).max(1).default(0.7),
    dbPath: z.string().optional(),
    aiEnabled: z.boolean().default(true),
    retentionDays: z.number().min(7).max(365).default(90),
  }),
  ui: z.object({
    theme: z.enum(['default', 'minimal']).default('default'),
    showTokenUsage: z.boolean().default(true),
    streamingEnabled: z.boolean().default(true),
  }),
});

export type QabotConfig = z.infer<typeof QabotConfigSchema>;
