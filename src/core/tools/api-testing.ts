import type { ToolRegistration } from './registry.js';

export const apiRequestTool: ToolRegistration = {
  category: 'testing',
  definition: {
    name: 'api_request',
    description:
      'Send an HTTP request to a REST or GraphQL API endpoint. Returns status code, headers, response body, and timing information.',
    parameters: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        },
        url: {
          type: 'string',
          description: 'The full URL to send the request to (e.g., https://api.example.com/users)',
        },
        headers: {
          type: 'string',
          description: 'JSON string of headers object (e.g., {"Authorization": "Bearer token123", "Content-Type": "application/json"})',
        },
        body: {
          type: 'string',
          description: 'Request body content. For JSON, provide the JSON string directly. For GraphQL, provide the query string.',
        },
        content_type: {
          type: 'string',
          description: 'Content type: json (default), text, form, graphql',
          enum: ['json', 'text', 'form', 'graphql'],
        },
        query_params: {
          type: 'string',
          description: 'JSON string of query parameters (e.g., {"page": "1", "limit": "10"})',
        },
        auth_type: {
          type: 'string',
          description: 'Authentication type: none, bearer, basic',
          enum: ['none', 'bearer', 'basic'],
        },
        auth_value: {
          type: 'string',
          description: 'Auth value: token for bearer, "username:password" for basic',
        },
        timeout: {
          type: 'number',
          description: 'Request timeout in milliseconds (default: 30000)',
        },
        follow_redirects: {
          type: 'boolean',
          description: 'Whether to follow redirects (default: true)',
        },
      },
      required: ['method', 'url'],
    },
  },
  handler: async (args) => {
    const { executeRequest } = await import('../../ui/services/api-executor.js');
    const method = (args.method as string).toUpperCase();
    const url = args.url as string;
    const contentType = (args.content_type as string) || 'json';
    const timeout = (args.timeout as number) || 30000;
    const followRedirects = args.follow_redirects !== false;

    // Parse headers
    let headers: Array<{ key: string; value: string; enabled: boolean }> = [];
    if (args.headers) {
      try {
        const parsed = JSON.parse(args.headers as string);
        headers = Object.entries(parsed).map(([key, value]) => ({
          key,
          value: String(value),
          enabled: true,
        }));
      } catch {
        return `Error: Invalid headers JSON: ${args.headers}`;
      }
    }

    // Parse query params
    let queryParams: Array<{ key: string; value: string; enabled: boolean }> = [];
    if (args.query_params) {
      try {
        const parsed = JSON.parse(args.query_params as string);
        queryParams = Object.entries(parsed).map(([key, value]) => ({
          key,
          value: String(value),
          enabled: true,
        }));
      } catch {
        return `Error: Invalid query_params JSON: ${args.query_params}`;
      }
    }

    // Build body
    let bodyType: 'none' | 'json' | 'text' | 'form-data' | 'graphql' = 'none';
    let raw: string | undefined;
    let graphqlVariables: string | undefined;

    if (args.body) {
      switch (contentType) {
        case 'graphql':
          bodyType = 'graphql';
          raw = args.body as string;
          break;
        case 'text':
          bodyType = 'text';
          raw = args.body as string;
          break;
        case 'form':
          bodyType = 'form-data';
          raw = args.body as string;
          break;
        case 'json':
        default:
          bodyType = 'json';
          raw = args.body as string;
          break;
      }
    }

    // Build auth
    let auth: { type: 'none' | 'bearer' | 'basic' | 'api-key'; bearerToken?: string; basicUsername?: string; basicPassword?: string } = { type: 'none' };
    if (args.auth_type === 'bearer' && args.auth_value) {
      auth = { type: 'bearer', bearerToken: args.auth_value as string };
    } else if (args.auth_type === 'basic' && args.auth_value) {
      const [username, ...passwordParts] = (args.auth_value as string).split(':');
      auth = { type: 'basic', basicUsername: username, basicPassword: passwordParts.join(':') };
    }

    // Build ApiRequest object
    const request = {
      id: `cli-${Date.now()}`,
      name: `${method} ${url}`,
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
      url,
      headers,
      queryParams,
      body: { type: bodyType, raw, graphqlVariables },
      auth,
      validations: [],
      timeout,
      followRedirects,
      sortOrder: 0,
    };

    try {
      const response = await executeRequest(request);

      // Format output
      const lines: string[] = [];
      lines.push(`HTTP ${response.status} ${response.statusText}`);
      lines.push(`Duration: ${response.duration}ms | Size: ${formatBytes(response.size)}`);
      lines.push('');

      // Response headers (compact)
      lines.push('--- Headers ---');
      for (const [key, value] of Object.entries(response.headers)) {
        lines.push(`${key}: ${value}`);
      }
      lines.push('');

      // Response body
      lines.push('--- Body ---');
      // Try to pretty-print JSON
      try {
        const parsed = JSON.parse(response.body);
        const pretty = JSON.stringify(parsed, null, 2);
        // Truncate very large bodies
        if (pretty.length > 5000) {
          lines.push(pretty.slice(0, 5000));
          lines.push(`\n... (truncated, total ${formatBytes(response.size)})`);
        } else {
          lines.push(pretty);
        }
      } catch {
        // Not JSON — show raw (truncated)
        if (response.body.length > 5000) {
          lines.push(response.body.slice(0, 5000));
          lines.push(`\n... (truncated, total ${formatBytes(response.size)})`);
        } else {
          lines.push(response.body);
        }
      }

      return lines.join('\n');
    } catch (error) {
      return `Error executing request: ${String(error)}`;
    }
  },
};

