import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGitStatus,
  getGitBlame,
  getGitLog,
  getGitDiff,
  getGitChurn,
  getGitCorrelation,
  getGitOwnership,
  getGitUncommittedDiff,
  getGitBranches,
  gitStageFiles,
  gitUnstageFiles,
  gitCommit,
  gitFetch,
  gitPull,
  gitPush,
  gitCreateBranch,
  gitSwitchBranch,
} from '../api/client';

// ── Read Queries ────────────────────────────────────────────────────────────

export function useGitStatus() {
  return useQuery({
    queryKey: ['git-status'],
    queryFn: getGitStatus,
    refetchInterval: 30000,
  });
}

export function useGitBlame(filePath: string | null) {
  return useQuery({
    queryKey: ['git-blame', filePath],
    queryFn: () => getGitBlame(filePath!),
    enabled: !!filePath,
  });
}

export function useGitLog(limit = 20, file?: string | null) {
  return useQuery({
    queryKey: ['git-log', limit, file],
    queryFn: () => getGitLog(limit, file || undefined),
    enabled: true,
  });
}

export function useGitFileHistory(file: string | null, limit = 20) {
  return useQuery({
    queryKey: ['git-file-history', file, limit],
    queryFn: () => getGitLog(limit, file || undefined),
    enabled: !!file,
  });
}

export function useGitDiff(sha: string | null) {
  return useQuery({
    queryKey: ['git-diff', sha],
    queryFn: () => getGitDiff(sha!),
    enabled: !!sha,
  });
}

export function useGitUncommittedDiff(filePath?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['git-uncommitted-diff', filePath ?? 'all'],
    queryFn: () => getGitUncommittedDiff(filePath || undefined),
    enabled,
    refetchInterval: 15000,
  });
}

export function useGitChurn(filePath: string | null, days = 30) {
  return useQuery({
    queryKey: ['git-churn', filePath, days],
    queryFn: () => getGitChurn(filePath!, days),
    enabled: !!filePath,
  });
}

export function useGitCorrelation(runId: string | null) {
  return useQuery({
    queryKey: ['git-correlation', runId],
    queryFn: () => getGitCorrelation(runId!),
    enabled: !!runId,
  });
}

export function useGitOwnership(runId: string | null) {
  return useQuery({
    queryKey: ['git-ownership', runId],
    queryFn: () => getGitOwnership(runId!),
    enabled: !!runId,
  });
}

export function useGitBranches() {
  return useQuery({
    queryKey: ['git-branches'],
    queryFn: getGitBranches,
  });
}

// ── Mutations (invalidate all git queries on success) ───────────────────────

function useGitMutation<TData, TVariables>(
  mutationFn: (vars: TVariables) => Promise<TData>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['git-status'] });
      queryClient.invalidateQueries({ queryKey: ['git-log'] });
      queryClient.invalidateQueries({ queryKey: ['git-uncommitted-diff'] });
      queryClient.invalidateQueries({ queryKey: ['git-branches'] });
    },
  });
}

export function useGitStage() {
  return useGitMutation((files: string[]) => gitStageFiles(files));
}

export function useGitUnstage() {
  return useGitMutation((files: string[]) => gitUnstageFiles(files));
}

export function useGitCommitMutation() {
  return useGitMutation((message: string) => gitCommit(message));
}

export function useGitFetchMutation() {
  return useGitMutation((remote?: string) => gitFetch(remote));
}

export function useGitPullMutation() {
  return useGitMutation(
    (params?: { remote?: string; branch?: string }) => gitPull(params?.remote, params?.branch),
  );
}

export function useGitPushMutation() {
  return useGitMutation(
    (params?: { remote?: string; branch?: string }) => gitPush(params?.remote, params?.branch),
  );
}

export function useGitCreateBranch() {
  return useGitMutation(
    (params: { name: string; checkout?: boolean }) => gitCreateBranch(params.name, params.checkout),
  );
}

export function useGitSwitchBranch() {
  return useGitMutation((name: string) => gitSwitchBranch(name));
}
