import type {
  ApiRequest, ApiResponse, KeyValuePair,
  RequestAuth, ValidationRule, ValidationResult,
} from '../types/api-testing.js';
import { validateJsonSchema } from './schema-validator.js';

// ── Variable Substitution ───────────────────────────────────────────────────

/**
 * Replace `{{variableName}}` placeholders in a template string.
 * Resolves from the provided variables map.
 */
export function resolveVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return vars[key] ?? `{{${key}}}`;
  });
}

/** Resolve variables in all enabled key-value pairs. */
function resolveKeyValues(pairs: KeyValuePair[], vars: Record<string, string>): KeyValuePair[] {
  return pairs
    .filter(p => p.enabled)
    .map(p => ({
      ...p,
      key: resolveVariables(p.key, vars),
      value: resolveVariables(p.value, vars),
    }));
}

// ── Auth Header Builder ─────────────────────────────────────────────────────

function buildAuthHeaders(auth: RequestAuth, vars: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (auth.type) {
    case 'bearer':
      if (auth.bearerToken) {
        headers['Authorization'] = `Bearer ${resolveVariables(auth.bearerToken, vars)}`;
      }
      break;
    case 'basic':
      if (auth.basicUsername && auth.basicPassword) {
        const user = resolveVariables(auth.basicUsername, vars);
        const pass = resolveVariables(auth.basicPassword, vars);
        headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
      }
      break;
    case 'api-key':
      if (auth.apiKeyName && auth.apiKeyValue && auth.apiKeyIn === 'header') {
        headers[resolveVariables(auth.apiKeyName, vars)] = resolveVariables(auth.apiKeyValue, vars);
      }
      break;
  }

  return headers;
}

// ── Build Fetch Options ─────────────────────────────────────────────────────

export interface FetchOptions {
  url: string;
  init: RequestInit;
}

export function buildFetchOptions(request: ApiRequest, vars: Record<string, string>): FetchOptions {
  let url = resolveVariables(request.url, vars);

  // Query parameters
  const queryParams = resolveKeyValues(request.queryParams, vars);
  if (queryParams.length > 0) {
    const separator = url.includes('?') ? '&' : '?';
    const qs = queryParams
      .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');
    url = `${url}${separator}${qs}`;
  }

  // API key in query string
  if (request.auth.type === 'api-key' && request.auth.apiKeyIn === 'query' && request.auth.apiKeyName && request.auth.apiKeyValue) {
    const separator = url.includes('?') ? '&' : '?';
    const keyName = resolveVariables(request.auth.apiKeyName, vars);
    const keyValue = resolveVariables(request.auth.apiKeyValue, vars);
    url = `${url}${separator}${encodeURIComponent(keyName)}=${encodeURIComponent(keyValue)}`;
  }

  // Headers
  const headers: Record<string, string> = {};
  for (const h of resolveKeyValues(request.headers, vars)) {
    headers[h.key] = h.value;
  }

  // Auth headers
  Object.assign(headers, buildAuthHeaders(request.auth, vars));

  // Body
  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    switch (request.body.type) {
      case 'json':
        if (request.body.raw) {
          body = resolveVariables(request.body.raw, vars);
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/json';
          }
        }
        break;
      case 'text':
        if (request.body.raw) {
          body = resolveVariables(request.body.raw, vars);
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'text/plain';
          }
        }
        break;
      case 'graphql': {
        const query = request.body.raw ? resolveVariables(request.body.raw, vars) : '';
        let variables: Record<string, unknown> = {};
        if (request.body.graphqlVariables) {
          try {
            variables = JSON.parse(resolveVariables(request.body.graphqlVariables, vars));
          } catch { /* ignore invalid JSON */ }
        }
        body = JSON.stringify({ query, variables });
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        break;
      }
      case 'form-data':
        if (request.body.formData) {
          const formPairs = resolveKeyValues(request.body.formData, vars);
          const params = new URLSearchParams();
          for (const p of formPairs) {
            params.append(p.key, p.value);
          }
          body = params.toString();
          if (!headers['Content-Type'] && !headers['content-type']) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
          }
        }
        break;
    }
  }

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: request.followRedirects ? 'follow' : 'manual',
  };

  if (body !== undefined) {
    init.body = body;
  }

  return { url, init };
}

// ── Execute Request ─────────────────────────────────────────────────────────

