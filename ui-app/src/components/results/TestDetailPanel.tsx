import { useState } from 'react';
import { X, ChevronDown, ChevronRight, Image, FileText, Sparkles, CheckCircle, XCircle, MinusCircle, CircleDot, HelpCircle, AlertTriangle, Eye, Loader2, User, GitCommitHorizontal, Video, Download, Copy, Check, ExternalLink, Clock, RotateCcw } from 'lucide-react';
import { useTestHistoryData } from '../../hooks/useTestResults';
import { useTestSourceByName } from '../../hooks/useTestExplorer';
import { useGitBlame, useGitFileHistory, useGitChurn } from '../../hooks/useGit';
import { ScreenshotViewer } from './ScreenshotViewer';
import { BrowserIcon } from '../shared/BrowserIcon';
import type { HumanStep } from '../../api/types';

interface TestStep {
  keyword: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending' | 'undefined';
  duration?: number;
  errorMessage?: string;
}

interface TestCase {
  name: string;
  suite?: string;
  file?: string;
  status: string;
  duration?: number;
  errorMessage?: string;
  stackTrace?: string;
  screenshotPath?: string;
  videoPath?: string;
  tracePath?: string;
  retryCount?: number;
  browser?: string;
  steps?: TestStep[];
}

interface Props {
  test?: TestCase;
  projectPath?: string;
  onClose: () => void;
}

/** Build a URL that serves a binary artifact through the artifact API */
function artifactUrl(relPath: string, projectPath?: string): string {
  // Normalize Windows backslashes to forward slashes for URL consistency
  const normalizedPath = relPath.replace(/\\/g, '/');
  const params = new URLSearchParams({ path: normalizedPath });
  if (projectPath) params.set('project', projectPath);
  return `/api/results/artifact?${params.toString()}`;
}

const stepStatusIcon: Record<string, React.ReactNode> = {
  passed: <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />,
  failed: <XCircle size={14} className="text-red-400 flex-shrink-0" />,
  skipped: <MinusCircle size={14} className="text-gray-500 flex-shrink-0" />,
  pending: <CircleDot size={14} className="text-amber-400 flex-shrink-0" />,
  undefined: <HelpCircle size={14} className="text-gray-600 flex-shrink-0" />,
};

