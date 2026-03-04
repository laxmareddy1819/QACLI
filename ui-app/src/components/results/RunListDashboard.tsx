import { useMemo } from 'react';
import { Clock, Cloud, Play, BarChart3, Calendar, Terminal } from 'lucide-react';
import { EmptyState } from '../shared/EmptyState';

// ── Types ────────────────────────────────────────────────────────────────────

interface RunListDashboardProps {
  runs: any[];
  total: number;
  isLoading: boolean;
  onSelectRun: (runId: string) => void;
}

const CLOUD_SHORT: Record<string, string> = {
  browserstack: 'BS',
  lambdatest: 'LT',
  saucelabs: 'SL',
};

const STATUS_DOT: Record<string, string> = {
  running: 'bg-amber-400 animate-pulse',
  completed: 'bg-emerald-400',
  failed: 'bg-red-400',
  cancelled: 'bg-gray-500',
};

const STATUS_BADGE: Record<string, string> = {
  running: 'bg-amber-500/15 text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  cancelled: 'bg-gray-500/15 text-gray-400',
};

// ── Component ────────────────────────────────────────────────────────────────

export function RunListDashboard({ runs, total, isLoading, onSelectRun }: RunListDashboardProps) {
  // ── Empty ───────────────────────────────────────────────────────────────
  if (!isLoading && runs.length === 0) {
    return (
      <EmptyState
        title="No Test Runs"
        description="Run tests from the Runner page to see results here."
        icon={<BarChart3 size={28} />}
      />
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  const passRateColor = (rate: number) =>
    rate >= 90 ? 'text-emerald-400' : rate >= 70 ? 'text-amber-400' : 'text-red-400';

  const formatDuration = (ms?: number) => {
    if (!ms) return null;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return `${m}m ${rem}s`;
  };

  const formatTimestamp = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  const relativeTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="space-y-2 animate-fade-in">
      {runs.map((run: any) => {
        const summary = run.summary || { total: 0, passed: 0, failed: 0, skipped: 0, passRate: 0 };
        const runTotal = summary.total || 1;
        const passW = (summary.passed / runTotal) * 100;
        const failW = (summary.failed / runTotal) * 100;
        const skipW = (summary.skipped / runTotal) * 100;

        return (
          <button
            key={run.runId}
            onClick={() => onSelectRun(run.runId)}
            className="w-full text-left bg-surface-1 rounded-xl border border-white/5 p-4 hover:border-white/10 hover:bg-surface-2/50 transition-all cursor-pointer group"
          >
            {/* Row 1: Status + Timestamp + Duration + Pass Rate */}
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[run.status] || 'bg-gray-500'}`} />
                <span className="text-sm text-gray-200 font-medium">
                  {formatTimestamp(run.startTime)}
                </span>
                <span className="text-[10px] text-gray-600">{relativeTime(run.startTime)}</span>
                <span className={`px-1.5 py-0.5 rounded-lg text-[10px] font-medium ${STATUS_BADGE[run.status] || 'bg-gray-500/15 text-gray-400'}`}>
                  {run.status}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {run.duration && (
                  <span className="text-xs text-gray-500">
                    <Clock size={10} className="inline mr-1" />
                    {formatDuration(run.duration)}
                  </span>
                )}
                {summary.total > 0 && (
                  <span className={`text-sm font-semibold ${passRateColor(summary.passRate)}`}>
                    {summary.passRate}%
                  </span>
                )}
              </div>
            </div>

            {/* Row 1b: Command + Schedule/Build name */}
            {(run.command || run.cloudBuildName) && (
              <div className="flex items-center gap-2 mb-2.5 ml-[18px]">
                {run.command && (
                  <span className="flex items-center gap-1 text-xs text-gray-500 font-mono">
                    <Terminal size={10} className="flex-shrink-0 text-gray-600" />
                    {run.command}
                  </span>
                )}
                {run.cloudBuildName && (
                  <span className="flex items-center gap-1 text-[11px] text-amber-400/70 flex-shrink-0">
                    <Calendar size={10} />
                    {run.cloudBuildName}
                  </span>
                )}
              </div>
            )}

            {/* Row 2: Pass/Fail bar + Counts */}
            {summary.total > 0 && (
              <div className="flex items-center gap-3 mb-2.5">
                {/* Progress bar */}
                <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-surface-2">
                  {summary.passed > 0 && (
                    <div className="bg-emerald-500/30 transition-all" style={{ width: `${passW}%` }} />
                  )}
                  {summary.failed > 0 && (
                    <div className="bg-red-500/30 transition-all" style={{ width: `${failW}%` }} />
                  )}
                  {summary.skipped > 0 && (
                    <div className="bg-gray-600/30 transition-all" style={{ width: `${skipW}%` }} />
                  )}
                </div>
                {/* Counts */}
                <div className="flex items-center gap-2 flex-shrink-0 text-[13px]">
                  <span className="text-emerald-400">{summary.passed} passed</span>
                  {summary.failed > 0 && <span className="text-red-400">{summary.failed} failed</span>}
                  {summary.skipped > 0 && <span className="text-gray-500">{summary.skipped} skipped</span>}
                  <span className="text-gray-600">({summary.total} total)</span>
                </div>
              </div>
            )}

            {/* Row 3: Framework + Cloud + Build name */}
            <div className="flex items-center gap-2 text-[11px]">
              {run.framework && (
                <span className="px-1.5 py-0.5 rounded-lg bg-surface-2 text-gray-400 font-medium">
                  {run.framework}
                </span>
              )}
              {run.source === 'cloud' && run.cloudProvider && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-blue-500/15 text-blue-400 font-medium">
                  <Cloud size={10} />
                  {CLOUD_SHORT[run.cloudProvider] || run.cloudProvider}
                </span>
              )}
              {run.source !== 'cloud' && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-surface-2 text-gray-500 font-medium">
                  <Play size={10} />
                  Local
                </span>
              )}
              {run.cloudBuildName && (
                <span className="text-gray-600">
                  {run.cloudBuildName}
                </span>
              )}
              {run.hasAnalysis && (
                <span className="px-1.5 py-0.5 rounded-lg bg-purple-500/15 text-purple-400 font-medium">
                  Analyzed
                </span>
              )}
            </div>
          </button>
        );
      })}

      {runs.length === 0 && (
        <div className="text-center py-10 text-gray-500 text-sm">
          No runs match the current filters.
        </div>
      )}
    </div>
  );
}
