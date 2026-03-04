import { useState, useEffect, useCallback, useRef } from 'react';
import { getActiveRuns } from '../api/client';
import type { WSMessage } from '../api/types';

export interface ActiveRunState {
  runId: string;
  command: string;
  startTime: string;
  framework: string | null;
  cloudProvider?: string;
  source: 'manual' | 'scheduler' | 'cli';
  // Live progress
  passed: number;
  failed: number;
  currentTest: number;
  currentTestName: string;
  elapsedMs: number;
}

/**
 * Global hook that tracks ALL active test runs across the application.
 * Lives in AppShell so it works on every page, not just the Runner page.
 *
 * - On mount: fetches GET /api/runner/active to catch runs already in progress
 * - Subscribes to WebSocket: run-started, complete, test-passed, test-failed, test-progress
 * - Maintains a Map of all active runs with their live progress counters
 */
export function useActiveRuns(
  subscribe: (handler: (msg: WSMessage) => void) => () => void,
) {
  const [runs, setRuns] = useState<Map<string, ActiveRunState>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const startTimesRef = useRef<Map<string, number>>(new Map());

  // Start an elapsed timer for a run
  const startTimer = useCallback((runId: string, startTime: string) => {
    if (timersRef.current.has(runId)) return;
    const startMs = new Date(startTime).getTime();
    startTimesRef.current.set(runId, startMs);
    const timer = setInterval(() => {
      setRuns(prev => {
        const run = prev.get(runId);
        if (!run) return prev;
        const next = new Map(prev);
        next.set(runId, { ...run, elapsedMs: Date.now() - startMs });
        return next;
      });
    }, 1000);
    timersRef.current.set(runId, timer);
  }, []);

  // Stop timer for a run
  const stopTimer = useCallback((runId: string) => {
    const timer = timersRef.current.get(runId);
    if (timer) {
      clearInterval(timer);
      timersRef.current.delete(runId);
    }
    startTimesRef.current.delete(runId);
  }, []);

  // Fetch active runs on mount (handles page refresh / late navigation)
  useEffect(() => {
    getActiveRuns()
      .then(data => {
        const map = new Map<string, ActiveRunState>();
        for (const run of data.runs) {
          const state: ActiveRunState = {
            runId: run.runId,
            command: run.command,
            startTime: run.startTime,
            framework: run.framework,
            cloudProvider: run.cloudProvider,
            source: run.source,
            passed: 0,
            failed: 0,
            currentTest: 0,
            currentTestName: '',
            elapsedMs: Date.now() - new Date(run.startTime).getTime(),
          };
          map.set(run.runId, state);
          startTimer(run.runId, run.startTime);
        }
        if (map.size > 0) setRuns(map);
      })
      .catch(() => {
        // Server may not support this endpoint yet
      });

    return () => {
      // Cleanup all timers on unmount
      for (const timer of timersRef.current.values()) {
        clearInterval(timer);
      }
      timersRef.current.clear();
    };
  }, [startTimer]);

  // Subscribe to WebSocket messages for live updates
  useEffect(() => {
    return subscribe((msg) => {
      // New run started
      if (msg.type === 'run-started') {
        const runId = msg.runId as string;
        const command = msg.command as string;
        const startTime = msg.startTime as string;
        const framework = msg.framework as string | null;
        const cloudProvider = msg.cloudProvider as string | undefined;
        const source = (msg.source as 'manual' | 'scheduler' | 'cli') || 'manual';
        setRuns(prev => {
          const next = new Map(prev);
          next.set(runId, {
            runId,
            command,
            startTime,
            framework,
            cloudProvider,
            source,
            passed: 0,
            failed: 0,
            currentTest: 0,
            currentTestName: '',
            elapsedMs: 0,
          });
          return next;
        });
        startTimer(runId, startTime);
      }

      // Run completed — update final counts then remove after delay
      if (msg.type === 'complete') {
        const runId = msg.runId as string;
        const passed = msg.passed as number | undefined;
        const failed = msg.failed as number | undefined;
        stopTimer(runId);
        // Update counts from complete message (belt-and-suspenders with test-results)
        setRuns(prev => {
          const run = prev.get(runId);
          if (!run) return prev;
          const next = new Map(prev);
          next.set(runId, {
            ...run,
            passed: passed ?? run.passed,
            failed: failed ?? run.failed,
            currentTestName: 'Completed',
          });
          return next;
        });
        // Keep banner visible for 8s so user sees final results
        setTimeout(() => {
          setRuns(prev => {
            const next = new Map(prev);
            next.delete(runId);
            return next;
          });
        }, 8000);
      }

      // Run error (process crash)
      if (msg.type === 'error' && msg.runId) {
        const runId = msg.runId as string;
        stopTimer(runId);
        setRuns(prev => {
          const next = new Map(prev);
          next.delete(runId);
          return next;
        });
      }

      // Test passed — increment counter
      if (msg.type === 'test-passed' && msg.runId) {
        const runId = msg.runId as string;
        setRuns(prev => {
          const run = prev.get(runId);
          if (!run) return prev;
          const next = new Map(prev);
          next.set(runId, { ...run, passed: run.passed + 1 });
          return next;
        });
      }

      // Test failed — increment counter
      if (msg.type === 'test-failed' && msg.runId) {
        const runId = msg.runId as string;
        setRuns(prev => {
          const run = prev.get(runId);
          if (!run) return prev;
          const next = new Map(prev);
          next.set(runId, { ...run, failed: run.failed + 1 });
          return next;
        });
      }

      // Test results summary — authoritative final counts from full stdout parse.
      // Handles cloud runs where real-time stdout detection doesn't work.
      if (msg.type === 'test-results' && msg.runId) {
        const runId = msg.runId as string;
        const summary = msg.summary as { passed: number; failed: number } | undefined;
        if (summary) {
          setRuns(prev => {
            const run = prev.get(runId);
            if (!run) return prev;
            const next = new Map(prev);
            next.set(runId, { ...run, passed: summary.passed, failed: summary.failed });
            return next;
          });
        }
      }

      // Test progress — update current test info
      if (msg.type === 'test-progress' && msg.runId) {
        const runId = msg.runId as string;
        const current = msg.current as number;
        const testName = msg.testName as string;
        setRuns(prev => {
          const run = prev.get(runId);
          if (!run) return prev;
          const next = new Map(prev);
          next.set(runId, {
            ...run,
            currentTest: current,
            currentTestName: testName,
          });
          return next;
        });
      }
    });
  }, [subscribe, startTimer, stopTimer]);

  const runsArray = Array.from(runs.values());

  return {
    runs: runsArray,
    hasActiveRuns: runsArray.length > 0,
    activeRunCount: runsArray.length,
  };
}
