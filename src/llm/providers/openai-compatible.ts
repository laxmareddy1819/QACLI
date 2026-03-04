import OpenAI from 'openai';
import type {
  ProviderName,
  ProviderCapabilities,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  ToolCall,
  FinishReason,
} from '../../types/index.js';
import { BaseLLMProvider } from '../provider.js';
import { generateId } from '../../utils/index.js';

interface OpenAICompatibleConfig {
  providerName: ProviderName;
  defaultBaseUrl: string;
  defaultModel: string;
  defaultApiKey: string;
  capabilities: ProviderCapabilities;
}

export class OpenAICompatibleProvider extends BaseLLMProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;

  private client!: OpenAI;
  private defaultModel: string;
  private defaultBaseUrl: string;
  private defaultApiKey: string;

  constructor(config: OpenAICompatibleConfig) {
    super();
    this.name = config.providerName;
    this.capabilities = config.capabilities;
    this.defaultModel = config.defaultModel;
    this.defaultBaseUrl = config.defaultBaseUrl;
    this.defaultApiKey = config.defaultApiKey;
  }

  protected async setup(): Promise<void> {
    this.client = new OpenAI({
      apiKey: this.config.apiKey || this.defaultApiKey,
      baseURL: this.config.baseUrl || this.defaultBaseUrl,
      timeout: this.config.timeout || this.defaultTimeout,
      maxRetries: this.config.maxRetries ?? this.defaultMaxRetries,
    });
  }

  /** Default timeout in ms. Subclasses can override for local providers. */
  protected get defaultTimeout(): number {
    return 60000; // 60s for cloud APIs
  }

  /** Default max retries. Subclasses can override for local providers. */
  protected get defaultMaxRetries(): number {
    return 2; // 2 retries for cloud APIs
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.ensureReady();
    const start = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: request.model || this.config.model || this.defaultModel,
        messages: this.convertMessages(request.messages) as OpenAI.ChatCompletionMessageParam[],
        tools: this.convertTools(request.tools || []) as OpenAI.ChatCompletionTool[] | undefined,
        temperature: request.temperature ?? this.config.temperature,
        max_tokens: request.maxTokens ?? this.config.maxTokens,
      });

      const choice = response.choices[0];
      if (!choice) throw new Error('No completion choice returned');

      const toolCalls = choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}'),
      }));

      const duration = Date.now() - start;
      this.updateStats(
        duration,
        response.usage?.prompt_tokens,
        response.usage?.completion_tokens,
      );

      return {
        content: choice.message.content || '',
        toolCalls,
        finishReason: this.mapFinishReason(choice.finish_reason),
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    this.ensureReady();
    const start = Date.now();

    try {
      const stream = await this.client.chat.completions.create({
        model: request.model || this.config.model || this.defaultModel,
        messages: this.convertMessages(request.messages) as OpenAI.ChatCompletionMessageParam[],
        tools: this.convertTools(request.tools || []) as OpenAI.ChatCompletionTool[] | undefined,
        temperature: request.temperature ?? this.config.temperature,
        max_tokens: request.maxTokens ?? this.config.maxTokens,
        stream: true,
      });

      const toolCallAccumulator = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let lastFinishReason: string | null = null;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];

        if (choice?.delta?.content) {
          yield { type: 'text', content: choice.delta.content };
        }

        if (choice?.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallAccumulator.has(idx)) {
              toolCallAccumulator.set(idx, {
                id: tc.id || generateId('call'),
                name: tc.function?.name || '',
                arguments: '',
              });
            }
            const acc = toolCallAccumulator.get(idx)!;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          }
        }

        if (choice?.finish_reason) {
          lastFinishReason = choice.finish_reason;
          if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
            for (const [, acc] of toolCallAccumulator) {
              const toolCall: ToolCall = {
                id: acc.id,
                name: acc.name,
                arguments: JSON.parse(acc.arguments || '{}'),
              };
              yield { type: 'tool_call', toolCall };
            }
            toolCallAccumulator.clear();
          }
        }
      }

      const duration = Date.now() - start;
      this.updateStats(duration);
      yield { type: 'done', finishReason: this.mapFinishReason(lastFinishReason) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
    }
  }

  protected convertMessages(messages: Message[]): unknown[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.toolCallId || '',
        };
      }
      // Assistant messages with tool calls must include tool_calls array
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: msg.content || null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        };
      }
      return {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      };
    });
  }

  protected convertTools(tools: ToolDefinition[]): unknown[] | undefined {
    if (!tools.length) return undefined;
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private mapFinishReason(reason: string | null | undefined): FinishReason {
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'tool_calls': return 'tool_calls';
      case 'content_filter': return 'content_filter';
      default: return 'stop';
    }
  }
}

