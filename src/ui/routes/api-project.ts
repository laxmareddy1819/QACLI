import type { Express } from 'express';
import type { ProjectScanner } from '../scanner/project-scanner.js';
import type { UIServerOptions } from '../server.js';

export function mountProjectRoutes(
  app: Express,
  scanner: ProjectScanner,
  _options: UIServerOptions,
): void {
  // GET /api/project — Full project info with modules
  app.get('/api/project', async (_req, res) => {
    try {
      const info = await scanner.getInfo();
      res.json(info);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/project/rescan — Force rescan
  app.get('/api/project/rescan', async (_req, res) => {
    try {
      scanner.invalidateCache();
      const info = await scanner.scan();
      res.json(info);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/project/tree — Full recursive file tree
  app.get('/api/project/tree', async (_req, res) => {
    try {
      const tree = scanner.buildFileTree();
      res.json(tree);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/project/modules/:id/files — List files for a module
  app.get('/api/project/modules/:id/files', async (req, res) => {
    try {
      const info = await scanner.getInfo();
      const mod = info.modules.find(m => m.id === req.params.id);
      if (!mod) {
        res.status(404).json({ error: `Module not found: ${req.params.id}` });
        return;
      }
      const files = scanner.listModuleFiles(mod.path);
      res.json({ module: mod, files });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
