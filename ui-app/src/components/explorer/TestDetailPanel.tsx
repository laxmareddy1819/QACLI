import { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeft, Play, FileText, Clock, CheckCircle2, XCircle,
  MinusCircle, Circle, Copy, Check, History,
  TrendingUp, BarChart3, Square, Loader2,
  ExternalLink, Code2, ChevronRight, ChevronDown,
  Eye, Image, AlertTriangle, ClipboardCopy,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import type { ExplorerTestCase, ExplorerTestSuite, WSMessage, HumanStep, StepDefinitionMatch } from '../../api/types';
import { useTestCaseHistory, useTestSource, useStepDefinitions } from '../../hooks/useTestExplorer';
import { startRun, cancelRun, getResultRun } from '../../api/client';
import { FrameworkBadge } from './TestSuiteList';
import { BrowserIcon } from '../shared/BrowserIcon';
import { useChartTheme } from '../../hooks/useChartTheme';
import { parseAnsi, segmentToStyle } from '../../utils/ansiToHtml';
import { ScreenshotViewer } from '../results/ScreenshotViewer';

// ── Types ────────────────────────────────────────────────────────────────────

interface TestDetailPanelProps {
  test: ExplorerTestCase;
  suite: ExplorerTestSuite;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  onBack: () => void;
}

interface RunOutput {
  stream: 'stdout' | 'stderr';
  data: string;
}

interface RunState {
  runId: string;
  command: string;
  status: 'running' | 'completed' | 'failed';
  output: RunOutput[];
  progress: {
    current: number;
    total: number;
    passed: number;
    failed: number;
    currentTestName: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
    duration: number;
  } | null;
  startTime: number;
  elapsedMs: number;
}

interface RunTestDetail {
  name: string;
  status: string;
  duration?: number;
  errorMessage?: string;
  stackTrace?: string;
  screenshotPath?: string;
  videoPath?: string;
  tracePath?: string;
  steps?: Array<{ keyword: string; name: string; status: string; errorMessage?: string }>;
}

type Tab = 'steps' | 'source' | 'runs' | 'output';

// ── Main Component ───────────────────────────────────────────────────────────

export function TestDetailPanel({ test, suite, subscribe, onBack }: TestDetailPanelProps) {
  const navigate = useNavigate();
  const { data: historyData, refetch: refetchHistory } = useTestCaseHistory(test.name);
  const [copied, setCopied] = useState(false);
  const [runState, setRunState] = useState<RunState | null>(null);
  const [runTestDetails, setRunTestDetails] = useState<RunTestDetail[]>([]);
  const [runProjectPath, setRunProjectPath] = useState<string>('');
  const [screenshotView, setScreenshotView] = useState<{ path: string; name: string } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('steps');
  const outputRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch source + human steps (works for all frameworks including Cucumber .feature files)
  const isCucumber = test.framework === 'cucumber';
  const hasSteps = test.steps && test.steps.length > 0;
  const { data: sourceData, isLoading: sourceLoading } = useTestSource(
    suite.file,
    test.line ?? null,
    test.endLine ?? null,
    test.framework,
  );

  // Resolve step definitions for Cucumber steps (batch)
  const { data: stepDefData } = useStepDefinitions(
    hasSteps ? test.steps : null,
    isCucumber,
  );

  const history = historyData?.history || [];
  const passRate = test.runCount > 0
    ? Math.round((test.passCount / test.runCount) * 100)
    : null;

  const isRunning = runState?.status === 'running';

  // Auto-switch to output tab when a run starts
  useEffect(() => {
    if (isRunning) setActiveTab('output');
  }, [isRunning]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [runState?.output.length]);

  // Elapsed timer
  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setRunState(prev => prev && prev.status === 'running'
          ? { ...prev, elapsedMs: Date.now() - prev.startTime }
          : prev,
        );
      }, 500);
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRunning]);

  // WebSocket subscription for live output + progress + results
  useEffect(() => {
    if (!runState || runState.status !== 'running') return;

    const runId = runState.runId;
    return subscribe((msg) => {
      if (msg.type === 'output' && msg.runId === runId) {
        setRunState(prev => prev ? {
          ...prev,
          output: [...prev.output, { stream: msg.stream as 'stdout' | 'stderr', data: msg.data as string }],
        } : prev);
      }

      if (msg.type === 'test-progress' && msg.runId === runId) {
        setRunState(prev => prev ? {
          ...prev,
          progress: {
            ...prev.progress,
            current: msg.current as number,
            total: msg.total as number || prev.progress.total,
            currentTestName: msg.testName as string,
          },
        } : prev);
      }

      if (msg.type === 'test-passed' && msg.runId === runId) {
        setRunState(prev => prev ? {
          ...prev,
          progress: { ...prev.progress, passed: prev.progress.passed + 1 },
        } : prev);
      }

      if (msg.type === 'test-failed' && msg.runId === runId) {
        setRunState(prev => prev ? {
          ...prev,
          progress: { ...prev.progress, failed: prev.progress.failed + 1 },
        } : prev);
      }

      if (msg.type === 'test-results' && msg.runId === runId) {
        const s = msg.summary as any;
        setRunState(prev => prev ? { ...prev, summary: s } : prev);
      }

      if (msg.type === 'complete' && msg.runId === runId) {
        setRunState(prev => prev ? {
          ...prev,
          status: msg.exitCode === 0 ? 'completed' : 'failed',
          elapsedMs: Date.now() - prev.startTime,
        } : prev);
        setTimeout(() => refetchHistory(), 1500);

        setTimeout(async () => {
          try {
            const runData = await getResultRun(runId);
            if (runData?.tests && Array.isArray(runData.tests)) {
              setRunTestDetails(runData.tests);
            }
            if (runData?.projectPath) {
              setRunProjectPath(runData.projectPath);
            }
          } catch { /* Non-critical */ }
        }, 500);
      }
    });
  }, [subscribe, runState?.runId, runState?.status, refetchHistory]);

  const handleCopyCommand = async () => {
    if (test.runCommand) {
      await navigator.clipboard.writeText(test.runCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRunTest = async () => {
    if (!test.runCommand || isRunning) return;
    try {
      const result = await startRun({ command: test.runCommand });
      setRunState({
        runId: result.runId,
        command: result.command,
        status: 'running',
        output: [],
        progress: { current: 0, total: 0, passed: 0, failed: 0, currentTestName: '' },
        summary: null,
        startTime: Date.now(),
        elapsedMs: 0,
      });
    } catch {
      // API error
    }
  };

  const handleCancel = async () => {
    if (runState && isRunning) {
      await cancelRun(runState.runId);
      setRunState(prev => prev ? { ...prev, status: 'failed' } : prev);
    }
  };

  const handleDismissRun = () => {
    setRunState(null);
    setRunTestDetails([]);
    setRunProjectPath('');
  };

  // Tab definitions
  const tabs: { id: Tab; label: string; badge?: React.ReactNode }[] = [
    { id: 'steps', label: 'Steps' },
    { id: 'source', label: 'Source' },
    { id: 'runs', label: 'Runs' },
    {
      id: 'output',
      label: 'Output',
      badge: isRunning ? (
        <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse ml-1.5" />
      ) : runState && runState.status !== 'running' ? (
        runState.status === 'completed'
          ? <CheckCircle2 size={10} className="text-emerald-400 ml-1" />
          : <XCircle size={10} className="text-red-400 ml-1" />
      ) : null,
    },
  ];

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* ── Back Navigation Bar ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          <ArrowLeft size={14} />
          <span>Back to Tests</span>
        </button>
        <span className="text-gray-600 text-xs">|</span>
        <span className="text-xs text-gray-500 truncate flex items-center gap-1">
          <FileText size={11} />
          {suite.name}
        </span>
      </div>

      {/* ── Detail Header ───────────────────────────────────────────── */}
      <div className="px-6 py-4 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <div className="flex items-start gap-3">
          {/* Status icon */}
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            test.lastStatus === 'passed' ? 'bg-emerald-500/15'
              : test.lastStatus === 'failed' ? 'bg-red-500/15'
                : 'bg-gray-500/15'
          }`}>
            <StatusIcon status={test.lastStatus} size={20} />
          </div>

          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-100 leading-snug">{test.name}</h2>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500 flex-wrap">
              <FrameworkBadge framework={test.framework} />
              <span className="flex items-center gap-1">
                <FileText size={11} />
                <button
                  onClick={() => navigate(`/explorer?file=${encodeURIComponent(suite.file)}`)}
                  className="text-brand-400/80 hover:text-brand-300 transition-colors"
                  title="Open in Project Explorer"
                >
                  {suite.file}{test.line ? `:${test.line}` : ''}
                </button>
              </span>
              {test.runCount > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full bg-gray-600" />
                  <span>{test.runCount} runs</span>
                  {passRate !== null && (
                    <>
                      <span className="w-1 h-1 rounded-full bg-gray-600" />
                      <span className={passRate >= 90 ? 'text-emerald-400' : passRate >= 70 ? 'text-amber-400' : 'text-red-400'}>
                        {passRate}% pass rate
                      </span>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action row */}
        {test.runCommand && (
          <div className="flex items-center gap-2 mt-4">
            {isRunning ? (
              <button
                onClick={handleCancel}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/15 text-red-300 hover:bg-red-500/25 transition-colors"
              >
                <Square size={12} /> Stop
              </button>
            ) : (
              <button
                onClick={handleRunTest}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-500 transition-colors"
              >
                <Play size={12} /> Run Test
              </button>
            )}

            <div className="flex items-center gap-1 px-2.5 py-1.5 bg-surface-2 rounded-lg border border-white/5 max-w-md overflow-hidden">
              <code className="text-[11px] text-gray-400 font-mono truncate" title={test.runCommand}>
                {test.runCommand}
              </code>
              <button
                onClick={handleCopyCommand}
                className="text-gray-500 hover:text-gray-300 p-0.5 rounded transition-colors flex-shrink-0"
                title="Copy command"
              >
                {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Tab Bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-white/5 bg-surface-1/50 px-6 flex-shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center px-3 py-2.5 text-xs font-medium transition-colors relative ${
              activeTab === tab.id
                ? 'text-brand-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
            {tab.badge}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab Content ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'steps' && (
          <StepsTab test={test} sourceData={sourceData} sourceLoading={sourceLoading} />
        )}
        {activeTab === 'source' && (
          <SourceTab test={test} suite={suite} sourceData={sourceData} sourceLoading={sourceLoading} stepDefMatches={stepDefData?.matches} />
        )}
        {activeTab === 'runs' && (
          <RunsTab test={test} history={history} passRate={passRate} />
        )}
        {activeTab === 'output' && (
          <OutputTab
            runState={runState}
            runTestDetails={runTestDetails}
            runProjectPath={runProjectPath}
            isRunning={isRunning}
            outputRef={outputRef}
            onDismiss={handleDismissRun}
            onScreenshot={(path, name) => setScreenshotView({ path, name })}
            onViewResults={() => navigate('/results')}
          />
        )}
      </div>

      {/* Screenshot Viewer Modal */}
      {screenshotView && (
        <ScreenshotViewer
          url={artifactUrl(screenshotView.path, runProjectPath)}
          testName={screenshotView.name}
          onClose={() => setScreenshotView(null)}
        />
      )}
    </div>
  );
}

// ── Status Icon (Local) ──────────────────────────────────────────────────────

function StatusIcon({ status, size = 14 }: { status?: string; size?: number }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 size={size} className="text-emerald-400" />;
    case 'failed':
      return <XCircle size={size} className="text-red-400" />;
    case 'skipped':
      return <MinusCircle size={size} className="text-gray-500" />;
    default:
      return <Circle size={size} className="text-gray-600" />;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  STEPS TAB
// ══════════════════════════════════════════════════════════════════════════════

function StepsTab({ test, sourceData, sourceLoading }: {
  test: ExplorerTestCase;
  sourceData: any;
  sourceLoading: boolean;
}) {
  const hasSteps = test.steps && test.steps.length > 0;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      {/* Cucumber steps */}
      {hasSteps && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
            Scenario Steps ({test.steps.length})
          </h4>
          <div className="space-y-1">
            {test.steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3 group">
                {/* Step number with connector */}
                <div className="flex flex-col items-center flex-shrink-0">
                  <span className="w-6 h-6 rounded-full bg-surface-2 border border-white/10 flex items-center justify-center text-[10px] text-gray-500 font-medium">
                    {i + 1}
                  </span>
                  {i < test.steps.length - 1 && (
                    <span className="w-px h-4 bg-white/10 mt-1" />
                  )}
                </div>
                <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-surface-2/40 flex-1 min-w-0">
                  <KeywordBadge keyword={step.keyword} />
                  <span className="text-[13px] text-gray-300 leading-relaxed">{step.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Non-Cucumber human-readable steps */}
      {!hasSteps && (
        <>
          {sourceLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-gray-500 text-xs">
              <Loader2 size={14} className="animate-spin" />
              <span>Loading test steps...</span>
            </div>
          )}

          {sourceData && !sourceLoading && sourceData.humanSteps.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
                <Eye size={12} />
                Test Steps ({sourceData.humanSteps.length})
              </h4>
              <div className="space-y-1">
                {sourceData.humanSteps.map((step: HumanStep, i: number) => (
                  <div key={i} className="flex items-start gap-3 group">
                    <div className="flex flex-col items-center flex-shrink-0">
                      <span className="w-6 h-6 rounded-full bg-surface-2 border border-white/10 flex items-center justify-center text-[10px] text-gray-500 font-medium">
                        {i + 1}
                      </span>
                      {i < sourceData.humanSteps.length - 1 && (
                        <span className="w-px h-4 bg-white/10 mt-1" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-surface-2/40 flex-1 min-w-0">
                      <StepKeywordBadge keyword={step.keyword} />
                      <span className="text-[13px] text-gray-300 leading-relaxed">{step.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sourceData && !sourceLoading && sourceData.humanSteps.length === 0 && (
            <div className="py-8 text-center text-gray-500 text-sm">
              No steps detected for this test. Check the Source tab to view the test code.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SOURCE TAB
// ══════════════════════════════════════════════════════════════════════════════

function SourceTab({ test, suite, sourceData, sourceLoading, stepDefMatches }: {
  test: ExplorerTestCase;
  suite: ExplorerTestSuite;
  sourceData: any;
  sourceLoading: boolean;
  stepDefMatches?: Record<string, StepDefinitionMatch>;
}) {
  const navigate = useNavigate();
  const isCucumber = test.framework === 'cucumber';
  const hasSteps = test.steps && test.steps.length > 0;

  const handleGoToDefinition = (file: string, line?: number) => {
    let url = `/explorer?file=${encodeURIComponent(file)}`;
    if (line && line > 0) url += `&line=${line}`;
    navigate(url);
  };

  // ── Cucumber: show step definition source for each step ──
  if (isCucumber && hasSteps) {
    const resolvedCount = stepDefMatches ? Object.keys(stepDefMatches).length : 0;

    return (
      <div className="p-6 space-y-4">
        {/* Header info */}
        <div className="bg-surface-2/50 rounded-lg px-4 py-3 text-xs text-gray-300 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Code2 size={12} className="text-gray-500" />
            <span className="text-gray-500">Step Definitions</span>
          </div>
          <span className="text-gray-500">
            {resolvedCount} of {test.steps.length} steps resolved
          </span>
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Feature:</span>
            <span className="font-mono">{suite.file}</span>
          </div>
        </div>

        {/* Step definition code for each step */}
        {test.steps.map((step, i) => {
          const defKey = `${step.keyword}:${step.name}`;
          const defMatch = stepDefMatches?.[defKey];

          return (
            <div key={i} className="rounded-lg border border-white/5 overflow-hidden">
              {/* Step header */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-surface-1 border-b border-white/5">
                <span className="w-5 h-5 rounded-full bg-surface-2 border border-white/10 flex items-center justify-center text-[9px] text-gray-500 font-medium flex-shrink-0">
                  {i + 1}
                </span>
                <KeywordBadge keyword={step.keyword} />
                <span className="text-[13px] text-gray-300 flex-1 truncate">{step.name}</span>
              </div>

              {defMatch ? (
                <>
                  {/* File info + Go to Definition */}
                  <div className="flex items-center gap-3 px-4 py-2 bg-surface-2/30 border-b border-white/5">
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-400 flex-1 min-w-0">
                      <FileText size={11} className="flex-shrink-0" />
                      <span className="font-mono truncate">{defMatch.file}:{defMatch.line}</span>
                      {defMatch.method && (
                        <span className="text-gray-500">
                          &middot; <span className="font-mono text-brand-400/70">{defMatch.method}()</span>
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleGoToDefinition(defMatch.file, defMatch.line)}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-brand-400 hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 transition-colors flex-shrink-0"
                      title={`Open ${defMatch.file} in Project Explorer and highlight line ${defMatch.line}`}
                    >
                      <ExternalLink size={10} />
                      Go to Definition
                    </button>
                  </div>

                  {/* Source code */}
                  <InlineCodeViewer
                    source={defMatch.source}
                    language={defMatch.language}
                    startLine={defMatch.line}
                  />
                </>
              ) : (
                <div className="px-4 py-4 text-center text-gray-600 text-xs flex items-center justify-center gap-1.5">
                  <AlertTriangle size={12} />
                  <span>Step definition not found</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── Non-Cucumber: show test source code ──
  if (sourceLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-gray-500 text-xs">
        <Loader2 size={14} className="animate-spin" />
        <span>Loading source code...</span>
      </div>
    );
  }

  if (!sourceData) {
    return (
      <div className="py-12 text-center text-gray-500 text-sm">
        Source code not available for this test.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-3">
      {/* File metadata + Go to Definition */}
      <div className="bg-surface-2/50 rounded-lg px-4 py-3 text-xs text-gray-300 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText size={11} className="text-gray-500 flex-shrink-0" />
          <span className="font-mono">{suite.file}</span>
        </div>
        {test.line && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Lines:</span>
            <span className="font-mono">{test.line}{test.endLine ? ` - ${test.endLine}` : ''}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-gray-500">Framework:</span>
          <FrameworkBadge framework={test.framework} />
        </div>
        <div className="flex-1" />
        <button
          onClick={() => handleGoToDefinition(suite.file, test.line ?? undefined)}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-brand-400 hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 transition-colors flex-shrink-0"
          title={`Open ${suite.file}${test.line ? `:${test.line}` : ''} in Project Explorer`}
        >
          <ExternalLink size={10} />
          Go to Definition
        </button>
      </div>

      {/* Monaco editor */}
      <InlineCodeViewer
        source={sourceData.source}
        language={sourceData.language}
        startLine={sourceData.startLine}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  RUNS TAB
// ══════════════════════════════════════════════════════════════════════════════

function RunsTab({ test, history, passRate }: {
  test: ExplorerTestCase;
  history: any[];
  passRate: number | null;
}) {
  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Summary cards */}
      {test.runCount > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard icon={<BarChart3 size={13} />} label="Total Runs" value={test.runCount.toString()} />
          <StatCard
            icon={<TrendingUp size={13} />}
            label="Pass Rate"
            value={passRate !== null ? `${passRate}%` : 'N/A'}
            color={passRate !== null ? (passRate >= 90 ? 'emerald' : passRate >= 70 ? 'amber' : 'red') : undefined}
          />
          <StatCard
            icon={<XCircle size={13} />}
            label="Failures"
            value={test.failCount.toString()}
            color={test.failCount > 0 ? 'red' : 'emerald'}
          />
        </div>
      )}

      {/* Browser info */}
      {(test as any).lastBrowser && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2/50">
          <BrowserIcon browser={(test as any).lastBrowser} size={14} />
          <span className="text-xs text-gray-300">Last run: {(test as any).lastBrowser}</span>
        </div>
      )}

      {/* History timeline dots */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 flex items-center gap-1.5">
          <History size={12} />
          Execution History
        </h4>

        {history.length > 0 && (
          <div className="flex items-center gap-1 mb-4 flex-wrap">
            {history.slice(0, 20).map((entry: any, i: number) => (
              <span
                key={i}
                className={`w-3.5 h-3.5 rounded-full flex-shrink-0 transition-colors ${
                  entry.status === 'passed' ? 'bg-emerald-400'
                    : entry.status === 'failed' ? 'bg-red-400'
                      : 'bg-gray-500'
                }`}
                title={`${entry.status} — ${new Date(entry.timestamp).toLocaleString()}`}
              />
            ))}
          </div>
        )}

        {/* History entries */}
        {history.length > 0 ? (
          <div className="space-y-1">
            {history.slice(0, 15).map((entry: any, i: number) => (
              <div key={i} className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-surface-2/30 text-[13px]">
                <StatusIcon status={entry.status} size={14} />
                <span className={`font-medium w-16 ${
                  entry.status === 'passed' ? 'text-emerald-400'
                    : entry.status === 'failed' ? 'text-red-400'
                      : 'text-gray-400'
                }`}>
                  {entry.status}
                </span>
                {entry.duration != null && (
                  <span className="text-gray-500 flex items-center gap-1">
                    <Clock size={11} />
                    {(entry.duration / 1000).toFixed(1)}s
                  </span>
                )}
                {entry.browser && (
                  <span className="flex items-center gap-1 text-gray-500">
                    <BrowserIcon browser={entry.browser} size={11} />
                    <span className="text-xs">{entry.browser}</span>
                  </span>
                )}
                <span className="ml-auto text-gray-600 text-xs">
                  {new Date(entry.timestamp).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-600 italic py-4">
            No execution history yet. Run this test to see results here.
          </p>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  OUTPUT TAB
// ══════════════════════════════════════════════════════════════════════════════

function OutputTab({ runState, runTestDetails, runProjectPath, isRunning, outputRef, onDismiss, onScreenshot, onViewResults }: {
  runState: RunState | null;
  runTestDetails: RunTestDetail[];
  runProjectPath: string;
  isRunning: boolean;
  outputRef: React.RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
  onScreenshot: (path: string, name: string) => void;
  onViewResults: () => void;
}) {
  if (!runState) {
    return (
      <div className="py-16 text-center">
        <Play size={32} className="mx-auto text-gray-700 mb-3" />
        <p className="text-sm text-gray-500">No test output yet</p>
        <p className="text-xs text-gray-600 mt-1">Run the test to see live output here</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Execution header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 flex-shrink-0">
        {isRunning ? (
          <Loader2 size={14} className="text-brand-400 animate-spin" />
        ) : runState.status === 'completed' ? (
          <CheckCircle2 size={14} className="text-emerald-400" />
        ) : (
          <XCircle size={14} className="text-red-400" />
        )}
        <span className="text-xs font-medium text-gray-200">
          {isRunning ? 'Running...' : runState.status === 'completed' ? 'Run Complete' : 'Run Failed'}
        </span>
        <span className="text-xs text-gray-500 ml-auto">
          {Math.round(runState.elapsedMs / 1000)}s
        </span>
        {!isRunning && (
          <button
            onClick={onDismiss}
            className="text-gray-500 hover:text-gray-300 p-0.5 rounded transition-colors"
            title="Dismiss"
          >
            <XCircle size={12} />
          </button>
        )}
      </div>

      {/* Live progress */}
      {isRunning && (
        <div className="px-4 py-2.5 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3 mb-1.5">
            <div className="flex-1 bg-surface-2 rounded-full h-1.5 overflow-hidden">
              {(runState.progress.passed + runState.progress.failed) > 0 && (
                <div className="h-full flex">
                  <div
                    className="bg-emerald-500 transition-all"
                    style={{
                      width: `${(runState.progress.passed / Math.max(runState.progress.passed + runState.progress.failed, 1)) * 100}%`,
                    }}
                  />
                  <div
                    className="bg-red-500 transition-all"
                    style={{
                      width: `${(runState.progress.failed / Math.max(runState.progress.passed + runState.progress.failed, 1)) * 100}%`,
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            {runState.progress.current > 0 && (
              <span className="text-gray-400">Test #{runState.progress.current}</span>
            )}
            <span className="text-emerald-400 flex items-center gap-0.5">
              <CheckCircle2 size={10} /> {runState.progress.passed}
            </span>
            <span className="text-red-400 flex items-center gap-0.5">
              <XCircle size={10} /> {runState.progress.failed}
            </span>
            {runState.progress.currentTestName && (
              <span className="text-gray-500 flex items-center gap-1 truncate ml-auto">
                <Loader2 size={10} className="animate-spin flex-shrink-0" />
                <span className="truncate">{runState.progress.currentTestName}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Run summary */}
      {!isRunning && runState.summary && (
        <div className="px-4 py-3 border-b border-white/5 flex-shrink-0">
          <div className="grid grid-cols-4 gap-2 text-center mb-3">
            <div>
              <p className="text-lg font-bold text-gray-100">{runState.summary.total}</p>
              <p className="text-[9px] text-gray-500">Total</p>
            </div>
            <div>
              <p className="text-lg font-bold text-emerald-400 flex items-center justify-center gap-1">
                <CheckCircle2 size={13} /> {runState.summary.passed}
              </p>
              <p className="text-[9px] text-gray-500">Passed</p>
            </div>
            <div>
              <p className={`text-lg font-bold flex items-center justify-center gap-1 ${runState.summary.failed > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                <XCircle size={13} /> {runState.summary.failed}
              </p>
              <p className="text-[9px] text-gray-500">Failed</p>
            </div>
            <div>
              <p className="text-lg font-bold text-gray-500 flex items-center justify-center gap-1">
                <MinusCircle size={13} /> {runState.summary.skipped}
              </p>
              <p className="text-[9px] text-gray-500">Skipped</p>
            </div>
          </div>
          <div className="text-center mb-3">
            <span className={`text-xl font-bold ${
              runState.summary.passRate >= 90 ? 'text-emerald-400'
                : runState.summary.passRate >= 70 ? 'text-amber-400'
                  : 'text-red-400'
            }`}>
              {runState.summary.passRate}%
            </span>
            <span className="text-[10px] text-gray-500 ml-1">pass rate</span>
          </div>
          <button
            onClick={onViewResults}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-2 text-gray-300 text-xs hover:bg-white/10 transition-colors"
          >
            <ExternalLink size={11} /> View Full Results
          </button>
        </div>
      )}

      {/* Live output (ANSI) */}
      <ExplorerRunOutput output={runState.output} isRunning={isRunning} outputRef={outputRef} />

      {/* Post-run details */}
      {!isRunning && runTestDetails.length > 0 && (
        <RunTestDetailsPanel
          tests={runTestDetails}
          projectPath={runProjectPath}
          onScreenshot={onScreenshot}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SHARED SUB-COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

// ── Keyword Badges ──────────────────────────────────────────────────────────

function KeywordBadge({ keyword }: { keyword: string }) {
  const colorMap: Record<string, string> = {
    Given: 'bg-sky-500/20 text-sky-300',
    When: 'bg-amber-500/20 text-amber-300',
    Then: 'bg-emerald-500/20 text-emerald-300',
    And: 'bg-gray-500/20 text-gray-300',
    But: 'bg-red-500/20 text-red-300',
  };
  const color = colorMap[keyword] || 'bg-gray-500/20 text-gray-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium flex-shrink-0 ${color}`}>
      {keyword}
    </span>
  );
}

function StepKeywordBadge({ keyword }: { keyword: string }) {
  const colorMap: Record<string, string> = {
    Action: 'bg-amber-500/20 text-amber-300',
    Assert: 'bg-emerald-500/20 text-emerald-300',
    Comment: 'bg-gray-500/20 text-gray-400',
    Setup: 'bg-sky-500/20 text-sky-300',
  };
  const color = colorMap[keyword] || 'bg-gray-500/20 text-gray-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium flex-shrink-0 ${color}`}>
      {keyword}
    </span>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: 'emerald' | 'amber' | 'red';
}) {
  const valueColor = color === 'emerald' ? 'text-emerald-400'
    : color === 'amber' ? 'text-amber-400'
      : color === 'red' ? 'text-red-400'
        : 'text-gray-200';

  return (
    <div className="bg-surface-1 border border-white/5 rounded-lg p-3 text-center">
      <div className="flex items-center justify-center gap-1 text-gray-500 mb-1.5">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className={`text-lg font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

// ── Artifact URL Helper ──────────────────────────────────────────────────────

function artifactUrl(relPath: string, projectPath?: string): string {
  const normalizedPath = relPath.replace(/\\/g, '/');
  const params = new URLSearchParams({ path: normalizedPath });
  if (projectPath) params.set('project', projectPath);
  return `/api/results/artifact?${params.toString()}`;
}

// ── Explorer Run Output (ANSI) ──────────────────────────────────────────────

function combineIntoLines(
  output: Array<{ stream: 'stdout' | 'stderr'; data: string }>,
): Array<{ stream: 'stdout' | 'stderr'; data: string }> {
  const lines: Array<{ stream: 'stdout' | 'stderr'; data: string }> = [];
  let buffer = '';
  let currentStream: 'stdout' | 'stderr' = 'stdout';

  for (const chunk of output) {
    if (chunk.stream !== currentStream && buffer) {
      const parts = buffer.split('\n');
      for (const part of parts) {
        if (part) lines.push({ stream: currentStream, data: part });
      }
      buffer = '';
    }
    currentStream = chunk.stream;
    buffer += chunk.data;
  }

  if (buffer) {
    const parts = buffer.split('\n');
    for (const part of parts) {
      if (part) lines.push({ stream: currentStream, data: part });
    }
  }

  return lines;
}

function ExplorerRunOutput({ output, isRunning, outputRef }: {
  output: Array<{ stream: 'stdout' | 'stderr'; data: string }>;
  isRunning: boolean;
  outputRef: React.RefObject<HTMLDivElement | null>;
}) {
  const lines = useMemo(() => combineIntoLines(output), [output]);

  return (
    <div
      ref={outputRef}
      className="flex-1 min-h-0 overflow-auto bg-black/40 p-3 font-mono text-[11px] leading-5"
    >
      {lines.length === 0 && isRunning && (
        <span className="text-gray-600">Waiting for output...</span>
      )}
      {lines.map((line, i) => (
        <AnsiLine key={i} data={line.data} stream={line.stream} />
      ))}
    </div>
  );
}

function AnsiLine({ data, stream }: { data: string; stream: 'stdout' | 'stderr' }) {
  const segments = useMemo(() => parseAnsi(data), [data]);
  const baseClass = stream === 'stderr' ? 'text-red-400' : 'text-gray-200';

  if (segments.length <= 1 && !segments[0]?.style.color && !segments[0]?.style.bold && !segments[0]?.style.dim) {
    return <div className={baseClass}>{data}</div>;
  }

  return (
    <div className={baseClass}>
      {segments.map((seg, j) => {
        const style = segmentToStyle(seg.style);
        const hasStyle = Object.keys(style).length > 0;
        return hasStyle
          ? <span key={j} style={style}>{seg.text}</span>
          : <span key={j}>{seg.text}</span>;
      })}
    </div>
  );
}

// ── Run Test Details Panel ───────────────────────────────────────────────────

function RunTestDetailsPanel({ tests, projectPath, onScreenshot }: {
  tests: RunTestDetail[];
  projectPath: string;
  onScreenshot: (path: string, name: string) => void;
}) {
  const failedTests = tests.filter(t => t.status === 'failed' || t.status === 'error');
  const [expandedTests, setExpandedTests] = useState<Set<number>>(
    () => new Set(failedTests.length <= 3 ? failedTests.map((_, i) => i) : [0]),
  );
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  if (failedTests.length === 0) {
    const withScreenshots = tests.filter(t => t.screenshotPath);
    if (withScreenshots.length === 0) return null;

    return (
      <div className="border-t border-white/5 px-4 py-3">
        <h5 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
          <Image size={11} />
          Screenshots ({withScreenshots.length})
        </h5>
        <div className="flex flex-wrap gap-2">
          {withScreenshots.map((t, i) => (
            <button
              key={i}
              onClick={() => onScreenshot(t.screenshotPath!, t.name)}
              className="group relative w-20 h-14 rounded-md overflow-hidden border border-white/10 hover:border-brand-400/50 transition-colors"
            >
              <img
                src={artifactUrl(t.screenshotPath!, projectPath)}
                alt={t.name}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Eye size={12} className="text-white" />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const toggleExpand = (idx: number) => {
    setExpandedTests(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleCopyError = async (text: string, idx: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="border-t border-white/5 px-4 py-3 space-y-2">
      <h5 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
        <AlertTriangle size={11} className="text-red-400" />
        Failed Tests ({failedTests.length})
      </h5>

      {failedTests.map((t, idx) => {
        const isExpanded = expandedTests.has(idx);
        return (
          <div key={idx} className="rounded-lg border border-red-500/20 bg-red-500/5 overflow-hidden">
            <button
              onClick={() => toggleExpand(idx)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-red-500/10 transition-colors"
            >
              {isExpanded ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
              <XCircle size={12} className="text-red-400 flex-shrink-0" />
              <span className="text-xs text-gray-200 truncate flex-1">{t.name}</span>
              {t.duration != null && (
                <span className="text-[10px] text-gray-500 flex-shrink-0">{(t.duration / 1000).toFixed(1)}s</span>
              )}
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 space-y-2 animate-fade-in">
                {t.screenshotPath && (
                  <button
                    onClick={() => onScreenshot(t.screenshotPath!, t.name)}
                    className="group relative w-full max-w-xs h-24 rounded-md overflow-hidden border border-white/10 hover:border-brand-400/50 transition-colors"
                  >
                    <img
                      src={artifactUrl(t.screenshotPath, projectPath)}
                      alt="Failure screenshot"
                      className="w-full h-full object-cover object-top"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                      <Eye size={14} className="text-white" />
                      <span className="text-white text-xs">View Screenshot</span>
                    </div>
                  </button>
                )}

                {t.errorMessage && (
                  <div className="relative">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-medium text-red-300">Error</span>
                      <button
                        onClick={() => handleCopyError(t.errorMessage! + (t.stackTrace ? '\n' + t.stackTrace : ''), idx)}
                        className="text-gray-500 hover:text-gray-300 p-0.5 rounded transition-colors"
                        title="Copy error"
                      >
                        {copiedIdx === idx ? <Check size={10} className="text-emerald-400" /> : <ClipboardCopy size={10} />}
                      </button>
                    </div>
                    <pre className="text-[11px] text-red-300 bg-red-500/10 rounded-md px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-32 overflow-y-auto font-mono leading-relaxed">
                      {t.errorMessage}
                    </pre>
                  </div>
                )}

                {t.stackTrace && (
                  <details className="group/stack">
                    <summary className="text-[10px] font-medium text-gray-500 cursor-pointer hover:text-gray-300 select-none">
                      Stack Trace
                    </summary>
                    <pre className="mt-1 text-[10px] text-gray-500 bg-black/30 rounded-md px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-mono leading-relaxed">
                      {t.stackTrace}
                    </pre>
                  </details>
                )}

                {t.steps && t.steps.length > 0 && (
                  <div>
                    <span className="text-[10px] font-medium text-gray-500">Steps</span>
                    <div className="mt-1 space-y-0.5">
                      {t.steps.map((step, si) => (
                        <div key={si} className="flex items-start gap-1.5 text-[11px]">
                          <span className={`flex-shrink-0 ${
                            step.status === 'passed' ? 'text-emerald-400'
                              : step.status === 'failed' ? 'text-red-400'
                                : 'text-gray-500'
                          }`}>
                            {step.status === 'passed' ? '\u2713' : step.status === 'failed' ? '\u2717' : '-'}
                          </span>
                          <span className="text-gray-500 font-mono">{step.keyword}</span>
                          <span className="text-gray-300">{step.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {t.tracePath && (
                  <div className="flex items-center gap-2">
                    <a
                      href={artifactUrl(t.tracePath, projectPath) + '&download=true'}
                      className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"
                    >
                      <ExternalLink size={10} /> Download Trace
                    </a>
                    <a
                      href={`https://trace.playwright.dev/?trace=${encodeURIComponent(window.location.origin + artifactUrl(t.tracePath, projectPath))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1"
                    >
                      <ExternalLink size={10} /> Open in Trace Viewer
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Inline Code Viewer ───────────────────────────────────────────────────────

const MONACO_LANGUAGE_MAP: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  java: 'java',
  csharp: 'csharp',
  ruby: 'ruby',
  robot: 'plaintext',
  gherkin: 'plaintext',
};

function InlineCodeViewer({ source, language, startLine }: {
  source: string;
  language: string;
  startLine: number;
}) {
  const ct = useChartTheme();
  const lineCount = source.split('\n').length;
  const height = Math.min(lineCount * 20 + 24, 500);
  const monacoLang = MONACO_LANGUAGE_MAP[language] || language || 'plaintext';

  return (
    <div className="rounded-lg border border-white/5 overflow-hidden">
      <Editor
        height={height}
        language={monacoLang}
        value={source}
        theme={ct.monacoTheme}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          lineNumbers: (lineNumber: number) => String(lineNumber + startLine - 1),
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineHeight: 20,
          folding: false,
          renderLineHighlight: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
          domReadOnly: true,
          contextmenu: false,
          padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  );
}
