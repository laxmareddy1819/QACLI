// Shared frontend types — matches backend ProjectInfo / FileNode / etc.

export interface ProjectModule {
  id: string;
  label: string;
  icon: string;
  path: string;
  type: string;
  count: number;
  language: string;
  lastModified: string;
}

export interface FileMetadata {
  path: string;
  name: string;
  type: string;
  language: string;
  lines: number;
  size: number;
  lastModified: string;
  metadata?: {
    classes?: string[];
    methods?: string[];
    steps?: string[];
    endpoints?: Array<{ method: string; url: string }>;
    keywords?: string[];
    imports?: string[];
    testCount?: number;
  };
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  fileType?: string;
  language?: string;
  size?: number;
}

export interface ProjectInfo {
  name: string;
  framework: string | null;
  language: string;
  rootPath: string;
  modules: ProjectModule[];
  stats: {
    totalFiles: number;
    totalLines: number;
    totalModules: number;
  };
}

export interface RunResult {
  runId: string;
  command: string;
  startTime: string;
  endTime?: string;
  exitCode?: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  duration?: number;
}

export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

// ── Test Explorer ─────────────────────────────────────────────────────────────

export type TestFramework =
  | 'playwright' | 'jest' | 'cypress' | 'mocha' | 'vitest'
  | 'cucumber' | 'pytest' | 'junit' | 'testng'
  | 'nunit' | 'xunit' | 'mstest'
  | 'rspec' | 'robot' | 'unknown';

export interface ExplorerStep {
  keyword: string;
  name: string;
}

export interface ExplorerTestCase {
  name: string;
  framework: TestFramework;
  line?: number;
  endLine?: number;
  steps: ExplorerStep[];
  lastStatus?: string;
  runCount: number;
  passCount: number;
  failCount: number;
  lastRun?: string;
  runCommand?: string;
}

export interface ExplorerTestSuite {
  name: string;
  file: string;
  framework: TestFramework;
  testCount: number;
  tests: ExplorerTestCase[];
}

export interface ExplorerData {
  suites: ExplorerTestSuite[];
  totalSuites: number;
  totalTests: number;
}

export interface HumanStep {
  keyword: string;   // 'Action' | 'Assert' | 'Comment' | 'Setup'
  name: string;
  line: number;
}

export interface TestSourceResponse {
  file: string;
  startLine: number;
  endLine: number;
  language: string;
  source: string;
  humanSteps: HumanStep[];
}

export interface StepDefinitionMatch {
  file: string;
  line: number;
  endLine: number;
  pattern: string;
  keyword: string;
  method?: string;
  source: string;
  language: string;
}

export interface StepDefinitionBatchResponse {
  matches: Record<string, StepDefinitionMatch>;
  totalResolved: number;
  totalSteps: number;
}

/** @deprecated Use ExplorerTestCase */
export type ExplorerScenario = ExplorerTestCase;
/** @deprecated Use ExplorerTestSuite */
export type ExplorerFeature = ExplorerTestSuite;

// ── API Testing ─────────────────────────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
  description?: string;
}

export interface RequestAuth {
  type: 'none' | 'bearer' | 'basic' | 'api-key';
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyIn?: 'header' | 'query';
}

export interface RequestBody {
  type: 'none' | 'json' | 'text' | 'form-data' | 'graphql';
  raw?: string;
  formData?: KeyValuePair[];
  graphqlVariables?: string;
}

export interface ValidationRule {
  id: string;
  type: 'status' | 'header' | 'body-contains' | 'body-json-path' | 'response-time' | 'schema';
  target?: string;
  operator: 'equals' | 'not-equals' | 'contains' | 'not-contains' | 'greater-than' | 'less-than' | 'exists' | 'matches-regex';
  expected: string;
  enabled: boolean;
}

export interface ValidationResult {
  ruleId: string;
  passed: boolean;
  actual?: string;
  message?: string;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValuePair[];
  queryParams: KeyValuePair[];
  body: RequestBody;
  auth: RequestAuth;
  validations: ValidationRule[];
  preRequestScript?: string;
  postResponseScript?: string;
  timeout?: number;
  followRedirects: boolean;
  sortOrder: number;
}

export interface ApiResponse {
  requestId: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  duration: number;
  size: number;
  timestamp: string;
  validationResults?: ValidationResult[];
}

export interface EnvironmentVariable {
  key: string;
  value: string;
  enabled: boolean;
  secret: boolean;
}

export interface ApiEnvironment {
  id: string;
  name: string;
  variables: EnvironmentVariable[];
}

export interface ApiFolder {
  id: string;
  name: string;
  requests: ApiRequest[];
  sortOrder: number;
}

export interface ApiCollection {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  defaultHeaders: KeyValuePair[];
  defaultAuth?: RequestAuth;
  folders: ApiFolder[];
  requests: ApiRequest[];
  environments: ApiEnvironment[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiCollectionSummary {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  requestCount: number;
  folderCount: number;
  environmentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiHistoryEntry {
  id: string;
  request: ApiRequest;
  response: ApiResponse;
  collectionId?: string;
  timestamp: string;
}

// ── CI/CD ────────────────────────────────────────────────────────────────────

export type CICDPlatform = 'github-actions' | 'gitlab-ci' | 'jenkins' | 'azure-pipelines' | 'bitbucket' | 'circleci';

export interface CICDPlatformInfo {
  id: CICDPlatform;
  name: string;
  icon: string;
  description: string;
  configFile: string;
  configPath: string;
}

export interface CICDDetectedConfig {
  platform: CICDPlatform;
  fileName: string;
  filePath: string;
  exists: boolean;
}

export interface CICDDetectResponse {
  configs: CICDDetectedConfig[];
  projectFramework: string | null;
  hasCI: boolean;
}

export interface CICDOptions {
  nodeVersion?: string;
  pythonVersion?: string;
  javaVersion?: string;
  dotnetVersion?: string;
  triggers?: Array<'push' | 'pull_request' | 'schedule' | 'manual'>;
  branches?: string[];
  cronSchedule?: string;
  parallel?: boolean;
  shardCount?: number;
  timeout?: number;
  headless?: boolean;
  useDocker?: boolean;
  uploadArtifacts?: boolean;
  artifactRetention?: number;
  envVars?: Record<string, string>;
}

export interface CICDGenerateResult {
  content: string;
  fileName: string;
  filePath: string;
  platform: CICDPlatform;
  framework: string | null;
}
