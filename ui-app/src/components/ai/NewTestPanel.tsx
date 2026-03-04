import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { aiNewTest } from '../../api/client';
import {
  Sparkles, Plus, Globe, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, RotateCcw, FileText, FilePlus, FileEdit,
  ChevronsUpDown,
} from 'lucide-react';
import type { WSMessage } from '../../api/types';
import {
  ScopedStreamPanel,
  PermissionPrompt,
  parseAttemptInfo,
  type ScopedStreamState,
  type ToolEvent,
} from '../results/FailureAnalysis';

// ── File Diff Types ──────────────────────────────────────────────────────────

export interface FileDiff {
  filePath: string;
  diffType: 'new' | 'modified';
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  timestamp: number;
}

// ── DiffViewer Component (exported for reuse by FailureAnalysis) ─────────────

export function DiffViewer({ diffs }: { diffs: FileDiff[] }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [allExpanded, setAllExpanded] = useState(false);

  if (diffs.length === 0) return null;

  const toggleAll = () => {
    const next = !allExpanded;
    setAllExpanded(next);
    const map: Record<number, boolean> = {};
    diffs.forEach((_, i) => { map[i] = next; });
    setExpanded(map);
  };

  const toggleOne = (idx: number) => {
    setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="mt-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <FileText size={13} className="text-sky-400" />
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            File Changes
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
            {diffs.length} file{diffs.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={toggleAll}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-400 transition-colors"
        >
          <ChevronsUpDown size={11} />
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {/* File cards */}
      <div className="space-y-1.5">
        {diffs.map((d, i) => {
          const isExp = expanded[i] ?? false;
          return (
            <div key={`${d.filePath}-${d.timestamp}`} className="rounded-lg border border-white/5 bg-black/20 overflow-hidden">
              {/* File header */}
              <button
                onClick={() => toggleOne(i)}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors text-left"
              >
                {isExp ? <ChevronDown size={12} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={12} className="text-gray-500 flex-shrink-0" />}
                {d.diffType === 'new'
                  ? <FilePlus size={13} className="text-emerald-400 flex-shrink-0" />
                  : <FileEdit size={13} className="text-amber-400 flex-shrink-0" />}
                <span className="text-xs font-mono text-gray-300 truncate flex-1">{d.filePath}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${
                  d.diffType === 'new'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  {d.diffType === 'new' ? 'New' : 'Modified'}
                </span>
                {d.linesAdded > 0 && (
                  <span className="text-[10px] text-emerald-400 flex-shrink-0">+{d.linesAdded}</span>
                )}
                {d.linesRemoved > 0 && (
                  <span className="text-[10px] text-red-400 flex-shrink-0">-{d.linesRemoved}</span>
                )}
              </button>

              {/* Diff content */}
              {isExp && (
                <div className="border-t border-white/5 max-h-[400px] overflow-auto">
                  <pre className="text-[11px] font-mono leading-[1.6]">
                    {d.diff.split('\n').map((line, li) => {
                      let bgClass = '';
                      let textClass = 'text-gray-400';

                      if (line.startsWith('+++') || line.startsWith('---')) {
                        textClass = 'text-gray-500 font-bold';
                        bgClass = 'bg-white/[0.02]';
                      } else if (line.startsWith('@@')) {
                        textClass = 'text-purple-400';
                        bgClass = 'bg-purple-500/5';
                      } else if (line.startsWith('+')) {
                        textClass = 'text-emerald-300';
                        bgClass = 'bg-emerald-500/8';
                      } else if (line.startsWith('-')) {
                        textClass = 'text-red-300';
                        bgClass = 'bg-red-500/8';
                      }

                      return (
                        <div key={li} className={`px-3 py-0 ${bgClass} ${textClass} whitespace-pre-wrap break-all`}>
                          {line || ' '}
                        </div>
                      );
                    })}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── NewTestPanel Component ───────────────────────────────────────────────────

export function NewTestPanel() {
  const { subscribe, send } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    send: (msg: object) => void;
  }>();

  // Form state
  const [prompt, setPrompt] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Streaming state (single, not keyed by index)
  const [streamState, setStreamState] = useState<ScopedStreamState>({
    requestId: null,
    content: '',
    status: 'idle',
    toolEvents: [],
    pendingPermission: null,
  });

  // File diffs collected during the session
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);

  const panelRef = useRef<HTMLDivElement>(null);

  // ── WebSocket message handler ──────────────────────────────────────────────
  // Uses functional updater to avoid stale closure issues.
  const handleMessage = useCallback((msg: WSMessage) => {
    const msgRequestId = msg.requestId as string | undefined;
    if (!msgRequestId) return;

    // Handle file diff messages
    if (msg.type === 'ai-fix-file-diff') {
      setFileDiffs(prev => {
        // Check if there's already a diff for this file — replace it (AI may edit same file multiple times)
        const existing = prev.findIndex(d => d.filePath === (msg.filePath as string));
        const newDiff: FileDiff = {
          filePath: msg.filePath as string,
          diffType: msg.diffType as 'new' | 'modified',
          diff: msg.diff as string,
          linesAdded: msg.linesAdded as number,
          linesRemoved: msg.linesRemoved as number,
          timestamp: Date.now(),
        };
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = newDiff;
          return updated;
        }
        return [...prev, newDiff];
      });
      return;
    }

    setStreamState(prev => {
      if (!prev.requestId || prev.requestId !== msgRequestId) return prev;

      if (msg.type === 'ai-fix-stream') {
        return { ...prev, content: prev.content + (msg.content as string), status: 'streaming' as const };
      }

      if (msg.type === 'ai-fix-status') {
        return { ...prev, statusMessage: msg.message as string };
      }

      if (msg.type === 'ai-fix-tool') {
        const phase = msg.phase as string;
        const toolName = msg.toolName as string;
        const args = msg.args as string;

        if (phase === 'complete' || phase === 'error' || phase === 'denied') {
          const updatedEvents = prev.toolEvents.map(evt =>
            evt.toolName === toolName && evt.phase === 'start'
              ? { ...evt, phase: phase as ToolEvent['phase'], result: msg.result as string | undefined, error: msg.error as string | undefined }
              : evt,
          );
          return { ...prev, toolEvents: updatedEvents };
        }

        // New tool start
        const newEvent: ToolEvent = {
          id: `${Date.now()}-${prev.toolEvents.length}`,
          phase: 'start',
          toolName,
          args,
          timestamp: Date.now(),
        };
        return { ...prev, toolEvents: [...prev.toolEvents, newEvent] };
      }

      if (msg.type === 'ai-fix-permission') {
        return {
          ...prev,
          pendingPermission: {
            permissionId: msg.permissionId as string,
            toolName: msg.toolName as string,
            args: msg.args as string,
          },
        };
      }

      if (msg.type === 'ai-fix-done') {
        return { ...prev, status: 'done' as const, statusMessage: undefined, pendingPermission: null };
      }

      if (msg.type === 'ai-fix-error') {
        return { ...prev, status: 'error' as const, error: msg.message as string, pendingPermission: null };
      }

      return prev;
    });
  }, []);

  // Subscribe to WebSocket
  useEffect(() => subscribe(handleMessage), [subscribe, handleMessage]);

  // Auto-scroll
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = panelRef.current.scrollHeight;
  }, [streamState.content, streamState.toolEvents]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!prompt.trim()) return;
    const requestId = `newtest-${Date.now()}`;
    setStreamState({
      requestId,
      content: '',
      status: 'streaming',
      toolEvents: [],
      pendingPermission: null,
    });
    setFileDiffs([]); // Reset diffs for new request
    try {
      await aiNewTest({
        requestId,
        prompt: prompt.trim(),
        context: targetUrl ? { targetUrl } : undefined,
      });
    } catch (err) {
      setStreamState(prev => ({ ...prev, status: 'error', error: String(err) }));
    }
  };

  const handlePermissionResponse = (permissionId: string, granted: boolean, remember?: boolean) => {
    send({
      type: 'ai-fix-permission-response',
      permissionId,
      granted,
      remember: remember || false,
    });
    setStreamState(prev => ({ ...prev, pendingPermission: null }));
  };

  const handleReset = () => {
    setPrompt('');
    setTargetUrl('');
    setShowAdvanced(false);
    setStreamState({
      requestId: null,
      content: '',
      status: 'idle',
      toolEvents: [],
      pendingPermission: null,
    });
    setFileDiffs([]);
  };

  const handleCreateAnother = () => {
    setStreamState({
      requestId: null,
      content: '',
      status: 'idle',
      toolEvents: [],
      pendingPermission: null,
    });
    setFileDiffs([]);
  };

  const isStreaming = streamState.status === 'streaming';
  const isDone = streamState.status === 'done';
  const isError = streamState.status === 'error';
  const isIdle = streamState.status === 'idle';
  const attemptInfo = parseAttemptInfo(streamState.content);

  // Detect final verdict from content
  const getVerdict = (): 'pass' | 'fail' | null => {
    if (!isDone || !streamState.content) return null;
    const finalIdx = streamState.content.search(/###\s*Final\s*Result/i);
    if (finalIdx >= 0) {
      const finalSection = streamState.content.slice(finalIdx);
      if (/\*\*Status:\*\*\s*PASS/i.test(finalSection)) return 'pass';
      if (/\*\*Status:\*\*\s*FAIL/i.test(finalSection)) return 'fail';
      if (/pass(ed)?/i.test(finalSection) && !/fail/i.test(finalSection)) return 'pass';
      if (/fail/i.test(finalSection)) return 'fail';
    }
    if (attemptInfo?.status === 'pass') return 'pass';
    if (!attemptInfo) {
      const runEvents = streamState.toolEvents.filter(e =>
        (e.toolName === 'run_command' || e.toolName === 'run_tests') && e.phase === 'complete',
      );
      if (runEvents.length > 0) return 'pass';
    }
    return null;
  };

  const verdict = getVerdict();

  return (
    <div className="flex flex-col h-full">
      {/* Form section — shown when idle */}
      {isIdle && (
        <div className="p-6 space-y-5 flex-shrink-0 animate-fade-in max-w-5xl mx-auto w-full">
          <div>
            <label className="text-sm text-gray-400 block mb-1.5 font-medium">
              Describe your test scenario
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={`e.g., "Test the checkout flow: add item to cart, proceed to checkout, fill shipping details, complete payment, and verify order confirmation"\n\nor "Create a login test that validates email format, shows error for wrong password, and successfully logs in with valid credentials"`}
              rows={5}
              className="w-full bg-surface-2 border border-white/10 rounded-lg px-4 py-3 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 resize-none leading-relaxed"
            />
          </div>

          {/* Advanced options */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gray-500 hover:text-gray-400 flex items-center gap-1.5 transition-colors"
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 pl-4 border-l border-white/5">
                <div>
                  <label className="text-sm text-gray-400 block mb-1.5">
                    <Globe size={13} className="inline mr-1" />
                    Target URL (optional)
                  </label>
                  <input
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://example.com/login"
                    className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50"
                  />
                  <p className="text-xs text-gray-600 mt-1">
                    If provided, the AI may launch a browser to inspect elements and discover selectors.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-white/10"
          >
            <Plus size={16} />
            Create New Test
          </button>

          <p className="text-sm text-gray-600 leading-relaxed">
            AI will scan your project, reuse existing page objects & step definitions, create only new code, then run and verify the test. Up to 3 self-healing attempts if the test fails.
          </p>
        </div>
      )}

      {/* Streaming / Done / Error section */}
      {!isIdle && streamState.requestId && (
        <div className="flex-1 overflow-y-auto p-6 space-y-3 animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-purple-400" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                New Test Creation
              </span>

              {/* Status badges */}
              {isStreaming && !attemptInfo && (
                <span className="flex items-center gap-1 text-xs text-purple-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  {streamState.statusMessage || (streamState.toolEvents.length > 0
                    ? `Working... (${streamState.toolEvents.filter(e => e.phase === 'complete' || e.phase === 'error').length}/${streamState.toolEvents.filter(e => e.phase === 'start').length} tools)`
                    : 'Scanning project...')}
                </span>
              )}
              {isStreaming && attemptInfo && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {`Attempt ${attemptInfo.current} of ${attemptInfo.total}${attemptInfo.status === 'fail' ? ' — retrying...' : attemptInfo.status === 'pass' ? ' — passed!' : ' — running...'}`}
                </span>
              )}
              {isDone && verdict === 'pass' && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle2 size={12} /> Test Created & Passed
                </span>
              )}
              {isDone && verdict === 'fail' && (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <XCircle size={12} /> Test Created — Needs Manual Fix
                </span>
              )}
              {isDone && verdict === null && (
                <span className="text-xs text-gray-400">Complete</span>
              )}
              {isError && <span className="text-xs text-red-400">Error</span>}
            </div>

            <div className="flex items-center gap-1">
              {(isDone || isError) && (
                <>
                  <button
                    onClick={handleCreateAnother}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-gray-400 transition-colors"
                  >
                    <Plus size={12} /> New
                  </button>
                  <button
                    onClick={handleReset}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-gray-400 transition-colors"
                  >
                    <RotateCcw size={12} /> Reset
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Self-healing progress bar */}
          {attemptInfo && (
            <div className="mb-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Test Verification Progress</span>
                <span className="text-[10px] text-gray-600">
                  {attemptInfo.status === 'pass'
                    ? '✓ Passed'
                    : attemptInfo.status === 'fail' && isDone
                      ? '✗ All attempts exhausted'
                      : `Attempt ${attemptInfo.current} of ${attemptInfo.total}`}
                </span>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: attemptInfo.total }, (_, idx) => {
                  const attemptNum = idx + 1;
                  let bgColor = 'bg-gray-700';
                  if (attemptNum < attemptInfo.current) bgColor = 'bg-red-500/50';
                  if (attemptNum === attemptInfo.current && attemptInfo.status === 'running') bgColor = 'bg-amber-500 animate-pulse';
                  if (attemptNum === attemptInfo.current && attemptInfo.status === 'pass') bgColor = 'bg-emerald-500';
                  if (attemptNum === attemptInfo.current && attemptInfo.status === 'fail' && isStreaming) bgColor = 'bg-red-500 animate-pulse';
                  if (attemptNum === attemptInfo.current && attemptInfo.status === 'fail' && isDone) bgColor = 'bg-red-500';
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className={`h-2 w-full rounded-full ${bgColor} transition-colors`} />
                      <span className="text-[9px] text-gray-600">{attemptNum}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Permission prompt */}
          {streamState.pendingPermission && (
            <PermissionPrompt
              permission={streamState.pendingPermission}
              onRespond={handlePermissionResponse}
            />
          )}

          {/* Main streaming panel */}
          <ScopedStreamPanel
            state={streamState}
            panelRef={panelRef}
            label="New Test"
            icon={<Plus size={14} />}
            emptyMessage="Scanning project structure and analyzing existing code..."
          />

          {/* File Changes Diff Viewer */}
          {fileDiffs.length > 0 && <DiffViewer diffs={fileDiffs} />}

          {/* Success banner */}
          {isDone && verdict === 'pass' && (
            <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={22} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-300">Test Created & Verified!</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {attemptInfo && attemptInfo.current > 1
                    ? `The AI created the test and self-healed in ${attemptInfo.current} attempt${attemptInfo.current !== 1 ? 's' : ''}.`
                    : 'The new test was created and passed on the first run.'}
                  {' '}Check the "Final Result" section above for details on files created and reused code.
                </p>
              </div>
            </div>
          )}

          {/* Failure banner */}
          {isDone && verdict === 'fail' && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <XCircle size={22} className="text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-red-300">Test Created — Needs Manual Fix</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  The AI created the test files but couldn't get it to pass after {attemptInfo?.total || 3} attempts.
                  Review the code and error details above, then fix manually or retry.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
