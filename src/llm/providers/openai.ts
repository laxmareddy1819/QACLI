import OpenAI from 'openai';
import type {
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

export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai' as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    maxTokens: 16384,
    contextWindow: 128000,
  };

  private client!: OpenAI;

  protected async setup(): Promise<void> {
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout || 60000,
      maxRetries: this.config.maxRetries || 2,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.ensureReady();
    const start = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: request.model || this.config.model || 'gpt-4o',
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
        model: request.model || this.config.model || 'gpt-4o',
        messages: this.convertMessages(request.messages) as OpenAI.ChatCompletionMessageParam[],
        tools: this.convertTools(request.tools || []) as OpenAI.ChatCompletionTool[] | undefined,
        temperature: request.temperature ?? this.config.temperature,
        max_tokens: request.maxTokens ?? this.config.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
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
          // Emit accumulated tool calls on stop or tool_calls finish
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

        if (chunk.usage) {
          const duration = Date.now() - start;
          this.updateStats(duration, chunk.usage.prompt_tokens, chunk.usage.completion_tokens);
          yield {
            type: 'done',
            finishReason: this.mapFinishReason(lastFinishReason),
            usage: {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            },
          };
          return;
        }
      }

      yield { type: 'done', finishReason: this.mapFinishReason(lastFinishReason) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
      this.handleError(error);
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
      // so the API can correlate tool results with the correct tool calls
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

  private mapFinishReason(
    reason: string | null | undefined,
  ): FinishReason {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      case 'tool_calls':
        return 'tool_calls';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