export async function executeRequest(
  request: ApiRequest,
  vars: Record<string, string> = {},
): Promise<ApiResponse> {
  const { url, init } = buildFetchOptions(request, vars);

  const timeout = request.timeout || 30000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  init.signal = controller.signal;

  const startTime = Date.now();
  let status = 0;
  let statusText = '';
  let responseHeaders: Record<string, string> = {};
  let responseBody = '';
  let size = 0;

  try {
    const resp = await fetch(url, init);
    status = resp.status;
    statusText = resp.statusText;

    // Capture response headers
    resp.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Read body
    responseBody = await resp.text();
    size = new TextEncoder().encode(responseBody).length;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      status = 0;
      statusText = 'Request Timeout';
      responseBody = `Request timed out after ${timeout}ms`;
    } else {
      status = 0;
      statusText = 'Network Error';
      responseBody = String(error);
    }
  } finally {
    clearTimeout(timer);
  }

  const duration = Date.now() - startTime;

  const apiResponse: ApiResponse = {
    requestId: request.id,
    status,
    statusText,
    headers: responseHeaders,
    body: responseBody,
    duration,
    size,
    timestamp: new Date().toISOString(),
  };

  // Run validations
  if (request.validations.length > 0) {
    apiResponse.validationResults = validateResponse(apiResponse, request.validations);
  }

  return apiResponse;
}

// ── Response Validation ─────────────────────────────────────────────────────

export function validateResponse(response: ApiResponse, rules: ValidationRule[]): ValidationResult[] {
  return rules.filter(r => r.enabled).map(rule => {
    try {
      switch (rule.type) {
        case 'status':
          return validateComparison(rule, String(response.status));

        case 'header': {
          const headerKey = rule.target?.toLowerCase() || '';
          const headerValue = Object.entries(response.headers)
            .find(([k]) => k.toLowerCase() === headerKey)?.[1] || '';
          return validateComparison(rule, headerValue);
        }

        case 'body-contains':
          return validateComparison(rule, response.body);

        case 'body-json-path': {
          const jsonPath = rule.target || '';
          let actual = '';
          try {
            const parsed = JSON.parse(response.body);
            actual = String(resolveJsonPath(parsed, jsonPath));
          } catch {
            return { ruleId: rule.id, passed: false, actual: '', message: 'Response is not valid JSON' };
          }
          return validateComparison(rule, actual);
        }

        case 'response-time':
          return validateComparison(rule, String(response.duration));

        case 'schema': {
          // Validate response body against an inline JSON Schema
          if (!rule.expected) {
            return { ruleId: rule.id, passed: false, message: 'No schema provided in "expected" field' };
          }
          try {
            const schemaObj = JSON.parse(rule.expected);
            let bodyData: unknown;
            try { bodyData = JSON.parse(response.body); } catch {
              return { ruleId: rule.id, passed: false, actual: response.body.slice(0, 200), message: 'Response body is not valid JSON' };
            }
            const schemaErrors = validateJsonSchema(bodyData, schemaObj);
            if (schemaErrors.length === 0) {
              return { ruleId: rule.id, passed: true };
            }
            return {
              ruleId: rule.id,
              passed: false,
              message: schemaErrors.map(e => `${e.path}: ${e.message}`).join('; '),
            };
          } catch (err) {
            return { ruleId: rule.id, passed: false, message: `Schema validation error: ${String(err)}` };
          }
        }

        default:
          return { ruleId: rule.id, passed: false, message: `Unknown rule type: ${rule.type}` };
      }
    } catch (err) {
      return { ruleId: rule.id, passed: false, message: `Validation error: ${String(err)}` };
    }
  });
}

function validateComparison(rule: ValidationRule, actual: string): ValidationResult {
  const expected = rule.expected;
  let passed = false;

  switch (rule.operator) {
    case 'equals':
      passed = actual === expected;
      break;
    case 'not-equals':
      passed = actual !== expected;
      break;
    case 'contains':
      passed = actual.includes(expected);
      break;
    case 'not-contains':
      passed = !actual.includes(expected);
      break;
    case 'greater-than':
      passed = parseFloat(actual) > parseFloat(expected);
      break;
    case 'less-than':
      passed = parseFloat(actual) < parseFloat(expected);
      break;
    case 'exists':
      passed = actual !== '' && actual !== 'undefined' && actual !== 'null';
      break;
    case 'matches-regex':
      try {
        passed = new RegExp(expected).test(actual);
      } catch {
        return { ruleId: rule.id, passed: false, actual, message: `Invalid regex: ${expected}` };
      }
      break;
  }

  return {
    ruleId: rule.id,
    passed,
    actual: actual.length > 500 ? actual.slice(0, 500) + '...' : actual,
    message: passed ? undefined : `Expected ${rule.operator} "${expected}", got "${actual.length > 100 ? actual.slice(0, 100) + '...' : actual}"`,
  };
}

// ── Simple JSON Path Resolver ───────────────────────────────────────────────

