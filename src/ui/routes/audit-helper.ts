/**
 * Shared audit logging helper for route handlers.
 *
 * Usage:
 *   import { audit } from './audit-helper.js';
 *   audit(req, 'run.start', { resourceType: 'test-run', resourceId: runId });
 */
import type { Request } from 'express';
import type { AuditLogStore, AuditAction } from '../store/audit-log-store.js';
import type { AuthenticatedRequest } from '../auth/auth-middleware.js';

export function audit(
  req: Request,
  action: AuditAction,
  opts?: {
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
  },
): void {
  const store = req.app.locals.auditLogStore as AuditLogStore | undefined;
  const user = (req as AuthenticatedRequest).user;
  if (store && user) {
    store.log({
      userId: user.id,
      username: user.username,
      action,
      resourceType: opts?.resourceType,
      resourceId: opts?.resourceId,
      details: opts?.details,
      ipAddress: req.ip,
    });
  }
}
