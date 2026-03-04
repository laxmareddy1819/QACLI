/**
 * Import Postman Collection v2.1 JSON format into the internal ApiCollection format.
 */

import type {
  ApiCollection, ApiRequest, ApiFolder, ApiEnvironment,
  KeyValuePair, RequestAuth, RequestBody, HttpMethod,
} from '../types/api-testing.js';

// ── Postman Types (subset) ──────────────────────────────────────────────────

interface PostmanCollection {
  info?: {
    name?: string;
    description?: string;
    schema?: string;
  };
  item?: PostmanItem[];
  auth?: PostmanAuth;
  variable?: PostmanVariable[];
}

interface PostmanItem {
  name?: string;
  request?: PostmanRequest;
  item?: PostmanItem[];  // Sub-folders
  description?: string;
}

interface PostmanRequest {
  method?: string;
  header?: PostmanHeader[];
  url?: PostmanUrl | string;
  body?: PostmanBody;
  auth?: PostmanAuth;
  description?: string;
}

interface PostmanHeader {
  key?: string;
  value?: string;
  disabled?: boolean;
  description?: string;
}

interface PostmanUrl {
  raw?: string;
  host?: string[];
  path?: string[];
  query?: Array<{ key?: string; value?: string; disabled?: boolean; description?: string }>;
  protocol?: string;
}

interface PostmanBody {
  mode?: string;
  raw?: string;
  urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  formdata?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } };
}

interface PostmanAuth {
  type?: string;
  bearer?: Array<{ key?: string; value?: string }>;
  basic?: Array<{ key?: string; value?: string }>;
  apikey?: Array<{ key?: string; value?: string }>;
}

interface PostmanVariable {
  key?: string;
  value?: string;
  disabled?: boolean;
  description?: string;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function importPostmanCollection(data: unknown): ApiCollection {
  const postman = data as PostmanCollection;

  const now = new Date().toISOString();
  const collection: ApiCollection = {
    id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: postman.info?.name || 'Imported Collection',
    description: postman.info?.description,
    defaultHeaders: [],
    defaultAuth: postman.auth ? convertAuth(postman.auth) : undefined,
    folders: [],
    requests: [],
    environments: [],
    createdAt: now,
    updatedAt: now,
  };

  // Convert variables to an environment
  if (postman.variable && postman.variable.length > 0) {
    const env: ApiEnvironment = {
      id: `env-${Date.now()}-imported`,
      name: 'Postman Variables',
      variables: postman.variable.map(v => ({
        key: v.key || '',
        value: v.value || '',
        enabled: !v.disabled,
        secret: false,
      })),
    };
    collection.environments.push(env);
  }

  // Convert items (recursive — handle nested folders)
  if (postman.item) {
    for (const item of postman.item) {
      if (isFolder(item)) {
        collection.folders.push(convertFolder(item));
      } else {
        const req = convertItem(item);
        if (req) collection.requests.push(req);
      }
    }
  }

  return collection;
}

// ── Internal Helpers ────────────────────────────────────────────────────────

function isFolder(item: PostmanItem): boolean {
  return !!item.item && Array.isArray(item.item);
}

function convertFolder(item: PostmanItem, order = 0): ApiFolder {
  const folder: ApiFolder = {
    id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: item.name || 'Folder',
    requests: [],
    sortOrder: order,
  };

  if (item.item) {
    for (const child of item.item) {
      // Nested folders are flattened (their requests are merged)
      if (isFolder(child)) {
        const subFolder = convertFolder(child);
        folder.requests.push(...subFolder.requests);
      } else {
        const req = convertItem(child);
        if (req) folder.requests.push(req);
      }
    }
  }

  return folder;
}

function convertItem(item: PostmanItem): ApiRequest | undefined {
  if (!item.request) return undefined;
  const pmReq = item.request;

  const method = (pmReq.method || 'GET').toUpperCase() as HttpMethod;
  const url = extractUrl(pmReq.url);
  const queryParams = extractQueryParams(pmReq.url);
  const headers = extractHeaders(pmReq.header);
  const body = extractBody(pmReq.body);
  const auth = pmReq.auth ? convertAuth(pmReq.auth) : { type: 'none' as const };

  return {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: item.name || `${method} ${url}`,
    method,
    url,
    headers,
    queryParams,
    body,
    auth,
    validations: [],
    followRedirects: true,
    sortOrder: 0,
  };
}

function extractUrl(url: PostmanUrl | string | undefined): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  if (url.raw) return url.raw.split('?')[0] || url.raw;

  const protocol = url.protocol || 'https';
  const host = url.host?.join('.') || '';
  const path = url.path?.join('/') || '';
  return `${protocol}://${host}/${path}`;
}

function extractQueryParams(url: PostmanUrl | string | undefined): KeyValuePair[] {
  if (!url || typeof url === 'string') {
    // Parse from raw URL string
    if (typeof url === 'string') {
      const qIdx = url.indexOf('?');
      if (qIdx >= 0) {
        const params = new URLSearchParams(url.slice(qIdx + 1));
        return Array.from(params.entries()).map(([key, value]) => ({
          key, value, enabled: true,
        }));
      }
    }
    return [];
  }

  return (url.query || []).map(q => ({
    key: q.key || '',
    value: q.value || '',
    enabled: !q.disabled,
    description: q.description,
  }));
}

function extractHeaders(headers: PostmanHeader[] | undefined): KeyValuePair[] {
  if (!headers) return [];
  return headers.map(h => ({
    key: h.key || '',
    value: h.value || '',
    enabled: !h.disabled,
    description: h.description,
  }));
}

function extractBody(body: PostmanBody | undefined): RequestBody {
  if (!body) return { type: 'none' };

  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language;
      if (lang === 'json' || (!lang && body.raw?.trim().startsWith('{'))) {
        return { type: 'json', raw: body.raw || '' };
      }
      return { type: 'text', raw: body.raw || '' };
    }
    case 'graphql':
      return {
        type: 'graphql',
        raw: body.graphql?.query || '',
        graphqlVariables: body.graphql?.variables,
      };
    case 'urlencoded':
    case 'formdata':
      return {
        type: 'form-data',
        formData: (body.urlencoded || body.formdata || []).map(f => ({
          key: f.key || '',
          value: f.value || '',
          enabled: !f.disabled,
        })),
      };
    default:
      return { type: 'none' };
  }
}

function convertAuth(auth: PostmanAuth): RequestAuth {
  switch (auth.type) {
    case 'bearer': {
      const token = auth.bearer?.find(b => b.key === 'token')?.value || '';
      return { type: 'bearer', bearerToken: token };
    }
    case 'basic': {
      const username = auth.basic?.find(b => b.key === 'username')?.value || '';
      const password = auth.basic?.find(b => b.key === 'password')?.value || '';
      return { type: 'basic', basicUsername: username, basicPassword: password };
    }
    case 'apikey': {
      const keyName = auth.apikey?.find(b => b.key === 'key')?.value || '';
      const keyValue = auth.apikey?.find(b => b.key === 'value')?.value || '';
      const keyIn = auth.apikey?.find(b => b.key === 'in')?.value || 'header';
      return {
        type: 'api-key',
        apiKeyName: keyName,
        apiKeyValue: keyValue,
        apiKeyIn: keyIn === 'query' ? 'query' : 'header',
      };
    }
    default:
      return { type: 'none' };
  }
}
