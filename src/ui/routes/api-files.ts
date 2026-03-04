import type { Express } from 'express';
import { readFile, writeFile, unlink, mkdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { ProjectScanner } from '../scanner/project-scanner.js';
import type { UIServerOptions } from '../server.js';
import { audit } from './audit-helper.js';

export function mountFileRoutes(
  app: Express,
  scanner: ProjectScanner,
  options: UIServerOptions,
): void {
  const projectPath = options.projectPath;

  // Resolve and validate path to prevent directory traversal
  function safePath(relPath: string): string | null {
    const full = resolve(projectPath, relPath);
    if (!full.startsWith(projectPath)) return null;
    return full;
  }

  // GET /api/files/*path — Read a file with metadata
  app.get('/api/files/*', async (req, res) => {
    try {
      const relPath = (req.params as any)[0] as string;
      if (!relPath) { res.status(400).json({ error: 'Path required' }); return; }

      const fullPath = safePath(relPath);
      if (!fullPath) { res.status(403).json({ error: 'Invalid path' }); return; }

      const content = await readFile(fullPath, 'utf-8');
      const metadata = scanner.getFileMetadata(relPath);

      res.json({
        path: relPath,
        content,
        metadata: metadata || undefined,
      });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
      } else {
        res.status(500).json({ error: String(error) });
      }
    }
  });

  // POST /api/files — Create a new file
  app.post('/api/files', async (req, res) => {
    try {
      const { path: relPath, content } = req.body;
      if (!relPath || content === undefined) {
        res.status(400).json({ error: 'path and content required' });
        return;
      }

      const fullPath = safePath(relPath);
      if (!fullPath) { res.status(403).json({ error: 'Invalid path' }); return; }

      if (existsSync(fullPath)) {
        res.status(409).json({ error: 'File already exists' });
        return;
      }

      const dir = dirname(fullPath);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });

      await writeFile(fullPath, content, 'utf-8');
      scanner.invalidateCache();

      audit(req, 'file.create', { resourceType: 'file', resourceId: relPath });
      res.status(201).json({ path: relPath, message: 'File created' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/files/*path — Update a file
  app.put('/api/files/*', async (req, res) => {
    try {
      const relPath = (req.params as any)[0] as string;
      const { content } = req.body;
      if (!relPath || content === undefined) {
        res.status(400).json({ error: 'Path and content required' });
        return;
      }

      const fullPath = safePath(relPath);
      if (!fullPath) { res.status(403).json({ error: 'Invalid path' }); return; }

      if (!existsSync(fullPath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      await writeFile(fullPath, content, 'utf-8');
      audit(req, 'file.update', { resourceType: 'file', resourceId: relPath });
      res.json({ path: relPath, message: 'File updated' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/files/*path — Delete a file
  app.delete('/api/files/*', async (req, res) => {
    try {
      const relPath = (req.params as any)[0] as string;
      if (!relPath) { res.status(400).json({ error: 'Path required' }); return; }

      const fullPath = safePath(relPath);
      if (!fullPath) { res.status(403).json({ error: 'Invalid path' }); return; }

      if (!existsSync(fullPath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const s = await stat(fullPath);
      if (s.isDirectory()) {
        res.status(400).json({ error: 'Cannot delete directory via this endpoint' });
        return;
      }

      await unlink(fullPath);
      scanner.invalidateCache();

      audit(req, 'file.delete', { resourceType: 'file', resourceId: relPath });
      res.json({ path: relPath, message: 'File deleted' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/files/search — Search file contents
  app.post('/api/files/search', async (req, res) => {
    try {
      const { pattern, maxResults } = req.body;
      if (!pattern) {
        res.status(400).json({ error: 'pattern required' });
        return;
      }

      const results = scanner.searchFiles(pattern, maxResults || 50);
      res.json({ results, count: results.length });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
