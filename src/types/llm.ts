import { z } from 'zod';

// ── Provider ──────────────────────────────────────────────────────────────────

export const ProviderNameSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'xai',
  'ollama',
  'lmstudio',
  'custom',
]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const ProviderCapabilitiesSchema = z.object({
  streaming: z.boolean(),
  functionCalling: z.boolean(),
  vision: z.boolean(),
  maxTokens: z.number(),
  contextWindow: z.number(),
});
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  timeout: z.number().optional(),
  maxRetries: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ProviderHealthSchema = z.object({
  name: ProviderNameSchema,
  healthy: z.boolean(),
  lastCheck: z.number(),
  latency: z.number().optional(),
  errorCount: z.number().default(0),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const ProviderStatsSchema = z.object({
  totalRequests: z.number().default(0),
  successfulRequests: z.number().default(0),
  failedRequests: z.number().default(0),
  totalTokens: z.number().default(0),
  totalInputTokens: z.number().default(0),
  totalOutputTokens: z.number().default(0),
  averageLatency: z.number().default(0),
});
export type ProviderStats = z.infer<typeof ProviderStatsSchema>;

// ── Messages ──────────────────────────────────────────────────────────────────

export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    arguments: z.record(z.unknown()),
  })).optional(),
});
export type Message = z.infer<typeof MessageSchema>;

// ── Tools ─────────────────────────────────────────────────────────────────────

export const ToolParameterSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.any()),
  required: z.array(z.string()).optional(),
});
export type ToolParameter = z.infer<typeof ToolParameterSchema>;

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: ToolParameterSchema,
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.any()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  result: z.any(),
  isError: z.boolean().default(false),
});
export type ToolResult = z.infer<typeof ToolResultSchema>;

// ── Completion ────────────────────────────────────────────────────────────────

export const CompletionRequestSchema = z.object({
  messages: z.array(MessageSchema),
  tools: z.array(ToolDefinitionSchema).optional(),
  model: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  stream: z.boolean().optional(),
});
export type CompletionRequest = z.infer<typeof CompletionRequestSchema>;

export const FinishReasonSchema = z.enum([
  'stop',
  'length',
  'tool_calls',
  'content_filter',
  'error',
]);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

export const CompletionResponseSchema = z.object({
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  finishReason: FinishReasonSchema,
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    })
    .optional(),
});
export type CompletionResponse = z.infer<typeof CompletionResponseSchema>;

// ── Streaming ─────────────────────────────────────────────────────────────────

export const StreamChunkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({ type: z.literal('tool_call'), toolCall: ToolCallSchema }),
  z.object({ type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('status'), message: z.string() }),
  z.object({
    type: z.literal('done'),
    finishReason: FinishReasonSchema.optional(),
    usage: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number(),
      })
      .optional(),
  }),
]);
export type StreamChunk = z.infer<typeof StreamChunkSchema>;
