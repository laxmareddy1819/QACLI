import { z } from 'zod';

// ── API Testing Types (re-export) ───────────────────────────────────────────
export * from './types/api-testing.js';

// ── Module Types ─────────────────────────────────────────────────────────────

export const ModuleTypeSchema = z.enum([
  'tests', 'bdd', 'steps', 'pages', 'api', 'data',
  'fixtures', 'helpers', 'config', 'reports', 'keywords', 'env', 'custom',
]);
export type ModuleType = z.infer<typeof ModuleTypeSchema>;

export const ProjectModuleSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string(),
  path: z.string(),
  type: ModuleTypeSchema,
  count: z.number(),
  language: z.string(),
  lastModified: z.string(),
});
export type ProjectModule = z.infer<typeof ProjectModuleSchema>;

// ── File Types ───────────────────────────────────────────────────────────────

export const FileTypeSchema = z.enum([
  'test', 'page', 'step', 'api', 'data', 'fixture',
  'config', 'report', 'keyword', 'env', 'source',
]);
export type FileType = z.infer<typeof FileTypeSchema>;

export const FileMetadataSchema = z.object({
  path: z.string(),
  name: z.string(),
  type: FileTypeSchema,
  language: z.string(),
  lines: z.number(),
  size: z.number(),
  lastModified: z.string(),
  metadata: z.object({
    classes: z.array(z.string()).optional(),
    methods: z.array(z.string()).optional(),
    steps: z.array(z.string()).optional(),
    endpoints: z.array(z.object({
      method: z.string(),
      url: z.string(),
    })).optional(),
    keywords: z.array(z.string()).optional(),
    imports: z.array(z.string()).optional(),
    testCount: z.number().optional(),
  }).optional(),
});
export type FileMetadata = z.infer<typeof FileMetadataSchema>;

// ── File Tree ────────────────────────────────────────────────────────────────

export const FileNodeSchema: z.ZodType<FileNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'directory']),
    children: z.array(FileNodeSchema).optional(),
    fileType: FileTypeSchema.optional(),
    language: z.string().optional(),
    size: z.number().optional(),
  }),
);
export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  fileType?: FileType;
  language?: string;
  size?: number;
}

// ── Project Info ─────────────────────────────────────────────────────────────

export const ProjectInfoSchema = z.object({
  name: z.string(),
  framework: z.string().nullable(),
  language: z.string(),
  rootPath: z.string(),
  modules: z.array(ProjectModuleSchema),
  stats: z.object({
    totalFiles: z.number(),
    totalLines: z.number(),
    totalModules: z.number(),
  }),
});
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;

// ── Test Runner ──────────────────────────────────────────────────────────────

