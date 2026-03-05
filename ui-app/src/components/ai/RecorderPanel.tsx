import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  startRecording,
  stopRecording,
  getRecorderStatus,
  generateFromRecording,
  resetRecording,
  playbackRecording,
  deleteRecorderAction,
  toggleAssertMode,
  getBrowserStatus,
} from '../../api/client';
import {
  Circle, Square, Play, Globe, Loader2, RotateCcw,
  MousePointer2, Type, Keyboard, ListOrdered, CheckSquare,
  ArrowRight, Clock, Sparkles, ChevronDown,
  Bot, Wrench, AlertCircle, CheckCircle2, XCircle, Shield,
  FileCode, Pause, SkipForward, FastForward, X,
  ShieldCheck, Eye, Hash, Link, FileCheck,
} from 'lucide-react';
import {
  PermissionPrompt,
  type ToolEvent,
  AIMarkdown,
} from '../results/FailureAnalysis';
import { DiffViewer, type FileDiff } from './NewTestPanel';
import type { WSMessage } from '../../api/types';
import { LiveBrowserWrapper } from './LiveBrowserWrapper';

// ── Types ────────────────────────────────────────────────────────────────────

type RecorderPhase = 'setup' | 'recording' | 'stopped' | 'playback' | 'generating' | 'done';

type TimelineEntry =
  | { kind: 'recorded-action'; id: string; actionType: string; description: string; selector?: string | { primary: string }; value?: string; timestamp: number; assertType?: string; expectedValue?: string }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'text'; id: string; text: string; done?: boolean }
  | { kind: 'tool'; id: string; toolId: string; phase: 'start' | 'complete' | 'error' | 'denied'; toolName: string; args: string; result?: string; error?: string }
  | { kind: 'file-diff'; id: string; filePath: string; diffType: string; diff: string; linesAdded?: number; linesRemoved?: number }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'loading'; id: string }
  | { kind: 'playback-action'; id: string; actionType: string; description: string; status: 'pending' | 'running' | 'done' | 'error' };

interface PendingPermission {
  permissionId: string;
  toolName: string;
  args: string;
}

// ── Helper: format seconds to mm:ss ──────────────────────────────────────────
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Action type icon mapping ─────────────────────────────────────────────────
function ActionIcon({ type }: { type: string }) {
  const map: Record<string, React.ReactNode> = {
    click: <MousePointer2 size={12} className="text-blue-400" />,
    dblclick: <MousePointer2 size={12} className="text-blue-300" />,
    fill: <Type size={12} className="text-emerald-400" />,
    type: <Type size={12} className="text-emerald-400" />,
    press: <Keyboard size={12} className="text-amber-400" />,
    navigate: <Globe size={12} className="text-purple-400" />,
    select: <ListOrdered size={12} className="text-cyan-400" />,
    check: <CheckSquare size={12} className="text-emerald-400" />,
    uncheck: <Square size={12} className="text-gray-400" />,
    hover: <ArrowRight size={12} className="text-gray-400" />,
    scroll: <ChevronDown size={12} className="text-gray-400" />,
    assert: <ShieldCheck size={12} className="text-green-400" />,
  };
  return <>{map[type] || <Circle size={10} className="text-gray-500" />}</>;
}

// ── RecorderPanel Component ──────────────────────────────────────────────────

