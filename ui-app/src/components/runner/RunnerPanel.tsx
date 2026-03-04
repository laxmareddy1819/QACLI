import { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useTestRunner } from '../../hooks/useTestRunner';
import { useLiveProgress } from '../../hooks/useLiveProgress';
import { RunOutput } from './RunOutput';
import { RunHistory } from './RunHistory';
import { LiveProgress } from './LiveProgress';
import { RunSummary } from './RunSummary';
import { CloudPatchDialog } from './CloudPatchDialog';
import { Play, Square, Cloud, Monitor, Loader2, CheckCircle, XCircle, Calendar, Terminal, GitBranch } from 'lucide-react';
import type { ActiveRunState } from '../../hooks/useActiveRuns';
import { useToast } from '../shared/Toast';
import {
  getCloudProviders,
  analyzeCloudReadiness,
  applyCloudPatches,
  cancelRun,
  type CloudProviderId,
  type CloudProviderInfo,
  type CloudAnalysisResult,
  type CloudPatchInfo,
} from '../../api/client';
import { useGitStatus } from '../../hooks/useGit';
import type { ProjectInfo, WSMessage } from '../../api/types';

const PROVIDER_LABELS: Record<CloudProviderId, string> = {
  browserstack: 'BrowserStack',
  lambdatest: 'LambdaTest',
  saucelabs: 'Sauce Labs',
};

