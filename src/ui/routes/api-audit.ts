import type { Express } from 'express';
import type { AuditLogStore } from '../store/audit-log-store.js';

export function mountAuditRoutes(
  app: Express,
  auditLogStore: AuditLogStore,
): void {

  // GET /api/audit — Query audit log with filters
  app.get('/api/audit', (req, res) => {
    try {
      const result = auditLogStore.query({
        userId: req.query.userId as string | undefined,
        action: req.query.action as string | undefined,
        resourceType: req.query.resourceType as string | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/audit/export — Download full audit log as JSON
  app.get('/api/audit/export', (_req, res) => {
    try {
      const entries = auditLogStore.exportAll();
      res.setHeader('Content-Disposition', 'attachment; filename="audit-log.json"');
      res.json({ entries, exportedAt: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/audit/stats — Summary statistics
  app.get('/api/audit/stats', (_req, res) => {
    try {
      const stats = auditLogStore.getStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