export const apiValidateSchemaTool: ToolRegistration = {
  category: 'testing',
  definition: {
    name: 'api_validate_schema',
    description:
      'Validate a JSON response body against a JSON Schema or an OpenAPI component schema. Returns validation results.',
    parameters: {
      type: 'object',
      properties: {
        response_body: {
          type: 'string',
          description: 'The JSON response body to validate',
        },
        schema: {
          type: 'string',
          description: 'JSON Schema as a JSON string (e.g., {"type":"object","properties":{"id":{"type":"number"}}})',
        },
        schema_file: {
          type: 'string',
          description: 'Path to an OpenAPI specification file (JSON format)',
        },
        component_name: {
          type: 'string',
          description: 'Name of the component schema to use from the OpenAPI spec (e.g., "User", "Product")',
        },
      },
      required: ['response_body'],
    },
  },
  handler: async (args, ctx) => {
    const responseBody = args.response_body as string;

    // Parse the response body
    let data: unknown;
    try {
      data = JSON.parse(responseBody);
    } catch {
      return 'Error: response_body is not valid JSON';
    }

    // Get schema
    let schema: Record<string, unknown> | undefined;

    if (args.schema) {
      try {
        schema = JSON.parse(args.schema as string);
      } catch {
        return 'Error: schema is not valid JSON';
      }
    } else if (args.schema_file) {
      const { readFile } = await import('node:fs/promises');
      const { resolve } = await import('node:path');
      try {
        const filePath = resolve(ctx.workingDirectory, args.schema_file as string);
        const content = await readFile(filePath, 'utf-8');
        const spec = JSON.parse(content);

        // Extract component schema from OpenAPI spec
        const componentName = args.component_name as string;
        if (!componentName) {
          return 'Error: component_name is required when using schema_file';
        }

        // Try OpenAPI 3.x schemas
        schema = spec?.components?.schemas?.[componentName]
          || spec?.definitions?.[componentName]; // Swagger 2.x

        if (!schema) {
          const available = Object.keys(spec?.components?.schemas || spec?.definitions || {});
          return `Error: Component "${componentName}" not found in the spec.\nAvailable: ${available.join(', ') || 'none'}`;
        }
      } catch (error) {
        return `Error reading schema file: ${String(error)}`;
      }
    } else {
      return 'Error: Either "schema" (inline JSON Schema) or "schema_file" + "component_name" must be provided';
    }

    if (!schema) {
      return 'Error: No schema resolved';
    }

    // Perform lightweight validation
    try {
      const errors = validateJsonSchemaLightweight(data, schema, '');
      if (errors.length === 0) {
        return 'Valid: Response matches the schema.';
      }
      return `Invalid: ${errors.length} validation error(s):\n${errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`;
    } catch (error) {
      return `Error during validation: ${String(error)}`;
    }
  },
};

