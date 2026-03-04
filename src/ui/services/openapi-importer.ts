/**
 * OpenAPI/Swagger importer — converts OpenAPI 3.x and Swagger 2.x specs to internal ApiCollection format.
 * Supports JSON format only (no YAML).
 */
import type {
  ApiCollection, ApiRequest, ApiFolder, KeyValuePair,
} from '../types/api-testing.js';
import { resolveRef } from './schema-validator.js';

export interface OpenApiEndpoint {
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  tags: string[];
  parameters: Array<{ name: string; in: string; required?: boolean; schema?: Record<string, unknown> }>;
  requestBody?: Record<string, unknown>;
  responses?: Record<string, unknown>;
}

/**
 * Extract a flat list of endpoints from an OpenAPI/Swagger spec for the picker UI
 */
export function extractEndpoints(content: string): OpenApiEndpoint[] {
  let spec: Record<string, unknown>;
  try { spec = JSON.parse(content); } catch { throw new Error('Invalid JSON'); }

  const endpoints: OpenApiEndpoint[] = [];
  const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;
  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of httpMethods) {
      const operation = pathItem[method] as Record<string, unknown> | undefined;
      if (!operation || typeof operation !== 'object') continue;

      const endpoint: OpenApiEndpoint = {
        path,
        method: method.toUpperCase(),
        operationId: operation.operationId as string | undefined,
        summary: (operation.summary || operation.description || '') as string,
        tags: (operation.tags || []) as string[],
        parameters: [],
        requestBody: operation.requestBody as Record<string, unknown> | undefined,
        responses: operation.responses as Record<string, unknown> | undefined,
      };

      // Merge path-level and operation-level parameters
      const pathParams = (pathItem.parameters || []) as Array<Record<string, unknown>>;
      const opParams = (operation.parameters || []) as Array<Record<string, unknown>>;
      const allParams = [...pathParams, ...opParams];

      for (const param of allParams) {
        const resolved = param.$ref ? resolveRef(param.$ref as string, spec) || param : param;
        endpoint.parameters.push({
          name: resolved.name as string,
          in: resolved.in as string,
          required: resolved.required as boolean | undefined,
          schema: resolved.schema as Record<string, unknown> | undefined,
        });
      }

      endpoints.push(endpoint);
    }
  }

  return endpoints;
}

/**
 * Import an OpenAPI/Swagger spec and convert to internal ApiCollection format
 */
