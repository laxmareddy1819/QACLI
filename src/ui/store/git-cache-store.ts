import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir } from '../../utils/index.js';

const STATUS_TTL_MS = 5 * 60 * 1000;     // 5 minutes
const BLAME_TTL_MS = 30 * 60 * 1000;     // 30 minutes

export class GitCacheStore {
  private db: Database.Database;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const resolvedPath = join(dir, 'git-cache.db');
    this.db = new Database(resolvedPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS blame_cache (
        file_path TEXT NOT NULL,
        head_sha TEXT NOT NULL,
        blame_data TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY (file_path, head_sha)
      );
      CREATE TABLE IF NOT EXISTS status_cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS log_cache (
        cache_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL
      );
    `);
  }

  // ── Blame Cache ─────────────────────────────────────────────────────────

  getBlame(filePath: string, headSha: string): any | null {
    try {
      const row = this.db
        .prepare('SELECT blame_data, cached_at FROM blame_cache WHERE file_path = ? AND head_sha = ?')
        .get(filePath, headSha) as any;

      if (!row) return null;
      if (Date.now() - row.cached_at > BLAME_TTL_MS) {
        this.db.prepare('DELETE FROM blame_cache WHERE file_path = ? AND head_sha = ?').run(filePath, headSha);
        return null;
      }

      return JSON.parse(row.blame_data);
    } catch {
      return null;
    }
  }

  setBlame(filePath: string, headSha: string, data: any): void {
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO blame_cache (file_path, head_sha, blame_data, cached_at) VALUES (?, ?, ?, ?)')
        .run(filePath, headSha, JSON.stringify(data), Date.now());
    } catch { /* ignore */ }
  }

  // ── Status Cache ────────────────────────────────────────────────────────

  getStatus(): any | null {
    try {
      const row = this.db
        .prepare('SELECT data, cached_at FROM status_cache WHERE key = ?')
        .get('status') as any;

      if (!row) return null;
      if (Date.now() - row.cached_at > STATUS_TTL_MS) {
        this.db.prepare('DELETE FROM status_cache WHERE key = ?').run('status');
        return null;
      }

      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }

  setStatus(data: any): void {
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO status_cache (key, data, cached_at) VALUES (?, ?, ?)')
        .run('status', JSON.stringify(data), Date.now());
    } catch { /* ignore */ }
  }

  // ── Log Cache ───────────────────────────────────────────────────────────

  getLog(cacheKey: string): any | null {
    try {
      const row = this.db
        .prepare('SELECT data, cached_at FROM log_cache WHERE cache_key = ?')
        .get(cacheKey) as any;

      if (!row) return null;
      if (Date.now() - row.cached_at > STATUS_TTL_MS) {
        this.db.prepare('DELETE FROM log_cache WHERE cache_key = ?').run(cacheKey);
        return null;
      }

      return JSON.parse(row.data);
    } catch {
      return null;
    }
  }

  setLog(cacheKey: string, data: any): void {
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO log_cache (cache_key, data, cached_at) VALUES (?, ?, ?)')
        .run(cacheKey, JSON.stringify(data), Date.now());
    } catch { /* ignore */ }
  }

  // ── Maintenance ─────────────────────────────────────────────────────────

  invalidateFile(filePath: string): void {
    try {
      this.db.prepare('DELETE FROM blame_cache WHERE file_path = ?').run(filePath);
    } catch { /* ignore */ }
  }

  invalidateAll(): void {
    try {
      this.db.prepare('DELETE FROM blame_cache').run();
      this.db.prepare('DELETE FROM status_cache').run();
      this.db.prepare('DELETE FROM log_cache').run();
    } catch { /* ignore */ }
  }

  pruneOld(): void {
    try {
      const now = Date.now();
      this.db.prepare('DELETE FROM blame_cache WHERE ? - cached_at > ?').run(now, BLAME_TTL_MS * 2);
      this.db.prepare('DELETE FROM status_cache WHERE ? - cached_at > ?').run(now, STATUS_TTL_MS * 2);
      this.db.prepare('DELETE FROM log_cache WHERE ? - cached_at > ?').run(now, STATUS_TTL_MS * 2);
    } catch { /* ignore */ }
  }
}
