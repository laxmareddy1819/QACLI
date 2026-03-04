import type { QabotConfig } from '../types/index.js';

export const ENV_API_KEY_MAP: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  xai: 'XAI_API_KEY',
  ollama: '',
  lmstudio: '',
  custom: 'CUSTOM_API_KEY',
};

export const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
  xai: 'grok-2-latest',
  ollama: 'llama3',
  lmstudio: 'default',
};

export const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: 'http://localhost:11434/v1',
  lmstudio: 'http://localhost:1234/v1',
};

export const defaultConfig: QabotConfig = {
  llm: {
    defaultProvider: 'openai',
    defaultModel: undefined,
    maxToolIterations: 30,
    providers: {
      openai: { model: 'gpt-4o' },
      anthropic: { model: 'claude-sonnet-4-20250514' },
      google: { model: 'gemini-2.0-flash' },
      xai: { model: 'grok-2-latest' },
      ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3' },
      lmstudio: { baseUrl: 'http://localhost:1234/v1', model: 'default' },
    },
    fallback: ['anthropic', 'google'],
  },
  automation: {
    defaultAdapter: 'playwright',
    browser: 'chromium',
    headless: false,
    timeout: 30000,
    slowMo: undefined,
  },
  recording: {
    outputFormat: 'playwright',
    outputLanguage: 'typescript',
    includeComments: true,
  },
  healing: {
    enabled: true,
    confidenceThreshold: 0.7,
    dbPath: undefined,
    aiEnabled: true,
    retentionDays: 90,
  },
  ui: {
    theme: 'default',
    showTokenUsage: true,
    streamingEnabled: true,
  },
};
