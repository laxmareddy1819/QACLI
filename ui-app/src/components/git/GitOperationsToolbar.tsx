import { useState } from 'react';
import {
  ArrowDownToLine, ArrowUpFromLine, Download, GitBranch, Plus, RefreshCw, X,
} from 'lucide-react';
import {
  useGitStatus, useGitBranches,
  useGitFetchMutation, useGitPullMutation, useGitPushMutation,
  useGitCreateBranch, useGitSwitchBranch,
} from '../../hooks/useGit';
import { useToast } from '../shared/Toast';

export function GitOperationsToolbar() {
  const { toast } = useToast();
  const { data: gitStatus } = useGitStatus();
  const { data: branchesData } = useGitBranches();

  const fetchMutation = useGitFetchMutation();
  const pullMutation = useGitPullMutation();
  const pushMutation = useGitPushMutation();
  const createBranchMutation = useGitCreateBranch();
  const switchBranchMutation = useGitSwitchBranch();

  const [showNewBranch, setShowNewBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');

  const ahead = gitStatus?.ahead || 0;
  const behind = gitStatus?.behind || 0;
  const isClean = gitStatus?.isClean ?? true;

  const handleFetch = () => {
    fetchMutation.mutate(undefined, {
      onSuccess: () => toast('success', 'Fetch complete'),
      onError: (err) => toast('error', `Fetch failed: ${err.message}`),
    });
  };

  const handlePull = () => {
    pullMutation.mutate(undefined, {
      onSuccess: (data) => {
        const count = data.files?.length || 0;
        toast('success', count > 0 ? `Pulled ${count} file${count !== 1 ? 's' : ''}` : 'Already up to date');
      },
      onError: (err) => toast('error', `Pull failed: ${err.message}`),
    });
  };

  const handlePush = () => {
    pushMutation.mutate(undefined, {
      onSuccess: () => toast('success', 'Push complete'),
      onError: (err) => toast('error', `Push failed: ${err.message}`),
    });
  };

  const handleSwitchBranch = (name: string) => {
    if (name === branchesData?.current) return;

    if (!isClean) {
      const ok = window.confirm(
        'You have uncommitted changes. Switching branches may discard them. Continue?',
      );
      if (!ok) return;
    }

    switchBranchMutation.mutate(name, {
      onSuccess: () => toast('success', `Switched to ${name}`),
      onError: (err) => toast('error', `Switch failed: ${err.message}`),
    });
  };

  const handleCreateBranch = () => {
    const name = newBranchName.trim();
    if (!name) return;

    createBranchMutation.mutate({ name, checkout: true }, {
      onSuccess: () => {
        toast('success', `Created and switched to ${name}`);
        setNewBranchName('');
        setShowNewBranch(false);
      },
      onError: (err) => toast('error', `Create failed: ${err.message}`),
    });
  };

  const anyPending =
    fetchMutation.isPending || pullMutation.isPending ||
    pushMutation.isPending || switchBranchMutation.isPending ||
    createBranchMutation.isPending;

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 px-4 py-3">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Remote Operations */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleFetch}
            disabled={fetchMutation.isPending || anyPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Fetch from remote"
          >
            {fetchMutation.isPending ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <Download size={12} />
            )}
            Fetch
          </button>

          <button
            onClick={handlePull}
            disabled={pullMutation.isPending || anyPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Pull from remote"
          >
            {pullMutation.isPending ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <ArrowDownToLine size={12} />
            )}
            Pull
            {behind > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                {behind}
              </span>
            )}
          </button>

          <button
            onClick={handlePush}
            disabled={pushMutation.isPending || anyPending || ahead === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={ahead === 0 ? 'Nothing to push' : 'Push to remote'}
          >
            {pushMutation.isPending ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <ArrowUpFromLine size={12} />
            )}
            Push
            {ahead > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                {ahead}
              </span>
            )}
          </button>
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Branch Selector */}
        <div className="flex items-center gap-1.5">
          <GitBranch size={13} className="text-sky-400" />
          <select
            value={branchesData?.current || ''}
            onChange={(e) => handleSwitchBranch(e.target.value)}
            disabled={switchBranchMutation.isPending || anyPending}
            className="bg-surface-2 border border-white/5 rounded-lg px-2 py-1.5 text-xs text-gray-300 disabled:opacity-50 cursor-pointer focus:outline-none focus:border-sky-500/50"
          >
            {(branchesData?.branches || []).map(b => (
              <option key={b.name} value={b.name}>
                {b.name}{b.current ? ' (current)' : ''}
              </option>
            ))}
            {(!branchesData?.branches || branchesData.branches.length === 0) && (
              <option value="">{gitStatus?.branch || 'No branches'}</option>
            )}
          </select>

          {/* New Branch */}
          {!showNewBranch ? (
            <button
              onClick={() => setShowNewBranch(true)}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs text-sky-400 hover:text-sky-300 hover:bg-surface-2 border border-transparent hover:border-white/5 transition-colors"
              title="Create new branch"
            >
              <Plus size={12} /> Branch
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBranch(); if (e.key === 'Escape') { setShowNewBranch(false); setNewBranchName(''); } }}
                placeholder="branch-name"
                className="bg-surface-2 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 w-36 focus:outline-none focus:border-sky-500/50"
                autoFocus
              />
              <button
                onClick={handleCreateBranch}
                disabled={!newBranchName.trim() || createBranchMutation.isPending}
                className="px-2 py-1 rounded text-xs bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createBranchMutation.isPending ? (
                  <RefreshCw size={10} className="animate-spin" />
                ) : 'Create'}
              </button>
              <button
                onClick={() => { setShowNewBranch(false); setNewBranchName(''); }}
                className="p-1 rounded hover:bg-surface-3 text-gray-500"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
