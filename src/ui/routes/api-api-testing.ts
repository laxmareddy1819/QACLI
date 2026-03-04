import type { Express } from 'express';
import type { ApiCollectionsStore } from '../store/api-collections-store.js';
import { executeRequest, executeChain, validateResponse } from '../services/api-executor.js';
import type {
  ApiCollection, ApiRequest, ApiFolder, ApiEnvironment,
  EnvironmentVariable,
} from '../types/api-testing.js';

export function mountApiTestingRoutes(
  app: Express,
  store: ApiCollectionsStore,
): void {

  // ── Collections CRUD ──────────────────────────────────────────────────────

  // GET /api/api-testing/collections — List all collections
  app.get('/api/api-testing/collections', (_req, res) => {
    const collections = store.getCollections();
    // Return summaries without full request/folder data for list view
    const summaries = collections.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      baseUrl: c.baseUrl,
      requestCount: c.requests.length + c.folders.reduce((sum, f) => sum + f.requests.length, 0),
      folderCount: c.folders.length,
      environmentCount: c.environments.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
    res.json({ collections: summaries });
  });

  // GET /api/api-testing/collections/:id — Get full collection
  app.get('/api/api-testing/collections/:id', (req, res) => {
    const col = store.getCollection(req.params.id!);
    if (!col) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.json(col);
  });

  // POST /api/api-testing/collections — Create collection
  app.post('/api/api-testing/collections', (req, res) => {
    try {
      const { name, description, baseUrl } = req.body;
      if (!name) {
        res.status(400).json({ error: 'Collection name is required' });
        return;
      }
      const now = new Date().toISOString();
      const collection: ApiCollection = {
        id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        description: description || undefined,
        baseUrl: baseUrl || undefined,
        defaultHeaders: [],
        folders: [],
        requests: [],
        environments: [],
        createdAt: now,
        updatedAt: now,
      };
      const created = store.createCollection(collection);
      res.status(201).json(created);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/api-testing/collections/:id — Update collection
  app.put('/api/api-testing/collections/:id', (req, res) => {
    const updated = store.updateCollection(req.params.id!, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.json(updated);
  });

  // DELETE /api/api-testing/collections/:id — Delete collection
  app.delete('/api/api-testing/collections/:id', (req, res) => {
    const deleted = store.deleteCollection(req.params.id!);
    if (!deleted) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.json({ success: true });
  });

  // ── Requests ──────────────────────────────────────────────────────────────

  // POST /api/api-testing/collections/:id/requests — Create/update request
  app.post('/api/api-testing/collections/:id/requests', (req, res) => {
    const { request, folderId } = req.body;
    if (!request) {
      res.status(400).json({ error: 'Request object is required' });
      return;
    }
    // Ensure ID
    if (!request.id) {
      request.id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    const saved = store.saveRequest(req.params.id!, request, folderId);
    if (!saved) {
      res.status(404).json({ error: 'Collection or folder not found' });
      return;
    }
    res.json(saved);
  });

  // DELETE /api/api-testing/collections/:id/requests/:rid — Delete request
  app.delete('/api/api-testing/collections/:id/requests/:rid', (req, res) => {
    const deleted = store.deleteRequest(req.params.id!, req.params.rid!);
    if (!deleted) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    res.json({ success: true });
  });

  // ── Folders ───────────────────────────────────────────────────────────────

  // POST /api/api-testing/collections/:id/folders — Create folder
  app.post('/api/api-testing/collections/:id/folders', (req, res) => {
    const { name } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Folder name is required' });
      return;
    }
    const folder: ApiFolder = {
      id: `fld-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      requests: [],
      sortOrder: 0,
    };
    const created = store.createFolder(req.params.id!, folder);
    if (!created) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.status(201).json(created);
  });

  // PUT /api/api-testing/collections/:id/folders/:fid — Update folder
  app.put('/api/api-testing/collections/:id/folders/:fid', (req, res) => {
    const updated = store.updateFolder(req.params.id!, req.params.fid!, req.body);
    if (!updated) {
      res.status(404).json({ error: 'Collection or folder not found' });
      return;
    }
    res.json(updated);
  });

  // DELETE /api/api-testing/collections/:id/folders/:fid — Delete folder
  app.delete('/api/api-testing/collections/:id/folders/:fid', (req, res) => {
    const deleted = store.deleteFolder(req.params.id!, req.params.fid!);
    if (!deleted) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    res.json({ success: true });
  });

  // ── Environments ──────────────────────────────────────────────────────────

  // GET /api/api-testing/collections/:id/environments
  app.get('/api/api-testing/collections/:id/environments', (req, res) => {
    const envs = store.getEnvironments(req.params.id!);
    res.json({ environments: envs });
  });

  // POST /api/api-testing/collections/:id/environments
  app.post('/api/api-testing/collections/:id/environments', (req, res) => {
    const { id, name, variables } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Environment name is required' });
      return;
    }
    const env: ApiEnvironment = {
      id: id || `env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      variables: variables || [],
    };
    const saved = store.saveEnvironment(req.params.id!, env);
    if (!saved) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.status(201).json(saved);
  });

  // PUT /api/api-testing/collections/:id/environments/:eid
  app.put('/api/api-testing/collections/:id/environments/:eid', (req, res) => {
    const env: ApiEnvironment = {
      ...req.body,
      id: req.params.eid!,
    };
    const saved = store.saveEnvironment(req.params.id!, env);
    if (!saved) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.json(saved);
  });

  // DELETE /api/api-testing/collections/:id/environments/:eid
  app.delete('/api/api-testing/collections/:id/environments/:eid', (req, res) => {
    const deleted = store.deleteEnvironment(req.params.id!, req.params.eid!);
    if (!deleted) {
      res.status(404).json({ error: 'Environment not found' });
      return;
    }
    res.json({ success: true });
  });

  // ── Execute ───────────────────────────────────────────────────────────────

  // POST /api/api-testing/send — Execute a single request
  app.post('/api/api-testing/send', async (req, res) => {
    const { request, variables, collectionId } = req.body;
    if (!request) {
      res.status(400).json({ error: 'Request object is required' });
      return;
    }

    try {
      const vars: Record<string, string> = variables || {};
      const response = await executeRequest(request as ApiRequest, vars);

      // Add to history
      store.addHistoryEntry(request, response, collectionId);

      res.json(response);
    } catch (error) {
      res.status(500).json({ error: `Request execution failed: ${String(error)}` });
    }
  });

  // POST /api/api-testing/send-chain — Execute a chain of requests
  app.post('/api/api-testing/send-chain', async (req, res) => {
    const { requests, variables } = req.body;
    if (!requests || !Array.isArray(requests) || requests.length === 0) {
      res.status(400).json({ error: 'At least one request is required' });
      return;
    }

    try {
      const vars: Record<string, string> = variables || {};
      const steps = await executeChain(requests as ApiRequest[], vars);
      res.json({
        steps,
        responses: steps.map(s => s.response),
      });
    } catch (error) {
      res.status(500).json({ error: `Chain execution failed: ${String(error)}` });
    }
  });

  // POST /api/api-testing/validate-schema — Validate response against schema
  app.post('/api/api-testing/validate-schema', (req, res) => {
    const { response, rules } = req.body;
    if (!response || !rules) {
      res.status(400).json({ error: 'Response and rules are required' });
      return;
    }

    try {
      const results = validateResponse(response, rules);
      res.json({ results });
    } catch (error) {
      res.status(500).json({ error: `Validation failed: ${String(error)}` });
    }
  });

  // ── History ───────────────────────────────────────────────────────────────

  // GET /api/api-testing/history
  app.get('/api/api-testing/history', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const history = store.getHistory(limit);
    res.json({ history, count: history.length });
  });

  // DELETE /api/api-testing/history — Clear history
  app.delete('/api/api-testing/history', (_req, res) => {
    store.clearHistory();
    res.json({ success: true });
  });

  // ── Import/Export ─────────────────────────────────────────────────────────

  // POST /api/api-testing/import — Import a collection (Postman or native format)
  app.post('/api/api-testing/import', async (req, res) => {
    const { data, format } = req.body;
    if (!data) {
      res.status(400).json({ error: 'Import data is required' });
      return;
    }

    try {
      let collection: ApiCollection;

      if (format === 'postman') {
        const { importPostmanCollection } = await import('../services/postman-importer.js');
        collection = importPostmanCollection(data);
      } else if (format === 'openapi' || format === 'swagger') {
        const { importOpenApiSpec } = await import('../services/openapi-importer.js');
        collection = importOpenApiSpec(typeof data === 'string' ? data : JSON.stringify(data));
      } else {
        // Native format — validate and store directly
        collection = data as ApiCollection;
        if (!collection.id) {
          collection.id = `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }
        if (!collection.createdAt) {
          collection.createdAt = new Date().toISOString();
        }
        collection.updatedAt = new Date().toISOString();
      }

      const imported = store.importCollection(collection);
      res.status(201).json(imported);
    } catch (error) {
      res.status(500).json({ error: `Import failed: ${String(error)}` });
    }
  });

  // POST /api/api-testing/parse-spec — Parse an API spec without importing
  app.post('/api/api-testing/parse-spec', async (req, res) => {
    const { content, format } = req.body;
    if (!content) {
      res.status(400).json({ error: 'Spec content is required' });
      return;
    }

    try {
      const raw = typeof content === 'string' ? content : JSON.stringify(content);
      let spec: Record<string, unknown>;
      try { spec = JSON.parse(raw); } catch { res.status(400).json({ error: 'Invalid JSON' }); return; }

      // Auto-detect format
      const isOpenApi = !!(spec.openapi || spec.swagger);
      const isPostman = !!(spec.info && (spec as any).item);

      if (format === 'postman' || (!format && isPostman && !isOpenApi)) {
        const { importPostmanCollection } = await import('../services/postman-importer.js');
        const collection = importPostmanCollection(spec);
        const endpoints = extractEndpointsFromCollection(collection);
        res.json({ format: 'postman', collection, endpoints, specName: collection.name });
        return;
      }

      if (format === 'openapi' || format === 'swagger' || isOpenApi) {
        const { importOpenApiSpec, extractEndpoints } = await import('../services/openapi-importer.js');
        const endpoints = extractEndpoints(raw);
        const collection = importOpenApiSpec(raw);
        res.json({ format: 'openapi', collection, endpoints, specName: collection.name });
        return;
      }

      // Try native format
      res.json({ format: 'native', collection: spec, endpoints: extractEndpointsFromCollection(spec as any), specName: (spec as any).name || 'Imported' });
    } catch (error) {
      res.status(500).json({ error: `Parse failed: ${String(error)}` });
    }
  });

  // GET /api/api-testing/collections/:id/export — Export collection
  app.get('/api/api-testing/collections/:id/export', (req, res) => {
    const col = store.exportCollection(req.params.id!);
    if (!col) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${col.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.json"`);
    res.json(col);
  });
}

/** Helper to extract endpoint list from a collection */
function extractEndpointsFromCollection(col: ApiCollection): Array<{ method: string; path: string; name: string; folder?: string }> {
  const endpoints: Array<{ method: string; path: string; name: string; folder?: string }> = [];
  if (col.requests) {
    for (const req of col.requests) {
      endpoints.push({ method: req.method, path: req.url, name: req.name });
    }
  }
  if (col.folders) {
    for (const folder of col.folders) {
      for (const req of folder.requests) {
        endpoints.push({ method: req.method, path: req.url, name: req.name, folder: folder.name });
      }
    }
  }
  return endpoints;
}
