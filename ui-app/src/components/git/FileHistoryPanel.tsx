import { useState } from 'react';
import {
  GitCommitHorizontal, ChevronDown, ChevronRight, User, RefreshCw,
} from 'lucide-react';
import { useGitDiff } from '../../hooks/useGit';
import type { GitCommit } from '../../api/client';

interface FileHistoryPanelProps {
  commits: GitCommit[];
  isLoading: boolean;
  filePath: string;
}

export function FileHistoryPanel({ commits, isLoading, filePath }: FileHistoryPanelProps) {
  const [expandedSha, setExpandedSha] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-gray-500 flex items-center gap-1.5">
        <RefreshCw size={10} className="animate-spin" /> Loading history...
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-gray-500">
        No commit history found for this file.
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 mb-2">
        <GitCommitHorizontal size={12} className="text-sky-400" />
        <span className="text-[10px] font-semibold text-gray-400 uppercase">
          File History ({commits.length} commit{commits.length !== 1 ? 's' : ''})
        </span>
      </div>
      <div className="space-y-0.5">
        {commits.map(commit => (
          <div key={commit.sha}>
            <button
              onClick={() => setExpandedSha(expandedSha === commit.sha ? null : commit.sha)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-2 transition-colors text-left"
            >
              <span className="text-gray-600 flex-shrink-0">
                {expandedSha === commit.sha ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              </span>
              <span className="font-mono text-sky-400/70 text-[11px] w-14 flex-shrink-0">{commit.shortSha}</span>
              <span className="text-xs text-gray-300 truncate flex-1">{commit.message}</span>
              <span className="text-[10px] text-gray-600 flex-shrink-0 flex items-center gap-1">
                <User size={9} /> {commit.author}
              </span>
              <span className="text-[10px] text-gray-600 flex-shrink-0">
                {formatRelativeTime(commit.timestamp)}
              </span>
            </button>

            {expandedSha === commit.sha && (
              <CommitFileDiff sha={commit.sha} filePath={filePath} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shows the diff for a specific file within a commit */
function CommitFileDiff({ sha, filePath }: { sha: string; filePath: string }) {
  const { data: diffData, isLoading } = useGitDiff(sha);

  if (isLoading) {
    return (
      <div className="ml-8 px-2 py-1 text-[10px] text-gray-500 flex items-center gap-1">
        <RefreshCw size={8} className="animate-spin" /> Loading diff...
      </div>
    );
  }

  // Find the specific file in the commit diff — match by ending path
  const normalizedPath = filePath.replace(/\\/g, '/');
  const file = diffData?.files?.find(f => {
    const fNorm = f.path.replace(/\\/g, '/');
    return normalizedPath.endsWith(fNorm) || fNorm.endsWith(normalizedPath) || fNorm === normalizedPath;
  });

  if (!file?.patch) {
    return (
      <div className="ml-8 px-2 py-1 text-[10px] text-gray-500">
        No diff available for this file in this commit.
      </div>
    );
  }

  return (
    <div className="ml-8 mr-2 mb-1 rounded border border-white/5 bg-black/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1 text-[10px] border-b border-white/5">
        <span className="text-emerald-400">+{file.additions}</span>
        <span className="text-red-400">-{file.deletions}</span>
      </div>
      <div className="max-h-48 overflow-auto">
        <pre className="text-[10px] font-mono leading-[1.5] whitespace-pre">
          {file.patch.split('\n').slice(0, 100).map((line, li) => {
            let bgClass = '';
            let textClass = 'text-gray-400';
            if (line.startsWith('+++') || line.startsWith('---')) {
              textClass = 'text-gray-500 font-bold';
              bgClass = 'bg-white/[0.02]';
            } else if (line.startsWith('@@')) {
              textClass = 'text-sky-400/50';
              bgClass = 'bg-sky-500/5';
            } else if (line.startsWith('+')) {
              textClass = 'text-emerald-400/70';
              bgClass = 'bg-emerald-500/8';
            } else if (line.startsWith('-')) {
              textClass = 'text-red-400/70';
              bgClass = 'bg-red-500/8';
            }
            return (
              <div key={li} className={`px-2 ${bgClass} ${textClass}`}>
                {line || ' '}
              </div>
            );
          })}
        </pre>
      </div>
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────────

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
