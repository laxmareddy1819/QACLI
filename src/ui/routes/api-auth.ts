import type { Express } from 'express';
import type { TokenManager } from '../auth/token-manager.js';
import type { UserStore } from '../store/user-store.js';
import type { AuditLogStore } from '../store/audit-log-store.js';
import type { AuthenticatedRequest } from '../auth/auth-middleware.js';
import { isValidRole, type Role } from '../auth/permissions.js';

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_PASSWORD_LENGTH = 6;

export function mountAuthRoutes(
  app: Express,
  userStore: UserStore,
  tokenManager: TokenManager,
  auditLogStore: AuditLogStore,
): void {

  // ── Public Endpoints ─────────────────────────────────────────────────────

  // GET /api/auth/status — Check auth status (setup required? authenticated?)
  app.get('/api/auth/status', (req, res) => {
    const setupRequired = !userStore.hasAnyUsers();
    if (setupRequired) {
      res.json({ setupRequired: true, authenticated: false });
      return;
    }

    // Check if caller has valid token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.json({ setupRequired: false, authenticated: false });
      return;
    }

    const payload = tokenManager.verify(authHeader.slice(7));
    if (!payload) {
      res.json({ setupRequired: false, authenticated: false });
      return;
    }

    const session = userStore.getSession(payload.jti);
    if (!session || session.revoked || session.expiresAt < Date.now()) {
      res.json({ setupRequired: false, authenticated: false });
      return;
    }

    const user = userStore.getUser(payload.sub);
    if (!user || !user.isActive) {
      res.json({ setupRequired: false, authenticated: false });
      return;
    }

    res.json({
      setupRequired: false,
      authenticated: true,
      user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    });
  });

  // POST /api/auth/setup — Create initial admin account (only when no users)
  app.post('/api/auth/setup', (req, res) => {
    try {
      if (userStore.hasAnyUsers()) {
        res.status(400).json({ error: 'Setup already completed' });
        return;
      }

      const { username, displayName, password } = req.body as {
        username?: string;
        displayName?: string;
        password?: string;
      };

      if (!username?.trim()) {
        res.status(400).json({ error: 'Username is required' });
        return;
      }
      if (!displayName?.trim()) {
        res.status(400).json({ error: 'Display name is required' });
        return;
      }
      if (!password || password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        return;
      }

      const user = userStore.createUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        role: 'admin',
      });

      // Create session
      const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
      const session = userStore.createSession({
        userId: user.id,
        expiresAt,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const token = tokenManager.sign({
        sub: user.id,
        jti: session.id,
        role: user.role,
        username: user.username,
        exp: Math.floor(expiresAt / 1000),
      });

      auditLogStore.log({
        userId: user.id,
        username: user.username,
        action: 'auth.setup',
        resourceType: 'user',
        resourceId: user.id,
        details: { role: 'admin' },
        ipAddress: req.ip,
      });

      res.json({
        user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
        token,
        expiresAt: new Date(expiresAt).toISOString(),
      });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint')) {
        res.status(400).json({ error: 'Username already exists' });
        return;
      }
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/auth/login — Authenticate and get token
  app.post('/api/auth/login', (req, res) => {
    try {
      if (!userStore.hasAnyUsers()) {
        res.status(400).json({ error: 'Setup required — no users exist' });
        return;
      }

      const { username, password } = req.body as { username?: string; password?: string };

      if (!username || !password) {
        res.status(400).json({ error: 'Username and password are required' });
        return;
      }

      const user = userStore.authenticateUser(username, password);
      if (!user) {
        auditLogStore.log({
          userId: 'unknown',
          username: username,
          action: 'auth.login_failed',
          details: { reason: 'Invalid credentials' },
          ipAddress: req.ip,
        });
        res.status(401).json({ error: 'Invalid username or password' });
        return;
      }

      // Create session
      const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
      const session = userStore.createSession({
        userId: user.id,
        expiresAt,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      const token = tokenManager.sign({
        sub: user.id,
        jti: session.id,
        role: user.role,
        username: user.username,
        exp: Math.floor(expiresAt / 1000),
      });

      auditLogStore.log({
        userId: user.id,
        username: user.username,
        action: 'auth.login',
        ipAddress: req.ip,
      });

      res.json({
        token,
        user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
        expiresAt: new Date(expiresAt).toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── Authenticated Endpoints ──────────────────────────────────────────────

  // POST /api/auth/logout — Revoke current session
  app.post('/api/auth/logout', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      userStore.revokeSession(authReq.user.sessionId);

      auditLogStore.log({
        userId: authReq.user.id,
        username: authReq.user.username,
        action: 'auth.logout',
        ipAddress: req.ip,
      });

      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/auth/change-password — Change own password
  app.post('/api/auth/change-password', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
      }

      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword?: string;
      };

      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: 'Current and new password are required' });
        return;
      }
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        return;
      }

      // Verify current password
      const user = userStore.authenticateUser(authReq.user.username, currentPassword);
      if (!user) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
      }

      userStore.changePassword(authReq.user.id, newPassword);

      auditLogStore.log({
        userId: authReq.user.id,
        username: authReq.user.username,
        action: 'auth.password_change',
        resourceType: 'user',
        resourceId: authReq.user.id,
        ipAddress: req.ip,
      });

      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/auth/me — Get current user profile
  app.get('/api/auth/me', (req, res) => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = userStore.getUser(authReq.user.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: new Date(user.createdAt).toISOString(),
      lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
    });
  });

  // ── Profile & Sessions ──────────────────────────────────────────────────

  // PUT /api/auth/profile — Update own display name
  app.put('/api/auth/profile', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user) { res.status(401).json({ error: 'Not authenticated' }); return; }

      const { displayName } = req.body as { displayName?: string };
      if (!displayName?.trim()) {
        res.status(400).json({ error: 'Display name is required' });
        return;
      }

      userStore.updateUser(authReq.user.id, { displayName: displayName.trim() });
      const updated = userStore.getUser(authReq.user.id);

      auditLogStore.log({
        userId: authReq.user.id,
        username: authReq.user.username,
        action: 'user.update',
        resourceType: 'user',
        resourceId: authReq.user.id,
        details: { field: 'displayName', newValue: displayName.trim() },
        ipAddress: req.ip,
      });

      res.json({
        user: {
          id: updated!.id,
          username: updated!.username,
          displayName: updated!.displayName,
          role: updated!.role,
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/auth/sessions — List current user's active sessions
  app.get('/api/auth/sessions', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user) { res.status(401).json({ error: 'Not authenticated' }); return; }

      const sessions = userStore.listUserSessions(authReq.user.id);
      res.json({
        sessions: sessions.map(s => ({
          id: s.id,
          createdAt: new Date(s.createdAt).toISOString(),
          expiresAt: new Date(s.expiresAt).toISOString(),
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          isCurrent: s.id === authReq.user!.sessionId,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/auth/sessions/revoke-others — Revoke all sessions except current
  app.post('/api/auth/sessions/revoke-others', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user) { res.status(401).json({ error: 'Not authenticated' }); return; }

      const count = userStore.revokeOtherUserSessions(authReq.user.id, authReq.user.sessionId);

      auditLogStore.log({
        userId: authReq.user.id,
        username: authReq.user.username,
        action: 'user.revoke_sessions',
        details: { sessionsRevoked: count, type: 'revoke-all-others' },
        ipAddress: req.ip,
      });

      res.json({ status: 'ok', sessionsRevoked: count });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/auth/sessions/:id — Revoke a specific session
  app.delete('/api/auth/sessions/:id', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user) { res.status(401).json({ error: 'Not authenticated' }); return; }

      const sessionId = req.params.id!;

      // Cannot revoke current session — use logout instead
      if (sessionId === authReq.user.sessionId) {
        res.status(400).json({ error: 'Cannot revoke current session. Use logout instead.' });
        return;
      }

      // Verify session belongs to this user
      const session = userStore.getSession(sessionId);
      if (!session || session.userId !== authReq.user.id) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      userStore.revokeSession(sessionId);

      auditLogStore.log({
        userId: authReq.user.id,
        username: authReq.user.username,
        action: 'user.revoke_sessions',
        details: { sessionId },
        ipAddress: req.ip,
      });

      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/auth/activity — Get own recent audit entries
  app.get('/api/auth/activity', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      if (!authReq.user) { res.status(401).json({ error: 'Not authenticated' }); return; }

      const limit = req.query.limit ? Math.min(parseInt(req.query.limit as string, 10), 50) : 20;
      const result = auditLogStore.query({ userId: authReq.user.id, limit });

      res.json({ entries: result.entries, total: result.total });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── Admin: User Management ───────────────────────────────────────────────

  // GET /api/auth/users — List all users
  app.get('/api/auth/users', (req, res) => {
    try {
      const users = userStore.listUsers().map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        isActive: u.isActive,
        createdAt: new Date(u.createdAt).toISOString(),
        lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
        sessions: userStore.getActiveSessionCount(u.id),
      }));
      res.json({ users });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/auth/users — Create a new user
  app.post('/api/auth/users', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const { username, displayName, password, role } = req.body as {
        username?: string;
        displayName?: string;
        password?: string;
        role?: string;
      };

      if (!username?.trim()) {
        res.status(400).json({ error: 'Username is required' });
        return;
      }
      if (!displayName?.trim()) {
        res.status(400).json({ error: 'Display name is required' });
        return;
      }
      if (!password || password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        return;
      }
      if (!role || !isValidRole(role)) {
        res.status(400).json({ error: 'Role must be admin, tester, or viewer' });
        return;
      }

      const user = userStore.createUser({
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        role,
        createdBy: authReq.user?.id,
      });

      auditLogStore.log({
        userId: authReq.user!.id,
        username: authReq.user!.username,
        action: 'user.create',
        resourceType: 'user',
        resourceId: user.id,
        details: { targetUsername: user.username, targetRole: user.role },
        ipAddress: req.ip,
      });

      res.json({
        user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role, isActive: user.isActive },
      });
    } catch (error: any) {
      if (error.message?.includes('UNIQUE constraint')) {
        res.status(400).json({ error: 'Username already exists' });
        return;
      }
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/auth/users/:id — Update user
  app.put('/api/auth/users/:id', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const targetId = req.params.id;
      const { displayName, role, isActive } = req.body as {
        displayName?: string;
        role?: string;
        isActive?: boolean;
      };

      const targetUser = userStore.getUser(targetId);
      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Last admin protection
      if (targetUser.role === 'admin' && userStore.getAdminCount() <= 1) {
        if ((role && role !== 'admin') || isActive === false) {
          res.status(409).json({ error: 'Cannot remove or demote the last admin account' });
          return;
        }
      }

      if (role && !isValidRole(role)) {
        res.status(400).json({ error: 'Role must be admin, tester, or viewer' });
        return;
      }

      const updateData: any = {};
      if (displayName !== undefined) updateData.displayName = displayName;
      if (role !== undefined) updateData.role = role;
      if (isActive !== undefined) updateData.isActive = isActive;

      userStore.updateUser(targetId, updateData);

      // If disabling user, revoke their sessions
      if (isActive === false) {
        userStore.revokeAllUserSessions(targetId);
      }

      const updatedUser = userStore.getUser(targetId);

      const auditAction = role && role !== targetUser.role ? 'user.role_change' :
        isActive === false ? 'user.disable' :
        isActive === true ? 'user.enable' : 'user.update';

      auditLogStore.log({
        userId: authReq.user!.id,
        username: authReq.user!.username,
        action: auditAction,
        resourceType: 'user',
        resourceId: targetId,
        details: {
          targetUsername: targetUser.username,
          ...(role && role !== targetUser.role ? { oldRole: targetUser.role, newRole: role } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
        },
        ipAddress: req.ip,
      });

      res.json({
        user: {
          id: updatedUser!.id,
          username: updatedUser!.username,
          displayName: updatedUser!.displayName,
          role: updatedUser!.role,
          isActive: updatedUser!.isActive,
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/auth/users/:id — Deactivate user (soft delete)
  app.delete('/api/auth/users/:id', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const targetId = req.params.id;

      const targetUser = userStore.getUser(targetId);
      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Prevent self-deletion
      if (targetId === authReq.user!.id) {
        res.status(400).json({ error: 'Cannot delete your own account' });
        return;
      }

      // Last admin protection
      if (targetUser.role === 'admin' && userStore.getAdminCount() <= 1) {
        res.status(409).json({ error: 'Cannot delete the last admin account' });
        return;
      }

      userStore.deleteUser(targetId);

      auditLogStore.log({
        userId: authReq.user!.id,
        username: authReq.user!.username,
        action: 'user.delete',
        resourceType: 'user',
        resourceId: targetId,
        details: { targetUsername: targetUser.username, targetRole: targetUser.role },
        ipAddress: req.ip,
      });

      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/auth/users/:id/reset-password — Admin resets a user's password
  app.post('/api/auth/users/:id/reset-password', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const targetId = req.params.id;
      const { newPassword } = req.body as { newPassword?: string };

      if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
        return;
      }

      const targetUser = userStore.getUser(targetId);
      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      userStore.changePassword(targetId, newPassword);

      auditLogStore.log({
        userId: authReq.user!.id,
        username: authReq.user!.username,
        action: 'auth.password_change',
        resourceType: 'user',
        resourceId: targetId,
        details: { targetUsername: targetUser.username, resetByAdmin: true },
        ipAddress: req.ip,
      });

      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/auth/users/:id/revoke-sessions — Force logout a user
  app.post('/api/auth/users/:id/revoke-sessions', (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const targetId = req.params.id;

      const targetUser = userStore.getUser(targetId);
      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const count = userStore.revokeAllUserSessions(targetId);

      auditLogStore.log({
        userId: authReq.user!.id,
        username: authReq.user!.username,
        action: 'user.revoke_sessions',
        resourceType: 'user',
        resourceId: targetId,
        details: { targetUsername: targetUser.username, sessionsRevoked: count },
        ipAddress: req.ip,
      });

      res.json({ status: 'ok', sessionsRevoked: count });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
