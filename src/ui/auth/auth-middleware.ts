import type { Request, Response, NextFunction } from 'express';
import type { TokenManager, TokenPayload } from './token-manager.js';
import type { UserStore } from '../store/user-store.js';
import { getRequiredRole, hasPermission, type Role } from './permissions.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// ── Public Paths (no auth required) ──────────────────────────────────────────

const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/status',
];

function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.some(p => path === p)) return true;
  // Healing API is a localhost HTTP bridge for external test frameworks
  // (Cucumber hooks, Selenium helpers, etc.) that call without auth tokens
  if (path.startsWith('/api/heal/')) return true;
  // Artifact endpoint serves binary files (screenshots, videos, traces) via
  // <img>, <video>, <a> tags which can't add Authorization headers.
  // Also needed for cross-origin access from trace.playwright.dev.
  if (path === '/api/results/artifact') return true;
  // Report export opens in a new tab via window.open() — no auth headers
  if (/^\/api\/results\/runs\/[^/]+\/report$/.test(path)) return true;
  return false;
}

// ── Auth Middleware ───────────────────────────────────────────────────────────

export function createAuthMiddleware(
  tokenManager: TokenManager,
  userStore: UserStore,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Static files and non-API paths pass through (SPA handles auth client-side)
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }

    // Public auth endpoints don't need auth
    if (isPublicPath(req.path)) {
      next();
      return;
    }

    // Setup mode: if no users exist yet, return setupRequired
    if (!userStore.hasAnyUsers()) {
      res.status(200).json({ setupRequired: true });
      return;
    }

    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = authHeader.slice(7);
    const payload = tokenManager.verify(token);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Verify session still valid (not revoked)
    const session = userStore.getSession(payload.jti);
    if (!session || session.revoked) {
      res.status(401).json({ error: 'Session expired or revoked' });
      return;
    }

    // Check session expiry (double-check beyond JWT exp)
    if (session.expiresAt < Date.now()) {
      res.status(401).json({ error: 'Session expired' });
      return;
    }

    // Attach user to request
    const authUser: AuthUser = {
      id: payload.sub,
      username: payload.username,
      role: payload.role as Role,
      sessionId: payload.jti,
    };
    (req as AuthenticatedRequest).user = authUser;

    // Check role-based permissions
    const requiredRole = getRequiredRole(req.method, req.path);
    if (!hasPermission(authUser.role, requiredRole)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
