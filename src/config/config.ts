import Conf from 'conf';
import type { QabotConfig, ProviderName } from '../types/index.js';
import { defaultConfig, ENV_API_KEY_MAP, DEFAULT_MODELS, DEFAULT_BASE_URLS } from './defaults.js';
import { deepMerge } from '../utils/index.js';

let instance: ConfigStore | null = null;

export class ConfigStore {
  private store: Conf<QabotConfig>;

  constructor() {
    this.store = new Conf<QabotConfig>({
      projectName: 'qabot',
      defaults: defaultConfig,
    });
  }

  get(): QabotConfig {
    return this.store.store;
  }

  getLLMConfig() {
    return this.store.get('llm');
  }

  getDefaultProvider(): ProviderName {
    const envProvider = process.env.QABOT_DEFAULT_PROVIDER;
    if (envProvider) return envProvider as ProviderName;
    return this.store.get('llm.defaultProvider') as ProviderName;
  }

  getDefaultModel(): string | undefined {
    const envModel = process.env.QABOT_DEFAULT_MODEL;
    if (envModel) return envModel;
    return this.store.get('llm.defaultModel') as string | undefined;
  }

  setDefaultProvider(provider: ProviderName): void {
    this.store.set('llm.defaultProvider', provider);
  }

  setDefaultModel(model: string): void {
    this.store.set('llm.defaultModel', model);
  }

  getProviderApiKey(provider: ProviderName): string | undefined {
    const envVar = ENV_API_KEY_MAP[provider];
    if (envVar) {
      const envKey = process.env[envVar];
      if (envKey) return envKey;
    }
    const providers = this.store.get('llm.providers') as Record<string, { apiKey?: string }>;
    return providers[provider]?.apiKey;
  }

  setProviderApiKey(provider: ProviderName, apiKey: string): void {
    this.store.set(`llm.providers.${provider}.apiKey`, apiKey);
  }

  getProviderModel(provider: ProviderName): string {
    // 1. Check provider-specific env var (e.g., OPENAI_MODEL, OLLAMA_MODEL)
    const envModelVar = `${provider.toUpperCase()}_MODEL`;
    const envModel = process.env[envModelVar];
    if (envModel) return envModel;

    // 2. Check persistent config store
    const providers = this.store.get('llm.providers') as Record<string, { model?: string }>;
    return providers[provider]?.model || DEFAULT_MODELS[provider] || 'gpt-4o';
  }

  setProviderModel(provider: ProviderName, model: string): void {
    this.store.set(`llm.providers.${provider}.model`, model);
  }

  getProviderBaseUrl(provider: ProviderName): string | undefined {
    const envVar = `${provider.toUpperCase()}_BASE_URL`;
    const envUrl = process.env[envVar];
    if (envUrl) return envUrl;
    const providers = this.store.get('llm.providers') as Record<string, { baseUrl?: string }>;
    return providers[provider]?.baseUrl || DEFAULT_BASE_URLS[provider];
  }

  getProviderTimeout(provider: ProviderName): number | undefined {
    // 1. Check provider-specific env var (e.g., OLLAMA_TIMEOUT)
    const envVar = `${provider.toUpperCase()}_TIMEOUT`;
    const envVal = process.env[envVar];
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    // 2. Check generic env var
    const genericVal = process.env.QABOT_LLM_TIMEOUT;
    if (genericVal) {
      const parsed = parseInt(genericVal, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    // 3. Check config store
    const providers = this.store.get('llm.providers') as Record<string, { timeout?: number }>;
    return providers[provider]?.timeout;
  }

  hasApiKey(provider: ProviderName): boolean {
    return !!this.getProviderApiKey(provider);
  }

  getAvailableProviders(): ProviderName[] {
    const all: ProviderName[] = ['openai', 'anthropic', 'google', 'xai', 'ollama', 'lmstudio'];
    return all.filter((p) => {
      if (p === 'ollama' || p === 'lmstudio') return true;
      return this.hasApiKey(p);
    });
  }

  getMaxToolIterations(): number {
    // Env var takes priority, then config, then default 30
    const envVal = process.env.QABOT_MAX_TOOL_ITERATIONS;
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 0) return Math.min(parsed, 100);
    }
    return (this.store.get('llm.maxToolIterations') as number) || 30;
  }

  getAutomationConfig() {
    return this.store.get('automation');
  }

  getRecordingConfig() {
    return this.store.get('recording');
  }

  getHealingConfig() {
    return this.store.get('healing');
  }

  getUIConfig() {
    return this.store.get('ui');
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  reset(): void {
    this.store.clear();
  }

  getPath(): string {
    return this.store.path;
  }

  merge(partial: Partial<QabotConfig>): void {
    const current = this.get();
    const merged = deepMerge(current, partial as Record<string, unknown>) as QabotConfig;
    this.store.store = merged;
  }
}

export function getConfig(): ConfigStore {
  if (!instance) {
    instance = new ConfigStore();
  }
  return instance;
}
