import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir, generateId } from '../../utils/index.js';
import { hashPassword, verifyPassword } from '../auth/token-manager.js';
import type { Role } from '../auth/permissions.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  createdBy: string | null;
  lastLoginAt: number | null;
}

export interface Session {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  ipAddress: string | null;
  userAgent: string | null;
  revoked: boolean;
}

// ── Store ────────────────────────────────────────────────────────────────────

export class UserStore {
  private db: Database.Database;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const resolvedPath = join(dir, 'users.db');
    this.db = new Database(resolvedPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'tester', 'viewer')),
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_by TEXT,
        last_login_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `);

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');
  }

  // ── User CRUD ──────────────────────────────────────────────────────────────

  createUser(data: {
    username: string;
    displayName: string;
    password: string;
    role: Role;
    createdBy?: string;
  }): User {
    const id = generateId('usr');
    const now = Date.now();
    const passwordHash = hashPassword(data.password);

    this.db
      .prepare(
        `INSERT INTO users (id, username, display_name, password_hash, role, is_active, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
      )
      .run(id, data.username.trim(), data.displayName.trim(), passwordHash, data.role, now, now, data.createdBy ?? null);

    return this.getUser(id)!;
  }

  getUser(id: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as any;
    return row ? this.mapUser(row) : undefined;
  }

  getUserByUsername(username: string): User | undefined {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
      .get(username) as any;
    return row ? this.mapUser(row) : undefined;
  }

  listUsers(): User[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as any[];
    return rows.map(r => this.mapUser(r));
  }

  updateUser(id: string, data: Partial<Pick<User, 'displayName' | 'role' | 'isActive'>>): boolean {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (data.displayName !== undefined) {
      setClauses.push('display_name = ?');
      values.push(data.displayName.trim());
    }
    if (data.role !== undefined) {
      setClauses.push('role = ?');
      values.push(data.role);
    }
    if (data.isActive !== undefined) {
      setClauses.push('is_active = ?');
      values.push(data.isActive ? 1 : 0);
    }

    if (setClauses.length === 0) return false;

    setClauses.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    const result = this.db
      .prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...values);
    return result.changes > 0;
  }

  changePassword(id: string, newPassword: string): boolean {
    const passwordHash = hashPassword(newPassword);
    const result = this.db
      .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, Date.now(), id);
    return result.changes > 0;
  }

  deleteUser(id: string): boolean {
    // Soft delete — set is_active = 0
    const result = this.db
      .prepare('UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?')
      .run(Date.now(), id);
    if (result.changes > 0) {
      // Revoke all sessions
      this.revokeAllUserSessions(id);
      return true;
    }
    return false;
  }

  getUserCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM users WHERE is_active = 1')
      .get() as any;
    return row?.count ?? 0;
  }

  getAdminCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_active = 1")
      .get() as any;
    return row?.count ?? 0;
  }

  hasAnyUsers(): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM users')
      .get() as any;
    return (row?.count ?? 0) > 0;
  }

  // ── Auth Helpers ───────────────────────────────────────────────────────────

  authenticateUser(username: string, password: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1')
      .get(username) as any;

    if (!row) return null;
    if (!verifyPassword(password, row.password_hash)) return null;

    // Update last login
    this.db
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(Date.now(), row.id);

    return this.mapUser(row);
  }

  // ── Session Management ─────────────────────────────────────────────────────

  createSession(data: {
    userId: string;
    expiresAt: number;
    ipAddress?: string;
    userAgent?: string;
  }): Session {
    const id = generateId('ses');
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, created_at, expires_at, ip_address, user_agent, revoked)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
      .run(id, data.userId, now, data.expiresAt, data.ipAddress ?? null, data.userAgent ?? null);

    return {
      id,
      userId: data.userId,
      createdAt: now,
      expiresAt: data.expiresAt,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      revoked: false,
    };
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as any;
    return row ? this.mapSession(row) : null;
  }

  revokeSession(id: string): boolean {
    const result = this.db
      .prepare('UPDATE sessions SET revoked = 1 WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  revokeAllUserSessions(userId: string): number {
    const result = this.db
      .prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0')
      .run(userId);
    return result.changes;
  }

  pruneExpiredSessions(): number {
    const now = Date.now();
    const result = this.db
      .prepare('DELETE FROM sessions WHERE expires_at < ? OR revoked = 1')
      .run(now);
    return result.changes;
  }

  getActiveSessionCount(userId: string): number {
    const now = Date.now();
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM sessions WHERE user_id = ? AND revoked = 0 AND expires_at > ?')
      .get(userId, now) as any;
    return row?.count ?? 0;
  }

  listUserSessions(userId: string): Session[] {
    const now = Date.now();
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE user_id = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC')
      .all(userId, now) as any[];
    return rows.map(r => this.mapSession(r));
  }

  revokeOtherUserSessions(userId: string, keepSessionId: string): number {
    const result = this.db
      .prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ? AND revoked = 0')
      .run(userId, keepSessionId);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private mapUser(row: any): User {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role as Role,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      lastLoginAt: row.last_login_at,
    };
  }

  private mapSession(row: any): Session {
    return {
      id: row.id,
      userId: row.user_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      revoked: row.revoked === 1,
    };
  }
}
