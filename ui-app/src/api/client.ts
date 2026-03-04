const BASE = '';

// ── Auth Token Helpers ─────────────────────────────────────────────────────

const TOKEN_KEY = 'qabot_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Core Request Function ──────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    const err = await res.json().catch(() => ({ error: 'Session expired' }));
    clearStoredToken();
    // Redirect to login if not already there
    if (window.location.pathname !== '/login' && window.location.pathname !== '/setup') {
      window.location.href = '/login';
    }
    throw new Error(err.error || 'Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }

  const data = await res.json();

  // Check for setup-required response from auth middleware
  if (data && typeof data === 'object' && 'setupRequired' in data && data.setupRequired === true) {
    if (window.location.pathname !== '/setup' && window.location.pathname !== '/login') {
      window.location.href = '/setup';
    }
    throw new Error('Setup required');
  }

  return data as T;
}

// Project
export const getProject = () => request<import('./types').ProjectInfo>('/api/project');
export const rescanProject = () => request<import('./types').ProjectInfo>('/api/project/rescan');
export const getFileTree = () => request<import('./types').FileNode>('/api/project/tree');
export const getModuleFiles = (id: string) =>
  request<{ module: import('./types').ProjectModule; files: import('./types').FileMetadata[] }>(
    `/api/project/modules/${id}/files`,
  );

// Files
export const readFile = (path: string) =>
  request<{ path: string; content: string; metadata: import('./types').FileMetadata }>(
    `/api/files/${encodeURIComponent(path)}`,
  );
export const createFile = (path: string, content: string) =>
  request<{ path: string; created: boolean }>('/api/files', {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  });
