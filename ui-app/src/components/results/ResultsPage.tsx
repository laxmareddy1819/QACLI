import { useState, useMemo } from 'react';
import { useRunList, useRunDetail } from '../../hooks/useTestResults';
import { TestResultsTable } from './TestResultsTable';
import { TestDetailPanel } from './TestDetailPanel';
import { FailureAnalysis } from './FailureAnalysis';
import { RunListDashboard } from './RunListDashboard';
import {
  BarChart3, ArrowLeft, Brain, Cloud, Download, Loader2, Video, FileText,
  ExternalLink, Terminal, Calendar, FileDown, GitBranch, GitCommitHorizontal,
  ListChecks, XCircle, Clock, TrendingUp, CheckCircle2, MinusCircle,
  RefreshCw, Play, Filter,
} from 'lucide-react';
import { fetchCloudArtifacts } from '../../api/client';
import { useGitCorrelation } from '../../hooks/useGit';
import { useToast } from '../shared/Toast';
import { BrowserIcon } from '../shared/BrowserIcon';
import { useQueryClient } from '@tanstack/react-query';

const CLOUD_LABELS: Record<string, string> = {
  browserstack: 'BS',
  lambdatest: 'LT',
  saucelabs: 'SL',
};

// ── Shared Components ───────────────────────────────────────────────────────

