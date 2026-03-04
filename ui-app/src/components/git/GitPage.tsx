import { useState } from 'react';
import {
  GitBranch, GitCommitHorizontal, ChevronDown, ChevronRight,
  User, Clock, FileText, CheckCircle, XCircle,
  ArrowUp, ArrowDown, RefreshCw, Code,
} from 'lucide-react';
import {
  useGitStatus, useGitLog, useGitDiff, useGitUncommittedDiff,
  useGitStage, useGitUnstage,
} from '../../hooks/useGit';
import { useRunList } from '../../hooks/useTestResults';
import { useToast } from '../shared/Toast';
import { UncommittedDiffViewer } from './UncommittedDiffViewer';
import { GitOperationsToolbar } from './GitOperationsToolbar';
import { CommitPanel } from './CommitPanel';
import type { GitCommit } from '../../api/client';

export function GitPage() {
  const { toast } = useToast();
  const { data: gitStatus, isLoading: statusLoading, refetch: refetchStatus } = useGitStatus();
  const { data: logData, isLoading: logLoading } = useGitLog(30);
  const { data: runListData } = useRunList(10);
  const commits = logData?.commits || [];
  const runs = runListData?.runs || [];
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [showUncommittedDiffs, setShowUncommittedDiffs] = useState(false);
  const { data: uncommittedDiffData, isLoading: diffLoading } = useGitUncommittedDiff(
    undefined,
    showUncommittedDiffs,
  );

  // Stage/Unstage mutations
  const stageMutation = useGitStage();
  const unstageMutation = useGitUnstage();

  const handleStageFile = (path: string) => {
    stageMutation.mutate([path], {
      onSuccess: () => toast('success', `Staged ${path}`),
      onError: (err) => toast('error', `Stage failed: ${err.message}`),
    });
  };

  const handleUnstageFile = (path: string) => {
    unstageMutation.mutate([path], {
      onSuccess: () => toast('success', `Unstaged ${path}`),
      onError: (err) => toast('error', `Unstage failed: ${err.message}`),
    });
  };

  const handleStageAll = () => {
    const unstagedFiles = uncommittedDiffData?.files?.filter(f => !f.staged).map(f => f.path) || [];
    if (unstagedFiles.length === 0) return;
    stageMutation.mutate(unstagedFiles, {
      onSuccess: () => toast('success', `Staged ${unstagedFiles.length} file${unstagedFiles.length !== 1 ? 's' : ''}`),
      onError: (err) => toast('error', `Stage failed: ${err.message}`),
    });
  };

  const handleUnstageAll = () => {
    const stagedFiles = uncommittedDiffData?.files?.filter(f => f.staged).map(f => f.path) || [];
    if (stagedFiles.length === 0) return;
    unstageMutation.mutate(stagedFiles, {
      onSuccess: () => toast('success', `Unstaged ${stagedFiles.length} file${stagedFiles.length !== 1 ? 's' : ''}`),
      onError: (err) => toast('error', `Unstage failed: ${err.message}`),
    });
  };

  // Compute staged count for commit panel
  const stagedCount = uncommittedDiffData?.stagedCount || 0;

  // Build a map of commitSha → run results for correlation display
  const commitRunMap = new Map<string, { passed: number; failed: number; total: number }>();
  for (const run of runs) {
    if (run.gitCommitSha) {
      commitRunMap.set(run.gitCommitSha, {
        passed: run.summary?.passed || 0,
        failed: run.summary?.failed || 0,
        total: run.summary?.total || 0,
      });
    }
  }

  if (!gitStatus?.available && !statusLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="text-center max-w-md">
          <GitBranch size={48} className="text-gray-700 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-300 mb-2">Git Not Available</h2>
          <p className="text-sm text-gray-500">
            This project is not inside a git repository. Initialize a repository with{' '}
            <code className="text-gray-400 bg-surface-2 px-1.5 py-0.5 rounded">git init</code>{' '}
            to enable git integration features.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
              <GitBranch size={22} className="text-brand-400" />
              Git Integration
            </h1>
            <p className="text-sm text-gray-500 mt-1">Branch info, commit history, and repository management</p>
          </div>
          <button
            onClick={() => refetchStatus()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-surface-3 transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>

        {/* Operations Toolbar */}
        {gitStatus?.available && <GitOperationsToolbar />}

        {/* Status Card */}
        {gitStatus && gitStatus.available && (
          <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
            <h3 className="text-base font-semibold text-gray-300 mb-3 flex items-center gap-2">
              <GitBranch size={16} className="text-brand-400" />
              Repository Status
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Branch */}
              <div className="space-y-1">
                <p className="text-[10px] text-gray-600 uppercase font-semibold">Branch</p>
                <p className="text-sm text-brand-400 font-mono">{gitStatus.branch || 'detached'}</p>
              </div>

              {/* Status */}
              <div className="space-y-1">
                <p className="text-[10px] text-gray-600 uppercase font-semibold">Status</p>
                <p className={`text-sm ${gitStatus.isClean ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {gitStatus.isClean ? 'Clean' : `${gitStatus.uncommittedChanges?.length || 0} changes`}
                </p>
              </div>

              {/* Ahead/Behind */}
              <div className="space-y-1">
                <p className="text-[10px] text-gray-600 uppercase font-semibold">Sync</p>
                <div className="flex items-center gap-2 text-sm">
                  {(gitStatus.ahead || 0) > 0 && (
                    <span className="flex items-center gap-0.5 text-emerald-400">
                      <ArrowUp size={12} /> {gitStatus.ahead}
                    </span>
                  )}
                  {(gitStatus.behind || 0) > 0 && (
                    <span className="flex items-center gap-0.5 text-red-400">
                      <ArrowDown size={12} /> {gitStatus.behind}
                    </span>
                  )}
                  {!gitStatus.ahead && !gitStatus.behind && (
                    <span className="text-gray-500">Up to date</span>
                  )}
                </div>
              </div>

              {/* Last Commit */}
              <div className="space-y-1">
                <p className="text-[10px] text-gray-600 uppercase font-semibold">Last Commit</p>
                {gitStatus.lastCommit ? (
                  <div className="text-sm">
                    <span className="font-mono text-brand-400/70">{gitStatus.lastCommit.shortSha}</span>
                    <span className="text-gray-500 ml-1.5">{gitStatus.lastCommit.author}</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">—</p>
                )}
              </div>
            </div>

            {/* Uncommitted Changes */}
            {gitStatus.uncommittedChanges && gitStatus.uncommittedChanges.length > 0 && (
              <div className="mt-4 pt-3 border-t border-white/5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-gray-600 uppercase font-semibold">
                    Uncommitted Changes ({gitStatus.uncommittedChanges.length})
                  </p>
                  <button
                    onClick={() => setShowUncommittedDiffs(!showUncommittedDiffs)}
                    className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    <Code size={11} />
                    {showUncommittedDiffs ? 'Hide Diffs' : 'Show Diffs'}
                  </button>
                </div>

                {!showUncommittedDiffs && (
                  <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
                    {gitStatus.uncommittedChanges.slice(0, 20).map((c, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11px]">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          c.status === 'modified' ? 'bg-amber-400' :
                          c.status === 'added' || c.status === 'untracked' ? 'bg-emerald-400' :
                          c.status === 'deleted' ? 'bg-red-400' : 'bg-gray-400'
                        }`} />
                        <span className="text-gray-400 truncate font-mono">{c.path}</span>
                      </div>
                    ))}
                  </div>
                )}

                {showUncommittedDiffs && (
                  diffLoading ? (
                    <div className="py-3 text-xs text-gray-500 flex items-center gap-1.5 justify-center">
                      <RefreshCw size={10} className="animate-spin" /> Loading diffs...
                    </div>
                  ) : uncommittedDiffData?.files && uncommittedDiffData.files.length > 0 ? (
                    <UncommittedDiffViewer
                      files={uncommittedDiffData.files}
                      showGroups={true}
                      onStageFile={handleStageFile}
                      onUnstageFile={handleUnstageFile}
                      onStageAll={handleStageAll}
                      onUnstageAll={handleUnstageAll}
                    />
                  ) : (
                    <p className="text-xs text-gray-500 py-2">No diff data available.</p>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* Commit Panel */}
        {gitStatus?.available && !gitStatus?.isClean && (
          <CommitPanel stagedCount={stagedCount} />
        )}

        {/* Recent Commits */}
        <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
          <h3 className="text-base font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <GitCommitHorizontal size={16} className="text-gray-400" />
            Recent Commits ({commits.length})
          </h3>

          {logLoading && (
            <div className="flex items-center gap-2 py-4 text-gray-500 text-xs justify-center">
              <RefreshCw size={12} className="animate-spin" /> Loading commits...
            </div>
          )}

          {!logLoading && commits.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">No commits found.</p>
          )}

          <div className="space-y-0.5">
            {commits.map((commit: GitCommit) => {
              const runInfo = commitRunMap.get(commit.shortSha);
              return (
                <div key={commit.sha}>
                  <button
                    onClick={() => setExpandedCommit(expandedCommit === commit.sha ? null : commit.sha)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors text-left group"
                  >
                    <span className="text-gray-600 flex-shrink-0">
                      {expandedCommit === commit.sha ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <span className="font-mono text-brand-400/70 text-xs w-16 flex-shrink-0">{commit.shortSha}</span>
                    <span className="text-sm text-gray-300 truncate flex-1">{commit.message}</span>
                    <span className="flex items-center gap-1 text-[11px] text-gray-500 flex-shrink-0">
                      <User size={10} /> {commit.author}
                    </span>
                    <span className="text-[11px] text-gray-600 flex-shrink-0 w-16 text-right">
                      {formatRelativeTime(commit.timestamp)}
                    </span>
                    {/* Test result indicator for this commit */}
                    {runInfo && (
                      <span className="flex items-center gap-1 flex-shrink-0 ml-1">
                        {runInfo.failed > 0 ? (
                          <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                            <XCircle size={10} /> {runInfo.failed}
                          </span>
                        ) : (
                          <span className="flex items-center gap-0.5 text-[10px] text-emerald-400">
                            <CheckCircle size={10} /> {runInfo.passed}
                          </span>
                        )}
                      </span>
                    )}
                  </button>

                  {/* Expanded: Commit Details */}
                  {expandedCommit === commit.sha && (
                    <CommitDetailPanel sha={commit.sha} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Commit Detail Panel ─────────────────────────────────────────────────────

function CommitDetailPanel({ sha }: { sha: string }) {
  const { data: diffData, isLoading } = useGitDiff(sha);

  if (isLoading) {
    return (
      <div className="ml-10 px-3 py-2 text-xs text-gray-500 flex items-center gap-1.5">
        <RefreshCw size={10} className="animate-spin" /> Loading diff...
      </div>
    );
  }

  if (!diffData?.files || diffData.files.length === 0) {
    return (
      <div className="ml-10 px-3 py-2 text-xs text-gray-500">
        No file changes found for this commit.
      </div>
    );
  }

  return (
    <div className="ml-10 mr-3 mb-2 rounded-lg bg-surface-2/50 border border-white/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-2">
        <User size={10} /> {diffData.author}
        <span className="text-gray-700">•</span>
        <Clock size={10} /> {formatRelativeTime(diffData.timestamp)}
        <span className="text-gray-700">•</span>
        <FileText size={10} /> {diffData.files.length} file{diffData.files.length !== 1 ? 's' : ''} changed
      </div>

      {diffData.files.map((file, i) => (
        <div key={i} className="rounded border border-white/5 bg-surface-1/50">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              file.status === 'added' ? 'bg-emerald-400' :
              file.status === 'deleted' ? 'bg-red-400' :
              file.status === 'renamed' ? 'bg-sky-400' : 'bg-amber-400'
            }`} />
            <span className="text-gray-300 font-mono truncate flex-1">{file.path}</span>
            <span className="text-emerald-400 text-[11px]">+{file.additions}</span>
            <span className="text-red-400 text-[11px]">-{file.deletions}</span>
          </div>
          {file.patch && (
            <pre className="px-3 py-2 text-[11px] text-gray-400 overflow-x-auto max-h-48 overflow-y-auto border-t border-white/5 font-mono whitespace-pre">
              {file.patch.split('\n').slice(0, 50).map((line, li) => (
                <div key={li} className={
                  line.startsWith('+') && !line.startsWith('+++') ? 'text-emerald-400/70' :
                  line.startsWith('-') && !line.startsWith('---') ? 'text-red-400/70' :
                  line.startsWith('@@') ? 'text-brand-400/50' : ''
                }>
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(isoDate: string): string {
  try {
    const now = Date.now();
    const then = new Date(isoDate).getTime();
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d`;
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffDays < 90) return `${diffWeeks}w`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo`;
  } catch {
    return '';
  }
}