/**
 * Resolve a simple dot-notation JSON path like `$.data.items[0].name`.
 * Supports: dot notation, bracket notation, array indices.
 * Does NOT require an external dependency.
 */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  // Strip leading $. if present
  let cleanPath = path.startsWith('$.') ? path.slice(2) : path;
  if (cleanPath === '$' || cleanPath === '') return obj;

  // Tokenize: split on . and [] notation
  const tokens: string[] = [];
  let current = '';
  for (let i = 0; i < cleanPath.length; i++) {
    const ch = cleanPath[i]!;
    if (ch === '.') {
      if (current) tokens.push(current);
      current = '';
    } else if (ch === '[') {
      if (current) tokens.push(current);
      current = '';
      const end = cleanPath.indexOf(']', i);
      if (end < 0) break;
      tokens.push(cleanPath.slice(i + 1, end));
      i = end;
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  let result: unknown = obj;
  for (const token of tokens) {
    if (result == null) return undefined;
    if (typeof result === 'object') {
      result = (result as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }

  return result;
}

// ── Chain Execution ─────────────────────────────────────────────────────────

/** Result for each step of a chain execution. */
export interface ChainStepResult {
  index: number;
  request: ApiRequest;
  response: ApiResponse;
  extractedVars: Record<string, string>;
  error?: string;
}

/**
 * Execute a sequence of requests, passing runtime variables between them.
 * Pre-request scripts can read/set variables. Post-response scripts can extract
 * values from the response body (e.g., tokens, IDs) and inject them into
 * subsequent requests.
 *
 * Script DSL (sandboxed):
 *   get("key")                          → read a chain variable
 *   set("key", value)                   → set a chain variable
 *   jsonpath(body, "$.data.token")      → extract from response JSON
 *   setHeader("Authorization", value)   → set a header for the *current* request
 */
export async function executeChain(
  requests: ApiRequest[],
  initialVars: Record<string, string> = {},
  onStep?: (step: ChainStepResult) => void,
): Promise<ChainStepResult[]> {
  const vars = { ...initialVars };
  const results: ChainStepResult[] = [];

  for (let i = 0; i < requests.length; i++) {
    const request = { ...requests[i]! };
    // Deep-clone headers so preRequestScript mutations don't affect the original
    request.headers = request.headers.map(h => ({ ...h }));

    // ── Pre-request script ──────────────────────────────────────────────
    if (request.preRequestScript) {
      try {
        runScript(request.preRequestScript, {
          vars,
          response: null,
          request,
        });
      } catch (err) {
        const stepResult: ChainStepResult = {
          index: i,
          request,
          response: {
            requestId: request.id,
            status: 0,
            statusText: 'Script Error',
            headers: {},
            body: `Pre-request script error: ${String(err)}`,
            duration: 0,
            size: 0,
            timestamp: new Date().toISOString(),
          },
          extractedVars: {},
          error: `Pre-request script error: ${String(err)}`,
        };
        results.push(stepResult);
        onStep?.(stepResult);
        continue; // Skip this request but continue chain
      }
    }

    // ── Execute request ─────────────────────────────────────────────────
    const response = await executeRequest(request, vars);

    const extractedVars: Record<string, string> = {};

    // ── Post-response script ────────────────────────────────────────────
    if (request.postResponseScript) {
      try {
        const prevVarKeys = new Set(Object.keys(vars));
        runScript(request.postResponseScript, {
          vars,
          response,
          request,
        });
        // Track newly set variables
        for (const key of Object.keys(vars)) {
          if (!prevVarKeys.has(key) || vars[key] !== initialVars[key]) {
            extractedVars[key] = vars[key]!;
          }
        }
      } catch (err) {
        // Script error is non-fatal — response still captured
        const stepResult: ChainStepResult = {
          index: i,
          request,
          response,
          extractedVars,
          error: `Post-response script error: ${String(err)}`,
        };
        results.push(stepResult);
        onStep?.(stepResult);
        continue;
      }
    }

    const stepResult: ChainStepResult = {
      index: i,
      request,
      response,
      extractedVars,
    };
    results.push(stepResult);
    onStep?.(stepResult);
  }

  return results;
}

// ── Script Runner (Sandboxed) ───────────────────────────────────────────────

interface ScriptContext {
  vars: Record<string, string>;
  response: ApiResponse | null;
  request: ApiRequest;
}

/**
 * Run a user-provided script in a restricted sandbox.
 * Available functions: get, set, jsonpath, setHeader.
 */
function runScript(script: string, ctx: ScriptContext): void {
  const get = (key: string): string => ctx.vars[key] ?? '';
  const set = (key: string, value: unknown): void => {
    ctx.vars[key] = String(value);
  };
  const jsonpath = (body: string | unknown, path: string): unknown => {
    let parsed: unknown;
    if (typeof body === 'string') {
      try { parsed = JSON.parse(body); } catch { return undefined; }
    } else {
      parsed = body;
    }
    return resolveJsonPath(parsed, path);
  };
  const setHeader = (name: string, value: string): void => {
    const existing = ctx.request.headers.find(h => h.key.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.value = value;
    } else {
      ctx.request.headers.push({ key: name, value, enabled: true });
    }
  };

  // Build a response object the script can access
  const response = ctx.response ? {
    status: ctx.response.status,
    statusText: ctx.response.statusText,
    body: ctx.response.body,
    headers: ctx.response.headers,
    duration: ctx.response.duration,
  } : null;

  // Run in a sandboxed Function (no access to Node globals)
  const fn = new Function('get', 'set', 'jsonpath', 'setHeader', 'response', script);
  fn(get, set, jsonpath, setHeader, response);
}
