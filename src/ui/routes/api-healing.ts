import type { Express } from 'express';
import type { HealingStore } from '../../healing/store.js';

export function mountHealingRoutes(
  app: Express,
  healingStore: HealingStore | null,
): void {

  // GET /api/healing/stats — Healing statistics
  app.get('/api/healing/stats', (_req, res) => {
    if (!healingStore) {
      res.json({ total: 0, successCount: 0, failureCount: 0, successRate: 0, available: false });
      return;
    }

    try {
      const stats = healingStore.getStats();
      const total = stats.totalSuccess + stats.totalFailure;
      res.json({
        total: stats.total,
        successCount: stats.totalSuccess,
        failureCount: stats.totalFailure,
        successRate: total > 0 ? Math.round((stats.totalSuccess / total) * 10000) / 100 : 0,
        available: true,
      });
    } catch {
      res.json({ total: 0, successCount: 0, failureCount: 0, successRate: 0, available: false });
    }
  });

  // GET /api/healing/fingerprints — All stored fingerprints with search/pagination
  app.get('/api/healing/fingerprints', (req, res) => {
    if (!healingStore) {
      res.json({ fingerprints: [], total: 0 });
      return;
    }

    try {
      const search = req.query.search as string | undefined;
      const url = req.query.url as string | undefined;
      let fingerprints = url ? healingStore.getByUrl(url) : healingStore.getAll();

      if (search) {
        const q = search.toLowerCase();
        fingerprints = fingerprints.filter(fp =>
          fp.selectorKey.toLowerCase().includes(q) ||
          fp.url.toLowerCase().includes(q),
        );
      }

      const total = fingerprints.length;
      const offset = parseInt(req.query.offset as string || '0', 10);
      const limit = parseInt(req.query.limit as string || '50', 10);
      fingerprints = fingerprints.slice(offset, offset + limit);

      res.json({ fingerprints, total });
    } catch {
      res.json({ fingerprints: [], total: 0 });
    }
  });

  // DELETE /api/healing/fingerprints/:id — Delete a stored fingerprint
  app.delete('/api/healing/fingerprints/:id', (req, res) => {
    if (!healingStore) {
      res.status(503).json({ error: 'Healing store not available' });
      return;
    }

    try {
      healingStore.deleteFingerprint(req.params.id!);
      res.json({ deleted: true });
    } catch (error) {
      res.status(500).json({ error: `Failed to delete fingerprint: ${error}` });
    }
  });

  // GET /api/healing/by-url — Fingerprints for a specific URL
  app.get('/api/healing/by-url', (req, res) => {
    if (!healingStore) {
      res.json({ fingerprints: [], count: 0 });
      return;
    }

    const url = req.query.url as string;
    if (!url) {
      res.status(400).json({ error: 'url query parameter required' });
      return;
    }

    try {
      const fingerprints = healingStore.getByUrl(url);
      res.json({ fingerprints, count: fingerprints.length });
    } catch {
      res.json({ fingerprints: [], count: 0 });
    }
  });

  // GET /api/healing/problematic — Selectors with high failure rates
  app.get('/api/healing/problematic', (_req, res) => {
    if (!healingStore) {
      res.json({ problematic: [], count: 0 });
      return;
    }

    try {
      const stats = healingStore.getStats();
      res.json({
        total: stats.total,
        highFailureRate: stats.totalFailure > stats.totalSuccess,
        successRate: (stats.totalSuccess + stats.totalFailure) > 0
          ? Math.round((stats.totalSuccess / (stats.totalSuccess + stats.totalFailure)) * 100)
          : 0,
      });
    } catch {
      res.json({ problematic: [], count: 0 });
    }
  });

  // GET /api/healing/config — Read healing configuration
  app.get('/api/healing/config', async (_req, res) => {
    try {
      const { getConfig } = await import('../../config/config.js');
      const config = getConfig();
      const healing = config.getHealingConfig();
      res.json({
        enabled: healing.enabled,
        confidenceThreshold: healing.confidenceThreshold,
        aiEnabled: (healing as any).aiEnabled ?? true,
        retentionDays: (healing as any).retentionDays ?? 90,
      });
    } catch {
      res.json({ enabled: true, confidenceThreshold: 0.7, aiEnabled: true, retentionDays: 90 });
    }
  });

  // PUT /api/healing/config — Update healing configuration
  app.put('/api/healing/config', async (req, res) => {
    try {
      const { getConfig } = await import('../../config/config.js');
      const config = getConfig();
      const { enabled, confidenceThreshold, aiEnabled, retentionDays } = req.body;

      if (enabled !== undefined) config.set('healing.enabled', enabled);
      if (confidenceThreshold !== undefined) config.set('healing.confidenceThreshold', confidenceThreshold);
      if (aiEnabled !== undefined) config.set('healing.aiEnabled', aiEnabled);
      if (retentionDays !== undefined) config.set('healing.retentionDays', retentionDays);

      const healing = config.getHealingConfig();
      res.json({
        saved: true,
        config: {
          enabled: healing.enabled,
          confidenceThreshold: healing.confidenceThreshold,
          aiEnabled: (healing as any).aiEnabled ?? true,
          retentionDays: (healing as any).retentionDays ?? 90,
        },
      });
    } catch (error) {
      res.status(500).json({ error: `Failed to save config: ${error}` });
    }
  });
}