export function RunnerPanel() {
  const { project, subscribe, activeRuns } = useOutletContext<{
    project: ProjectInfo;
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    activeRuns?: ActiveRunState[];
  }>();
  const { toast } = useToast();
  const { activeRun, output, runResult, run, cancel, attachToRun } = useTestRunner(subscribe);
  const globalActiveRuns = (activeRuns ?? []).filter(r => r.runId !== activeRun?.runId);
  const liveProgress = useLiveProgress(subscribe, activeRun?.runId ?? null);
  const { data: gitStatus } = useGitStatus();
  const [command, setCommand] = useState('');

  // Cloud provider state
  const [enabledProviders, setEnabledProviders] = useState<CloudProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('local');
  const [buildName, setBuildName] = useState('');

  // Cloud readiness check state
  const [showPatchDialog, setShowPatchDialog] = useState(false);
  const [cloudAnalysis, setCloudAnalysis] = useState<CloudAnalysisResult | null>(null);
  const [analyzingCloud, setAnalyzingCloud] = useState(false);
  const [applyingPatches, setApplyingPatches] = useState(false);

  useEffect(() => {
    getCloudProviders()
      .then(data => {
        const enabled = data.providers.filter(p => p.enabled);
        setEnabledProviders(enabled);
      })
      .catch(() => {
        // Cloud providers not available
      });
  }, []);

  /** Execute the actual run (after cloud readiness is confirmed or skipped) */
  const executeRun = async () => {
    const cmd = command.trim();
    try {
      const opts: Parameters<typeof run>[0] = { command: cmd };
      if (selectedProvider !== 'local') {
        opts.cloudProvider = selectedProvider;
        if (buildName.trim()) opts.buildName = buildName.trim();
      }
      await run(opts);
      const label = selectedProvider === 'local' ? 'locally' : `on ${PROVIDER_LABELS[selectedProvider as CloudProviderId] || selectedProvider}`;
      toast('info', `Test run started ${label}`);
    } catch (err) {
      toast('error', `Failed to start: ${err}`);
    }
  };

  const handleRun = async () => {
    const cmd = command.trim();
    if (!cmd) {
      toast('error', 'Please enter a run command');
      return;
    }

    // If running locally, just execute directly
    if (selectedProvider === 'local') {
      await executeRun();
      return;
    }

    // Cloud run: analyze readiness first
    setAnalyzingCloud(true);
    try {
      const analysis = await analyzeCloudReadiness(selectedProvider as CloudProviderId);
      setCloudAnalysis(analysis);

      if (analysis.cloudReady || analysis.alreadyPatched) {
        // Already cloud-ready — run directly
        await executeRun();
      } else {
        // Show patch dialog
        setShowPatchDialog(true);
      }
    } catch (err) {
      toast('error', `Cloud analysis failed: ${err}`);
      // Still allow running with env vars only
      await executeRun();
    } finally {
      setAnalyzingCloud(false);
    }
  };

  /** Apply patches and then run */
  const handleApplyAndRun = async (patches: CloudPatchInfo[]) => {
    setApplyingPatches(true);
    try {
      const result = await applyCloudPatches(patches);
      toast('info', result.message);
      setShowPatchDialog(false);
      setCloudAnalysis(null);
      await executeRun();
    } catch (err) {
      toast('error', `Failed to apply patches: ${err}`);
    } finally {
      setApplyingPatches(false);
    }
  };

  /** Skip patching and run with env vars only */
  const handleSkipAndRun = async () => {
    setShowPatchDialog(false);
    setCloudAnalysis(null);
    await executeRun();
  };

  /** Cancel the cloud dialog */
  const handleCancelDialog = () => {
    setShowPatchDialog(false);
    setCloudAnalysis(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !activeRun) {
      handleRun();
    }
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Runner header */}
      <div className="px-6 py-4 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-100 mb-3">Test Runner</h1>

        <div className="flex gap-3">
          {/* Command input */}
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-400 block mb-1">Run Command</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., npx playwright test --headed"
              className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-200 font-mono outline-none placeholder-gray-600 focus:border-brand-500/50"
              disabled={!!activeRun}
            />
          </div>

          {/* Run / Stop button */}
          <div className="flex items-end">
            {activeRun ? (
              <button
                onClick={cancel}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-[15px] font-medium"
              >
                <Square size={14} />
                Stop
              </button>
            ) : (
              <button
                onClick={handleRun}
                disabled={analyzingCloud}
                className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium disabled:opacity-60"
              >
                {analyzingCloud ? (
                  <>
                    <Cloud size={14} className="animate-pulse" />
                    Checking...
                  </>
                ) : (
                  <>
                    <Play size={14} />
                    Run Tests
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Cloud provider selector — only show when providers are configured */}
        {enabledProviders.length > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <span className="text-sm text-gray-400">Run on:</span>
            <div className="flex gap-1.5">
              {/* Local option */}
              <button
                onClick={() => setSelectedProvider('local')}
                disabled={!!activeRun}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-xl border transition-colors ${
                  selectedProvider === 'local'
                    ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                    : 'border-white/5 bg-surface-2 text-gray-400 hover:text-gray-300 hover:border-white/10'
                } disabled:opacity-50`}
              >
                <Monitor size={14} />
                Local
              </button>

              {/* Cloud provider options */}
              {enabledProviders.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  disabled={!!activeRun}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 text-sm rounded-xl border transition-colors ${
                    selectedProvider === p.id
                      ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                      : 'border-white/5 bg-surface-2 text-gray-400 hover:text-gray-300 hover:border-white/10'
                  } disabled:opacity-50`}
                >
                  <Cloud size={14} />
                  {PROVIDER_LABELS[p.id]}
                </button>
              ))}
            </div>

            {/* Build name override when cloud selected */}
            {selectedProvider !== 'local' && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-500">Build:</label>
                <input
                  value={buildName}
                  onChange={e => setBuildName(e.target.value)}
                  placeholder="auto"
                  className="w-36 bg-surface-2 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-gray-300 outline-none placeholder-gray-600 focus:border-brand-500/50"
                  disabled={!!activeRun}
                />
              </div>
            )}
          </div>
        )}

        {/* Status info */}
        <div className="mt-2 text-sm text-gray-500">
          Framework: <span className="text-gray-400">{project.framework || 'auto-detect'}</span>
          {gitStatus?.branch && (
            <span className="ml-3 inline-flex items-center gap-1 text-sky-400/70">
              <GitBranch size={10} /> {gitStatus.branch}
            </span>
          )}
          {selectedProvider !== 'local' && !activeRun && (
            <span className="ml-3 text-blue-400">
              Cloud: {PROVIDER_LABELS[selectedProvider as CloudProviderId] || selectedProvider}
            </span>
          )}
          {activeRun && (
            <span className="ml-3 text-amber-400 animate-pulse">
              Running: {activeRun.command}
            </span>
          )}
          {runResult && !activeRun && (
            <span className={`ml-3 ${runResult.status === 'completed' ? 'text-emerald-400' : 'text-red-400'}`}>
              Last run: {runResult.status} {runResult.duration ? `(${(runResult.duration / 1000).toFixed(1)}s)` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Output + History */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col p-4 gap-3">
          {/* Live progress during active run */}
          {activeRun && liveProgress.current > 0 && (
            <div className="bg-surface-1 rounded-xl border border-white/5 p-4">
              <h3 className="text-sm font-semibold text-gray-400 uppercase mb-2">Live Progress</h3>
              <LiveProgress
                current={liveProgress.current}
                passed={liveProgress.passed}
                failed={liveProgress.failed}
                currentTestName={liveProgress.currentTestName}
                tests={liveProgress.tests}
                elapsedMs={liveProgress.elapsedMs}
              />
            </div>
          )}

          {/* Run summary after completion */}
          {!activeRun && liveProgress.summary && (
            <RunSummary
              summary={liveProgress.summary}
              runId={liveProgress.summary.runId}
            />
          )}

          <h3 className="text-sm font-semibold text-gray-400 uppercase">Output</h3>
          <RunOutput output={output} />
        </div>

        <div className="w-80 border-l border-white/5 bg-surface-1 p-4 overflow-y-auto flex-shrink-0">
          {/* Current Runs — show active runs from global state */}
          {globalActiveRuns.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-amber-400 uppercase mb-3">Current Runs</h3>
              <div className="space-y-1.5">
                {globalActiveRuns.map(gr => (
                  <div
                    key={gr.runId}
                    className="px-3 py-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 cursor-pointer hover:bg-amber-500/10 transition-colors"
                    onClick={() => attachToRun(gr.runId, gr.command)}
                    title="Click to view output"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      {/* Pulsing indicator */}
                      <span className="relative flex h-2 w-2 flex-shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
                      </span>
                      <span className="font-mono text-gray-300 text-xs flex-1 truncate">{gr.command}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      {/* Cloud badge */}
                      {gr.cloudProvider && (
                        <span className="flex items-center gap-0.5 text-blue-400">
                          <Cloud size={8} />
                          {PROVIDER_LABELS[gr.cloudProvider as CloudProviderId] || gr.cloudProvider}
                        </span>
                      )}
                      {/* Source */}
                      {gr.source === 'scheduler' && (
                        <span className="flex items-center gap-0.5 text-gray-500">
                          <Calendar size={8} /> Scheduled
                        </span>
                      )}
                      <div className="flex-1" />
                      {/* Counters */}
                      <span className="text-emerald-400 flex items-center gap-0.5">
                        <CheckCircle size={8} /> {gr.passed}
                      </span>
                      <span className="text-red-400 flex items-center gap-0.5">
                        <XCircle size={8} /> {gr.failed}
                      </span>
                      {/* Elapsed */}
                      <span className="text-gray-500 tabular-nums font-mono">
                        {Math.floor(gr.elapsedMs / 1000)}s
                      </span>
                      {/* Cancel */}
                      <button
                        onClick={(e) => { e.stopPropagation(); cancelRun(gr.runId).catch(() => {}); }}
                        className="text-red-400 hover:text-red-300 p-0.5"
                        title="Cancel run"
                      >
                        <Square size={8} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h3 className="text-sm font-semibold text-gray-400 uppercase mb-3">Run History</h3>
          <RunHistory />
        </div>
      </div>

      {/* Cloud Readiness Patch Dialog */}
      {showPatchDialog && cloudAnalysis && (
        <CloudPatchDialog
          open={showPatchDialog}
          analysis={cloudAnalysis}
          providerLabel={PROVIDER_LABELS[selectedProvider as CloudProviderId] || selectedProvider}
          onApplyAndRun={handleApplyAndRun}
          onSkipAndRun={handleSkipAndRun}
          onCancel={handleCancelDialog}
          applying={applyingPatches}
        />
      )}
    </div>
  );
}