function FilterChip({ label, icon, active, onClick, activeColor }: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  activeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
        active
          ? activeColor || 'text-brand-300 bg-brand-500/15 border-brand-500/30'
          : 'text-gray-500 bg-transparent border-transparent hover:text-gray-300 hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function StatPill({ label, value, icon, color }: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-2/50 border border-white/5">
      {icon && <span className={color || 'text-gray-400'}>{icon}</span>}
      <span className={`text-[15px] font-bold ${color || 'text-gray-200'}`}>{value}</span>
      <span className="text-[13px] text-gray-500">{label}</span>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function ResultsPage() {
  const { data: runListData, refetch } = useRunList(20);
  const runs = runListData?.runs || [];
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedTest, setSelectedTest] = useState<string | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [fetchingArtifacts, setFetchingArtifacts] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // List view filters (lifted from RunListDashboard)
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const currentRunId = selectedRunId;
  const { data: runDetail } = useRunDetail(currentRunId);
  const { data: correlationData } = useGitCorrelation(currentRunId);

  // ── List View Stats ─────────────────────────────────────────────────────

  const listStats = useMemo(() => {
    const totalRuns = runs.length;
    const failedRuns = runs.filter((r: any) => r.status === 'failed').length;
    const completedRuns = runs.filter((r: any) => r.status === 'completed').length;
    const runsWithRate = runs.filter((r: any) => r.summary?.passRate != null);
    const avgPassRate = runsWithRate.length > 0
      ? Math.round(runsWithRate.reduce((s: number, r: any) => s + r.summary.passRate, 0) / runsWithRate.length)
      : 0;
    const avgDuration = runs.filter((r: any) => r.duration).length > 0
      ? Math.round(runs.filter((r: any) => r.duration).reduce((s: number, r: any) => s + r.duration, 0) / runs.filter((r: any) => r.duration).length / 1000)
      : 0;
    return { totalRuns, failedRuns, completedRuns, avgPassRate, avgDuration };
  }, [runs]);

  const statusCounts = useMemo(() => ({
    all: runs.length,
    completed: runs.filter((r: any) => r.status === 'completed').length,
    failed: runs.filter((r: any) => r.status === 'failed').length,
    running: runs.filter((r: any) => r.status === 'running').length,
  }), [runs]);

  const filteredRuns = useMemo(() => {
    let result = runs;
    if (statusFilter !== 'all') result = result.filter((r: any) => r.status === statusFilter);
    if (sourceFilter !== 'all') {
      result = result.filter((r: any) =>
        sourceFilter === 'cloud' ? r.source === 'cloud' : r.source !== 'cloud',
      );
    }
    return result;
  }, [runs, statusFilter, sourceFilter]);

  // ── Helpers ─────────────────────────────────────────────────────────────

  const passRateColor = (rate: number) =>
    rate >= 90 ? 'text-emerald-400' : rate >= 70 ? 'text-amber-400' : 'text-red-400';

  const handleFetchArtifacts = async () => {
    if (!currentRunId) return;
    setFetchingArtifacts(true);
    try {
      const result = await fetchCloudArtifacts(currentRunId);
      if (result.artifacts) {
        toast('success', result.message);
        queryClient.invalidateQueries({ queryKey: ['run', currentRunId] });
      } else {
        toast('info', result.message);
      }
    } catch (err) {
      toast('error', `Failed to fetch artifacts: ${err}`);
    } finally {
      setFetchingArtifacts(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // LIST VIEW (no run selected)
  // ══════════════════════════════════════════════════════════════════════════

  if (!selectedRunId) {
    return (
      <div className="h-full flex flex-col animate-fade-in">
        {/* ── Header Toolbar ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 bg-surface-1 flex-shrink-0">
          <BarChart3 size={22} className="text-brand-400 flex-shrink-0" />
          <h1 className="text-xl font-bold text-gray-100 flex-shrink-0">Test Results</h1>

          {/* Status filter chips */}
          <div className="flex items-center gap-1.5 ml-4">
            <FilterChip
              label={`All ${statusCounts.all}`}
              active={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
            />
            <FilterChip
              label={`Completed ${statusCounts.completed}`}
              icon={<CheckCircle2 size={12} />}
              active={statusFilter === 'completed'}
              onClick={() => setStatusFilter('completed')}
              activeColor="text-emerald-300 bg-emerald-500/15 border-emerald-500/30"
            />
            <FilterChip
              label={`Failed ${statusCounts.failed}`}
              icon={<XCircle size={12} />}
              active={statusFilter === 'failed'}
              onClick={() => setStatusFilter('failed')}
              activeColor="text-red-300 bg-red-500/15 border-red-500/30"
            />
            {statusCounts.running > 0 && (
              <FilterChip
                label={`Running ${statusCounts.running}`}
                icon={<Play size={12} />}
                active={statusFilter === 'running'}
                onClick={() => setStatusFilter('running')}
                activeColor="text-amber-300 bg-amber-500/15 border-amber-500/30"
              />
            )}
          </div>

          {/* Source filter chips */}
          <div className="flex items-center gap-1.5 ml-2">
            <Filter size={13} className="text-gray-600" />
            <FilterChip label="All" active={sourceFilter === 'all'} onClick={() => setSourceFilter('all')} />
            <FilterChip
              label="Local"
              icon={<Play size={12} />}
              active={sourceFilter === 'local'}
              onClick={() => setSourceFilter('local')}
            />
            <FilterChip
              label="Cloud"
              icon={<Cloud size={12} />}
              active={sourceFilter === 'cloud'}
              onClick={() => setSourceFilter('cloud')}
              activeColor="text-blue-300 bg-blue-500/15 border-blue-500/30"
            />
          </div>

          {/* Right: Actions */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-600">
              {filteredRuns.length} of {runs.length} runs
            </span>
            <button
              onClick={() => refetch()}
              className="p-2 rounded-xl hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {/* ── Stats Strip ─────────────────────────────────────────────── */}
        <div className="flex items-stretch gap-2 px-4 py-3 border-b border-white/5 bg-surface-1 flex-shrink-0">
          <StatPill
            label="Total Runs"
            value={listStats.totalRuns}
            icon={<ListChecks size={11} />}
          />
          <StatPill
            label="Avg Pass Rate"
            value={listStats.totalRuns > 0 ? `${listStats.avgPassRate}%` : '-'}
            icon={<TrendingUp size={11} />}
            color={listStats.totalRuns > 0 ? passRateColor(listStats.avgPassRate) : 'text-gray-500'}
          />
          <StatPill
            label="Failed"
            value={listStats.failedRuns}
            icon={<XCircle size={11} />}
            color={listStats.failedRuns > 0 ? 'text-red-400' : 'text-gray-500'}
          />
          <StatPill
            label="Avg Duration"
            value={listStats.avgDuration > 0 ? `${listStats.avgDuration}s` : '-'}
            icon={<Clock size={11} />}
          />
        </div>

        {/* ── Run Cards ───────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5">
          <RunListDashboard
            runs={filteredRuns}
            total={runListData?.total || 0}
            isLoading={!runListData}
            onSelectRun={(id) => { setSelectedRunId(id); setSelectedTest(null); }}
          />
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DETAIL VIEW (run selected)
  // ══════════════════════════════════════════════════════════════════════════

  const selectedRun = runs.find((r: any) => r.runId === selectedRunId);

  // If a test is selected, show full-width detail panel (like Test Explorer)
  if (selectedTest && runDetail) {
    const testData = runDetail.tests?.find((t: any) => t.name === selectedTest);
    return (
      <div className="h-full flex flex-col animate-fade-in">
        <TestDetailPanel
          test={testData}
          projectPath={runDetail.projectPath}
          onClose={() => setSelectedTest(null)}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* ── Header Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 bg-surface-1 flex-shrink-0">
        {/* Left: Back + Run info */}
        <button
          onClick={() => { setSelectedRunId(null); setSelectedTest(null); setShowAnalysis(false); }}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <span className="text-gray-700 flex-shrink-0">|</span>
        <span className="text-sm text-gray-300 font-medium flex-shrink-0">
          {selectedRun ? new Date(selectedRun.startTime).toLocaleString() : 'Run Details'}
        </span>
        {selectedRun && (
          <span className={`px-2 py-0.5 rounded-lg text-[11px] font-medium flex-shrink-0 ${
            selectedRun.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' :
            selectedRun.status === 'failed' ? 'bg-red-500/15 text-red-400' :
            selectedRun.status === 'running' ? 'bg-amber-500/15 text-amber-400' :
            'bg-gray-500/15 text-gray-400'
          }`}>{selectedRun.status}</span>
        )}

        {/* Right: Action buttons */}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              window.open(`/api/results/runs/${currentRunId}/report`, '_blank');
              toast('success', 'Report download started');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 text-gray-400 border border-white/10 text-sm font-medium hover:bg-white/10 hover:text-gray-300 transition-colors"
          >
            <FileDown size={13} />
            Export Report
          </button>
          {runDetail?.source === 'cloud' && !runDetail.cloudArtifacts && (
            <button
              onClick={handleFetchArtifacts}
              disabled={fetchingArtifacts}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-500/15 text-blue-300 text-sm font-medium hover:bg-blue-500/25 border border-blue-500/20 transition-colors disabled:opacity-50"
            >
              {fetchingArtifacts ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Fetch Artifacts
            </button>
          )}
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 text-gray-400 border border-white/10 text-sm font-medium hover:bg-white/10 hover:text-gray-300 transition-colors"
          >
            <Brain size={13} />
            {showAnalysis ? 'Show Tests' : 'Analyze Failures'}
          </button>
        </div>
      </div>

      {/* ── Stats Strip ─────────────────────────────────────────────── */}
      {runDetail && (
        <div className="flex items-stretch gap-2 px-4 py-3 border-b border-white/5 bg-surface-1 flex-shrink-0 flex-wrap">
          <StatPill label="Total" value={runDetail.summary?.total || 0} />
          <StatPill
            label="Passed"
            value={runDetail.summary?.passed || 0}
            icon={<CheckCircle2 size={11} />}
            color="text-emerald-400"
          />
          <StatPill
            label="Failed"
            value={runDetail.summary?.failed || 0}
            icon={<XCircle size={11} />}
            color={runDetail.summary?.failed > 0 ? 'text-red-400' : 'text-gray-500'}
          />
          <StatPill
            label="Skipped"
            value={runDetail.summary?.skipped || 0}
            icon={<MinusCircle size={11} />}
            color="text-gray-500"
          />
          <StatPill
            label="Pass Rate"
            value={`${runDetail.summary?.passRate || 0}%`}
            color={passRateColor(runDetail.summary?.passRate || 0)}
          />
          {runDetail.duration && (
            <StatPill
              label="Duration"
              value={`${(runDetail.duration / 1000).toFixed(1)}s`}
              icon={<Clock size={11} />}
            />
          )}
          {/* Cloud badge */}
          {runDetail.source === 'cloud' && runDetail.cloudProvider && (
            <div className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20">
              <Cloud size={11} className="text-blue-400" />
              <span className="text-sm font-medium text-blue-400">
                {CLOUD_LABELS[runDetail.cloudProvider] || runDetail.cloudProvider}
              </span>
            </div>
          )}
          {/* Browser badges */}
          {(() => {
            const browsers = [...new Set(
              (runDetail.tests || []).map((t: any) => t.browser).filter(Boolean),
            )] as string[];
            return browsers.map((b: string) => (
              <div key={b} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-2/50 border border-white/5">
                <BrowserIcon browser={b} size={12} />
                <span className="text-sm text-gray-400">{b}</span>
              </div>
            ));
          })()}
        </div>
      )}

      {/* ── Info Strip (command + git) ───────────────────────────────── */}
      {runDetail && (runDetail.command || runDetail.cloudBuildName || runDetail.gitBranch || runDetail.gitCommitSha) && (
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-white/5 bg-surface-1 flex-shrink-0">
          {runDetail.command && (
            <span className="flex items-center gap-1.5 text-xs text-gray-500 font-mono">
              <Terminal size={11} className="text-gray-600 flex-shrink-0" />
              {runDetail.command}
            </span>
          )}
          {runDetail.cloudBuildName && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400/70 flex-shrink-0">
              <Calendar size={11} />
              {runDetail.cloudBuildName}
            </span>
          )}
          {runDetail.gitBranch && (
            <span className="flex items-center gap-1.5 text-xs text-brand-400/70 flex-shrink-0">
              <GitBranch size={11} />
              {runDetail.gitBranch}
            </span>
          )}
          {runDetail.gitCommitSha && (
            <span className="flex items-center gap-1.5 text-xs text-gray-500 font-mono flex-shrink-0">
              <GitCommitHorizontal size={11} />
              {runDetail.gitCommitSha}
              {runDetail.gitCommitMessage && (
                <span className="text-gray-600 font-sans truncate max-w-48">— {runDetail.gitCommitMessage}</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* ── Git Commit Correlation Banner ────────────────────────────── */}
      {correlationData?.correlations && correlationData.correlations.length > 0 && (() => {
        const highConf = correlationData.correlations.filter((c: any) => c.confidence === 'high' || c.confidence === 'medium');
        if (highConf.length === 0) return null;
        const totalNewFailures = highConf.reduce((sum: number, c: any) => sum + (c.newFailures?.length || 0), 0);
        if (totalNewFailures === 0) return null;
        const topCorrelation = highConf[0];
        return (
          <div className="mx-5 mt-3 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-2 text-xs text-amber-300">
            <GitCommitHorizontal size={12} className="flex-shrink-0" />
            <span>
              {totalNewFailures} failure{totalNewFailures !== 1 ? 's' : ''} likely introduced by commit{' '}
              <code className="text-amber-200">{topCorrelation.commit.shortSha}</code>
              {' '}by {topCorrelation.commit.author}
            </span>
            <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-medium ${
              topCorrelation.confidence === 'high' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'
            }`}>
              {topCorrelation.confidence}
            </span>
          </div>
        );
      })()}

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Cloud Session Card */}
        {runDetail?.cloudArtifacts?.sessions && runDetail.cloudArtifacts.sessions.length > 0 && (
          <div className="mb-4 rounded-xl border border-white/5 bg-surface-1 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-1.5">
                <Cloud size={12} className={
                  runDetail.cloudArtifacts.provider === 'browserstack' ? 'text-orange-400' :
                  runDetail.cloudArtifacts.provider === 'lambdatest' ? 'text-purple-400' :
                  runDetail.cloudArtifacts.provider === 'saucelabs' ? 'text-red-400' : 'text-blue-400'
                } />
                Cloud Session — {
                  runDetail.cloudArtifacts.provider === 'browserstack' ? 'BrowserStack' :
                  runDetail.cloudArtifacts.provider === 'lambdatest' ? 'LambdaTest' :
                  runDetail.cloudArtifacts.provider === 'saucelabs' ? 'Sauce Labs' :
                  runDetail.cloudArtifacts.provider
                }
              </p>
              {runDetail.cloudArtifacts.buildUrl && (
                <a href={runDetail.cloudArtifacts.buildUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors">
                  <ExternalLink size={10} /> View Build
                </a>
              )}
            </div>
            <div className="space-y-2">
              {runDetail.cloudArtifacts.sessions.map((session: any) => (
                <div key={session.sessionId} className="flex items-center gap-3 rounded-xl bg-surface-2/50 border border-white/5 px-4 py-2.5">
                  <div className="flex items-center gap-2 text-xs flex-1 min-w-0">
                    {session.browser && <span className="text-gray-300">{session.browser}</span>}
                    {session.os && <span className="text-gray-500">{session.os} {session.osVersion || ''}</span>}
                    {session.status && (
                      <span className={`px-1.5 py-0.5 rounded-lg text-[10px] font-medium ${
                        session.status === 'passed' || session.status === 'done' ? 'bg-emerald-500/15 text-emerald-400' :
                        session.status === 'failed' || session.status === 'error' ? 'bg-red-500/15 text-red-400' :
                        'bg-gray-500/15 text-gray-400'
                      }`}>{session.status}</span>
                    )}
                    {session.duration != null && <span className="text-gray-600 text-[10px]">{session.duration}s</span>}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    {session.videoUrl && (
                      <a href={session.videoUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-surface-3 transition-colors">
                        <Video size={10} /> Video
                      </a>
                    )}
                    {session.logsUrl && (
                      <a href={session.logsUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-surface-3 transition-colors">
                        <FileText size={10} /> Logs
                      </a>
                    )}
                    {session.sessionUrl && (
                      <a href={session.sessionUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-surface-3 transition-colors">
                        <ExternalLink size={10} /> Session
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showAnalysis && currentRunId ? (
          <FailureAnalysis runId={currentRunId} onClose={() => setShowAnalysis(false)} />
        ) : (
          <TestResultsTable
            tests={runDetail?.tests || []}
            filter={undefined}
            onSelectTest={setSelectedTest}
            selectedTest={selectedTest}
          />
        )}
      </div>
    </div>
  );
}
