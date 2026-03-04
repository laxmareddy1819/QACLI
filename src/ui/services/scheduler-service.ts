import type { CloudConfigStore, ScheduleConfig } from '../store/cloud-config-store.js';
import type { WebSocketServer, WebSocket } from 'ws';

const TICK_INTERVAL = 60_000; // Check every 60 seconds

/**
 * Cron-based scheduler service that triggers test runs on schedule.
 *
 * Uses internal HTTP POST to /api/runner/run to reuse all existing run
 * logic (env var injection, cloud config generation, result parsing, etc.).
 */
export class SchedulerService {
  private interval: ReturnType<typeof setInterval> | null = null;
  private port = 0;
  private wss: WebSocketServer | null = null;
  private running = false;

  constructor(private cloudConfigStore: CloudConfigStore) {}

  /** Set the server port (deferred — resolved after server starts) */
  setPort(port: number): void {
    this.port = port;
  }

  /** Set the WebSocket server for broadcasting */
  setWss(wss: WebSocketServer): void {
    this.wss = wss;
  }

  /** Start the scheduler tick loop */
  start(): void {
    if (this.interval) return;
    this.running = true;
    console.log('[qabot] Scheduler service started');

    // Initial tick after 5s (let server finish startup)
    setTimeout(() => {
      if (this.running) this.tick();
    }, 5000);

    this.interval = setInterval(() => {
      if (this.running) this.tick();
    }, TICK_INTERVAL);
  }

  /** Stop the scheduler */
  stop(): void {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[qabot] Scheduler service stopped');
  }

  /** Immediately trigger a specific schedule */
  async runNow(scheduleId: string): Promise<{ runId?: string; error?: string }> {
    const schedule = this.cloudConfigStore.getSchedule(scheduleId);
    if (!schedule) {
      return { error: 'Schedule not found' };
    }
    return this.triggerRun(schedule);
  }

  /** Compute next run times for all schedules */
  getSchedulesWithNextRun(): Array<ScheduleConfig & { nextRunTime?: string }> {
    const schedules = this.cloudConfigStore.getSchedules();
    return schedules.map(s => ({
      ...s,
      nextRunTime: s.enabled ? getNextRunTime(s.cron)?.toISOString() : undefined,
    }));
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    const schedules = this.cloudConfigStore.getSchedules();
    const now = new Date();
    // Truncate to current minute for cron matching
    const nowTruncated = new Date(now);
    nowTruncated.setSeconds(0, 0);

    for (const schedule of schedules) {
      if (!schedule.enabled) continue;

      // Guard: don't fire twice in the same minute
      if (schedule.lastRunTime) {
        const lastRun = new Date(schedule.lastRunTime);
        lastRun.setSeconds(0, 0);
        if (lastRun.getTime() === nowTruncated.getTime()) continue;
      }

      // Direct cron match against current minute
      if (!matchesCron(schedule.cron, nowTruncated)) continue;

      // Schedule is due — trigger run
      console.log(`[qabot] Scheduler: triggering '${schedule.name}'`);
      const result = await this.triggerRun(schedule);

      // Update schedule metadata
      const updatedSchedule: ScheduleConfig = {
        ...schedule,
        lastRunTime: now.toISOString(),
        lastRunId: result.runId,
        nextRunTime: getNextRunTime(schedule.cron, now)?.toISOString(),
      };
      this.cloudConfigStore.saveSchedule(updatedSchedule);

      // Broadcast schedule trigger event
      if (this.wss && result.runId) {
        this.broadcast({ type: 'schedule-triggered', scheduleId: schedule.id, runId: result.runId });
      }
    }
  }

  private async triggerRun(schedule: ScheduleConfig): Promise<{ runId?: string; error?: string }> {
    if (!this.port) {
      return { error: 'Server port not set' };
    }

    try {
      const buildName = `${schedule.name}-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`;

      const response = await fetch(`http://localhost:${this.port}/api/runner/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: schedule.command,
          cloudProvider: schedule.cloudProvider || undefined,
          buildName,
          source: 'scheduler',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error(`[qabot] Scheduler: run failed for '${schedule.name}':`, err.error);
        return { error: err.error || 'Run failed' };
      }

      const data = await response.json();
      console.log(`[qabot] Scheduler: run started for '${schedule.name}': ${data.runId}`);
      return { runId: data.runId };
    } catch (err) {
      console.error(`[qabot] Scheduler: error triggering '${schedule.name}':`, err);
      return { error: String(err) };
    }
  }

  private broadcast(message: object): void {
    if (!this.wss) return;
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if ((client as WebSocket).readyState === 1 /* OPEN */) {
        client.send(data);
      }
    }
  }
}

// ── Minimal Cron Parser ───────────────────────────────────────────────────────

/**
 * Parse a cron field and check if a value matches.
 *
 * Supports: * (any), exact numbers, ranges (1-5), intervals (star/5),
 * lists (1,3,5), and range with step (1-5/2).
 */
function matchesCronField(field: string, value: number, max: number): boolean {
  if (field === '*') return true;

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    // Interval: */N or range/N
    const stepMatch = trimmed.match(/^(\*|\d+-\d+)\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[2]!, 10);
      if (stepMatch[1] === '*') {
        if (value % step === 0) return true;
      } else {
        const [start, end] = stepMatch[1]!.split('-').map(Number);
        if (value >= start! && value <= end! && (value - start!) % step === 0) return true;
      }
      continue;
    }

    // Range: N-M
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1]!, 10);
      const end = parseInt(rangeMatch[2]!, 10);
      if (value >= start && value <= end) return true;
      continue;
    }

    // Exact number
    if (/^\d+$/.test(trimmed)) {
      if (parseInt(trimmed, 10) === value) return true;
      continue;
    }
  }

  return false;
}

/**
 * Check if a Date matches a cron expression.
 *
 * Format: minute hour dayOfMonth month dayOfWeek
 * Examples: star/5 * * * * = every 5 minutes, 0 8 * * 1-5 = 8 AM weekdays
 */
function matchesCron(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return (
    matchesCronField(minute!, date.getMinutes(), 59) &&
    matchesCronField(hour!, date.getHours(), 23) &&
    matchesCronField(dayOfMonth!, date.getDate(), 31) &&
    matchesCronField(month!, date.getMonth() + 1, 12) &&
    matchesCronField(dayOfWeek!, date.getDay(), 7)
  );
}

/**
 * Compute the next time a cron expression will fire after a given date.
 * Scans forward minute-by-minute up to 7 days.
 */
export function getNextRunTime(cron: string, after?: Date): Date | null {
  const start = after ? new Date(after) : new Date();
  // Round up to next minute
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  const maxIterations = 7 * 24 * 60; // 7 days of minutes
  for (let i = 0; i < maxIterations; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (matchesCron(cron, candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Convert a cron expression to a human-readable string.
 */
export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Common patterns
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every minute';
  }
  if (minute?.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every ${minute.slice(2)} minutes`;
  }
  if (/^\d+$/.test(minute!) && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every hour at :${minute!.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Daily at ${hour!.padStart(2, '0')}:${minute!.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!) && dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `Weekdays at ${hour!.padStart(2, '0')}:${minute!.padStart(2, '0')}`;
  }
  if (/^\d+$/.test(minute!) && /^\d+$/.test(hour!) && dayOfMonth === '*' && month === '*' && dayOfWeek === '0') {
    return `Sundays at ${hour!.padStart(2, '0')}:${minute!.padStart(2, '0')}`;
  }

  return cron;
}
