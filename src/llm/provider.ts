import type {
  ProviderName,
  ProviderCapabilities,
  ProviderConfig,
  ProviderStats,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ToolDefinition,
} from '../types/index.js';
import { createLogger } from '../utils/index.js';

// ── LLM Provider Interface ───────────────────────────────────────────────────

export interface LLMProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  readonly stats: ProviderStats;

  initialize(config: ProviderConfig): Promise<void>;
  isReady(): boolean;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  stream(request: CompletionRequest): AsyncIterable<StreamChunk>;
  countTokens?(text: string): Promise<number>;
  dispose(): Promise<void>;
}

// ── Base Provider ─────────────────────────────────────────────────────────────

export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly name: ProviderName;
  abstract readonly capabilities: ProviderCapabilities;

  protected config!: ProviderConfig;
  protected initialized = false;
  protected logger = createLogger('llm');

  private _stats: ProviderStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    averageLatency: 0,
  };

  get stats(): ProviderStats {
    return { ...this._stats };
  }

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    await this.setup();
    this.initialized = true;
    this.logger.info(`${this.name} provider initialized`);
  }

  isReady(): boolean {
    return this.initialized;
  }

  protected ensureReady(): void {
    if (!this.initialized) {
      throw new Error(`Provider ${this.name} is not initialized. Call initialize() first.`);
    }
  }

  protected updateStats(duration: number, inputTokens?: number, outputTokens?: number): void {
    this._stats.totalRequests++;
    this._stats.successfulRequests++;
    const total = (inputTokens || 0) + (outputTokens || 0);
    this._stats.totalTokens += total;
    this._stats.totalInputTokens += inputTokens || 0;
    this._stats.totalOutputTokens += outputTokens || 0;
    this._stats.averageLatency =
      (this._stats.averageLatency * (this._stats.totalRequests - 1) + duration) /
      this._stats.totalRequests;
  }

  protected handleError(error: unknown): never {
    this._stats.totalRequests++;
    this._stats.failedRequests++;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`${this.name} provider error: ${message}`);
    throw error;
  }

  async countTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  protected abstract setup(): Promise<void>;
  abstract complete(request: CompletionRequest): Promise<CompletionResponse>;
  abstract stream(request: CompletionRequest): AsyncIterable<StreamChunk>;

  protected abstract convertMessages(
    messages: Message[],
  ): unknown[];
  protected abstract convertTools(
    tools: ToolDefinition[],
  ): unknown[] | undefined;
}
