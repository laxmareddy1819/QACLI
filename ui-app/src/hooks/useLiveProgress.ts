import { useState, useEffect, useCallback, useRef } from 'react';
import type { WSMessage } from '../api/types';

export interface LiveTest {
  name: string;
  status: 'passed' | 'failed' | 'running';
  duration?: number;
}

export interface LiveProgressState {
  current: number;
  total: number;
  currentTestName: string;
  passed: number;
  failed: number;
  tests: LiveTest[];
  elapsedMs: number;
  summary: { runId: string; total: number; passed: number; failed: number; skipped: number; passRate: number; duration: number } | null;
}

export function useLiveProgress(
  subscribe: (handler: (msg: WSMessage) => void) => () => void,
  activeRunId?: string | null,
) {
  const [state, setState] = useState<LiveProgressState>({
    current: 0,
    total: 0,
    currentTestName: '',
    passed: 0,
    failed: 0,
    tests: [],
    elapsedMs: 0,
    summary: null,
  });

  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    startTimeRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setState({
      current: 0,
      total: 0,
      currentTestName: '',
      passed: 0,
      failed: 0,
      tests: [],
      elapsedMs: 0,
      summary: null,
    });
  }, []);

  // Start elapsed timer when a run begins
  useEffect(() => {
    if (activeRunId) {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setState(prev => ({ ...prev, elapsedMs: Date.now() - startTimeRef.current! }));
        }
      }, 500);
    } else if (!activeRunId && startTimeRef.current) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeRunId]);

  useEffect(() => {
    if (!activeRunId) return;

    return subscribe((msg) => {
      const runId = (msg as any).runId;
      if (runId && runId !== activeRunId) return;

      if (msg.type === 'test-progress') {
        setState(prev => ({
          ...prev,
          current: msg.current as number,
          total: msg.total as number || prev.total,
          currentTestName: msg.testName as string,
        }));
      }

      if (msg.type === 'test-passed') {
        setState(prev => ({
          ...prev,
          passed: prev.passed + 1,
          tests: [...prev.tests, { name: msg.testName as string, status: 'passed', duration: msg.duration as number }],
        }));
      }

      if (msg.type === 'test-failed') {
        setState(prev => ({
          ...prev,
          failed: prev.failed + 1,
          tests: [...prev.tests, { name: msg.testName as string, status: 'failed', duration: msg.duration as number }],
        }));
      }

      if (msg.type === 'test-results') {
        const s = msg.summary as any;
        setState(prev => ({
          ...prev,
          summary: { runId: activeRunId, ...s },
        }));
      }
    });
  }, [subscribe, activeRunId]);

  return { ...state, reset };
}
