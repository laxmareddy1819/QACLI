import { useState } from 'react';
import { GitCommitHorizontal, RefreshCw } from 'lucide-react';
import { useGitCommitMutation } from '../../hooks/useGit';
import { useToast } from '../shared/Toast';

interface CommitPanelProps {
  stagedCount: number;
}

export function CommitPanel({ stagedCount }: CommitPanelProps) {
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const commitMutation = useGitCommitMutation();

  const canCommit = stagedCount > 0 && message.trim().length > 0 && !commitMutation.isPending;

  const handleCommit = () => {
    if (!canCommit) return;

    commitMutation.mutate(message.trim(), {
      onSuccess: (data) => {
        toast('success', `Committed ${data.commit || ''} on ${data.branch || 'branch'}`);
        setMessage('');
      },
      onError: (err) => toast('error', `Commit failed: ${err.message}`),
    });
  };

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <GitCommitHorizontal size={14} className="text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-300">Commit</h3>
        {stagedCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
            {stagedCount} staged
          </span>
        )}
        {stagedCount === 0 && (
          <span className="text-[10px] text-gray-600">No staged files</span>
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleCommit();
            }
          }}
          placeholder="Enter commit message... (Ctrl+Enter to commit)"
          rows={2}
          className="flex-1 bg-surface-2 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 resize-none focus:outline-none focus:border-sky-500/50 font-mono"
        />
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          className="self-end px-4 py-2 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
        >
          {commitMutation.isPending ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : (
            <GitCommitHorizontal size={12} />
          )}
          Commit
        </button>
      </div>
    </div>
  );
}
