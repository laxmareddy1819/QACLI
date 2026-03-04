import { useQuery } from '@tanstack/react-query';
import { getTestExplorer, getTestCaseHistory, getTestSource, getTestSourceByName, resolveStepDefinitions } from '../api/client';
import type { ExplorerStep } from '../api/types';

export function useTestExplorer() {
  return useQuery({
    queryKey: ['test-explorer'],
    queryFn: getTestExplorer,
    refetchInterval: 30000,
  });
}

export function useTestCaseHistory(name: string | null) {
  return useQuery({
    queryKey: ['test-history', name],
    queryFn: () => getTestCaseHistory(name!),
    enabled: !!name,
  });
}

export function useTestSource(
  file: string | null,
  startLine: number | null,
  endLine?: number | null,
  framework?: string | null,
) {
  return useQuery({
    queryKey: ['test-source', file, startLine, endLine],
    queryFn: () => getTestSource(file!, startLine!, endLine ?? undefined, framework ?? undefined),
    enabled: !!file && !!startLine,
    staleTime: 60000,
  });
}

export function useTestSourceByName(
  file: string | null,
  testName: string | null,
) {
  return useQuery({
    queryKey: ['test-source-by-name', file, testName],
    queryFn: () => getTestSourceByName(file!, testName!),
    enabled: !!file && !!testName,
    staleTime: 60000,
  });
}

export function useStepDefinitions(steps: ExplorerStep[] | null, isCucumber: boolean) {
  return useQuery({
    queryKey: ['step-definitions', steps?.map(s => `${s.keyword}:${s.name}`).join('|')],
    queryFn: () => resolveStepDefinitions(steps!),
    enabled: isCucumber && !!steps && steps.length > 0,
    staleTime: 120000,
  });
}

/** @deprecated Use useTestCaseHistory */
export const useScenarioHistory = useTestCaseHistory;
