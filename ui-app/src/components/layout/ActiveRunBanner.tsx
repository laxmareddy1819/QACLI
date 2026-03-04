import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, ChevronUp, Cloud,
  CheckCircle, XCircle, Loader2, Calendar, Terminal,
  ExternalLink, Square,
} from 'lucide-react';
import type { ActiveRunState } from '../../hooks/useActiveRuns';
import { cancelRun } from '../../api/client';

const PROVIDER_LABELS: Record<string, string> = {
  browserstack: 'BrowserStack',
  lambdatest: 'LambdaTest',
  saucelabs: 'Sauce Labs',
};

const PROVIDER_COLORS: Record<string, string> = {
  browserstack: 'text-orange-400',
  lambdatest: 'text-purple-400',
  saucelabs: 'text-red-400',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  scheduler: 'Scheduled',
  cli: 'CLI',
};

interface Props {
  runs: ActiveRunState[];
}

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return `${mins}m ${String(remainSecs).padStart(2, '0')}s`;
}

export function ActiveRunBanner({ runs }: Props) {
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const navigate = useNavigate();

  if (runs.length === 0) return null;

  const handleCancel = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await cancelRun(runId);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex-shrink-0 border-b border-white/5">
      {runs.map(run => {
        const isExpanded = expandedRunId === run.runId;
        const isCloud = !!run.cloudProvider;

        return (
          <div key={run.runId} className={run.currentTestName === 'Completed' ? 'bg-surface-1 border-l-2 border-emerald-500/50' : 'bg-surface-1'}>
            {/* Compact bar */}
            <div
              className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-surface-2 transition-colors"
              onClick={() => setExpandedRunId(isExpanded ? null : run.runId)}
            >
              {/* Status indicator */}
              {run.currentTestName === 'Completed' ? (
                <CheckCircle size={14} className={run.failed > 0 ? 'text-red-400 flex-shrink-0' : 'text-emerald-400 flex-shrink-0'} />
              ) : (
                <div className="relative flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <div className="absolute inset-0 w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                </div>
              )}

              {/* Status label */}
              <span className={`text-xs font-medium flex-shrink-0 ${
                run.currentTestName === 'Completed'
                  ? run.failed > 0 ? 'text-red-400' : 'text-emerald-400'
                  : 'text-amber-400'
              }`}>
                {run.currentTestName === 'Completed' ? 'Completed' : 'Running'}
              </span>

              {/* Command */}
              <span className="text-xs text-gray-400 truncate font-mono max-w-[300px]">
                {run.command}
              </span>

              {/* Cloud badge */}
              {isCloud && run.cloudProvider && (
                <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 ${PROVIDER_COLORS[run.cloudProvider] || 'text-blue-400'}`}>
                  <Cloud size={8} />
                  {PROVIDER_LABELS[run.cloudProvider] || run.cloudProvider}
                </span>
              )}

              {/* Source badge (only for non-manual) */}
              {run.source !== 'manual' && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/15 text-gray-400">
                  {run.source === 'scheduler' ? <Calendar size={8} /> : <Terminal size={8} />}
                  {SOURCE_LABELS[run.source]}
                </span>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Live counters — always visible */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-emerald-400 flex items-center gap-0.5">
                  <CheckCircle size={10} /> {run.passed}
                </span>
                <span className="text-red-400 flex items-center gap-0.5">
                  <XCircle size={10} /> {run.failed}
                </span>
              </div>

              {/* Current test name or status indicator */}
              {run.currentTestName !== 'Completed' && (
                <span className="text-[10px] text-gray-500 truncate max-w-[180px] flex items-center gap-1">
                  <Loader2 size={8} className="animate-spin" />
                  {run.currentTestName || 'Executing...'}
                </span>
              )}

              {/* Elapsed time */}
              <span className="text-xs text-gray-500 flex-shrink-0 tabular-nums font-mono">
                {formatElapsed(run.elapsedMs)}
              </span>

              {/* Expand/collapse chevron */}
              {isExpanded
                ? <ChevronUp size={14} className="text-gray-500 flex-shrink-0" />
                : <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />}
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="px-4 pb-3 pt-2 border-t border-white/5 bg-surface-2/50">
                <div className="flex items-center gap-4 text-xs">
                  {/* Full command */}
                  <div className="flex-1 min-w-0">
                    <span className="text-gray-500 block mb-1">Command</span>
                    <code className="text-gray-300 font-mono text-[11px] bg-surface-3 px-2 py-1 rounded block truncate">
                      {run.command}
                    </code>
                  </div>

                  {/* Framework */}
                  {run.framework && (
                    <div className="flex-shrink-0">
                      <span className="text-gray-500 block mb-1">Framework</span>
                      <span className="text-gray-300">{run.framework}</span>
                    </div>
                  )}

                  {/* Test count */}
                  <div className="flex-shrink-0">
                    <span className="text-gray-500 block mb-1">Tests</span>
                    <span className="text-gray-300">#{run.currentTest}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate('/runner'); }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand-500/15 text-brand-400 hover:bg-brand-500/25 text-[11px] transition-colors"
                    >
                      <ExternalLink size={10} /> View in Runner
                    </button>
                    <button
                      onClick={(e) => handleCancel(run.runId, e)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-400 hover:bg-red-500/25 text-[11px] transition-colors"
                    >
                      <Square size={10} /> Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