export function RecorderPanel() {
  const { subscribe, send } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    send: (msg: object) => void;
  }>();

  // Phase
  const [phase, setPhase] = useState<RecorderPhase>('setup');

  // Timeline (recorded actions + system messages + tool events + file diffs — ALL inline)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);

  // Setup form
  const [startUrl, setStartUrl] = useState('');
  const [testName, setTestName] = useState('');
  const [format, setFormat] = useState('');

  // Recording state
  const [elapsedTime, setElapsedTime] = useState(0);
  const [actionCount, setActionCount] = useState(0);
  const startTimeRef = useRef(0);

  // Browser status
  const [browserActive, setBrowserActive] = useState(false);

  // Loading states
  const [startLoading, setStartLoading] = useState(false);
  const [stopLoading, setStopLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [playbackLoading, setPlaybackLoading] = useState(false);

  // Streaming state for code generation
  const streamTextRef = useRef('');
  const streamTextIdRef = useRef<string | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

  // Playback state
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [playbackIndex, setPlaybackIndex] = useState(-1);
  const [playbackTotal, setPlaybackTotal] = useState(0);

  // Assert mode
  const [assertActive, setAssertActive] = useState(false);

  // AI pause state (for code generation)
  const [aiPaused, setAiPaused] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const msgCounter = useRef(0);
  const uid = () => `rec-${++msgCounter.current}`;

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [timeline]);

  // ── Fetch browser status on mount AND whenever we return to setup ────────
  useEffect(() => {
    getBrowserStatus().then((s) => setBrowserActive(s.active)).catch(() => setBrowserActive(false));
  }, [phase]);

  // ── Check recorder status on mount (resume if active) ───────────────────
  useEffect(() => {
    getRecorderStatus().then((s) => {
      if (s.recording) {
        setPhase('recording');
        setActionCount(s.actionCount || 0);
        startTimeRef.current = Date.now();
      } else if (s.hasSession) {
        setPhase('stopped');
        setActionCount(s.actionCount || 0);
      }
    }).catch(() => {});
  }, []);

  // ── Recording timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'recording') return;
    startTimeRef.current = startTimeRef.current || Date.now();
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // ── Flush streaming text helper ──────────────────────────────────────────
  const flushStreamText = useCallback(() => {
    if (streamTextRef.current && streamTextIdRef.current) {
      const id = streamTextIdRef.current;
      const text = streamTextRef.current;
      setTimeline(prev => {
        const idx = prev.findIndex(e => e.id === id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { kind: 'text', id, text, done: true };
          return next;
        }
        return prev;
      });
    }
    streamTextRef.current = '';
    streamTextIdRef.current = null;
  }, []);

  // ── WebSocket message handler ────────────────────────────────────────────
  useEffect(() => {
    const unsub = subscribe((msg: WSMessage) => {
      // AI pause/resume status (for code generation phase)
      if (msg.type === 'ai-orchestrator-paused') { setAiPaused(true); return; }
      if (msg.type === 'ai-orchestrator-resumed') { setAiPaused(false); return; }

      // Live recorded action
      if (msg.type === 'recorder-action') {
        const action = msg.action as any;
        const actionId = action.id || uid();

        // If ID ends with "-update", this is a fill-merge: update the last fill entry in-place
        if (typeof actionId === 'string' && actionId.endsWith('-update')) {
          setTimeline(prev => {
            // Find the last recorded-action fill entry and update it
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              const e = copy[i]!;
              if (e.kind === 'recorded-action' && e.actionType === 'fill') {
                copy[i] = {
                  ...e,
                  description: action.description || e.description,
                  value: action.value ?? (e as any).value,
                };
                break;
              }
            }
            return copy;
          });
          return;
        }

        setTimeline(prev => [...prev, {
          kind: 'recorded-action',
          id: actionId,
          actionType: action.type,
          description: action.description || action.type,
          selector: action.selector,
          value: action.value,
          timestamp: action.timestamp,
          assertType: action.assertType,
          expectedValue: action.expectedValue,
        }]);
        setActionCount(prev => prev + 1);

        // Auto-exit assert mode in UI when an assertion is captured
        if (action.type === 'assert') {
          setAssertActive(false);
        }
        return;
      }

      // Assert mode toggled (from ESC key in browser or after assertion capture)
      if (msg.type === 'recorder-assert-mode') {
        setAssertActive(!!(msg as any).active);
        return;
      }

      // Browser closed externally — stop recording UI if active
      if (msg.type === 'browser-closed') {
        setBrowserActive(false);
        if (phase === 'recording') {
          // Backend will send recorder-status:stopped, but ensure we show immediate feedback
          setTimeline(prev => [...prev, {
            kind: 'system',
            id: uid(),
            text: 'Browser closed — recording stopped',
          }]);
          setPhase('stopped');
          setAssertActive(false);
        }
        return;
      }

      // Browser launched — update status
      if (msg.type === 'browser-launched') {
        setBrowserActive(true);
        return;
      }

      // Recorder status changes
      if (msg.type === 'recorder-status') {
        if (msg.status === 'recording') {
          setPhase('recording');
          startTimeRef.current = Date.now();
        } else if (msg.status === 'stopped') {
          setPhase('stopped');
        } else if (msg.status === 'reset') {
          setPhase('setup');
          setTimeline([]);
          setActionCount(0);
          setElapsedTime(0);
          setPendingPermission(null);
        }
        return;
      }

      // Playback progress
      if (msg.type === 'recorder-playback') {
        const m = msg as any;
        if (m.status === 'started') {
          setPhase('playback');
          setPlaybackIndex(0);
          setPlaybackTotal(m.totalActions || 0);
          setTimeline(prev => [...prev, {
            kind: 'system',
            id: uid(),
            text: `Playback started — replaying ${m.totalActions} action(s)...`,
          }]);
        } else if (m.status === 'action') {
          setPlaybackIndex(m.index + 1);
          setTimeline(prev => [...prev, {
            kind: 'playback-action',
            id: uid(),
            actionType: m.actionType || 'action',
            description: m.description || `Action ${m.index + 1}`,
            status: 'done',
          }]);
        } else if (m.status === 'action-error') {
          setTimeline(prev => [...prev, {
            kind: 'playback-action',
            id: uid(),
            actionType: m.actionType || 'action',
            description: m.description || `Action ${m.index + 1}`,
            status: 'error',
          }]);
        } else if (m.status === 'done') {
          setPhase('stopped');
          setPlaybackLoading(false);
          setTimeline(prev => [...prev, {
            kind: 'system',
            id: uid(),
            text: `Playback complete — ${m.replayed || 0} of ${m.total || 0} actions replayed${m.errors ? ` (${m.errors} errors)` : ''}`,
          }]);
        } else if (m.status === 'error') {
          setPhase('stopped');
          setPlaybackLoading(false);
          setTimeline(prev => [...prev, {
            kind: 'error',
            id: uid(),
            text: `Playback failed: ${m.error || 'Unknown error'}`,
          }]);
        }
        return;
      }

      // AI streaming messages (scoped to current requestId)
      const rId = (msg as any).requestId as string | undefined;
      if (!rId || rId !== currentRequestId) return;

      if (msg.type === 'ai-fix-stream') {
        const content = (msg as any).content as string;
        if (!streamTextIdRef.current) {
          const id = uid();
          streamTextIdRef.current = id;
          streamTextRef.current = content;
          setTimeline(prev => [...prev, { kind: 'text', id, text: content }]);
        } else {
          streamTextRef.current += content;
          const id = streamTextIdRef.current;
          const text = streamTextRef.current;
          setTimeline(prev => {
            const idx = prev.findIndex(e => e.id === id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { kind: 'text', id, text };
              return next;
            }
            return prev;
          });
        }
      } else if (msg.type === 'ai-fix-tool') {
        const m = msg as any;
        const toolId = `${m.toolName}::${m.args || ''}`;

        if (m.phase === 'start') {
          // Flush any in-progress text before showing tool
          flushStreamText();
          // Add tool-start inline in the timeline
          setTimeline(prev => [...prev, {
            kind: 'tool',
            id: uid(),
            toolId,
            phase: 'start',
            toolName: m.toolName,
            args: m.args || '',
          }]);
        } else {
          // Update the existing tool entry in-place (complete/error/denied)
          setTimeline(prev => {
            // Find the last matching tool-start entry
            const idx = [...prev].reverse().findIndex(
              e => e.kind === 'tool' && (e as any).toolId === toolId && (e as any).phase === 'start'
            );
            if (idx >= 0) {
              const realIdx = prev.length - 1 - idx;
              const next = [...prev];
              next[realIdx] = {
                ...next[realIdx] as any,
                phase: m.phase,
                result: m.result,
                error: m.error,
              };
              return next;
            }
            // If no matching start found, add as new entry
            return [...prev, {
              kind: 'tool',
              id: uid(),
              toolId,
              phase: m.phase,
              toolName: m.toolName,
              args: m.args || '',
              result: m.result,
              error: m.error,
            }];
          });
        }
      } else if (msg.type === 'ai-fix-file-diff') {
        const m = msg as any;
        // Flush text, then add diff inline in the timeline
        flushStreamText();
        setTimeline(prev => [...prev, {
          kind: 'file-diff',
          id: uid(),
          filePath: m.filePath,
          diffType: m.diffType,
          diff: m.diff,
          linesAdded: m.linesAdded,
          linesRemoved: m.linesRemoved,
        }]);
      } else if (msg.type === 'ai-fix-permission') {
        const m = msg as any;
        flushStreamText();
        setPendingPermission({
          permissionId: m.permissionId,
          toolName: m.toolName,
          args: m.args || '',
        });
      } else if (msg.type === 'ai-fix-done') {
        flushStreamText();
        setPhase('done');
        setGenLoading(false);
        setAiPaused(false);
      } else if (msg.type === 'ai-fix-error') {
        flushStreamText();
        setTimeline(prev => [...prev, {
          kind: 'error',
          id: uid(),
          text: (msg as any).message || 'Unknown error',
        }]);
        setGenLoading(false);
        setAiPaused(false);
      }
    });
    return unsub;
  }, [subscribe, currentRequestId, flushStreamText, phase]);

  // ── Start recording ──────────────────────────────────────────────────────
  const handleStart = async () => {
    setStartLoading(true);
    try {
      await startRecording({
        url: startUrl || undefined,
        browser: 'chromium',
        headless: false,
      });
      setTimeline([{
        kind: 'system',
        id: uid(),
        text: startUrl
          ? `Recording started — navigating to ${startUrl}`
          : 'Recording started — interact with the browser',
      }]);
      setPhase('recording');
      setActionCount(0);
      setElapsedTime(0);
      startTimeRef.current = Date.now();
    } catch (err) {
      setTimeline(prev => [...prev, {
        kind: 'error',
        id: uid(),
        text: `Failed to start recording: ${err}`,
      }]);
    } finally {
      setStartLoading(false);
    }
  };

  // ── Stop recording ───────────────────────────────────────────────────────
  const handleStop = async () => {
    setStopLoading(true);
    try {
      const result = await stopRecording();
      setTimeline(prev => [...prev, {
        kind: 'system',
        id: uid(),
        text: `Recording stopped — ${result.actionCount} action(s) captured in ${(result.duration / 1000).toFixed(1)}s`,
      }]);
      setPhase('stopped');
      setAssertActive(false);

      // Auto-derive test name from URL if possible
      if (!testName && result.actions.length > 0) {
        const navAction = result.actions.find(a => a.type === 'navigate');
        if (navAction?.url) {
          try {
            const hostname = new URL(navAction.url).hostname.replace(/\./g, '-');
            setTestName(`${hostname}-test`);
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setTimeline(prev => [...prev, {
        kind: 'error',
        id: uid(),
        text: `Failed to stop recording: ${err}`,
      }]);
    } finally {
      setStopLoading(false);
    }
  };

  // ── Playback recorded actions ────────────────────────────────────────────
  const handlePlayback = async () => {
    setPlaybackLoading(true);
    setPlaybackIndex(0);
    try {
      await playbackRecording({ speed: playbackSpeed });
    } catch (err) {
      setTimeline(prev => [...prev, {
        kind: 'error',
        id: uid(),
        text: `Playback failed: ${err}`,
      }]);
      setPlaybackLoading(false);
    }
  };

  // ── Generate code ────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    setGenLoading(true);
    setPendingPermission(null);
    streamTextRef.current = '';
    streamTextIdRef.current = null;

    const requestId = `recorder-${Date.now()}`;
    setCurrentRequestId(requestId);
    setPhase('generating');

    setTimeline(prev => [...prev, {
      kind: 'system',
      id: uid(),
      text: 'Generating code with AI — analyzing your project patterns...',
    }]);

    try {
      await generateFromRecording({
        requestId,
        testName: testName || 'recorded test',
        format: format || undefined,
      });
    } catch (err) {
      setTimeline(prev => [...prev, {
        kind: 'error',
        id: uid(),
        text: `Failed to start code generation: ${err}`,
      }]);
      setGenLoading(false);
    }
  };

  // ── Permission response ──────────────────────────────────────────────────
  const handlePermission = (granted: boolean) => {
    if (!pendingPermission) return;
    send({
      type: 'ai-fix-permission-response',
      permissionId: pendingPermission.permissionId,
      granted,
    });
    setPendingPermission(null);
  };

  // ── Delete a single recorded step (UI + backend sync) ─────────────────
  const handleDeleteStep = async (entryId: string) => {
    // Remove from UI immediately
    setTimeline(prev => prev.filter(e => e.id !== entryId));
    setActionCount(prev => Math.max(0, prev - 1));

    // Sync deletion to backend so playback/generate use the updated list
    try {
      await deleteRecorderAction(entryId);
    } catch {
      // Best-effort — UI already updated; backend may not have the ID
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = async () => {
    await resetRecording().catch(() => {});
    setPhase('setup');
    setTimeline([]);
    setActionCount(0);
    setElapsedTime(0);
    setStartUrl('');
    setTestName('');
    setFormat('');
    setPendingPermission(null);
    setCurrentRequestId(null);
    setPlaybackLoading(false);
    setPlaybackIndex(-1);
    streamTextRef.current = '';
    streamTextIdRef.current = null;
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <LiveBrowserWrapper>
    <div className="h-full flex flex-col">
      {/* ── Header Bar ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-white/5 bg-surface-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {phase === 'recording' ? (
              <>
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
                <span className="text-sm font-semibold text-red-400">Recording</span>
                <span className="text-xs text-gray-500 font-mono ml-2">{formatDuration(elapsedTime)}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 ml-1">
                  {actionCount} action{actionCount !== 1 ? 's' : ''}
                </span>
              </>
            ) : phase === 'playback' ? (
              <>
                <Play size={14} className="text-cyan-400 fill-cyan-400" />
                <span className="text-sm font-semibold text-cyan-300">Replaying...</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 ml-1">
                  {playbackIndex}/{playbackTotal}
                </span>
              </>
            ) : phase === 'generating' ? (
              <>
                <Loader2 size={14} className="animate-spin text-brand-400" />
                <span className="text-sm font-semibold text-brand-300">Generating Code...</span>
              </>
            ) : phase === 'stopped' ? (
              <>
                <Square size={14} className="text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">Recording Stopped</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 ml-1">
                  {actionCount} action{actionCount !== 1 ? 's' : ''}
                </span>
              </>
            ) : phase === 'done' ? (
              <>
                <CheckCircle2 size={14} className="text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300">Code Generated</span>
              </>
            ) : (
              <>
                <Circle size={14} className="text-gray-400" />
                <span className="text-sm font-semibold text-gray-300">Browser Recorder</span>
              </>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {phase === 'recording' && (
              <>
                <button
                  onClick={async () => {
                    try {
                      await toggleAssertMode(!assertActive);
                      setAssertActive(!assertActive);
                    } catch { /* ignore */ }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    assertActive
                      ? 'bg-green-500/25 text-green-300 border border-green-500/40 shadow-[0_0_8px_rgba(16,185,129,0.15)]'
                      : 'bg-surface-2 text-gray-400 border border-white/5 hover:text-green-300 hover:bg-green-500/10 hover:border-green-500/20'
                  }`}
                  title={assertActive ? 'Exit assertion mode (ESC)' : 'Enter assertion mode — click elements to add assertions'}
                >
                  <ShieldCheck size={12} />
                  {assertActive ? 'Assert Mode ON' : 'Assert'}
                </button>
                <button
                  onClick={handleStop}
                  disabled={stopLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                >
                  {stopLoading ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
                  Stop Recording
                </button>
              </>
            )}
            {(phase === 'stopped' || phase === 'done') && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-surface-2 border border-transparent transition-colors"
              >
                <RotateCcw size={12} />
                New Recording
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Content ────────────────────────────────────────────── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Phase 1: Setup */}
        {phase === 'setup' && (
          <div className="max-w-xl mx-auto mt-8 space-y-6">
            {/* Icon + description */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 mx-auto">
                <Circle size={28} className="text-red-400" />
              </div>
              <h2 className="text-xl font-semibold text-gray-200">Record Browser Interactions</h2>
              <p className="text-[15px] text-gray-500 max-w-md mx-auto">
                Record your browser interactions, then let AI generate reusable test code
                that follows your project's existing patterns and conventions.
              </p>
            </div>

            {/* URL input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-400">Starting URL (optional)</label>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Globe size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    value={startUrl}
                    onChange={(e) => setStartUrl(e.target.value)}
                    placeholder="https://example.com"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-lg bg-surface-2 border border-white/5 text-[15px] text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/40 focus:ring-1 focus:ring-brand-500/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                  />
                </div>
              </div>
            </div>

            {/* Browser status */}
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className={`w-2 h-2 rounded-full ${browserActive ? 'bg-emerald-400' : 'bg-gray-600'}`} />
              {browserActive
                ? 'Browser is running — recording will use the current session'
                : 'A new browser will be launched for recording'
              }
            </div>

            {/* Start button */}
            <button
              onClick={handleStart}
              disabled={startLoading}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-[15px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              {startLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Circle size={18} className="fill-red-400 text-red-400" />
              )}
              Start Recording
            </button>
          </div>
        )}

        {/* Phase 2+: Timeline (recording + stopped + playback + generating + done) */}
        {phase !== 'setup' && (
          <div className="space-y-0.5">
            {timeline.map((entry, idx) => {
              if (entry.kind === 'recorded-action') {
                // Calculate step number (only count recorded-actions)
                const stepNum = timeline.slice(0, idx + 1).filter(e => e.kind === 'recorded-action').length;
                const isAssert = entry.actionType === 'assert';
                return (
                  <div
                    key={entry.id}
                    className={`flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors group ${
                      isAssert
                        ? 'bg-green-500/[0.04] border border-green-500/10 hover:bg-green-500/[0.07]'
                        : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    {/* Step number badge */}
                    <div className="flex-shrink-0 flex items-center gap-1.5 mt-0.5">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                        isAssert
                          ? 'bg-green-500/15 border border-green-500/25 text-green-400'
                          : 'bg-brand-500/15 border border-brand-500/25 text-brand-400'
                      }`}>
                        {stepNum}
                      </span>
                      <div className={`w-5 h-5 rounded-md flex items-center justify-center ${
                        isAssert
                          ? 'bg-green-500/10 border border-green-500/20'
                          : 'bg-surface-2 border border-white/5'
                      }`}>
                        <ActionIcon type={entry.actionType} />
                      </div>
                    </div>
                    {/* NLP description */}
                    <div className="flex-1 min-w-0">
                      {isAssert && (
                        <span className="inline-block text-[9px] font-semibold uppercase tracking-wider text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded mb-0.5 mr-1">
                          assert
                        </span>
                      )}
                      <span className={`text-xs leading-relaxed ${isAssert ? 'text-green-200' : 'text-gray-200'}`}>
                        {entry.description}
                      </span>
                      {/* Selector on hover */}
                      {entry.selector && (
                        <div className="text-[10px] text-gray-600 font-mono truncate mt-0.5 hidden group-hover:block">
                          {typeof entry.selector === 'string' ? entry.selector : (entry.selector as any).primary || ''}
                        </div>
                      )}
                    </div>
                    {/* Delete button — visible on hover */}
                    {(phase === 'recording' || phase === 'stopped') && (
                      <button
                        onClick={() => handleDeleteStep(entry.id)}
                        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/15 text-gray-600 hover:text-red-400 transition-all"
                        title="Remove this step"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                );
              }

              if (entry.kind === 'system') {
                return (
                  <div key={entry.id} className="flex items-start gap-2 px-3 py-2">
                    <Sparkles size={12} className="text-brand-400 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-gray-400">{entry.text}</span>
                  </div>
                );
              }

              if (entry.kind === 'text') {
                return (
                  <div key={entry.id} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <Bot size={14} className="text-brand-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0 text-sm text-gray-300">
                        <AIMarkdown text={entry.text} />
                      </div>
                    </div>
                  </div>
                );
              }

              if (entry.kind === 'tool') {
                const phaseIcon = entry.phase === 'start'
                  ? <Loader2 size={11} className="animate-spin text-blue-400" />
                  : entry.phase === 'complete'
                    ? <CheckCircle2 size={11} className="text-emerald-400" />
                    : entry.phase === 'error'
                      ? <XCircle size={11} className="text-red-400" />
                      : <Shield size={11} className="text-amber-400" />;
                return (
                  <div key={entry.id} className="flex items-center gap-2 px-3 py-1 ml-4">
                    {phaseIcon}
                    <Wrench size={10} className="text-gray-600" />
                    <span className="text-[11px] font-mono text-gray-500">{entry.toolName}</span>
                    {entry.args && (
                      <span className="text-[10px] text-gray-600 truncate max-w-[300px]">{entry.args}</span>
                    )}
                  </div>
                );
              }

              if (entry.kind === 'file-diff') {
                return (
                  <div key={entry.id} className="px-3 py-1">
                    <DiffViewer diffs={[{
                      filePath: entry.filePath,
                      diffType: entry.diffType,
                      diff: entry.diff,
                      linesAdded: entry.linesAdded,
                      linesRemoved: entry.linesRemoved,
                      timestamp: Date.now(),
                    }]} />
                  </div>
                );
              }

              if (entry.kind === 'playback-action') {
                const statusIcon = entry.status === 'running'
                  ? <Loader2 size={11} className="animate-spin text-cyan-400" />
                  : entry.status === 'done'
                    ? <CheckCircle2 size={11} className="text-emerald-400" />
                    : entry.status === 'error'
                      ? <XCircle size={11} className="text-red-400" />
                      : <Clock size={11} className="text-gray-500" />;
                return (
                  <div key={entry.id} className="flex items-center gap-2 px-3 py-1 ml-2">
                    {statusIcon}
                    <div className="w-5 h-5 rounded-md bg-cyan-500/10 flex items-center justify-center flex-shrink-0 border border-cyan-500/20">
                      <ActionIcon type={entry.actionType} />
                    </div>
                    <span className="text-xs text-gray-400">{entry.description}</span>
                    {entry.status === 'error' && (
                      <span className="text-[10px] text-red-400 ml-auto">failed</span>
                    )}
                  </div>
                );
              }

              if (entry.kind === 'error') {
                return (
                  <div key={entry.id} className="flex items-start gap-2 px-3 py-2">
                    <AlertCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-red-400">{entry.text}</span>
                  </div>
                );
              }

              if (entry.kind === 'loading') {
                return (
                  <div key={entry.id} className="flex items-center gap-2 px-3 py-2">
                    <Loader2 size={12} className="animate-spin text-gray-500" />
                    <span className="text-xs text-gray-500">Processing...</span>
                  </div>
                );
              }

              return null;
            })}

            {/* Permission prompt — always at the bottom (floats below timeline) */}
            {pendingPermission && (
              <div className="px-3 py-2">
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield size={14} className="text-amber-400" />
                    <span className="text-xs font-semibold text-amber-300">Permission Required</span>
                  </div>
                  <div className="text-xs text-gray-400 mb-1">
                    <span className="font-mono text-amber-300">{pendingPermission.toolName}</span>
                  </div>
                  {pendingPermission.args && (
                    <div className="text-[10px] text-gray-500 font-mono mb-3 truncate">{pendingPermission.args}</div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePermission(true)}
                      className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                    >
                      Allow
                    </button>
                    <button
                      onClick={() => handlePermission(false)}
                      className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Bar: Generate controls (when stopped) ────────────── */}
      {phase === 'stopped' && (
        <div className="flex-shrink-0 px-4 py-3 border-t border-white/5 bg-surface-1 space-y-3">
          {/* Test name + format */}
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="text"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="Test name (e.g. login-flow-test)"
                className="w-full px-3 py-2 rounded-lg bg-surface-2 border border-white/5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/40"
              />
            </div>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="px-3 py-2 rounded-lg bg-surface-2 border border-white/5 text-xs text-gray-300 focus:outline-none focus:border-brand-500/40 appearance-none cursor-pointer"
            >
              <option value="">Auto-detect</option>
              <option value="playwright">Playwright</option>
              <option value="cypress">Cypress</option>
              <option value="selenium">Selenium</option>
              <option value="puppeteer">Puppeteer</option>
            </select>
          </div>

          {/* Playback + Generate buttons */}
          <div className="flex gap-2">
            {/* Playback button with speed control */}
            <div className="flex items-center gap-1">
              <button
                onClick={handlePlayback}
                disabled={playbackLoading || actionCount === 0}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/25 hover:bg-cyan-500/25 transition-colors disabled:opacity-50"
                title="Replay recorded actions in the browser to verify them"
              >
                {playbackLoading ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} className="fill-cyan-400 text-cyan-400" />
                )}
                Playback
              </button>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="px-1.5 py-2.5 rounded-lg bg-surface-2 border border-white/5 text-[10px] text-gray-400 focus:outline-none appearance-none cursor-pointer w-[52px] text-center"
                title="Playback speed"
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
              </select>
            </div>

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={genLoading || actionCount === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold bg-brand-500/20 text-brand-300 border border-brand-500/30 hover:bg-brand-500/30 transition-colors disabled:opacity-50"
            >
              {genLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              Generate Test Code
            </button>
          </div>
        </div>
      )}

      {/* Pause/Resume AI during code generation */}
      {phase === 'generating' && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-white/5 bg-surface-1">
          <div className="flex gap-2">
            {!aiPaused && (
              <button
                onClick={() => send({ type: 'screencast-pause' })}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white bg-orange-600 border border-orange-400/40 hover:bg-orange-500 transition-colors shadow-sm"
              >
                <Pause size={10} /> Pause AI
              </button>
            )}
            {aiPaused && (
              <button
                onClick={() => send({ type: 'screencast-resume' })}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white bg-emerald-600 border border-emerald-400/40 hover:bg-emerald-500 transition-colors shadow-sm animate-pulse"
              >
                <Play size={10} /> Resume AI
              </button>
            )}
          </div>
        </div>
      )}

      {/* Playback progress bar */}
      {phase === 'playback' && playbackTotal > 0 && (
        <div className="flex-shrink-0 px-4 py-2 border-t border-white/5 bg-surface-1">
          <div className="flex items-center gap-3">
            <Loader2 size={12} className="animate-spin text-cyan-400" />
            <div className="flex-1">
              <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-500 rounded-full transition-all duration-300"
                  style={{ width: `${(playbackIndex / playbackTotal) * 100}%` }}
                />
              </div>
            </div>
            <span className="text-[10px] text-gray-500 font-mono">{playbackIndex}/{playbackTotal}</span>
          </div>
        </div>
      )}
    </div>
    </LiveBrowserWrapper>
  );
}
