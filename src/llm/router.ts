import type {
  ProviderName,
  ProviderHealth,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from '../types/index.js';
import type { LLMProvider } from './provider.js';
import { createProvider } from './providers/index.js';
import { getConfig } from '../config/index.js';
import { createLogger, retry } from '../utils/index.js';

const logger = createLogger('router');

export class LLMRouter {
  private providers = new Map<ProviderName, LLMProvider>();
  private health = new Map<ProviderName, ProviderHealth>();
  private defaultProvider: ProviderName;
  private fallbackChain: ProviderName[];

  constructor() {
    const config = getConfig();
    this.defaultProvider = config.getDefaultProvider();
    this.fallbackChain = config.getLLMConfig().fallback || [];
  }

  async initialize(): Promise<void> {
    const config = getConfig();
    const available = config.getAvailableProviders();

    // If the user explicitly set a default provider, make sure it's available
    if (!available.includes(this.defaultProvider)) {
      const envVar = this.defaultProvider === 'ollama' || this.defaultProvider === 'lmstudio'
        ? `${this.defaultProvider.toUpperCase()}_BASE_URL`
        : `${this.defaultProvider.toUpperCase().replace('XAI', 'XAI')}_API_KEY`;
      const keyMap: Record<string, string> = {
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        google: 'GOOGLE_API_KEY',
        xai: 'XAI_API_KEY',
      };
      const actualEnvVar = keyMap[this.defaultProvider] || envVar;
      throw new Error(
        `Provider "${this.defaultProvider}" is set as default but has no API key.\n` +
        `  Set ${actualEnvVar} in your .env file or shell environment.\n` +
        `  Or change QABOT_DEFAULT_PROVIDER to an available provider.`,
      );
    }

    // Initialize the default provider first to fail fast
    try {
      await this.addProvider(this.defaultProvider);
      logger.info(`Default provider ${this.defaultProvider} initialized`);
    } catch (error) {
      throw new Error(
        `Failed to initialize default provider "${this.defaultProvider}": ${error instanceof Error ? error.message : error}`,
      );
    }

    // Initialize remaining providers silently
    for (const name of available) {
      if (name === this.defaultProvider) continue; // already initialized
      try {
        await this.addProvider(name);
        logger.info(`Provider ${name} initialized`);
      } catch (error) {
        logger.warn(`Failed to initialize provider ${name}: ${error}`);
      }
    }

    if (this.providers.size === 0) {
      throw new Error(
        'No LLM providers available. Set an API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) or start a local model (Ollama, LM Studio).',
      );
    }
  }

  async addProvider(name: ProviderName): Promise<void> {
    const config = getConfig();
    const provider = createProvider(name);
    const providerConfig = {
      apiKey: config.getProviderApiKey(name),
      baseUrl: config.getProviderBaseUrl(name),
      model: config.getProviderModel(name),
      timeout: config.getProviderTimeout(name),
    };
    await provider.initialize(providerConfig);
    this.providers.set(name, provider);
    this.health.set(name, {
      name,
      healthy: true,
      lastCheck: Date.now(),
      latency: undefined,
      errorCount: 0,
    });
  }

  removeProvider(name: ProviderName): void {
    const provider = this.providers.get(name);
    if (provider) {
      provider.dispose().catch(() => {});
      this.providers.delete(name);
      this.health.delete(name);
    }
  }

  getProvider(name?: ProviderName): LLMProvider {
    const targetName = name || this.defaultProvider;
    const provider = this.providers.get(targetName);
    if (provider && this.isHealthy(targetName)) return provider;

    for (const fallback of this.fallbackChain) {
      const fb = this.providers.get(fallback);
      if (fb && this.isHealthy(fallback)) {
        logger.warn(`Falling back from ${targetName} to ${fallback}`);
        return fb;
      }
    }

    for (const [providerName, p] of this.providers) {
      if (this.isHealthy(providerName)) {
        logger.warn(`Using any available provider: ${providerName}`);
        return p;
      }
    }

    if (provider) return provider;
    throw new Error(`No healthy provider available. Tried: ${targetName}, ${this.fallbackChain.join(', ')}`);
  }

  async complete(request: CompletionRequest, providerName?: ProviderName): Promise<CompletionResponse> {
    const provider = this.getProvider(providerName);
    return retry(
      () => provider.complete(request),
      {
        maxRetries: 2,
        baseDelay: 1000,
        maxDelay: 10000,
        shouldRetry: (error) => this.shouldRetry(error),
      },
    );
  }

  async *stream(request: CompletionRequest, providerName?: ProviderName): AsyncIterable<StreamChunk> {
    const provider = this.getProvider(providerName);
    yield* provider.stream(request);
  }

  setDefaultProvider(name: ProviderName): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider ${name} is not initialized`);
    }
    this.defaultProvider = name;
    getConfig().setDefaultProvider(name);
  }

  setModel(provider: ProviderName, model: string): void {
    getConfig().setProviderModel(provider, model);
  }

  getDefaultProviderName(): ProviderName {
    return this.defaultProvider;
  }

  getDefaultModel(): string {
    return getConfig().getProviderModel(this.defaultProvider);
  }

  getAvailableProviders(): ProviderName[] {
    return Array.from(this.providers.keys());
  }

  getProviderHealth(): Map<ProviderName, ProviderHealth> {
    return new Map(this.health);
  }

  getTotalStats() {
    let totalTokens = 0;
    let totalRequests = 0;
    for (const provider of this.providers.values()) {
      totalTokens += provider.stats.totalTokens;
      totalRequests += provider.stats.totalRequests;
    }
    return { totalTokens, totalRequests };
  }

  private isHealthy(name: ProviderName): boolean {
    const h = this.health.get(name);
    if (!h) return false;
    return h.healthy || h.errorCount < 3;
  }

  private shouldRetry(error: unknown): boolean {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('rate limit') || msg.includes('429')) return true;
      if (msg.includes('timeout') || msg.includes('503')) return true;
      if (msg.includes('overloaded') || msg.includes('529')) return true;
    }
    return false;
  }

  async dispose(): Promise<void> {
    for (const provider of this.providers.values()) {
      await provider.dispose().catch(() => {});
    }
    this.providers.clear();
    this.health.clear();
  }
}

let routerInstance: LLMRouter | null = null;

export function getRouter(): LLMRouter {
  if (!routerInstance) {
    routerInstance = new LLMRouter();
  }
  return routerInstance;
}

export function createRouter(): LLMRouter {
  routerInstance = new LLMRouter();
  return routerInstance;
}