export const updateFile = (path: string, content: string) =>
  request<{ path: string; updated: boolean }>(`/api/files/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
export const deleteFile = (path: string) =>
  request<{ path: string; deleted: boolean }>(`/api/files/${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
export const searchFiles = (query: string, filePattern?: string) =>
  request<{ results: Array<{ file: string; line: number; content: string }> }>(
    '/api/files/search',
    { method: 'POST', body: JSON.stringify({ query, file_pattern: filePattern }) },
  );

// Runner
export const startRun = (options: {
  command?: string;
  files?: string[];
  framework?: string;
  args?: string[];
  env?: Record<string, string>;
  headless?: boolean;
  cloudProvider?: string;
  buildName?: string;
}) => request<{ runId: string; command: string; status: string }>('/api/runner/run', {
  method: 'POST',
  body: JSON.stringify(options),
});
export const getRunStatus = (id: string) =>
  request<import('./types').RunResult>(`/api/runner/status/${id}`);
export const cancelRun = (id: string) =>
  request<{ runId: string; status: string }>(`/api/runner/cancel/${id}`, { method: 'POST' });
export const getRunHistory = () =>
  request<{ history: import('./types').RunResult[]; count: number }>('/api/runner/history');

// Active runs (global tracking)
export interface ActiveRunInfo {
  runId: string;
  command: string;
  startTime: string;
  status: string;
  framework: string | null;
  cloudProvider?: string;
  source: 'manual' | 'scheduler' | 'cli';
}
export const getActiveRuns = () =>
  request<{ runs: ActiveRunInfo[] }>('/api/runner/active');

// Config
export const getConfigFiles = () =>
  request<{ configs: Array<{ name: string; path: string; framework: string }> }>('/api/config/files');
export const getEnvFiles = () =>
  request<{ environments: Array<{ name: string; path: string }> }>('/api/env');
export const compareEnvs = (file1: string, file2: string) =>
  request<{ comparison: Record<string, { file1?: string; file2?: string; match: boolean }> }>(
    '/api/env/compare',
    { method: 'POST', body: JSON.stringify({ file1, file2 }) },
  );

// Activity Feed
export const getActivity = () => request<{ activities: any[] }>('/api/activity');

// Test Results
export const getResultRuns = (limit = 20, offset = 0) =>
  request<{ runs: any[]; total: number }>(`/api/results/runs?limit=${limit}&offset=${offset}`);
export const getResultRun = (id: string) => request<any>(`/api/results/runs/${id}`);
export const getResultTests = (id: string, status?: string) =>
  request<{ tests: any[]; count: number }>(`/api/results/runs/${id}/tests${status ? `?status=${status}` : ''}`);
export const getResultFailures = (id: string) =>
  request<{ failures: any[]; count: number }>(`/api/results/runs/${id}/failures`);
export const getResultTrends = (count = 20) =>
  request<{ trends: any[] }>(`/api/results/trends?count=${count}`);
export const getFlakyTests = () => request<{ flaky: any[]; count: number }>('/api/results/flaky');
export const getSlowestTests = (count = 20) =>
  request<{ slowest: any[] }>(`/api/results/slowest?count=${count}`);
export const getTopFailures = (count = 20) =>
  request<{ topFailures: any[] }>(`/api/results/top-failures?count=${count}`);
export const analyzeFailures = (runId: string) =>
  request<{ groups: any[]; count: number }>(`/api/results/runs/${runId}/analyze`, { method: 'POST' });
export const getFailureAnalysis = (runId: string) =>
  request<{ groups: any[] }>(`/api/results/runs/${runId}/analysis`);
export const getTestHistory = (name: string) =>
  request<{ testName: string; history: any[]; count: number }>(`/api/results/test/${encodeURIComponent(name)}/history`);

// Healing
export const getHealingStats = () =>
  request<{ total: number; successCount: number; failureCount: number; successRate: number; available: boolean }>('/api/healing/stats');
export const getHealingByUrl = (url: string) =>
  request<{ fingerprints: any[]; count: number }>(`/api/healing/by-url?url=${encodeURIComponent(url)}`);

// Universal Healing API
export const getHealingAnalytics = (days = 30) =>
  request<{
    totalEvents: number; totalHealed: number; totalFailed: number;
    overallSuccessRate: number; averageConfidence: number; averageDurationMs: number;
    aiHealingRate: number;
    strategyBreakdown: Array<{ strategy: string; count: number; successRate: number }>;
    frameworkBreakdown: Array<{ framework: string; count: number; successRate: number }>;
    timeline: Array<{ date: string; total: number; healed: number; failed: number }>;
    topFailures: Array<{ selectorKey: string; url: string; failureCount: number; lastSeen: number }>;
  }>(`/api/heal/analytics?days=${days}`);

export const getHealingEvents = (filters?: {
  framework?: string; days?: number; success?: boolean; limit?: number;
}) => {
  const params = new URLSearchParams();
  if (filters?.framework) params.set('framework', filters.framework);
  if (filters?.days) params.set('days', String(filters.days));
  if (filters?.success !== undefined) params.set('success', String(filters.success));
  if (filters?.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return request<{ events: Array<{
    id: string; selectorKey: string; url: string; framework: string; language?: string;
    strategyUsed?: string; originalSelector: string; healedSelector?: string;
    confidence: number; success: boolean; durationMs: number; aiUsed: boolean;
    createdAt: number;
  }>; total: number }>(`/api/heal/events${qs ? `?${qs}` : ''}`);
};

export const getHealingInjections = (status?: string) =>
  request<{ injections: Array<{
    id: string; projectPath: string; framework: string; language: string;
    filesCreated: string[]; healingServerUrl: string; confidenceThreshold: number;
    aiEnabled: boolean; injectedAt: number; lastActivityAt?: number;
    status: 'active' | 'disabled' | 'removed';
  }>; total: number }>(`/api/heal/injections${status ? `?status=${status}` : ''}`);

export const getHealingAdapters = () =>
  request<{ adapters: Array<{ framework: string; language: string; displayName: string }> }>('/api/heal/adapters');

export const removeHealingInjection = (id: string) =>
  request<{ removed: boolean }>(`/api/heal/injections/${id}`, { method: 'DELETE' });

// Healing Config
export const getHealingConfig = () =>
  request<{ enabled: boolean; confidenceThreshold: number; aiEnabled: boolean; retentionDays: number }>(
    '/api/healing/config',
  );

export const saveHealingConfig = (config: {
  enabled?: boolean;
  confidenceThreshold?: number;
  aiEnabled?: boolean;
  retentionDays?: number;
}) =>
  request<{ saved: boolean; config: { enabled: boolean; confidenceThreshold: number; aiEnabled: boolean; retentionDays: number } }>(
    '/api/healing/config',
    { method: 'PUT', body: JSON.stringify(config) },
  );

// ── LLM Config ──────────────────────────────────────────────────────────────

export type LLMProviderId = 'openai' | 'anthropic' | 'google' | 'xai' | 'ollama' | 'lmstudio';

export interface LLMProviderConfig {
  model: string;
  baseUrl: string | null;
  timeout: number | null;
  hasApiKey: boolean;
  apiKeySource: 'env' | 'config' | 'none';
  isLocal: boolean;
  defaultModel: string | null;
  defaultBaseUrl: string | null;
  envVarName: string | null;
}

export interface LLMConfigResponse {
  defaultProvider: string;
  defaultModel: string | null;
  maxToolIterations: number;
  providers: Record<LLMProviderId, LLMProviderConfig>;
}

export const getLLMConfig = () =>
  request<LLMConfigResponse>('/api/llm/config');

export const saveLLMConfig = (data: {
  defaultProvider?: string;
  defaultModel?: string | null;
  maxToolIterations?: number;
  providers?: Record<string, {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    timeout?: number | null;
  }>;
}) =>
  request<{ saved: boolean }>('/api/llm/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const testLLMConnection = (data: {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}) =>
  request<{ connected: boolean; message: string; model?: string; latencyMs?: number }>(
    '/api/llm/test-connection',
    { method: 'POST', body: JSON.stringify(data) },
  );

// Healing Fingerprints
export const getHealingFingerprints = (params?: { search?: string; url?: string; offset?: number; limit?: number }) => {
  const searchParams = new URLSearchParams();
  if (params?.search) searchParams.set('search', params.search);
  if (params?.url) searchParams.set('url', params.url);
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset));
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();
  return request<{
    fingerprints: Array<{
      id: string; selectorKey: string; url: string; successCount?: number; failureCount?: number;
      updatedAt?: number; originalSelector?: string;
    }>;
    total: number;
  }>(`/api/healing/fingerprints${qs ? `?${qs}` : ''}`);
};

export const deleteHealingFingerprint = (id: string) =>
  request<{ deleted: boolean }>(`/api/healing/fingerprints/${id}`, { method: 'DELETE' });

// AI
export const aiGenerate = (data: { type: string; description: string; context?: string }) =>
  request<{ content: string }>('/api/ai/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const aiFix = (data: { testPath: string; errorOutput: string }) =>
  request<{ content: string }>('/api/ai/fix', { method: 'POST', body: JSON.stringify(data) });
export const aiExplain = (data: { filePath: string }) =>
  request<{ content: string }>('/api/ai/explain', { method: 'POST', body: JSON.stringify(data) });
export const aiChat = (data: { message: string; context?: string }) =>
  request<{ content: string }>('/api/ai/chat', { method: 'POST', body: JSON.stringify(data) });
export const aiChatStream = (data: {
  requestId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  fileContext?: Array<{ path: string; snippet?: string }>;
  uploadedFileIds?: string[];
}) =>
  request<{ status: string; requestId: string }>('/api/ai/chat-stream', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const aiChatReset = () =>
  request<{ status: string }>('/api/ai/chat-reset', { method: 'POST' });
export const aiFixFailure = (data: {
  requestId: string;
  errorSignature: string;
  category: string;
  rootCause: string;
  suggestedFix: string;
  affectedTests: string[];
  errorMessage?: string;
}) =>
  request<{ status: string; requestId: string }>('/api/ai/fix-failure', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const aiApplyFix = (data: {
  requestId: string;
  aiFixContent: string;
  affectedTests: string[];
  errorSignature?: string;
  originalCommand?: string;
}) =>
  request<{ status: string; requestId: string }>('/api/ai/apply-fix', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const aiNewTest = (data: {
  requestId: string;
  prompt: string;
  context?: {
    targetUrl?: string;
    frameworkHint?: string;
    moduleHint?: string;
  };
}) =>
  request<{ status: string; requestId: string }>('/api/ai/new-test', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const aiCodeReview = (data: {
  requestId: string;
  filePaths: string[];
  focus?: string[];
  context?: string;
  depth: 'quick' | 'deep';
}) =>
  request<{ status: string; requestId: string }>('/api/ai/code-review', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const aiApplyReviewFixes = (data: {
  requestId: string;
  reviewContent: string;
  selectedIssues: Array<{
    severity: string;
    title: string;
    content: string;
  }>;
}) =>
  request<{ status: string; requestId: string }>('/api/ai/apply-review-fixes', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// File Upload
export const uploadFiles = async (files: File[]): Promise<{
  files: Array<{
    id: string;
    originalName: string;
    type: string;
    mimeType: string;
    size: number;
    isImage: boolean;
    preview: string;
    contentLength: number;
    metadata?: Record<string, unknown>;
  }>;
}> => {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  const uploadHeaders: Record<string, string> = {};
  const token = getStoredToken();
  if (token) uploadHeaders['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api/upload', { method: 'POST', body: formData, headers: uploadHeaders });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
};
export const deleteUploadedFile = (id: string) =>
  request<{ deleted: boolean }>(`/api/upload/${id}`, { method: 'DELETE' });

// Browser
export const aiBrowserChat = (data: {
  requestId: string;
  message: string;
  context?: {
    currentUrl?: string;
    currentTitle?: string;
    tabCount?: number;
  };
}) =>
  request<{ status: string; requestId: string }>('/api/browser/chat', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getBrowserStatus = () =>
  request<{ active: boolean; url?: string; title?: string; tabs?: Array<{ index: number; url: string; title: string; active: boolean }>; error?: string }>(
    '/api/browser/status',
  );

export const getBrowserScreenshot = () =>
  request<{ screenshot: string }>('/api/browser/screenshot', {
    method: 'POST',
  });

export const getBrowserViewport = () =>
  request<{ width: number; height: number; browserType?: string }>('/api/browser/viewport');

// Test Explorer
export const getTestExplorer = () =>
  request<import('./types').ExplorerData>('/api/tests/explore');
export const getTestCaseHistory = (name: string) =>
  request<{ testName: string; history: any[]; count: number }>(
    `/api/tests/scenario/${encodeURIComponent(name)}/history`,
  );
export const getTestSource = (file: string, startLine: number, endLine?: number, framework?: string) =>
  request<import('./types').TestSourceResponse>(
    `/api/tests/source?file=${encodeURIComponent(file)}&startLine=${startLine}${endLine ? `&endLine=${endLine}` : ''}${framework ? `&framework=${encodeURIComponent(framework)}` : ''}`,
  );
export const getTestSourceByName = (file: string, testName: string) =>
  request<import('./types').TestSourceResponse>(
    `/api/tests/source?file=${encodeURIComponent(file)}&testName=${encodeURIComponent(testName)}`,
  );
export const resolveStepDefinition = (step: string, keyword?: string) =>
  request<import('./types').StepDefinitionMatch>(
    `/api/tests/step-definition?step=${encodeURIComponent(step)}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ''}`,
  );
export const resolveStepDefinitions = (steps: Array<{ keyword: string; name: string }>) =>
  request<import('./types').StepDefinitionBatchResponse>(
    '/api/tests/step-definitions',
    { method: 'POST', body: JSON.stringify({ steps }) },
  );
/** @deprecated Use getTestCaseHistory */
export const getScenarioHistory = getTestCaseHistory;

// CI/CD
export const getCICDPlatforms = () =>
  request<{ platforms: import('./types').CICDPlatformInfo[] }>('/api/cicd/platforms');
export const detectCICDConfigs = () =>
  request<import('./types').CICDDetectResponse>('/api/cicd/detect');
export const generateCICD = (data: {
  platform: import('./types').CICDPlatform;
  framework?: string;
  options?: import('./types').CICDOptions;
}) =>
  request<import('./types').CICDGenerateResult>('/api/cicd/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
export const saveCICDConfig = (data: { filePath: string; content: string }) =>
  request<{ saved: boolean; fullPath: string }>('/api/cicd/save', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Chat History
export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatSessionFull extends ChatSessionSummary {
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
}

export const getChatSessions = () =>
  request<{ sessions: ChatSessionSummary[]; count: number }>('/api/chat/sessions');

export const getChatSession = (id: string) =>
  request<ChatSessionFull>(`/api/chat/sessions/${encodeURIComponent(id)}`);

export const createChatSession = (id: string, title?: string) =>
  request<ChatSessionFull>('/api/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({ id, title }),
  });

export const addChatMessage = (sessionId: string, role: 'user' | 'assistant', content: string) =>
  request<{ status: string }>(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  });

export const renameChatSession = (id: string, title: string) =>
  request<{ status: string }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ title }),
  });

export const deleteChatSession = (id: string) =>
  request<{ status: string }>(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const clearChatSessions = () =>
  request<{ status: string }>('/api/chat/sessions', {
    method: 'DELETE',
  });

// Recorder
export interface RecordedActionInfo {
  id: string;
  type: string;
  timestamp: number;
  description?: string;
  selector?: string | { primary: string; strategy: string; value: string; fallbacks?: string[] };
  value?: string;
  url?: string;
  key?: string;
  frameName?: string;
  tabIndex?: number;
}

export const startRecording = (data: {
  url?: string;
  browser?: string;
  headless?: boolean;
}) =>
  request<{ status: string; sessionId: string }>('/api/recorder/start', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const stopRecording = () =>
  request<{
    status: string;
    sessionId: string;
    actionCount: number;
    duration: number;
    actions: RecordedActionInfo[];
  }>('/api/recorder/stop', { method: 'POST' });

export const getRecorderStatus = () =>
  request<{
    recording: boolean;
    sessionId?: string;
    actionCount?: number;
    duration?: number;
    hasSession?: boolean;
  }>('/api/recorder/status');

export const getRecorderActions = () =>
  request<{ actions: RecordedActionInfo[] }>('/api/recorder/actions');

export const generateFromRecording = (data: {
  requestId: string;
  testName?: string;
  format?: string;
}) =>
  request<{ status: string; requestId: string }>('/api/recorder/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const playbackRecording = (data: { speed?: number }) =>
  request<{ status: string; totalActions: number }>('/api/recorder/playback', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const deleteRecorderAction = (actionId: string) =>
  request<{ deleted: boolean; remaining: number }>(
    `/api/recorder/actions/${encodeURIComponent(actionId)}`,
    { method: 'DELETE' },
  );

export const toggleAssertMode = (enable: boolean) =>
  request<{ active: boolean }>('/api/recorder/assert-mode', {
    method: 'POST',
    body: JSON.stringify({ enable }),
  });

export const resetRecording = () =>
  request<{ status: string }>('/api/recorder/reset', { method: 'POST' });

// Cloud Providers
export type CloudProviderId = 'browserstack' | 'lambdatest' | 'saucelabs';

export interface CloudProviderInfo {
  id: CloudProviderId;
  enabled: boolean;
  username: string;
  accessKey: string; // masked
  hubUrl: string;
  region?: string;
  tunnelEnabled?: boolean;
  tunnelName?: string;
  defaultBuildName?: string;
  customEnvVars?: Record<string, string>;
}

export interface CloudSchedule {
  id: string;
  name: string;
  command: string;
  cloudProvider?: string;
  cron: string;
  enabled: boolean;
  lastRunId?: string;
  lastRunTime?: string;
  nextRunTime?: string;
}

export const getCloudProviders = () =>
  request<{ providers: CloudProviderInfo[]; defaultProvider: string | null }>('/api/cloud/providers');

export const getCloudProvider = (id: CloudProviderId) =>
  request<CloudProviderInfo>(`/api/cloud/providers/${id}`);

export const saveCloudProvider = (config: {
  id: CloudProviderId;
  enabled?: boolean;
  username: string;
  accessKey: string;
  hubUrl?: string;
  region?: string;
  tunnelEnabled?: boolean;
  tunnelName?: string;
  defaultBuildName?: string;
  customEnvVars?: Record<string, string>;
}) =>
  request<{ message: string; provider: CloudProviderInfo }>('/api/cloud/providers', {
    method: 'POST',
    body: JSON.stringify(config),
  });

export const deleteCloudProvider = (id: CloudProviderId) =>
  request<{ message: string }>(`/api/cloud/providers/${id}`, { method: 'DELETE' });

export const setDefaultCloudProvider = (provider: string | null) =>
  request<{ defaultProvider: string | null }>('/api/cloud/default-provider', {
    method: 'PUT',
    body: JSON.stringify({ provider }),
  });

export const testCloudConnection = (data: {
  id: CloudProviderId;
  username: string;
  accessKey: string;
  region?: string;
}) =>
  request<{ connected: boolean; message: string; details?: string }>('/api/cloud/test-connection', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getCloudBuilds = (providerId: CloudProviderId, limit = 10) =>
  request<{ builds: Array<{ id: string; name: string; status: string; duration?: number; timestamp?: string }> }>(
    `/api/cloud/providers/${providerId}/builds?limit=${limit}`,
  );

export const getCloudEnvVars = (providerId: CloudProviderId, buildName?: string) =>
  request<{ envVars: Record<string, string> }>(
    `/api/cloud/providers/${providerId}/env-vars${buildName ? `?buildName=${encodeURIComponent(buildName)}` : ''}`,
  );

export const getCloudHubUrl = (providerId: CloudProviderId) =>
  request<{ hubUrl: string }>(`/api/cloud/providers/${providerId}/hub-url`);

// Cloud Schedules
export const getCloudSchedules = () =>
  request<{ schedules: CloudSchedule[] }>('/api/cloud/schedules');

export const saveCloudSchedule = (schedule: Omit<CloudSchedule, 'lastRunId' | 'lastRunTime' | 'nextRunTime'>) =>
  request<{ message: string; schedule: CloudSchedule }>('/api/cloud/schedules', {
    method: 'POST',
    body: JSON.stringify(schedule),
  });

export const updateCloudSchedule = (id: string, data: Partial<CloudSchedule>) =>
  request<{ message: string; schedule: CloudSchedule }>(`/api/cloud/schedules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteCloudSchedule = (id: string) =>
  request<{ message: string }>(`/api/cloud/schedules/${id}`, { method: 'DELETE' });

// Cloud Readiness Analyzer
export interface CloudPatchInfo {
  type: 'cloud-connect' | 'session-status' | 'full';
  description: string;
  file: string;
  fileAbsolute: string;
  preview: string;
  original: string;
}

export interface CloudAnalysisResult {
  cloudReady: boolean;
  hasCloudConnect: boolean;
  hasSessionStatus: boolean;
  framework: string;
  language: string;
  hookFile: string | null;
  hookFileAbsolute: string | null;
  patches: CloudPatchInfo[];
  alreadyPatched: boolean;
}

export const analyzeCloudReadiness = (provider: CloudProviderId) =>
  request<CloudAnalysisResult>('/api/cloud/analyze', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });

export const applyCloudPatches = (patches: CloudPatchInfo[]) =>
  request<{ message: string; applied: string[]; errors?: string[] }>('/api/cloud/patch', {
    method: 'POST',
    body: JSON.stringify({ patches }),
  });

// Cloud Artifacts
export const fetchCloudArtifacts = (runId: string) =>
  request<{ artifacts: any; message: string }>(`/api/results/runs/${runId}/fetch-artifacts`, {
    method: 'POST',
  });

// Scheduler
export const runScheduleNow = (id: string) =>
  request<{ message: string; runId?: string }>(`/api/cloud/schedules/${id}/run-now`, {
    method: 'POST',
  });

export const getNextRuns = () =>
  request<{ schedules: Array<CloudSchedule & { nextRunTime?: string }> }>('/api/cloud/schedules/next-runs');

// ── API Testing ─────────────────────────────────────────────────────────────

export const getApiCollections = () =>
  request<{ collections: import('./types').ApiCollectionSummary[] }>('/api/api-testing/collections');

export const getApiCollection = (id: string) =>
  request<import('./types').ApiCollection>(`/api/api-testing/collections/${id}`);

export const createApiCollection = (data: { name: string; description?: string; baseUrl?: string }) =>
  request<import('./types').ApiCollection>('/api/api-testing/collections', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateApiCollection = (id: string, data: Partial<import('./types').ApiCollection>) =>
  request<import('./types').ApiCollection>(`/api/api-testing/collections/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteApiCollection = (id: string) =>
  request<{ success: boolean }>(`/api/api-testing/collections/${id}`, { method: 'DELETE' });

export const saveApiRequest = (collectionId: string, apiRequest: import('./types').ApiRequest, folderId?: string) =>
  request<import('./types').ApiRequest>(`/api/api-testing/collections/${collectionId}/requests`, {
    method: 'POST',
    body: JSON.stringify({ request: apiRequest, folderId }),
  });

export const deleteApiRequest = (collectionId: string, requestId: string) =>
  request<{ success: boolean }>(`/api/api-testing/collections/${collectionId}/requests/${requestId}`, {
    method: 'DELETE',
  });

export const createApiFolder = (collectionId: string, name: string) =>
  request<import('./types').ApiFolder>(`/api/api-testing/collections/${collectionId}/folders`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

export const updateApiFolder = (collectionId: string, folderId: string, data: Partial<import('./types').ApiFolder>) =>
  request<import('./types').ApiFolder>(`/api/api-testing/collections/${collectionId}/folders/${folderId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteApiFolder = (collectionId: string, folderId: string) =>
  request<{ success: boolean }>(`/api/api-testing/collections/${collectionId}/folders/${folderId}`, {
    method: 'DELETE',
  });

export const getApiEnvironments = (collectionId: string) =>
  request<{ environments: import('./types').ApiEnvironment[] }>(`/api/api-testing/collections/${collectionId}/environments`);

export const saveApiEnvironment = (collectionId: string, env: import('./types').ApiEnvironment) =>
  request<import('./types').ApiEnvironment>(`/api/api-testing/collections/${collectionId}/environments`, {
    method: 'POST',
    body: JSON.stringify(env),
  });

export const updateApiEnvironment = (collectionId: string, envId: string, env: import('./types').ApiEnvironment) =>
  request<import('./types').ApiEnvironment>(`/api/api-testing/collections/${collectionId}/environments/${envId}`, {
    method: 'PUT',
    body: JSON.stringify(env),
  });

export const deleteApiEnvironment = (collectionId: string, envId: string) =>
  request<{ success: boolean }>(`/api/api-testing/collections/${collectionId}/environments/${envId}`, {
    method: 'DELETE',
  });

export const sendApiRequest = (apiRequest: import('./types').ApiRequest, variables?: Record<string, string>, collectionId?: string) =>
  request<import('./types').ApiResponse>('/api/api-testing/send', {
    method: 'POST',
    body: JSON.stringify({ request: apiRequest, variables, collectionId }),
  });

export const sendApiChain = (requests: import('./types').ApiRequest[], variables?: Record<string, string>) =>
  request<{ responses: import('./types').ApiResponse[] }>('/api/api-testing/send-chain', {
    method: 'POST',
    body: JSON.stringify({ requests, variables }),
  });

export const getApiHistory = (limit = 50) =>
  request<{ history: import('./types').ApiHistoryEntry[]; count: number }>(`/api/api-testing/history?limit=${limit}`);

export const clearApiHistory = () =>
  request<{ success: boolean }>('/api/api-testing/history', { method: 'DELETE' });

export const importApiCollection = (data: unknown, format?: string) =>
  request<import('./types').ApiCollection>('/api/api-testing/import', {
    method: 'POST',
    body: JSON.stringify({ data, format }),
  });

export const exportApiCollection = (id: string) =>
  request<import('./types').ApiCollection>(`/api/api-testing/collections/${id}/export`);

export const generateApiTest = (data: {
  requestId: string;
  apiRequests: import('./types').ApiRequest[];
  responses?: import('./types').ApiResponse[];
  testName?: string;
  frameworkHint?: string;
}) =>
  request<{ status: string; requestId: string }>('/api/ai/generate-api-test', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const parseApiSpec = (content: string | object, format?: string) =>
  request<{
    format: string;
    collection: import('./types').ApiCollection;
    endpoints: Array<{ method: string; path: string; name?: string; summary?: string; folder?: string; tags?: string[] }>;
    specName: string;
  }>('/api/api-testing/parse-spec', {
    method: 'POST',
    body: JSON.stringify({ content, format }),
  });

export const generateApiScenarios = (data: {
  requestId: string;
  endpoints: Array<{ method: string; path: string; name?: string; summary?: string }>;
  specSummary?: string;
  selectedEndpoints?: Array<{ method: string; path: string; name?: string; summary?: string }>;
  existingCollections?: Array<{ name: string; requestCount: number }>;
  baseUrl?: string;
}) =>
  request<{ status: string; requestId: string }>('/api/ai/generate-api-scenarios', {
    method: 'POST',
    body: JSON.stringify(data),
  });

// ── Git Integration ─────────────────────────────────────────────────────────

export interface GitBlameResult {
  filePath: string;
  entries: Array<{
    line: number;
    author: string;
    email: string;
    commitSha: string;
    commitMessage: string;
    timestamp: string;
  }>;
  lastModifiedBy: string;
  lastModifiedAt: string;
  lastCommitSha: string;
  lastCommitMessage: string;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  message: string;
  timestamp: string;
  filesChanged?: string[];
}

export interface GitStatus {
  available: boolean;
  branch?: string;
  isClean?: boolean;
  lastCommit?: GitCommit;
  uncommittedChanges?: Array<{ path: string; status: string }>;
  ahead?: number;
  behind?: number;
}

export interface CommitCorrelation {
  commit: GitCommit;
  newFailures: string[];
  fixedTests: string[];
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface FailureOwnership {
  testName: string;
  suggestedOwner: {
    name: string;
    email: string;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
  };
  alternativeOwners: Array<{
    name: string;
    email: string;
    reason: string;
  }>;
}

export interface ChurnResult {
  filePath: string;
  editCount: number;
  daysSpan: number;
  churnScore: number;
  contributors: string[];
}

export const getGitStatus = () =>
  request<GitStatus>('/api/git/status');

export const getGitBlame = (filePath: string) =>
  request<GitBlameResult>(`/api/git/blame?file=${encodeURIComponent(filePath)}`);

export const getGitLog = (limit = 20, file?: string) =>
  request<{ commits: GitCommit[]; available: boolean }>(
    `/api/git/log?limit=${limit}${file ? `&file=${encodeURIComponent(file)}` : ''}`,
  );

export const getGitDiff = (sha: string) =>
  request<{
    sha: string;
    author: string;
    message: string;
    timestamp: string;
    files: Array<{ path: string; status: string; additions: number; deletions: number; patch?: string }>;
    available: boolean;
  }>(`/api/git/diff/${sha}`);

export interface UncommittedDiffFile {
  path: string;
  status: string;
  staged: boolean;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface UncommittedDiffResult {
  files: UncommittedDiffFile[];
  stagedCount: number;
  unstagedCount: number;
  available: boolean;
}

export const getGitUncommittedDiff = (filePath?: string) =>
  request<UncommittedDiffResult>(
    `/api/git/diff/uncommitted${filePath ? `?file=${encodeURIComponent(filePath)}` : ''}`,
  );

export const getGitChurn = (filePath: string, days = 30) =>
  request<ChurnResult>(`/api/git/churn?file=${encodeURIComponent(filePath)}&days=${days}`);

export const getGitCorrelation = (runId: string) =>
  request<{ correlations: CommitCorrelation[]; available: boolean }>(`/api/git/correlate/${runId}`);

export const getGitOwnership = (runId: string) =>
  request<{ ownership: FailureOwnership[]; available: boolean }>(`/api/git/ownership/${runId}`);

// ── Git Write Operations ────────────────────────────────────────────────

export interface GitCommitResult {
  commit: string;
  branch: string;
  summary: { changes: number; insertions: number; deletions: number };
}

export interface GitPullResult {
  files: string[];
  summary: { changes: number; insertions: number; deletions: number };
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  commit: string;
  label: string;
}

export interface GitBranchesResult {
  current: string;
  all: string[];
  branches: GitBranchInfo[];
  available: boolean;
}

export const gitStageFiles = (files: string[]) =>
  request<{ staged: string[] }>('/api/git/stage', {
    method: 'POST', body: JSON.stringify({ files }),
  });

export const gitUnstageFiles = (files: string[]) =>
  request<{ unstaged: string[] }>('/api/git/unstage', {
    method: 'POST', body: JSON.stringify({ files }),
  });

export const gitCommit = (message: string) =>
  request<GitCommitResult>('/api/git/commit', {
    method: 'POST', body: JSON.stringify({ message }),
  });

export const gitFetch = (remote?: string) =>
  request<{ raw: string }>('/api/git/fetch', {
    method: 'POST', body: JSON.stringify({ remote }),
  });

export const gitPull = (remote?: string, branch?: string) =>
  request<GitPullResult>('/api/git/pull', {
    method: 'POST', body: JSON.stringify({ remote, branch }),
  });

export const gitPush = (remote?: string, branch?: string) =>
  request<{ pushed: boolean; message: string }>('/api/git/push', {
    method: 'POST', body: JSON.stringify({ remote, branch }),
  });

export const getGitBranches = () =>
  request<GitBranchesResult>('/api/git/branches');

export const gitCreateBranch = (name: string, checkout = true) =>
  request<{ branch: string; switched: boolean }>('/api/git/branch/create', {
    method: 'POST', body: JSON.stringify({ name, checkout }),
  });

export const gitSwitchBranch = (name: string) =>
  request<{ branch: string; switched: boolean }>('/api/git/branch/switch', {
    method: 'POST', body: JSON.stringify({ name }),
  });

// ── Auth ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'tester' | 'viewer';
}

export interface AuthStatusResponse {
  setupRequired: boolean;
  authenticated: boolean;
  user?: AuthUser;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  expiresAt: string;
}

export const authStatus = () =>
  request<AuthStatusResponse>('/api/auth/status');

export const authLogin = (username: string, password: string) =>
  request<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

export const authSetup = (data: { username: string; displayName: string; password: string }) =>
  request<{ user: AuthUser; token: string; expiresAt: string }>('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const authLogout = () =>
  request<{ status: string }>('/api/auth/logout', { method: 'POST' });

export const authChangePassword = (currentPassword: string, newPassword: string) =>
  request<{ status: string }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });

export const authGetMe = () =>
  request<AuthUser & { createdAt: string; lastLoginAt: string | null }>('/api/auth/me');

// ── Profile & Sessions ──────────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  isCurrent: boolean;
}

export const updateMyProfile = (data: { displayName: string }) =>
  request<{ user: AuthUser }>('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const getMySessions = () =>
  request<{ sessions: SessionInfo[] }>('/api/auth/sessions');

export const revokeMySession = (sessionId: string) =>
  request<{ status: string }>(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });

export const revokeAllOtherSessions = () =>
  request<{ status: string; sessionsRevoked: number }>('/api/auth/sessions/revoke-others', {
    method: 'POST',
  });

export const getMyActivity = (limit = 20) =>
  request<{ entries: AuditEntry[]; total: number }>(`/api/auth/activity?limit=${limit}`);

// ── User Management (Admin) ─────────────────────────────────────────────────

export interface UserInfo extends AuthUser {
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  sessions: number;
}

export const getUsers = () =>
  request<{ users: UserInfo[] }>('/api/auth/users');

export const createUser = (data: { username: string; displayName: string; password: string; role: string }) =>
  request<{ user: AuthUser & { isActive: boolean } }>('/api/auth/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const updateUser = (id: string, data: Partial<{ displayName: string; role: string; isActive: boolean }>) =>
  request<{ user: AuthUser & { isActive: boolean } }>(`/api/auth/users/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteUser = (id: string) =>
  request<{ status: string }>(`/api/auth/users/${id}`, { method: 'DELETE' });

export const resetUserPassword = (id: string, newPassword: string) =>
  request<{ status: string }>(`/api/auth/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ newPassword }),
  });

export const revokeUserSessions = (id: string) =>
  request<{ status: string; sessionsRevoked: number }>(`/api/auth/users/${id}/revoke-sessions`, {
    method: 'POST',
  });

// ── Audit Log (Admin) ──────────────────────────────────────────────────────

export interface AuditEntry {
  id: number;
  timestamp: string;
  userId: string;
  username: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
}

export const getAuditLog = (params?: {
  userId?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) => {
  const searchParams = new URLSearchParams();
  if (params) {
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined) searchParams.set(key, String(val));
    }
  }
  const qs = searchParams.toString();
  return request<{ entries: AuditEntry[]; total: number; limit: number; offset: number }>(
    `/api/audit${qs ? `?${qs}` : ''}`,
  );
};

export const getAuditStats = () =>
  request<{
    totalEntries: number;
    uniqueUsers: number;
    actionCounts: Record<string, number>;
    recentLoginCount: number;
    recentFailedLogins: number;
  }>('/api/audit/stats');

export const exportAuditLog = () =>
  request<{ entries: AuditEntry[]; exportedAt: string }>('/api/audit/export');
