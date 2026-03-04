import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir } from '../../utils/index.js';
import type {
  StoredRun, StoredTestCase, TestHistoryEntry, FailureGroup,
  TrendDataPoint, FlakySummary, CloudArtifacts,
} from '../types.js';

const MAX_RUNS = 100;
const MAX_HISTORY_PER_TEST = 30;

interface StoreData {
  runs: StoredRun[];
  testHistory: Record<string, TestHistoryEntry[]>;
}

export class TestResultsStore {
  private data: StoreData = { runs: [], testHistory: {} };
  private filePath: string;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'test-results.json');
    this.load();
  }

  // ── Run Management ──────────────────────────────────────────────────────────

  saveRun(run: StoredRun): void {
    // Remove existing run with same ID (update scenario)
    this.data.runs = this.data.runs.filter(r => r.runId !== run.runId);
    this.data.runs.unshift(run);

    // Prune oldest
    if (this.data.runs.length > MAX_RUNS) {
      this.data.runs = this.data.runs.slice(0, MAX_RUNS);
    }

    // Update per-test history
    for (const test of run.tests) {
      const entry: TestHistoryEntry = {
        runId: run.runId,
        status: test.status,
        duration: test.duration,
        timestamp: run.endTime || run.startTime,
        browser: test.browser,
      };
      const history = this.data.testHistory[test.name] || [];
      history.unshift(entry);
      this.data.testHistory[test.name] = history.slice(0, MAX_HISTORY_PER_TEST);
    }

    this.save();
  }

  getRun(runId: string): StoredRun | undefined {
    return this.data.runs.find(r => r.runId === runId);
  }

  getRunHistory(limit = 20, offset = 0): { runs: StoredRun[]; total: number } {
    return {
      runs: this.data.runs.slice(offset, offset + limit),
      total: this.data.runs.length,
    };
  }

  // ── Test Cases ──────────────────────────────────────────────────────────────

  getTestCases(runId: string, status?: string): StoredTestCase[] {
    const run = this.getRun(runId);
    if (!run) return [];
    if (status) return run.tests.filter(t => t.status === status);
    return run.tests;
  }

  getFailures(runId: string): StoredTestCase[] {
    return this.getTestCases(runId, 'failed');
  }

  // ── Analytics ───────────────────────────────────────────────────────────────

  getTrends(count = 20): TrendDataPoint[] {
    return this.data.runs.slice(0, count).reverse().map(run => ({
      runId: run.runId,
      timestamp: run.startTime,
      total: run.summary.total,
      passed: run.summary.passed,
      failed: run.summary.failed,
      skipped: run.summary.skipped,
      passRate: run.summary.passRate,
      duration: run.duration || 0,
    }));
  }

  getFlaky(threshold = 0.2): FlakySummary[] {
    const results: FlakySummary[] = [];

    for (const [testName, history] of Object.entries(this.data.testHistory)) {
      if (history.length < 3) continue; // Need at least 3 runs

      const statuses = history.map(h => h.status);
      let flips = 0;
      for (let i = 1; i < statuses.length; i++) {
        if (statuses[i] !== statuses[i - 1]) flips++;
      }

      const flakinessRate = flips / (statuses.length - 1);
      if (flakinessRate >= threshold) {
        results.push({
          testName,
          totalRuns: history.length,
          passCount: statuses.filter(s => s === 'passed').length,
          failCount: statuses.filter(s => s === 'failed').length,
          flakinessRate,
          lastSeen: history[0]?.timestamp || '',
          recentStatuses: statuses.slice(0, 10),
        });
      }
    }

    return results.sort((a, b) => b.flakinessRate - a.flakinessRate);
  }

  getSlowest(count = 20): Array<{ name: string; avgDuration: number; maxDuration: number; file?: string }> {
    const durMap = new Map<string, { durations: number[]; file?: string }>();

    for (const run of this.data.runs) {
      for (const test of run.tests) {
        if (test.duration == null) continue;
        const entry = durMap.get(test.name) || { durations: [], file: test.file };
        entry.durations.push(test.duration);
        durMap.set(test.name, entry);
      }
    }

    return Array.from(durMap.entries())
      .map(([name, { durations, file }]) => ({
        name,
        avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
        maxDuration: Math.max(...durations),
        file,
      }))
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, count);
  }

  getTopFailures(count = 20): Array<{ testName: string; failureCount: number; lastFailure: string; lastError?: string }> {
    const failMap = new Map<string, { count: number; lastFailure: string; lastError?: string }>();

    for (const run of this.data.runs) {
      for (const test of run.tests) {
        if (test.status !== 'failed') continue;
        const existing = failMap.get(test.name);
        if (existing) {
          existing.count++;
        } else {
          failMap.set(test.name, {
            count: 1,
            lastFailure: run.startTime,
            lastError: test.errorMessage,
          });
        }
      }
    }

    return Array.from(failMap.entries())
      .map(([testName, data]) => ({ testName, failureCount: data.count, lastFailure: data.lastFailure, lastError: data.lastError }))
      .sort((a, b) => b.failureCount - a.failureCount)
      .slice(0, count);
  }

  getTestHistory(testName: string): TestHistoryEntry[] {
    return this.data.testHistory[testName] || [];
  }

  // ── AI Failure Analysis ─────────────────────────────────────────────────────

  saveFailureAnalysis(runId: string, groups: FailureGroup[]): void {
    const run = this.getRun(runId);
    if (run) {
      run.failureAnalysis = groups;
      this.save();
    }
  }

  getFailureAnalysis(runId: string): FailureGroup[] | undefined {
    return this.getRun(runId)?.failureAnalysis;
  }

  // ── Cloud Artifacts ───────────────────────────────────────────────────────

  updateRunArtifacts(runId: string, artifacts: CloudArtifacts): void {
    const run = this.getRun(runId);
    if (run) {
      run.cloudArtifacts = artifacts;
      this.save();
    }
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as StoreData;
        this.data = {
          runs: Array.isArray(parsed.runs) ? parsed.runs : [],
          testHistory: parsed.testHistory && typeof parsed.testHistory === 'object' ? parsed.testHistory : {},
        };
      }
    } catch {
      this.data = { runs: [], testHistory: {} };
    }
  }

  private save(): void {
    try {
      const dir = getQabotDir();
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.filePath, JSON.stringify(this.data), 'utf-8');
    } catch {
      // Silently ignore save failures
    }
  }
}
