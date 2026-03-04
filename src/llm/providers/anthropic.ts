import Anthropic from '@anthropic-ai/sdk';
import type {
  ProviderCapabilities,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  Message,
  ToolDefinition,
  ToolCall,
} from '../../types/index.js';
import { BaseLLMProvider } from '../provider.js';
import { generateId } from '../../utils/index.js';

export class AnthropicProvider extends BaseLLMProvider {
  readonly name = 'anthropic' as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    maxTokens: 16384,
    contextWindow: 200000,
  };

  private client!: Anthropic;

  protected async setup(): Promise<void> {
    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      timeout: this.config.timeout || 60000,
      maxRetries: this.config.maxRetries || 2,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.ensureReady();
    const start = Date.now();
    const { systemMessage, messages } = this.extractSystem(request.messages);

    try {
      const response = await this.client.messages.create({
        model: request.model || this.config.model || 'claude-sonnet-4-20250514',
        system: systemMessage || undefined,
        messages: this.convertMessages(messages) as Anthropic.MessageParam[],
        tools: this.convertTools(request.tools || []) as Anthropic.Tool[] | undefined,
        max_tokens: request.maxTokens ?? this.config.maxTokens ?? 8192,
        temperature: request.temperature ?? this.config.temperature,
      });

      let content = '';
      const toolCalls: ToolCall[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      const duration = Date.now() - start;
      this.updateStats(duration, response.usage.input_tokens, response.usage.output_tokens);

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    this.ensureReady();
    const start = Date.now();
    const { systemMessage, messages } = this.extractSystem(request.messages);

    try {
      const stream = this.client.messages.stream({
        model: request.model || this.config.model || 'claude-sonnet-4-20250514',
        system: systemMessage || undefined,
        messages: this.convertMessages(messages) as Anthropic.MessageParam[],
        tools: this.convertTools(request.tools || []) as Anthropic.Tool[] | undefined,
        max_tokens: request.maxTokens ?? this.config.maxTokens ?? 8192,
        temperature: request.temperature ?? this.config.temperature,
      });

      let currentToolId = '';
      let currentToolName = '';
      let currentToolInput = '';

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolInput = '';
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', content: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            currentToolInput += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolId) {
            const toolCall: ToolCall = {
              id: currentToolId,
              name: currentToolName,
              arguments: currentToolInput ? JSON.parse(currentToolInput) : {},
            };
            yield { type: 'tool_call', toolCall };
            currentToolId = '';
            currentToolName = '';
            currentToolInput = '';
          }
        } else if (event.type === 'message_delta') {
          const usage = (event as unknown as { usage?: { input_tokens: number; output_tokens: number } }).usage;
          if (usage) {
            const duration = Date.now() - start;
            this.updateStats(duration, usage.input_tokens, usage.output_tokens);
          }
        }
      }

      const finalMessage = await stream.finalMessage();
      const finishReason = finalMessage.stop_reason === 'tool_use' ? 'tool_calls' as const
        : finalMessage.stop_reason === 'max_tokens' ? 'length' as const
        : 'stop' as const;
      yield {
        type: 'done',
        finishReason,
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
          totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield { type: 'error', error: message };
    }
  }

  private extractSystem(messages: Message[]): {
    systemMessage: string | null;
    messages: Message[];
  } {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');
    const systemMessage =
      systemMessages.length > 0 ? systemMessages.map((m) => m.content).join('\n\n') : null;
    return { systemMessage, messages: otherMessages };
  }

  protected convertMessages(messages: Message[]): unknown[] {
    const converted: unknown[] = [];
    for (const msg of messages) {
      if (msg.role === 'tool') {
        converted.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId || generateId('tool'),
              content: msg.content,
            },
          ],
        });
      } else if (msg.role === 'assistant') {
        // Assistant messages with tool calls must include tool_use blocks
        // so the API can correlate tool results with the correct tool calls
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          const contentBlocks: unknown[] = [];
          if (msg.content) {
            contentBlocks.push({ type: 'text', text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          converted.push({
            role: 'assistant',
            content: contentBlocks,
          });
        } else {
          converted.push({
            role: 'assistant',
            content: msg.content,
          });
        }
      } else if (msg.role === 'user') {
        converted.push({
          role: 'user',
          content: msg.content,
        });
      }
    }
    return converted;
  }

  protected convertTools(tools: ToolDefinition[]): unknown[] | undefined {
    if (!tools.length) return undefined;
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
}
