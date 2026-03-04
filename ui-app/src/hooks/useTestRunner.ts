import { useState, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { startRun, cancelRun, getRunHistory } from '../api/client';
import type { RunResult, WSMessage } from '../api/types';

interface RunOutput {
  stream: 'stdout' | 'stderr';
  data: string;
}

export function useTestRunner(subscribe: (handler: (msg: WSMessage) => void) => () => void) {
  const [activeRun, setActiveRun] = useState<{ runId: string; command: string } | null>(null);
  const [output, setOutput] = useState<RunOutput[]>([]);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'output' && msg.runId === activeRun?.runId) {
        setOutput((prev) => [...prev, { stream: msg.stream as 'stdout' | 'stderr', data: msg.data as string }]);
      }
      if (msg.type === 'complete' && msg.runId === activeRun?.runId) {
        setRunResult({
          runId: activeRun.runId,
          command: activeRun.command,
          startTime: '',
          status: msg.exitCode === 0 ? 'completed' : 'failed',
          exitCode: msg.exitCode as number,
          duration: msg.duration as number,
        });
        setActiveRun(null);
      }
    });
  }, [subscribe, activeRun]);

  const run = useCallback(async (options: Parameters<typeof startRun>[0]) => {
    setOutput([]);
    setRunResult(null);
    const result = await startRun(options);
    setActiveRun({ runId: result.runId, command: result.command });
    return result;
  }, []);

  const cancel = useCallback(async () => {
    if (activeRun) {
      await cancelRun(activeRun.runId);
      setActiveRun(null);
    }
  }, [activeRun]);

  // Attach to an externally-started run (e.g., scheduled or triggered from another page)
  const attachToRun = useCallback((runId: string, command: string) => {
    setOutput([]);
    setRunResult(null);
    setActiveRun({ runId, command });
  }, []);

  return { activeRun, output, runResult, run, cancel, attachToRun };
}

export function useRunHistory() {
  return useQuery({
    queryKey: ['runHistory'],
    queryFn: getRunHistory,
    refetchInterval: 5000,
  });
}
