import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getResultRuns, getResultRun, getResultTrends,
  getFlakyTests, getTopFailures, getSlowestTests,
  analyzeFailures, getTestHistory,
} from '../api/client';

export function useRunList(limit = 20, offset = 0) {
  return useQuery({
    queryKey: ['result-runs', limit, offset],
    queryFn: () => getResultRuns(limit, offset),
    refetchInterval: 10000,
  });
}

export function useRunDetail(runId: string | null) {
  return useQuery({
    queryKey: ['result-run', runId],
    queryFn: () => getResultRun(runId!),
    enabled: !!runId,
  });
}

export function useTestTrends(count = 20) {
  return useQuery({
    queryKey: ['test-trends', count],
    queryFn: () => getResultTrends(count),
    refetchInterval: 15000,
  });
}

export function useFlakyTests() {
  return useQuery({
    queryKey: ['flaky-tests'],
    queryFn: () => getFlakyTests(),
    refetchInterval: 30000,
  });
}

export function useTopFailures(count = 10) {
  return useQuery({
    queryKey: ['top-failures', count],
    queryFn: () => getTopFailures(count),
    refetchInterval: 15000,
  });
}

export function useSlowestTests(count = 10) {
  return useQuery({
    queryKey: ['slowest-tests', count],
    queryFn: () => getSlowestTests(count),
  });
}

export function useAnalyzeFailures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => analyzeFailures(runId),
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({ queryKey: ['result-run', runId] });
    },
  });
}

export function useTestHistoryData(testName: string | null) {
  return useQuery({
    queryKey: ['test-history', testName],
    queryFn: () => getTestHistory(testName!),
    enabled: !!testName,
  });
}