export function TestDetailPanel({ test, projectPath, onClose }: Props) {
  const [showStack, setShowStack] = useState(true);
  const [showScreenshot, setShowScreenshot] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [showSteps, setShowSteps] = useState(true);
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [copiedError, setCopiedError] = useState(false);
  const { data: historyData } = useTestHistoryData(test?.name || null);
  const { data: sourceData, isLoading: sourceLoading } = useTestSourceByName(
    test?.file || null,
    test?.name || null,
  );
  const history = historyData?.history || [];
  const humanSteps = sourceData?.humanSteps || [];
  const { data: blameData } = useGitBlame(test?.file || null);
  const { data: fileHistoryData } = useGitFileHistory(test?.file || null, 10);
  const { data: churnData } = useGitChurn(test?.file || null);
  const fileCommits = fileHistoryData?.commits || [];

  if (!test) return null;

  const steps = test.steps || [];
  const passedSteps = steps.filter(s => s.status === 'passed').length;
  const failedSteps = steps.filter(s => s.status === 'failed').length;
  const skippedSteps = steps.filter(s => s.status === 'skipped' || s.status === 'pending' || s.status === 'undefined').length;
  const firstFailedStep = steps.find(s => s.status === 'failed');

  // Get the primary error message (from failed step or test-level)
  const primaryError = firstFailedStep?.errorMessage || test.errorMessage;

  const toggleError = (idx: number) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const copyErrorToClipboard = async () => {
    const errorText = [
      primaryError,
      test.stackTrace ? `\n--- Stack Trace ---\n${test.stackTrace}` : '',
    ].join('');
    try {
      await navigator.clipboard.writeText(errorText);
      setCopiedError(true);
      setTimeout(() => setCopiedError(false), 2000);
    } catch { /* clipboard may not be available */ }
  };

  return (
    <div className="p-5 space-y-4">
      {/* ── Header Card ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-gray-800 break-words">{test.name}</p>
            {test.suite && <p className="text-sm text-gray-500 mt-0.5">{test.suite}</p>}
            {test.file && <p className="text-xs text-gray-400 mt-0.5 font-mono">{test.file}</p>}
            {blameData?.lastModifiedBy && (
              <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-400">
                <User size={10} className="flex-shrink-0" />
                <span>{blameData.lastModifiedBy}</span>
                <span>•</span>
                <span>{formatRelativeTime(blameData.lastModifiedAt)}</span>
                <span>•</span>
                <span className="font-mono text-gray-500">{blameData.lastCommitSha?.slice(0, 7)}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="flex items-center gap-1.5 ml-3 px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors flex-shrink-0">
            <X size={14} /> Close
          </button>
        </div>

        {/* Status badges row */}
        <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-gray-100 flex-wrap">
          <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${
            test.status === 'passed' ? 'bg-emerald-100 text-emerald-700' :
            test.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
          }`}>{test.status.toUpperCase()}</span>
          {test.duration != null && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Clock size={11} />
              {(test.duration / 1000).toFixed(2)}s
            </span>
          )}
          {test.retryCount != null && test.retryCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600">
              <RotateCcw size={11} />
              {test.retryCount} retries
            </span>
          )}
          {test.browser && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-gray-100 text-xs text-gray-600">
              <BrowserIcon browser={test.browser} size={12} />
              {test.browser}
            </span>
          )}
          {steps.length > 0 && (
            <span className="text-xs text-gray-400">
              {passedSteps}/{steps.length} steps passed
            </span>
          )}
        </div>
      </div>

      {/* ── RCA — Root Cause Analysis ────────────────────────────────── */}
      {test.status === 'failed' && (firstFailedStep || test.errorMessage) && (
        <div className="bg-white rounded-xl border border-red-200 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-red-100">
              <AlertTriangle size={14} className="text-red-600" />
            </div>
            <p className="text-xs font-bold text-red-700 uppercase tracking-wide">Root Cause Analysis</p>
            {primaryError && (
              <button
                onClick={copyErrorToClipboard}
                className="ml-auto flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100"
                title="Copy error to clipboard"
              >
                {copiedError ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                {copiedError ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
          {firstFailedStep && (
            <div className="text-sm">
              <p>
                <span className="text-gray-500">Failed at step: </span>
                <span className="text-red-700 font-medium">{firstFailedStep.keyword} {firstFailedStep.name}</span>
              </p>
              {skippedSteps > 0 && (
                <p className="mt-1 text-gray-400 text-xs">
                  {skippedSteps} subsequent step{skippedSteps > 1 ? 's' : ''} skipped due to this failure
                </p>
              )}
            </div>
          )}
          {primaryError && (
            <pre className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
              {primaryError}
            </pre>
          )}

          {/* Inline failure screenshot preview */}
          {test.screenshotPath && (
            <button
              onClick={() => setShowScreenshot(true)}
              className="group relative w-full rounded-lg border border-gray-200 overflow-hidden cursor-pointer hover:border-red-300 transition-colors"
            >
              <img
                src={artifactUrl(test.screenshotPath, projectPath)}
                alt="Failure screenshot"
                className="w-full h-32 object-cover object-top opacity-90 group-hover:opacity-100 transition-opacity"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent flex items-end p-2">
                <span className="text-[11px] text-white flex items-center gap-1">
                  <Image size={10} /> Click to view full screenshot
                </span>
              </div>
            </button>
          )}
        </div>
      )}

      {/* ── Human-readable Test Steps ─────────────────────────────────── */}
      {sourceLoading && test.file && (
        <div className="flex items-center gap-2 py-2 text-gray-400 text-xs">
          <Loader2 size={12} className="animate-spin" />
          <span>Loading test steps...</span>
        </div>
      )}
      {humanSteps.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h4 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-1.5">
            <Eye size={12} />
            Test Steps ({humanSteps.length})
          </h4>
          <div className="space-y-1">
            {humanSteps.map((step: HumanStep, i: number) => (
              <div
                key={i}
                className="flex items-start gap-2 py-2 px-3 rounded-lg bg-gray-50"
              >
                <span className="text-[10px] text-gray-400 w-4 text-right flex-shrink-0 mt-0.5 font-mono">
                  {i + 1}
                </span>
                <HumanStepBadge keyword={step.keyword} />
                <span className="text-xs text-gray-700 leading-relaxed">{step.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Steps section (BDD/Cucumber) — KEEP AS IS ─────────────────── */}
      {steps.length > 0 && (
        <div>
          <button
            onClick={() => setShowSteps(!showSteps)}
            className="flex items-center gap-1 text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 hover:text-gray-300"
          >
            {showSteps ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Steps ({passedSteps} passed{failedSteps > 0 ? `, ${failedSteps} failed` : ''}{skippedSteps > 0 ? `, ${skippedSteps} skipped` : ''})
          </button>
          {showSteps && (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              {steps.map((step, i) => (
                <div
                  key={i}
                  className="border-b border-gray-200 last:border-0 bg-white"
                >
                  <div className="flex items-start gap-2 px-3 py-2 text-xs">
                    <div className="mt-0.5">
                      {stepStatusIcon[step.status] || stepStatusIcon.undefined}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div>
                        <span className="text-gray-800 font-semibold">{step.keyword} </span>
                        <span className={
                          step.status === 'passed' ? 'text-emerald-700'
                          : step.status === 'failed' ? 'text-red-700'
                          : 'text-gray-600'
                        }>{step.name}</span>
                        {step.duration != null && step.duration > 0 && (
                          <span className="text-gray-400 ml-1 text-[10px]">({step.duration}ms)</span>
                        )}
                      </div>
                      {/* Inline error toggle for failed steps */}
                      {step.errorMessage && (
                        <button
                          onClick={() => toggleError(i)}
                          className="mt-1 text-[10px] text-red-500 hover:text-red-700 flex items-center gap-1"
                        >
                          {expandedErrors.has(i) ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                          {expandedErrors.has(i) ? 'Hide error' : 'Show error details'}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Expanded error detail */}
                  {step.errorMessage && expandedErrors.has(i) && (
                    <div className="px-3 pb-2 ml-7">
                      <pre className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-lg p-2 whitespace-pre-wrap break-all overflow-x-auto max-h-48 overflow-y-auto">
                        {step.errorMessage}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Scenario-level error ──────────────────────────────────────── */}
      {test.errorMessage && !firstFailedStep && test.status !== 'failed' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Error</p>
          <pre className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap">{test.errorMessage}</pre>
        </div>
      )}

      {/* ── Stack Trace ──────────────────────────────────────────────── */}
      {test.stackTrace && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <button onClick={() => setShowStack(!showStack)} className="flex items-center gap-1.5 text-xs font-bold text-gray-500 uppercase tracking-wide hover:text-gray-700">
            {showStack ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Stack Trace
          </button>
          {showStack && (
            <pre className="mt-3 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto font-mono leading-relaxed">{test.stackTrace}</pre>
          )}
        </div>
      )}

      {/* ── Artifacts ────────────────────────────────────────────────── */}
      {(test.screenshotPath || test.videoPath || test.tracePath) && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Artifacts</p>
          <div className="flex gap-2 flex-wrap">
            {test.screenshotPath && (
              <button
                onClick={() => setShowScreenshot(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-700 font-medium hover:bg-gray-200 transition-colors"
              >
                <Image size={13} className="text-gray-500" /> Screenshot
              </button>
            )}
            {test.videoPath && (
              <button
                onClick={() => setShowVideo(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700 font-medium hover:bg-blue-100 transition-colors"
              >
                <Video size={13} /> Video
              </button>
            )}
            {test.tracePath && (
              <a
                href={artifactUrl(test.tracePath, projectPath) + '&download=true'}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-700 font-medium hover:bg-gray-200 transition-colors"
              >
                <FileText size={13} className="text-gray-500" /> Trace
                <Download size={10} className="text-gray-400" />
              </a>
            )}
            {test.tracePath && (
              <a
                href={`https://trace.playwright.dev/?trace=${encodeURIComponent(window.location.origin + artifactUrl(test.tracePath, projectPath))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-700 font-medium hover:bg-purple-100 transition-colors"
              >
                <ExternalLink size={13} /> Trace Viewer
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── History ──────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">History (last {history.length} runs)</p>
          <div className="flex items-center gap-1.5">
            {history.slice(0, 20).reverse().map((h: any, i: number) => (
              <div key={i} className={`w-4 h-4 rounded ${h.status === 'passed' ? 'bg-emerald-400' : h.status === 'failed' ? 'bg-red-400' : 'bg-gray-300'}`}
                title={`${h.status} — ${new Date(h.timestamp).toLocaleDateString()}`} />
            ))}
          </div>
        </div>
      )}

      {/* ── Git History ──────────────────────────────────────────────── */}
      {fileCommits.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <GitCommitHorizontal size={12} /> Git History
          </p>
          <div className="space-y-2">
            {fileCommits.slice(0, 5).map((c: any) => (
              <div key={c.sha} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-gray-50">
                <span className="font-mono text-gray-500 w-14 flex-shrink-0">{c.shortSha}</span>
                <span className="text-gray-700 truncate flex-1">{c.message}</span>
                <span className="text-gray-400 flex-shrink-0 text-[11px]">{formatRelativeTime(c.timestamp)}</span>
              </div>
            ))}
          </div>
          {churnData && churnData.churnScore > 5 && (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={11} />
              Modified {churnData.editCount} times in {churnData.daysSpan} days (high churn)
            </div>
          )}
        </div>
      )}

      {/* ── AI Fix Suggestion ────────────────────────────────────────── */}
      {test.status === 'failed' && (test.errorMessage || firstFailedStep?.errorMessage) && (
        <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white border border-purple-200 text-purple-700 text-sm font-medium hover:bg-purple-50 transition-colors">
          <Sparkles size={14} /> AI Fix Suggestion
        </button>
      )}

      {/* ── Screenshot Viewer Modal ──────────────────────────────────── */}
      {showScreenshot && test.screenshotPath && (
        <ScreenshotViewer
          url={artifactUrl(test.screenshotPath, projectPath)}
          testName={test.name}
          onClose={() => setShowScreenshot(false)}
        />
      )}

      {/* ── Video Player Modal ───────────────────────────────────────── */}
      {showVideo && test.videoPath && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setShowVideo(false)}>
          <div className="bg-white rounded-xl border border-gray-200 max-w-4xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Video size={14} className="text-blue-600" />
                <p className="text-sm text-gray-800 font-medium truncate">{test.name} — Video</p>
              </div>
              <button onClick={() => setShowVideo(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-gray-50">
              <video
                src={artifactUrl(test.videoPath, projectPath)}
                controls
                autoPlay
                className="max-w-full max-h-[70vh] rounded-lg"
              >
                Your browser does not support the video element.
              </video>
            </div>
          </div>
        </div>
      )}
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
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffDays < 90) return `${diffWeeks}w ago`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;
  } catch {
    return '';
  }
}

function HumanStepBadge({ keyword }: { keyword: string }) {
  const colorMap: Record<string, string> = {
    Action: 'bg-amber-100 text-amber-700',
    Assert: 'bg-emerald-100 text-emerald-700',
    Comment: 'bg-gray-100 text-gray-500',
    Setup: 'bg-blue-100 text-blue-700',
  };
  const color = colorMap[keyword] || 'bg-gray-100 text-gray-600';

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium flex-shrink-0 ${color}`}>
      {keyword}
    </span>
  );
}