// ── Lightweight JSON Schema Validator ─────────────────────────────────────

function validateJsonSchemaLightweight(
  data: unknown,
  schema: Record<string, unknown>,
  path: string,
): string[] {
  const errors: string[] = [];
  const p = path || '$';

  // Type check
  if (schema.type) {
    const schemaType = schema.type as string;
    const actualType = getJsonType(data);
    if (schemaType === 'integer') {
      if (typeof data !== 'number' || !Number.isInteger(data)) {
        errors.push(`${p}: expected integer, got ${actualType}`);
        return errors;
      }
    } else if (actualType !== schemaType) {
      errors.push(`${p}: expected ${schemaType}, got ${actualType}`);
      return errors;
    }
  }

  // Enum
  if (schema.enum && Array.isArray(schema.enum)) {
    if (!(schema.enum as unknown[]).includes(data)) {
      errors.push(`${p}: value "${data}" not in enum [${(schema.enum as unknown[]).join(', ')}]`);
    }
  }

  // Object properties
  if (schema.type === 'object' && typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = (schema.required || []) as string[];

    // Check required
    for (const req of required) {
      if (!(req in obj)) {
        errors.push(`${p}: missing required property "${req}"`);
      }
    }

    // Validate each property
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in obj) {
        errors.push(...validateJsonSchemaLightweight(obj[key], propSchema, `${p}.${key}`));
      }
    }
  }

  // Array items
  if (schema.type === 'array' && Array.isArray(data)) {
    const itemSchema = schema.items as Record<string, unknown> | undefined;
    if (itemSchema) {
      for (let i = 0; i < data.length; i++) {
        errors.push(...validateJsonSchemaLightweight(data[i], itemSchema, `${p}[${i}]`));
      }
    }
    if (schema.minItems && data.length < (schema.minItems as number)) {
      errors.push(`${p}: array has ${data.length} items, minimum is ${schema.minItems}`);
    }
    if (schema.maxItems && data.length > (schema.maxItems as number)) {
      errors.push(`${p}: array has ${data.length} items, maximum is ${schema.maxItems}`);
    }
  }

  // String constraints
  if (schema.type === 'string' && typeof data === 'string') {
    if (schema.minLength && data.length < (schema.minLength as number)) {
      errors.push(`${p}: string length ${data.length} is less than minimum ${schema.minLength}`);
    }
    if (schema.maxLength && data.length > (schema.maxLength as number)) {
      errors.push(`${p}: string length ${data.length} exceeds maximum ${schema.maxLength}`);
    }
    if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern as string).test(data)) {
          errors.push(`${p}: string does not match pattern "${schema.pattern}"`);
        }
      } catch { /* ignore invalid regex */ }
    }
  }

  // Number constraints
  if ((schema.type === 'number' || schema.type === 'integer') && typeof data === 'number') {
    if (schema.minimum !== undefined && data < (schema.minimum as number)) {
      errors.push(`${p}: value ${data} is less than minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > (schema.maximum as number)) {
      errors.push(`${p}: value ${data} exceeds maximum ${schema.maximum}`);
    }
  }

  return errors;
}

function getJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export const apiTestingTools: ToolRegistration[] = [apiRequestTool, apiValidateSchemaTool];
