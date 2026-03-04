import { useRunHistory } from '../../hooks/useTestRunner';
import { CheckCircle, XCircle, Clock, Ban } from 'lucide-react';
import type { RunResult } from '../../api/types';

export function RunHistory() {
  const { data, isLoading } = useRunHistory();
  const history = data?.history ?? [];

  if (isLoading) return <div className="text-xs text-gray-500 p-3">Loading history...</div>;

  if (history.length === 0) {
    return <div className="text-xs text-gray-500 p-4 text-center">No previous runs</div>;
  }

  return (
    <div className="space-y-1.5 max-h-72 overflow-y-auto">
      {history.map((run) => (
        <RunHistoryItem key={run.runId} run={run} />
      ))}
    </div>
  );
}

function RunHistoryItem({ run }: { run: RunResult }) {
  const statusIcons = {
    completed: <CheckCircle size={14} className="text-emerald-400" />,
    failed: <XCircle size={14} className="text-red-400" />,
    running: <Clock size={14} className="text-amber-400 animate-pulse" />,
    cancelled: <Ban size={14} className="text-gray-400" />,
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-white/5 text-xs">
      {statusIcons[run.status]}
      <span className="font-mono text-gray-300 flex-1 truncate">{run.command}</span>
      {run.duration != null && (
        <span className="text-gray-500">{(run.duration / 1000).toFixed(1)}s</span>
      )}
      {run.startTime && (
        <span className="text-gray-600 text-[10px]">
          {new Date(run.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}