export function importOpenApiSpec(content: string): ApiCollection {
  let spec: Record<string, unknown>;
  try { spec = JSON.parse(content); } catch { throw new Error('Failed to parse OpenAPI spec — only JSON format is supported'); }

  const info = (spec.info || {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  // Determine base URL
  let baseUrl = '';
  if (spec.servers && Array.isArray(spec.servers) && spec.servers.length > 0) {
    // OpenAPI 3.x
    baseUrl = (spec.servers[0] as Record<string, unknown>).url as string || '';
  } else if (spec.host) {
    // Swagger 2.x
    const scheme = Array.isArray(spec.schemes) && spec.schemes.length > 0 ? spec.schemes[0] : 'https';
    const basePath = (spec.basePath || '') as string;
    baseUrl = `${scheme}://${spec.host}${basePath}`;
  }

  const collection: ApiCollection = {
    id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: (info.title as string) || 'Imported API',
    description: (info.description as string) || undefined,
    baseUrl,
    defaultHeaders: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    folders: [],
    requests: [],
    environments: [],
    createdAt: now,
    updatedAt: now,
  };

  const endpoints = extractEndpoints(content);

  // Group by tags into folders
  const tagMap = new Map<string, ApiRequest[]>();
  const untagged: ApiRequest[] = [];

  for (const ep of endpoints) {
    const req = endpointToRequest(ep, spec, baseUrl);
    if (ep.tags.length > 0) {
      const tag = ep.tags[0]!;
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag)!.push(req);
    } else {
      untagged.push(req);
    }
  }

  // Create folders from tags
  let sortOrder = 0;
  for (const [tag, requests] of tagMap) {
    const folder: ApiFolder = {
      id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${sortOrder}`,
      name: tag,
      requests: requests.map((r, i) => ({ ...r, sortOrder: i })),
      sortOrder: sortOrder++,
    };
    collection.folders.push(folder);
  }

  // Root-level untagged requests
  collection.requests = untagged.map((r, i) => ({ ...r, sortOrder: i }));

  return collection;
}

function endpointToRequest(ep: OpenApiEndpoint, spec: Record<string, unknown>, baseUrl: string): ApiRequest {
  const headers: KeyValuePair[] = [];
  const queryParams: KeyValuePair[] = [];
  let url = ep.path;

  // Process parameters
  for (const param of ep.parameters) {
    if (param.in === 'query') {
      queryParams.push({
        key: param.name,
        value: getExampleValue(param.schema),
        enabled: param.required || false,
      });
    } else if (param.in === 'header') {
      headers.push({
        key: param.name,
        value: getExampleValue(param.schema),
        enabled: true,
      });
    } else if (param.in === 'path') {
      // Replace {param} in URL with placeholder
      url = url.replace(`{${param.name}}`, `{{${param.name}}}`);
    }
  }

  // Process request body
  let bodyType: 'none' | 'json' | 'form-urlencoded' | 'form-data' | 'raw' = 'none';
  let bodyContent = '';

  if (ep.requestBody) {
    const reqBody = ep.requestBody.$ref
      ? resolveRef(ep.requestBody.$ref as string, spec) || ep.requestBody
      : ep.requestBody;

    const content = (reqBody as any).content as Record<string, unknown> | undefined;
    if (content) {
      if (content['application/json']) {
        bodyType = 'json';
        const mediaType = content['application/json'] as Record<string, unknown>;
        const schema = mediaType.schema as Record<string, unknown> | undefined;
        if (schema) {
          const resolved = schema.$ref ? resolveRef(schema.$ref as string, spec) || schema : schema;
          bodyContent = generateExampleFromSchema(resolved, spec);
        }
      } else if (content['application/x-www-form-urlencoded']) {
        bodyType = 'form-urlencoded';
      } else if (content['multipart/form-data']) {
        bodyType = 'form-data';
      }
    }
  }

  // Build full URL with base
  const fullUrl = baseUrl ? `{{baseUrl}}${url}` : url;

  return {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 4)}`,
    name: ep.summary || ep.operationId || `${ep.method} ${ep.path}`,
    method: ep.method as any,
    url: fullUrl,
    headers,
    queryParams,
    body: bodyType === 'none' ? { type: 'none' } : { type: bodyType, raw: bodyContent },
    auth: { type: 'none' },
    validations: [],
    followRedirects: true,
    sortOrder: 0,
  };
}

function getExampleValue(schema?: Record<string, unknown>): string {
  if (!schema) return '';
  if (schema.example !== undefined) return String(schema.example);
  if (schema.default !== undefined) return String(schema.default);

  switch (schema.type) {
    case 'string': return schema.format === 'email' ? 'user@example.com' : schema.format === 'uuid' ? '00000000-0000-0000-0000-000000000000' : 'string';
    case 'integer': case 'number': return '0';
    case 'boolean': return 'true';
    default: return '';
  }
}

function generateExampleFromSchema(schema: Record<string, unknown>, spec: Record<string, unknown>): string {
  try {
    const example = buildExample(schema, spec, 0);
    return JSON.stringify(example, null, 2);
  } catch {
    return '{}';
  }
}

function buildExample(schema: Record<string, unknown>, spec: Record<string, unknown>, depth: number): unknown {
  if (depth > 5) return null; // Prevent infinite recursion

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref as string, spec);
    if (resolved) return buildExample(resolved, spec, depth + 1);
    return null;
  }

  if (schema.example !== undefined) return schema.example;

  const type = schema.type as string;
  if (type === 'object' || schema.properties) {
    const obj: Record<string, unknown> = {};
    const props = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    for (const [key, propSchema] of Object.entries(props)) {
      obj[key] = buildExample(propSchema, spec, depth + 1);
    }
    return obj;
  }

  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items) {
      return [buildExample(items, spec, depth + 1)];
    }
    return [];
  }

  if (type === 'string') {
    if (schema.enum && Array.isArray(schema.enum)) return schema.enum[0];
    if (schema.format === 'date') return '2024-01-01';
    if (schema.format === 'date-time') return '2024-01-01T00:00:00Z';
    if (schema.format === 'email') return 'user@example.com';
    if (schema.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
    return 'string';
  }
  if (type === 'integer') return schema.minimum !== undefined ? schema.minimum : 0;
  if (type === 'number') return schema.minimum !== undefined ? schema.minimum : 0.0;
  if (type === 'boolean') return true;
  if (type === 'null') return null;

  return null;
}