export const RunRequestSchema = z.object({
  files: z.string().optional(),
  framework: z.string().optional(),
  args: z.string().optional(),
  env: z.record(z.string()).optional(),
  headless: z.boolean().optional(),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const RunStatusSchema = z.enum(['running', 'completed', 'failed', 'cancelled']);

export const RunResultSchema = z.object({
  runId: z.string(),
  command: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  exitCode: z.number().optional(),
  status: RunStatusSchema,
  duration: z.number().optional(),
});
export type RunResult = z.infer<typeof RunResultSchema>;

// ── WebSocket Messages ───────────────────────────────────────────────────────

export type WSServerMessage =
  | { type: 'output'; runId: string; data: string; stream: 'stdout' | 'stderr' }
  | { type: 'complete'; runId: string; exitCode: number; duration: number }
  | { type: 'file-change'; event: 'add' | 'change' | 'unlink'; path: string }
  | { type: 'modules-updated'; modules: ProjectModule[] }
  | { type: 'ai-stream'; content: string }
  | { type: 'ai-done' }
  | { type: 'error'; message: string }
  | { type: 'test-progress'; runId: string; current: number; total: number; testName: string; status: 'running' | 'passed' | 'failed' }
  | { type: 'test-passed'; runId: string; testName: string; duration: number }
  | { type: 'test-failed'; runId: string; testName: string; duration: number; error: string }
  | { type: 'test-results'; runId: string; summary: { total: number; passed: number; failed: number; skipped: number; passRate: number; duration: number } }
  | { type: 'failure-analysis'; runId: string; groups: FailureGroup[] }
  | { type: 'cloud-artifacts'; runId: string; artifacts: CloudArtifacts }
  | { type: 'schedule-triggered'; scheduleId: string; runId: string }
  | { type: 'run-started'; runId: string; command: string; startTime: string; framework: string | null; cloudProvider?: string; source: 'manual' | 'scheduler' | 'cli' };

export type WSClientMessage =
  | { type: 'subscribe-run'; runId: string }
  | { type: 'ai-chat'; message: string; context?: string }
  | { type: 'cancel-run'; runId: string };

// ── AI Request Types ─────────────────────────────────────────────────────────

export const AIGenerateRequestSchema = z.object({
  type: z.enum(['test', 'page', 'step', 'api', 'data']),
  description: z.string(),
  targetPath: z.string().optional(),
});
export type AIGenerateRequest = z.infer<typeof AIGenerateRequestSchema>;

export const AIFixRequestSchema = z.object({
  testPath: z.string(),
  errorOutput: z.string(),
});
export type AIFixRequest = z.infer<typeof AIFixRequestSchema>;

export const AIExplainRequestSchema = z.object({
  filePath: z.string(),
});
export type AIExplainRequest = z.infer<typeof AIExplainRequestSchema>;

export const AIChatRequestSchema = z.object({
  message: z.string(),
  context: z.string().optional(),
});
export type AIChatRequest = z.infer<typeof AIChatRequestSchema>;

// ── Stored Test Results ──────────────────────────────────────────────────────

export const TestStepSchema = z.object({
  keyword: z.string(),
  name: z.string(),
  status: z.enum(['passed', 'failed', 'skipped', 'pending', 'undefined']),
  duration: z.number().optional(),
  errorMessage: z.string().optional(),
});
export type TestStep = z.infer<typeof TestStepSchema>;

export const StoredTestCaseSchema = z.object({
  name: z.string(),
  suite: z.string().optional(),
  file: z.string().optional(),
  status: z.enum(['passed', 'failed', 'skipped', 'error']),
  duration: z.number().optional(),
  errorMessage: z.string().optional(),
  stackTrace: z.string().optional(),
  screenshotPath: z.string().optional(),
  videoPath: z.string().optional(),
  tracePath: z.string().optional(),
  retryCount: z.number().optional(),
  browser: z.string().optional(),
  steps: z.array(TestStepSchema).optional(),
});
export type StoredTestCase = z.infer<typeof StoredTestCaseSchema>;

export const FailureGroupSchema = z.object({
  errorSignature: z.string(),
  category: z.enum(['bug', 'environment', 'flaky', 'test-issue', 'timeout', 'unknown']),
  affectedTests: z.array(z.string()),
  rootCause: z.string(),
  suggestedFix: z.string(),
  count: z.number(),
});
export type FailureGroup = z.infer<typeof FailureGroupSchema>;

// ── Cloud Artifacts ──────────────────────────────────────────────────────────

export const CloudSessionSchema = z.object({
  sessionId: z.string(),
  sessionUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  logsUrl: z.string().optional(),
  screenshots: z.array(z.string()).optional(),
  browser: z.string().optional(),
  os: z.string().optional(),
  osVersion: z.string().optional(),
  status: z.string().optional(),
  duration: z.number().optional(),
});
export type CloudSession = z.infer<typeof CloudSessionSchema>;

export const CloudArtifactsSchema = z.object({
  provider: z.enum(['browserstack', 'lambdatest', 'saucelabs']),
  buildId: z.string(),
  buildUrl: z.string().optional(),
  sessions: z.array(CloudSessionSchema).optional(),
});
export type CloudArtifacts = z.infer<typeof CloudArtifactsSchema>;

// ── Git Integration ──────────────────────────────────────────────────────────

export const GitBlameEntrySchema = z.object({
  line: z.number(),
  author: z.string(),
  email: z.string(),
  commitSha: z.string(),
  commitMessage: z.string(),
  timestamp: z.string(),
});
export type GitBlameEntry = z.infer<typeof GitBlameEntrySchema>;

export const GitBlameResultSchema = z.object({
  filePath: z.string(),
  entries: z.array(GitBlameEntrySchema),
  lastModifiedBy: z.string(),
  lastModifiedAt: z.string(),
  lastCommitSha: z.string(),
  lastCommitMessage: z.string(),
});
export type GitBlameResult = z.infer<typeof GitBlameResultSchema>;

export const GitCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  author: z.string(),
  email: z.string(),
  message: z.string(),
  timestamp: z.string(),
  filesChanged: z.array(z.string()).optional(),
});
export type GitCommit = z.infer<typeof GitCommitSchema>;

