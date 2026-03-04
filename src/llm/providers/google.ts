import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
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

export class GoogleProvider extends BaseLLMProvider {
  readonly name = 'google' as const;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    functionCalling: true,
    vision: true,
    maxTokens: 16384,
    contextWindow: 1000000,
  };

  private genAI!: GoogleGenerativeAI;

  protected async setup(): Promise<void> {
    this.genAI = new GoogleGenerativeAI(this.config.apiKey || '');
  }

  private getModel(request: CompletionRequest): GenerativeModel {
    const modelName = request.model || this.config.model || 'gemini-2.0-flash';
    const { systemMessage } = this.extractSystem(request.messages);
    const tools = this.convertTools(request.tools || []);

    return this.genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: systemMessage || undefined,
      tools: tools ? [{ functionDeclarations: tools as never }] : undefined,
      generationConfig: {
        temperature: request.temperature ?? this.config.temperature,
        maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
      },
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.ensureReady();
    const start = Date.now();
    const model = this.getModel(request);
    const { messages } = this.extractSystem(request.messages);

    try {
      const chat = model.startChat({
        history: this.convertMessages(messages.slice(0, -1)) as never,
      });

      const lastMsg = messages[messages.length - 1];
      const result = await chat.sendMessage(lastMsg?.content || '');
      const response = result.response;

      let content = '';
      const toolCalls: ToolCall[] = [];

      for (const candidate of response.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if ('text' in part && part.text) {
            content += part.text;
          } else if ('functionCall' in part && part.functionCall) {
            toolCalls.push({
              id: generateId('call'),
              name: part.functionCall.name,
              arguments: (part.functionCall.args as Record<string, unknown>) || {},
            });
          }
        }
      }

      const duration = Date.now() - start;
      const usage = response.usageMetadata;
      this.updateStats(
        duration,
        usage?.promptTokenCount,
        usage?.candidatesTokenCount,
      );

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        usage: usage
          ? {
              inputTokens: usage.promptTokenCount || 0,
              outputTokens: usage.candidatesTokenCount || 0,
              totalTokens: usage.totalTokenCount || 0,
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
    const model = this.getModel(request);
    const { messages } = this.extractSystem(request.messages);

    try {
      const chat = model.startChat({
        history: this.convertMessages(messages.slice(0, -1)) as never,
      });

      const lastMsg = messages[messages.length - 1];
      const result = await chat.sendMessageStream(lastMsg?.content || '');

      for await (const chunk of result.stream) {
        for (const candidate of chunk.candidates || []) {
          for (const part of candidate.content?.parts || []) {
            if ('text' in part && part.text) {
              yield { type: 'text', content: part.text };
            } else if ('functionCall' in part && part.functionCall) {
              const toolCall: ToolCall = {
                id: generateId('call'),
                name: part.functionCall.name,
                arguments: (part.functionCall.args as Record<string, unknown>) || {},
              };
              yield { type: 'tool_call', toolCall };
            }
          }
        }
      }

      const response = await result.response;
      const usage = response.usageMetadata;
      const duration = Date.now() - start;
      if (usage) {
        this.updateStats(duration, usage.promptTokenCount, usage.candidatesTokenCount);
      }

      // Determine finish reason from the final response candidates
      let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop';
      const candidates = response.candidates || [];
      if (candidates.length > 0) {
        const reason = candidates[0]?.finishReason;
        if (reason === 'MAX_TOKENS') finishReason = 'length';
        else if (candidates[0]?.content?.parts?.some((p: any) => 'functionCall' in p)) finishReason = 'tool_calls';
      }

      yield {
        type: 'done',
        finishReason,
        usage: usage
          ? {
              inputTokens: usage.promptTokenCount || 0,
              outputTokens: usage.candidatesTokenCount || 0,
              totalTokens: usage.totalTokenCount || 0,
            }
          : undefined,
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
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: msg.name || 'tool_result',
                response: { result: msg.content },
              },
            },
          ],
        };
      }
      // Model messages with tool calls must include functionCall parts
      // so the API can correlate function responses with the correct calls
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        const parts: unknown[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments,
            },
          });
        }
        return { role: 'model', parts };
      }
      return {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      };
    });
  }

  protected convertTools(tools: ToolDefinition[]): unknown[] | undefined {
    if (!tools.length) return undefined;
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }
}
