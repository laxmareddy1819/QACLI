import { z } from 'zod';

// ── Key-Value Pair ──────────────────────────────────────────────────────────

export const KeyValuePairSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});
export type KeyValuePair = z.infer<typeof KeyValuePairSchema>;

// ── Authentication ──────────────────────────────────────────────────────────

export const RequestAuthSchema = z.object({
  type: z.enum(['none', 'bearer', 'basic', 'api-key']),
  bearerToken: z.string().optional(),
  basicUsername: z.string().optional(),
  basicPassword: z.string().optional(),
  apiKeyName: z.string().optional(),
  apiKeyValue: z.string().optional(),
  apiKeyIn: z.enum(['header', 'query']).optional(),
});
export type RequestAuth = z.infer<typeof RequestAuthSchema>;

// ── Request Body ────────────────────────────────────────────────────────────

export const RequestBodySchema = z.object({
  type: z.enum(['none', 'json', 'text', 'form-data', 'graphql']),
  raw: z.string().optional(),
  formData: z.array(KeyValuePairSchema).optional(),
  graphqlVariables: z.string().optional(),
});
export type RequestBody = z.infer<typeof RequestBodySchema>;

// ── Validation Rules ────────────────────────────────────────────────────────

export const ValidationRuleSchema = z.object({
  id: z.string(),
  type: z.enum(['status', 'header', 'body-contains', 'body-json-path', 'response-time', 'schema']),
  target: z.string().optional(),      // header name, JSON path, etc.
  operator: z.enum(['equals', 'not-equals', 'contains', 'not-contains', 'greater-than', 'less-than', 'exists', 'matches-regex']),
  expected: z.string(),
  enabled: z.boolean().default(true),
});
export type ValidationRule = z.infer<typeof ValidationRuleSchema>;

export const ValidationResultSchema = z.object({
  ruleId: z.string(),
  passed: z.boolean(),
  actual: z.string().optional(),
  message: z.string().optional(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

// ── HTTP Method ─────────────────────────────────────────────────────────────

export const HttpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

// ── API Request ─────────────────────────────────────────────────────────────

export const ApiRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  method: HttpMethodSchema,
  url: z.string(),                    // Supports {{variable}} placeholders
  headers: z.array(KeyValuePairSchema).default([]),
  queryParams: z.array(KeyValuePairSchema).default([]),
  body: RequestBodySchema.default({ type: 'none' }),
  auth: RequestAuthSchema.default({ type: 'none' }),
  validations: z.array(ValidationRuleSchema).default([]),
  preRequestScript: z.string().optional(),
  postResponseScript: z.string().optional(),
  timeout: z.number().optional(),     // ms
  followRedirects: z.boolean().default(true),
  sortOrder: z.number().default(0),
});
export type ApiRequest = z.infer<typeof ApiRequestSchema>;

// ── API Response ────────────────────────────────────────────────────────────

export const ApiResponseSchema = z.object({
  requestId: z.string(),
  status: z.number(),
  statusText: z.string(),
  headers: z.record(z.string()),
  body: z.string(),
  duration: z.number(),               // ms
  size: z.number(),                   // bytes
  timestamp: z.string(),
  validationResults: z.array(ValidationResultSchema).optional(),
});
export type ApiResponse = z.infer<typeof ApiResponseSchema>;

// ── Environment ─────────────────────────────────────────────────────────────

export const EnvironmentVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
  secret: z.boolean().default(false),
});
export type EnvironmentVariable = z.infer<typeof EnvironmentVariableSchema>;

export const ApiEnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  variables: z.array(EnvironmentVariableSchema).default([]),
});
export type ApiEnvironment = z.infer<typeof ApiEnvironmentSchema>;

// ── Folder ──────────────────────────────────────────────────────────────────

export const ApiFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  requests: z.array(ApiRequestSchema).default([]),
  sortOrder: z.number().default(0),
});
export type ApiFolder = z.infer<typeof ApiFolderSchema>;

// ── Collection ──────────────────────────────────────────────────────────────

export const ApiCollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultHeaders: z.array(KeyValuePairSchema).default([]),
  defaultAuth: RequestAuthSchema.optional(),
  folders: z.array(ApiFolderSchema).default([]),
  requests: z.array(ApiRequestSchema).default([]),  // Root-level requests (not in any folder)
  environments: z.array(ApiEnvironmentSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApiCollection = z.infer<typeof ApiCollectionSchema>;

// ── History ─────────────────────────────────────────────────────────────────

export const ApiHistoryEntrySchema = z.object({
  id: z.string(),
  request: ApiRequestSchema,
  response: ApiResponseSchema,
  collectionId: z.string().optional(),
  timestamp: z.string(),
});
export type ApiHistoryEntry = z.infer<typeof ApiHistoryEntrySchema>;

// ── Store Data ──────────────────────────────────────────────────────────────

export const ApiCollectionsDataSchema = z.object({
  collections: z.array(ApiCollectionSchema).default([]),
  history: z.array(ApiHistoryEntrySchema).default([]),
});
export type ApiCollectionsData = z.infer<typeof ApiCollectionsDataSchema>;
