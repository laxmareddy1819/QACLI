import { z } from 'zod';

// ── Framework Detection ───────────────────────────────────────────────────────

export const FrameworkNameSchema = z.enum([
  'playwright',
  'cypress',
  'selenium',
  'puppeteer',
  'appium',
  'webdriverio',
  'jest',
  'mocha',
  'vitest',
  'pytest',
  'junit',
  'testng',
  'nunit',
  'xunit',
  'robot',
  'cucumber',
  'unknown',
]);
export type FrameworkName = z.infer<typeof FrameworkNameSchema>;

export const ProgrammingLanguageSchema = z.enum([
  'typescript',
  'javascript',
  'python',
  'java',
  'csharp',
  'ruby',
  'go',
  'kotlin',
  'unknown',
]);
export type ProgrammingLanguage = z.infer<typeof ProgrammingLanguageSchema>;

export const DetectedFrameworkSchema = z.object({
  framework: FrameworkNameSchema,
  language: ProgrammingLanguageSchema,
  confidence: z.number().min(0).max(1),
  configFile: z.string().optional(),
  version: z.string().optional(),
  testDirectory: z.string().optional(),
  testFilePattern: z.string().optional(),
});
export type DetectedFramework = z.infer<typeof DetectedFrameworkSchema>;

// ── Scaffold ──────────────────────────────────────────────────────────────────

export const ScaffoldOptionsSchema = z.object({
  framework: FrameworkNameSchema,
  language: ProgrammingLanguageSchema.default('typescript'),
  projectPath: z.string(),
  features: z
    .array(z.enum(['page-objects', 'fixtures', 'api-testing', 'visual-testing', 'ci-config']))
    .optional(),
  packageManager: z.enum(['npm', 'pnpm', 'yarn']).default('pnpm'),
});
export type ScaffoldOptions = z.infer<typeof ScaffoldOptionsSchema>;

export const ScaffoldResultSchema = z.object({
  success: z.boolean(),
  filesCreated: z.array(z.string()),
  instructions: z.string(),
  error: z.string().optional(),
});
export type ScaffoldResult = z.infer<typeof ScaffoldResultSchema>;

// ── Test Execution ────────────────────────────────────────────────────────────

export const TestStatusSchema = z.enum(['passed', 'failed', 'skipped', 'error']);
export type TestStatus = z.infer<typeof TestStatusSchema>;

export const TestResultSchema = z.object({
  name: z.string(),
  status: TestStatusSchema,
  duration: z.number(),
  error: z.string().optional(),
  file: z.string().optional(),
  healingAttempts: z.number().default(0),
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const ExecutionReportSchema = z.object({
  framework: FrameworkNameSchema,
  totalTests: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  duration: z.number(),
  results: z.array(TestResultSchema),
  healingAttempts: z.number().default(0),
});
export type ExecutionReport = z.infer<typeof ExecutionReportSchema>;