export const GitStatusSchema = z.object({
  available: z.boolean(),
  branch: z.string().optional(),
  isClean: z.boolean().optional(),
  lastCommit: GitCommitSchema.optional(),
  uncommittedChanges: z.array(z.object({
    path: z.string(),
    status: z.enum(['modified', 'added', 'deleted', 'untracked', 'renamed']),
  })).optional(),
  ahead: z.number().optional(),
  behind: z.number().optional(),
});
export type GitStatus = z.infer<typeof GitStatusSchema>;

export const CommitCorrelationSchema = z.object({
  commit: GitCommitSchema,
  newFailures: z.array(z.string()),
  fixedTests: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string(),
});
export type CommitCorrelation = z.infer<typeof CommitCorrelationSchema>;

export const FailureOwnershipSchema = z.object({
  testName: z.string(),
  suggestedOwner: z.object({
    name: z.string(),
    email: z.string(),
    reason: z.string(),
    confidence: z.enum(['high', 'medium', 'low']),
  }),
  alternativeOwners: z.array(z.object({
    name: z.string(),
    email: z.string(),
    reason: z.string(),
  })),
});
export type FailureOwnership = z.infer<typeof FailureOwnershipSchema>;

export const StoredRunSchema = z.object({
  runId: z.string(),
  framework: z.string().nullable(),
  command: z.string(),
  projectPath: z.string(),
  startTime: z.string(),
  endTime: z.string().optional(),
  exitCode: z.number().optional(),
  status: RunStatusSchema,
  duration: z.number().optional(),
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
    passRate: z.number(),
  }),
  tests: z.array(StoredTestCaseSchema),
  failureAnalysis: z.array(FailureGroupSchema).optional(),
  // Cloud grid fields
  source: z.enum(['local', 'cloud']).optional(),
  cloudProvider: z.enum(['browserstack', 'lambdatest', 'saucelabs']).optional(),
  cloudBuildName: z.string().optional(),
  cloudArtifacts: CloudArtifactsSchema.optional(),
  // Git metadata
  gitCommitSha: z.string().optional(),
  gitBranch: z.string().optional(),
  gitAuthor: z.string().optional(),
  gitCommitMessage: z.string().optional(),
});
export type StoredRun = z.infer<typeof StoredRunSchema>;

export const TestHistoryEntrySchema = z.object({
  runId: z.string(),
  status: z.string(),
  duration: z.number().optional(),
  timestamp: z.string(),
  browser: z.string().optional(),
});
export type TestHistoryEntry = z.infer<typeof TestHistoryEntrySchema>;

export const TrendDataPointSchema = z.object({
  runId: z.string(),
  timestamp: z.string(),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  skipped: z.number(),
  passRate: z.number(),
  duration: z.number(),
});
export type TrendDataPoint = z.infer<typeof TrendDataPointSchema>;

export const FlakySummarySchema = z.object({
  testName: z.string(),
  totalRuns: z.number(),
  passCount: z.number(),
  failCount: z.number(),
  flakinessRate: z.number(),
  lastSeen: z.string(),
  recentStatuses: z.array(z.string()),
});
export type FlakySummary = z.infer<typeof FlakySummarySchema>;

// ── Module Icon Mapping ──────────────────────────────────────────────────────

export const MODULE_ICONS: Record<ModuleType, string> = {
  tests: 'flask',
  bdd: 'book',
  steps: 'footprints',
  pages: 'layout-list',
  api: 'globe',
  data: 'database',
  fixtures: 'file-box',
  helpers: 'wrench',
  config: 'folder-cog',
  reports: 'file-text',
  keywords: 'tag',
  env: 'file-key',
  custom: 'folder-open',
};
