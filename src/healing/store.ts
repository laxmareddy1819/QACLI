import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import type {
  StoredFingerprint,
  ElementFingerprint,
  HealingEvent,
  HealingInjection,
  HealingInjectionStatus,
  HealingAnalytics,
} from '../types/index.js';
import { getQabotDir, generateId } from '../utils/index.js';
import { levenshteinSimilarity } from './fingerprint.js';

export class HealingStore {
  private db: Database.Database;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const resolvedPath = join(dir, 'healing.db');
    this.db = new Database(resolvedPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fingerprints (
        id TEXT PRIMARY KEY,
        selector_key TEXT NOT NULL,
        url TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_selector_key ON fingerprints(selector_key);
      CREATE INDEX IF NOT EXISTS idx_url ON fingerprints(url);

      CREATE TABLE IF NOT EXISTS healing_events (
        id TEXT PRIMARY KEY,
        selector_key TEXT NOT NULL,
        url TEXT NOT NULL,
        framework TEXT NOT NULL,
        language TEXT,
        strategy_used TEXT,
        original_selector TEXT NOT NULL,
        healed_selector TEXT,
        confidence REAL DEFAULT 0,
        success INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        ai_used INTEGER DEFAULT 0,
        dom_snapshot_size INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_framework ON healing_events(framework);
      CREATE INDEX IF NOT EXISTS idx_events_created ON healing_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_selector ON healing_events(selector_key);

      CREATE TABLE IF NOT EXISTS healing_injections (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        framework TEXT NOT NULL,
        language TEXT NOT NULL,
        files_created TEXT NOT NULL,
        healing_server_url TEXT NOT NULL,
        confidence_threshold REAL DEFAULT 0.7,
        ai_enabled INTEGER DEFAULT 1,
        injected_at INTEGER NOT NULL,
        last_activity_at INTEGER,
        status TEXT DEFAULT 'active'
      );
      CREATE INDEX IF NOT EXISTS idx_injections_project ON healing_injections(project_path);
      CREATE INDEX IF NOT EXISTS idx_injections_status ON healing_injections(status);
    `);

    // ── Schema migrations — add context columns to existing tables ──
    this.migrateAddContextColumns();
  }

  /**
   * Add scenario_name, step_name, action_type columns if they don't exist.
   * Uses ALTER TABLE ADD COLUMN which is safe to run on existing DBs —
   * SQLite ignores the statement if the column already exists (we catch the error).
   */
  private migrateAddContextColumns(): void {
    const addColumnSafe = (table: string, column: string, type: string) => {
      try {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      } catch {
        // Column already exists — ignore
      }
    };

    // healing_events: add scenario_name, step_name, action_type
    addColumnSafe('healing_events', 'scenario_name', 'TEXT');
    addColumnSafe('healing_events', 'step_name', 'TEXT');
    addColumnSafe('healing_events', 'action_type', 'TEXT');

    // fingerprints: add scenario_name, step_name
    addColumnSafe('fingerprints', 'scenario_name', 'TEXT');
    addColumnSafe('fingerprints', 'step_name', 'TEXT');
  }

  save(entry: {
    selectorKey: string;
    url: string;
    fingerprint: ElementFingerprint;
    scenarioName?: string;
    stepName?: string;
  }): string {
    const id = generateId('fp');
    const now = Date.now();

    const existing = this.get(entry.selectorKey);
    if (existing) {
      this.db
        .prepare(
          'UPDATE fingerprints SET fingerprint = ?, url = ?, updated_at = ?, scenario_name = COALESCE(?, scenario_name), step_name = COALESCE(?, step_name) WHERE selector_key = ?',
        )
        .run(JSON.stringify(entry.fingerprint), entry.url, now, entry.scenarioName || null, entry.stepName || null, entry.selectorKey);
      return existing.id;
    }

    this.db
      .prepare(
        'INSERT INTO fingerprints (id, selector_key, url, fingerprint, success_count, failure_count, scenario_name, step_name, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)',
      )
      .run(id, entry.selectorKey, entry.url, JSON.stringify(entry.fingerprint), entry.scenarioName || null, entry.stepName || null, now, now);

    return id;
  }

  get(selectorKey: string): StoredFingerprint | undefined {
    const row = this.db
      .prepare('SELECT * FROM fingerprints WHERE selector_key = ?')
      .get(selectorKey) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      selectorKey: row.selector_key,
      url: row.url,
      fingerprint: JSON.parse(row.fingerprint),
      successCount: row.success_count,
      failureCount: row.failure_count,
      scenarioName: row.scenario_name || undefined,
      stepName: row.step_name || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getByUrl(url: string): StoredFingerprint[] {
    const rows = this.db
      .prepare('SELECT * FROM fingerprints WHERE url = ?')
      .all(url) as any[];

    return rows.map((row) => this.mapFingerprintRow(row));
  }

  incrementSuccess(selectorKey: string): void {
    this.db
      .prepare(
        'UPDATE fingerprints SET success_count = success_count + 1, updated_at = ? WHERE selector_key = ?',
      )
      .run(Date.now(), selectorKey);
  }

  incrementFailure(selectorKey: string): void {
    this.db
      .prepare(
        'UPDATE fingerprints SET failure_count = failure_count + 1, updated_at = ? WHERE selector_key = ?',
      )
      .run(Date.now(), selectorKey);
  }

  deleteFingerprint(id: string): void {
    this.db.prepare('DELETE FROM fingerprints WHERE id = ?').run(id);
  }

  prune(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db
      .prepare('DELETE FROM fingerprints WHERE updated_at < ?')
      .run(cutoff);
    return result.changes;
  }

  getStats(): { total: number; totalSuccess: number; totalFailure: number } {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) as total, SUM(success_count) as totalSuccess, SUM(failure_count) as totalFailure FROM fingerprints',
      )
      .get() as any;

    return {
      total: row.total || 0,
      totalSuccess: row.totalSuccess || 0,
      totalFailure: row.totalFailure || 0,
    };
  }

  // ── Fingerprint getAll ────────────────────────────────────────────────────

  getAll(): StoredFingerprint[] {
    const rows = this.db
      .prepare('SELECT * FROM fingerprints ORDER BY updated_at DESC')
      .all() as any[];

    return rows.map((row) => this.mapFingerprintRow(row));
  }

  /** Map a raw SQLite row to StoredFingerprint */
  private mapFingerprintRow(row: any): StoredFingerprint {
    return {
      id: row.id,
      selectorKey: row.selector_key,
      url: row.url,
      fingerprint: JSON.parse(row.fingerprint),
      successCount: row.success_count,
      failureCount: row.failure_count,
      scenarioName: row.scenario_name || undefined,
      stepName: row.step_name || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ── Fuzzy Fingerprint Matching ──────────────────────────────────────────

  /**
   * Find a stored fingerprint that is SIMILAR (not exact) to the given selectorKey.
   * Used when exact match fails — e.g., selector changed from `input[name="q"]`
   * to `input[name="q "]` (trailing space / typo).
   *
   * Strategy:
   * 1. Prefer URL-scoped search (same page → more relevant, smaller set)
   * 2. Fall back to all fingerprints if URL has no results
   * 3. Use Levenshtein similarity on selectorKey strings
   * 4. Return best match above threshold
   */
  findSimilar(selectorKey: string, url?: string, threshold: number = 0.6): StoredFingerprint | undefined {
    // Get candidates — prefer URL-scoped (smaller set, more relevant)
    const urlScoped = url ? this.getByUrl(url) : [];
    const pool = urlScoped.length > 0 ? urlScoped : this.getAll();

    let bestMatch: StoredFingerprint | undefined;
    let bestScore = threshold;

    for (const stored of pool) {
      // Skip exact match — caller already tried that
      if (stored.selectorKey === selectorKey) continue;

      const score = levenshteinSimilarity(selectorKey, stored.selectorKey);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = stored;
      }
    }

    return bestMatch;
  }

  // ── Healing Events ──────────────────────────────────────────────────────

  saveEvent(event: Omit<HealingEvent, 'id' | 'createdAt'>): string {
    const id = generateId('he');
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO healing_events (id, selector_key, url, framework, language, strategy_used, original_selector, healed_selector, confidence, success, duration_ms, ai_used, dom_snapshot_size, scenario_name, step_name, action_type, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        event.selectorKey,
        event.url,
        event.framework,
        event.language || null,
        event.strategyUsed || null,
        event.originalSelector,
        event.healedSelector || null,
        event.confidence,
        event.success ? 1 : 0,
        event.durationMs,
        event.aiUsed ? 1 : 0,
        event.domSnapshotSize || null,
        event.scenarioName || null,
        event.stepName || null,
        event.actionType || null,
        now,
      );
    return id;
  }

  getEvents(filters?: {
    framework?: string;
    days?: number;
    success?: boolean;
    limit?: number;
    offset?: number;
  }): { events: HealingEvent[]; total: number } {
    let countSql = 'SELECT COUNT(*) as cnt FROM healing_events WHERE 1=1';
    let sql = 'SELECT * FROM healing_events WHERE 1=1';
    const params: unknown[] = [];
    const countParams: unknown[] = [];

    if (filters?.framework) {
      sql += ' AND framework = ?';
      countSql += ' AND framework = ?';
      params.push(filters.framework);
      countParams.push(filters.framework);
    }
    if (filters?.days) {
      const cutoff = Date.now() - filters.days * 86400000;
      sql += ' AND created_at >= ?';
      countSql += ' AND created_at >= ?';
      params.push(cutoff);
      countParams.push(cutoff);
    }
    if (filters?.success !== undefined) {
      sql += ' AND success = ?';
      countSql += ' AND success = ?';
      params.push(filters.success ? 1 : 0);
      countParams.push(filters.success ? 1 : 0);
    }

    const totalRow = this.db.prepare(countSql).get(...countParams) as any;
    const total = totalRow?.cnt || 0;

    sql += ' ORDER BY created_at DESC';

    if (filters?.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }
    if (filters?.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    const events = rows.map((r) => ({
      id: r.id,
      selectorKey: r.selector_key,
      url: r.url,
      framework: r.framework,
      language: r.language || undefined,
      strategyUsed: r.strategy_used || undefined,
      originalSelector: r.original_selector,
      healedSelector: r.healed_selector || undefined,
      confidence: r.confidence,
      success: r.success === 1,
      durationMs: r.duration_ms,
      aiUsed: r.ai_used === 1,
      domSnapshotSize: r.dom_snapshot_size || undefined,
      scenarioName: r.scenario_name || undefined,
      stepName: r.step_name || undefined,
      actionType: r.action_type || undefined,
      createdAt: r.created_at,
    }));
    return { events, total };
  }

  getEventStats(): { total: number; healed: number; failed: number } {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) as total, SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as healed, SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as failed FROM healing_events',
      )
      .get() as any;
    return {
      total: row.total || 0,
      healed: row.healed || 0,
      failed: row.failed || 0,
    };
  }

  getAnalytics(days: number = 30): HealingAnalytics {
    const cutoff = Date.now() - days * 86400000;

    // Overall stats
    const stats = this.db
      .prepare(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as healed,
                SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as failed,
                AVG(confidence) as avgConf,
                AVG(duration_ms) as avgDur,
                SUM(CASE WHEN ai_used=1 THEN 1 ELSE 0 END) as aiCount
         FROM healing_events WHERE created_at >= ?`,
      )
      .get(cutoff) as any;

    const total = stats.total || 0;
    const healed = stats.healed || 0;
    const failed = stats.failed || 0;

    // Strategy breakdown
    const strategyRows = this.db
      .prepare(
        `SELECT strategy_used, COUNT(*) as cnt,
                SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes
         FROM healing_events WHERE created_at >= ? AND strategy_used IS NOT NULL
         GROUP BY strategy_used ORDER BY cnt DESC`,
      )
      .all(cutoff) as any[];

    // Framework breakdown
    const frameworkRows = this.db
      .prepare(
        `SELECT framework, COUNT(*) as cnt,
                SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as successes
         FROM healing_events WHERE created_at >= ?
         GROUP BY framework ORDER BY cnt DESC`,
      )
      .all(cutoff) as any[];

    // Daily timeline
    const timelineRows = this.db
      .prepare(
        `SELECT date(created_at/1000, 'unixepoch') as day, COUNT(*) as total,
                SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as healed,
                SUM(CASE WHEN success=0 THEN 1 ELSE 0 END) as failed
         FROM healing_events WHERE created_at >= ?
         GROUP BY day ORDER BY day`,
      )
      .all(cutoff) as any[];

    // Top failures
    const failureRows = this.db
      .prepare(
        `SELECT selector_key, url, COUNT(*) as fail_count, MAX(created_at) as last_seen
         FROM healing_events WHERE success=0 AND created_at >= ?
         GROUP BY selector_key, url ORDER BY fail_count DESC LIMIT 10`,
      )
      .all(cutoff) as any[];

    return {
      totalEvents: total,
      totalHealed: healed,
      totalFailed: failed,
      overallSuccessRate: total > 0 ? Math.round((healed / total) * 10000) / 100 : 0,
      averageConfidence: Math.round((stats.avgConf || 0) * 100) / 100,
      averageDurationMs: Math.round(stats.avgDur || 0),
      aiHealingRate: total > 0 ? Math.round(((stats.aiCount || 0) / total) * 10000) / 100 : 0,
      strategyBreakdown: strategyRows.map((r) => ({
        strategy: r.strategy_used,
        count: r.cnt,
        successRate: r.cnt > 0 ? Math.round((r.successes / r.cnt) * 10000) / 100 : 0,
      })),
      frameworkBreakdown: frameworkRows.map((r) => ({
        framework: r.framework,
        count: r.cnt,
        successRate: r.cnt > 0 ? Math.round((r.successes / r.cnt) * 10000) / 100 : 0,
      })),
      timeline: timelineRows.map((r) => ({
        date: r.day,
        total: r.total,
        healed: r.healed,
        failed: r.failed,
      })),
      topFailures: failureRows.map((r) => ({
        selectorKey: r.selector_key,
        url: r.url,
        failureCount: r.fail_count,
        lastSeen: r.last_seen,
      })),
    };
  }

  // ── Healing Injections ──────────────────────────────────────────────────

  saveInjection(injection: Omit<HealingInjection, 'id' | 'injectedAt'>): string {
    const id = generateId('hi');
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO healing_injections (id, project_path, framework, language, files_created, healing_server_url, confidence_threshold, ai_enabled, injected_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        injection.projectPath,
        injection.framework,
        injection.language,
        JSON.stringify(injection.filesCreated),
        injection.healingServerUrl,
        injection.confidenceThreshold ?? 0.7,
        injection.aiEnabled ? 1 : 0,
        now,
        injection.status || 'active',
      );
    return id;
  }

  getInjections(status?: HealingInjectionStatus): HealingInjection[] {
    let sql = 'SELECT * FROM healing_injections';
    const params: unknown[] = [];
    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }
    sql += ' ORDER BY injected_at DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectPath: r.project_path,
      framework: r.framework,
      language: r.language,
      filesCreated: JSON.parse(r.files_created),
      healingServerUrl: r.healing_server_url,
      confidenceThreshold: r.confidence_threshold,
      aiEnabled: r.ai_enabled === 1,
      injectedAt: r.injected_at,
      lastActivityAt: r.last_activity_at || undefined,
      status: r.status as HealingInjectionStatus,
    }));
  }

  getInjectionByProject(projectPath: string): HealingInjection | undefined {
    const row = this.db
      .prepare('SELECT * FROM healing_injections WHERE project_path = ? AND status = ?')
      .get(projectPath, 'active') as any;

    if (!row) return undefined;
    return {
      id: row.id,
      projectPath: row.project_path,
      framework: row.framework,
      language: row.language,
      filesCreated: JSON.parse(row.files_created),
      healingServerUrl: row.healing_server_url,
      confidenceThreshold: row.confidence_threshold,
      aiEnabled: row.ai_enabled === 1,
      injectedAt: row.injected_at,
      lastActivityAt: row.last_activity_at || undefined,
      status: row.status as HealingInjectionStatus,
    };
  }

  updateInjectionStatus(id: string, status: HealingInjectionStatus): void {
    this.db
      .prepare('UPDATE healing_injections SET status = ? WHERE id = ?')
      .run(status, id);
  }

  updateInjectionActivity(projectPath: string): void {
    this.db
      .prepare('UPDATE healing_injections SET last_activity_at = ? WHERE project_path = ? AND status = ?')
      .run(Date.now(), projectPath, 'active');
  }

  updateInjectionActivityByFramework(framework: string): void {
    this.db
      .prepare('UPDATE healing_injections SET last_activity_at = ? WHERE framework = ? AND status = ?')
      .run(Date.now(), framework, 'active');
  }

  close(): void {
    this.db.close();
  }
}
