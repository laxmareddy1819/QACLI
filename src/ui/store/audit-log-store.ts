import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir } from '../../utils/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type AuditAction =
  // Auth
  | 'auth.setup' | 'auth.login' | 'auth.logout' | 'auth.login_failed' | 'auth.password_change'
  // Users
  | 'user.create' | 'user.update' | 'user.delete' | 'user.role_change'
  | 'user.disable' | 'user.enable' | 'user.revoke_sessions'
  // Tests
  | 'run.start' | 'run.cancel'
  // Files
  | 'file.create' | 'file.update' | 'file.delete' | 'file.upload'
  // Settings
  | 'settings.cloud_save' | 'settings.cloud_delete'
  | 'settings.schedule_create' | 'settings.schedule_update' | 'settings.schedule_delete'
  // AI
  | 'ai.generate' | 'ai.fix' | 'ai.chat'
  // Git
  | 'git.commit' | 'git.push' | 'git.pull' | 'git.fetch' | 'git.branch_create' | 'git.branch_switch'
  // Browser/Recorder
  | 'browser.chat' | 'recorder.start' | 'recorder.stop'
  // CI/CD
  | 'cicd.generate';

export interface AuditEntry {
  id: number;
  timestamp: string;   // ISO 8601
  userId: string;
  username: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
}

export interface AuditQueryFilter {
  userId?: string;
  action?: string;         // supports prefix: 'auth.*'
  resourceType?: string;
  from?: string;           // ISO date string
  to?: string;             // ISO date string
  limit?: number;          // default 50, max 500
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditStats {
  totalEntries: number;
  uniqueUsers: number;
  actionCounts: Record<string, number>;
  recentLoginCount: number;     // last 24h
  recentFailedLogins: number;   // last 24h
}

// ── Store ────────────────────────────────────────────────────────────────────

const DEFAULT_RETENTION_DAYS = 90;
const MAX_QUERY_LIMIT = 500;

export class AuditLogStore {
  private db: Database.Database;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const resolvedPath = join(dir, 'audit.db');
    this.db = new Database(resolvedPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        ip_address TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);
    `);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  log(entry: {
    userId: string;
    username: string;
    action: AuditAction | string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }): void {
    try {
      this.db
        .prepare(
          `INSERT INTO audit_log (timestamp, user_id, username, action, resource_type, resource_id, details, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          Date.now(),
          entry.userId,
          entry.username,
          entry.action,
          entry.resourceType ?? null,
          entry.resourceId ?? null,
          entry.details ? JSON.stringify(entry.details) : null,
          entry.ipAddress ?? null,
        );
    } catch {
      // Silent — audit logging must never break the actual operation
    }
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  query(filter: AuditQueryFilter = {}): AuditQueryResult {
    const limit = Math.min(filter.limit ?? 50, MAX_QUERY_LIMIT);
    const offset = filter.offset ?? 0;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.userId) {
      conditions.push('user_id = ?');
      params.push(filter.userId);
    }

    if (filter.action) {
      if (filter.action.endsWith('.*')) {
        // Prefix match: 'auth.*' matches 'auth.login', 'auth.logout', etc.
        const prefix = filter.action.slice(0, -1); // remove '*'
        conditions.push('action LIKE ?');
        params.push(`${prefix}%`);
      } else {
        conditions.push('action = ?');
        params.push(filter.action);
      }
    }

    if (filter.resourceType) {
      conditions.push('resource_type = ?');
      params.push(filter.resourceType);
    }

    if (filter.from) {
      conditions.push('timestamp >= ?');
      params.push(new Date(filter.from).getTime());
    }

    if (filter.to) {
      conditions.push('timestamp <= ?');
      params.push(new Date(filter.to).getTime());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as total FROM audit_log ${where}`)
      .get(...params) as any;
    const total = countRow?.total ?? 0;

    // Get paginated results
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as any[];

    return {
      entries: rows.map(r => this.mapEntry(r)),
      total,
      limit,
      offset,
    };
  }

  getRecentActivity(limit = 20): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?')
      .all(limit) as any[];
    return rows.map(r => this.mapEntry(r));
  }

  getStats(): AuditStats {
    const totalRow = this.db
      .prepare('SELECT COUNT(*) as total FROM audit_log')
      .get() as any;

    const usersRow = this.db
      .prepare('SELECT COUNT(DISTINCT user_id) as count FROM audit_log')
      .get() as any;

    const last24h = Date.now() - 24 * 60 * 60 * 1000;

    const loginRow = this.db
      .prepare("SELECT COUNT(*) as count FROM audit_log WHERE action = 'auth.login' AND timestamp >= ?")
      .get(last24h) as any;

    const failedRow = this.db
      .prepare("SELECT COUNT(*) as count FROM audit_log WHERE action = 'auth.login_failed' AND timestamp >= ?")
      .get(last24h) as any;

    // Action counts
    const actionRows = this.db
      .prepare('SELECT action, COUNT(*) as count FROM audit_log GROUP BY action ORDER BY count DESC')
      .all() as any[];

    const actionCounts: Record<string, number> = {};
    for (const row of actionRows) {
      actionCounts[row.action] = row.count;
    }

    return {
      totalEntries: totalRow?.total ?? 0,
      uniqueUsers: usersRow?.count ?? 0,
      actionCounts,
      recentLoginCount: loginRow?.count ?? 0,
      recentFailedLogins: failedRow?.count ?? 0,
    };
  }

  // ── Retention ──────────────────────────────────────────────────────────────

  prune(olderThanDays = DEFAULT_RETENTION_DAYS): number {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare('DELETE FROM audit_log WHERE timestamp < ?')
      .run(cutoff);
    return result.changes;
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  exportAll(): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM audit_log ORDER BY timestamp DESC')
      .all() as any[];
    return rows.map(r => this.mapEntry(r));
  }

  close(): void {
    this.db.close();
  }

  // ── Mapper ─────────────────────────────────────────────────────────────────

  private mapEntry(row: any): AuditEntry {
    return {
      id: row.id,
      timestamp: new Date(row.timestamp).toISOString(),
      userId: row.user_id,
      username: row.username,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details ? JSON.parse(row.details) : null,
      ipAddress: row.ip_address,
    };
  }
}