// ── Concrete providers ────────────────────────────────────────────────────────

export class XAIProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      providerName: 'xai',
      defaultBaseUrl: 'https://api.x.ai/v1',
      defaultModel: 'grok-2-latest',
      defaultApiKey: '',
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: false,
        maxTokens: 131072,
        contextWindow: 131072,
      },
    });
  }
}

export class OllamaProvider extends OpenAICompatibleProvider {
  private resolvedModel: string | undefined;

  constructor() {
    super({
      providerName: 'ollama',
      defaultBaseUrl: 'http://localhost:11434/v1',
      defaultModel: 'llama3',
      defaultApiKey: 'ollama',
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: false,
        maxTokens: 4096,
        contextWindow: 128000,
      },
    });
  }

  /** Local models need much more time — 5 minutes default. */
  protected override get defaultTimeout(): number {
    return 300000; // 5 minutes
  }

  /** Don't retry against local models — they're already busy. */
  protected override get defaultMaxRetries(): number {
    return 0;
  }

  protected override async setup(): Promise<void> {
    await super.setup();
    // Resolve model name against locally available Ollama models.
    // Ollama requires the full "name:tag" format (e.g. "llama3.2:3b").
    // Users typically set just the family name (e.g. "llama3.2"), so we
    // query the Ollama REST API to find the best match.
    const wanted = this.config.model || 'llama3';
    try {
      const baseUrl = (this.config.baseUrl || 'http://localhost:11434/v1').replace(/\/v1\/?$/, '');
      const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = (await resp.json()) as { models?: Array<{ name: string }> };
        const models = data.models || [];
        const names = models.map(m => m.name);

        // Exact match — already good
        if (names.includes(wanted)) {
          this.resolvedModel = wanted;
          return;
        }

        // Find models whose name starts with the wanted string
        // e.g. "llama3.2" matches "llama3.2:3b", "llama3.2:latest"
        const matches = names.filter(n => n.startsWith(wanted + ':') || n.split(':')[0] === wanted);
        if (matches.length > 0) {
          // Prefer ":latest" tag, otherwise take the first match
          const latest = matches.find(n => n.endsWith(':latest'));
          this.resolvedModel = latest || matches[0]!;
          return;
        }

        // Partial prefix match — e.g. "llama3" matches "llama3.1:8b", "llama3.2:3b"
        const prefixMatches = names.filter(n => n.startsWith(wanted));
        if (prefixMatches.length > 0) {
          const latest = prefixMatches.find(n => n.endsWith(':latest'));
          this.resolvedModel = latest || prefixMatches[0]!;
        }
      }
    } catch {
      // Can't reach Ollama API tags endpoint — proceed with user-specified name
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (this.resolvedModel) {
      request = { ...request, model: request.model || this.resolvedModel };
    }
    return super.complete(request);
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    if (this.resolvedModel) {
      request = { ...request, model: request.model || this.resolvedModel };
    }
    yield* super.stream(request);
  }
}

export class LMStudioProvider extends OpenAICompatibleProvider {
  constructor() {
    super({
      providerName: 'lmstudio',
      defaultBaseUrl: 'http://localhost:1234/v1',
      defaultModel: 'default',
      defaultApiKey: 'lmstudio',
      capabilities: {
        streaming: true,
        functionCalling: true,
        vision: false,
        maxTokens: 4096,
        contextWindow: 128000,
      },
    });
  }

  /** Local models need much more time — 5 minutes default. */
  protected override get defaultTimeout(): number {
    return 300000; // 5 minutes
  }

  /** Don't retry against local models — they're already busy. */
  protected override get defaultMaxRetries(): number {
    return 0;
  }
}
