import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { aiCodeReview, aiApplyReviewFixes } from '../../api/client';
import {
  ClipboardCheck, ChevronDown, ChevronRight, Globe, FolderSearch,
  CheckCircle2, XCircle, RotateCcw, AlertTriangle, Shield, Zap,
  Code2, Bug, Layers, Gauge, Eye, Wrench, Rocket, Play, Pause,
} from 'lucide-react';
import type { WSMessage } from '../../api/types';
import {
  ScopedStreamPanel,
  PermissionPrompt,
  parseAttemptInfo,
  type ScopedStreamState,
  type ToolEvent,
} from '../results/FailureAnalysis';
import { DiffViewer, type FileDiff } from './NewTestPanel';

// ── Review Focus Options ─────────────────────────────────────────────────────

interface ReviewFocus {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const REVIEW_FOCUSES: ReviewFocus[] = [
  {
    id: 'flakiness',
    label: 'Flakiness Risks',
    description: 'Hardcoded waits, race conditions, non-deterministic selectors',
    icon: <AlertTriangle size={14} />,
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  {
    id: 'best-practices',
    label: 'Best Practices',
    description: 'Page Object pattern, DRY, assertions, test isolation',
    icon: <CheckCircle2 size={14} />,
    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  },
  {
    id: 'selectors',
    label: 'Selector Quality',
    description: 'Fragile CSS/XPath, missing data-testid, over-specific locators',
    icon: <Code2 size={14} />,
    color: 'text-sky-400 bg-sky-500/10 border-sky-500/20',
  },
  {
    id: 'performance',
    label: 'Performance',
    description: 'Unnecessary browser launches, redundant loads, slow locators',
    icon: <Zap size={14} />,
    color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  },
  {
    id: 'maintainability',
    label: 'Maintainability',
    description: 'Duplication, magic strings, poor naming, missing abstractions',
    icon: <Layers size={14} />,
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  },
  {
    id: 'error-handling',
    label: 'Error Handling',
    description: 'Missing try-catch, uncaught promises, poor error messages',
    icon: <Shield size={14} />,
    color: 'text-red-400 bg-red-500/10 border-red-500/20',
  },
  {
    id: 'test-structure',
    label: 'Test Structure',
    description: 'Setup/teardown, test interdependency, improper scoping',
    icon: <Gauge size={14} />,
    color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
  },
];

// ── Review Scope Options ─────────────────────────────────────────────────────

type ReviewScope = 'files' | 'framework';
type ReviewDepth = 'quick' | 'deep';

// ── Parsed review issue ──────────────────────────────────────────────────────

interface ParsedIssue {
  id: number;
  severity: 'critical' | 'warning' | 'suggestion';
  title: string;
  content: string; // full markdown content of this issue section
}

/**
 * Parse the review markdown content to extract individual issues.
 * Looks for patterns like:
 *   #### 1. Issue title
 *   #### 2. Issue title
 * under severity headings (🔴 Critical, 🟡 Warning, 🟢 Suggestion)
 */
function parseReviewIssues(content: string): ParsedIssue[] {
  const issues: ParsedIssue[] = [];
  if (!content) return issues;

  let currentSeverity: 'critical' | 'warning' | 'suggestion' = 'suggestion';
  let issueId = 0;

  // Split into lines and track sections
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();

    // Detect severity section headers
    if (/^###\s.*(?:🔴|Critical\s+Issue)/i.test(line)) {
      currentSeverity = 'critical';
      i++;
      continue;
    }
    if (/^###\s.*(?:🟡|Warning)/i.test(line)) {
      currentSeverity = 'warning';
      i++;
      continue;
    }
    if (/^###\s.*(?:🟢|💡|Suggestion)/i.test(line)) {
      currentSeverity = 'suggestion';
      i++;
      continue;
    }
    // Stop parsing issues if we hit Metrics or Recommendations section
    if (/^###\s*(?:Metrics|Recommendations|Code Review Summary)/i.test(line)) {
      i++;
      continue;
    }

    // Detect individual issue: #### N. Title
    const issueMatch = line.match(/^####\s+(\d+)\.\s+(.+)/);
    if (issueMatch) {
      const title = issueMatch[2]!;
      const issueLines: string[] = [line];
      i++;

      // Collect all lines until the next #### or ### heading or ---
      while (i < lines.length) {
        const nextLine = lines[i]!.trim();
        if (/^#{2,4}\s/.test(nextLine) || /^[-*_]{3,}$/.test(nextLine)) break;
        issueLines.push(lines[i]!);
        i++;
      }

      issues.push({
        id: ++issueId,
        severity: currentSeverity,
        title,
        content: issueLines.join('\n').trim(),
      });
      continue;
    }

    i++;
  }

  return issues;
}

function getSeverityIcon(severity: 'critical' | 'warning' | 'suggestion') {
  if (severity === 'critical') return <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />;
  if (severity === 'warning') return <span className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />;
  return <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0" />;
}

function getSeverityLabel(severity: 'critical' | 'warning' | 'suggestion') {
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Warning';
  return 'Suggestion';
}

function getSeverityColor(severity: 'critical' | 'warning' | 'suggestion') {
  if (severity === 'critical') return 'text-red-400 border-red-500/20 bg-red-500/5';
  if (severity === 'warning') return 'text-amber-400 border-amber-500/20 bg-amber-500/5';
  return 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5';
}

// ── CodeReviewPanel Component ────────────────────────────────────────────────

export function CodeReviewPanel() {
  const { subscribe, send } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    send: (msg: object) => void;
  }>();

  // Form state
  const [scope, setScope] = useState<ReviewScope>('files');
  const [filePaths, setFilePaths] = useState('');
  const [selectedFocuses, setSelectedFocuses] = useState<string[]>([]);
  const [context, setContext] = useState('');
  const [depth, setDepth] = useState<ReviewDepth>('deep');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Review streaming state
  const [streamState, setStreamState] = useState<ScopedStreamState>({
    requestId: null,
    content: '',
    status: 'idle',
    toolEvents: [],
    pendingPermission: null,
  });

  // File diffs from review (unlikely but possible)
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);

  // ── Fix Now state ──────────────────────────────────────────────────────────
  const [showFixSelector, setShowFixSelector] = useState(false);
  const [selectedIssueIds, setSelectedIssueIds] = useState<number[]>([]);
  const [applyState, setApplyState] = useState<ScopedStreamState>({
    requestId: null,
    content: '',
    status: 'idle',
    toolEvents: [],
    pendingPermission: null,
  });
  const [applyDiffs, setApplyDiffs] = useState<FileDiff[]>([]);

  // AI pause state
  const [aiPaused, setAiPaused] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const applyPanelRef = useRef<HTMLDivElement>(null);

  // ── WebSocket message handler ──────────────────────────────────────────────

  const handleMessage = useCallback((msg: WSMessage) => {
    // Handle AI pause/resume status (no requestId filter needed)
    if (msg.type === 'ai-orchestrator-paused') { setAiPaused(true); return; }
    if (msg.type === 'ai-orchestrator-resumed') { setAiPaused(false); return; }

    const msgRequestId = msg.requestId as string | undefined;
    if (!msgRequestId) return;

    // Handle file diff messages — route to correct state
    if (msg.type === 'ai-fix-file-diff') {
      const isApplyDiff = msgRequestId.startsWith('reviewfix-');
      const setter = isApplyDiff ? setApplyDiffs : setFileDiffs;
      setter(prev => {
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

    // Route messages to review or apply state based on requestId prefix
    const isApplyMsg = msgRequestId.startsWith('reviewfix-');
    const setState = isApplyMsg ? setApplyState : setStreamState;

    setState(prev => {
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
        setAiPaused(false);
        return { ...prev, status: 'done' as const, statusMessage: undefined, pendingPermission: null };
      }

      if (msg.type === 'ai-fix-error') {
        setAiPaused(false);
        return { ...prev, status: 'error' as const, error: msg.message as string, pendingPermission: null };
      }

      return prev;
    });
  }, []);

  useEffect(() => subscribe(handleMessage), [subscribe, handleMessage]);

  // Auto-scroll
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = panelRef.current.scrollHeight;
  }, [streamState.content, streamState.toolEvents]);

  useEffect(() => {
    if (applyPanelRef.current) applyPanelRef.current.scrollTop = applyPanelRef.current.scrollHeight;
  }, [applyState.content, applyState.toolEvents]);

  // ── Focus toggle ──────────────────────────────────────────────────────────

  const toggleFocus = (id: string) => {
    setSelectedFocuses(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id],
    );
  };

  const selectAllFocuses = () => {
    if (selectedFocuses.length === REVIEW_FOCUSES.length) {
      setSelectedFocuses([]);
    } else {
      setSelectedFocuses(REVIEW_FOCUSES.map(f => f.id));
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (scope === 'files' && !filePaths.trim()) return;

    const requestId = `review-${Date.now()}`;
    setStreamState({
      requestId,
      content: '',
      status: 'streaming',
      toolEvents: [],
      pendingPermission: null,
    });
    setFileDiffs([]);
    // Reset fix state when starting a new review
    setShowFixSelector(false);
    setSelectedIssueIds([]);
    setApplyState({ requestId: null, content: '', status: 'idle', toolEvents: [], pendingPermission: null });
    setApplyDiffs([]);

    try {
      const paths = scope === 'framework'
        ? ['__FULL_FRAMEWORK__']
        : filePaths.split('\n').map(p => p.trim()).filter(Boolean);

      await aiCodeReview({
        requestId,
        filePaths: paths,
        focus: selectedFocuses.length > 0 ? selectedFocuses : undefined,
        context: context.trim() || undefined,
        depth,
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
    // Clear from both states
    setStreamState(prev =>
      prev.pendingPermission?.permissionId === permissionId
        ? { ...prev, pendingPermission: null }
        : prev,
    );
    setApplyState(prev =>
      prev.pendingPermission?.permissionId === permissionId
        ? { ...prev, pendingPermission: null }
        : prev,
    );
  };

  const handleReset = () => {
    setScope('files');
    setFilePaths('');
    setSelectedFocuses([]);
    setContext('');
    setDepth('deep');
    setShowAdvanced(false);
    setStreamState({ requestId: null, content: '', status: 'idle', toolEvents: [], pendingPermission: null });
    setFileDiffs([]);
    setShowFixSelector(false);
    setSelectedIssueIds([]);
    setApplyState({ requestId: null, content: '', status: 'idle', toolEvents: [], pendingPermission: null });
    setApplyDiffs([]);
  };

  const handleNewReview = () => {
    setStreamState({ requestId: null, content: '', status: 'idle', toolEvents: [], pendingPermission: null });
    setFileDiffs([]);
    setShowFixSelector(false);
    setSelectedIssueIds([]);
    setApplyState({ requestId: null, content: '', status: 'idle', toolEvents: [], pendingPermission: null });
    setApplyDiffs([]);
  };

  // ── Fix Now handlers ──────────────────────────────────────────────────────

  const handleFixNowClick = () => {
    // Pre-select all critical and warning issues
    const issues = parseReviewIssues(streamState.content);
    const preSelected = issues
      .filter(i => i.severity === 'critical' || i.severity === 'warning')
      .map(i => i.id);
    setSelectedIssueIds(preSelected);
    setShowFixSelector(true);
  };

  const toggleIssueSelection = (id: number) => {
    setSelectedIssueIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const selectAllIssues = (issues: ParsedIssue[]) => {
    if (selectedIssueIds.length === issues.length) {
      setSelectedIssueIds([]);
    } else {
      setSelectedIssueIds(issues.map(i => i.id));
    }
  };

  const handleConfirmFix = async () => {
    const allIssues = parseReviewIssues(streamState.content);
    const selected = allIssues.filter(i => selectedIssueIds.includes(i.id));
    if (selected.length === 0) return;

    setShowFixSelector(false);

    const requestId = `reviewfix-${Date.now()}`;
    setApplyState({
      requestId,
      content: '',
      status: 'streaming',
      toolEvents: [],
      pendingPermission: null,
    });
    setApplyDiffs([]);

    try {
      await aiApplyReviewFixes({
        requestId,
        reviewContent: streamState.content,
        selectedIssues: selected.map(i => ({
          severity: i.severity,
          title: i.title,
          content: i.content,
        })),
      });
    } catch (err) {
      setApplyState(prev => ({ ...prev, status: 'error', error: String(err) }));
    }
  };

  const handleRetryFix = () => {
    setApplyState({ requestId: null, content: '', status: 'idle', toolEvents: [], pendingPermission: null });
    setApplyDiffs([]);
    setShowFixSelector(true);
  };

  const isStreaming = streamState.status === 'streaming';
  const isDone = streamState.status === 'done';
  const isError = streamState.status === 'error';
  const isIdle = streamState.status === 'idle';

  const isApplyStreaming = applyState.status === 'streaming';
  const isApplyDone = applyState.status === 'done';
  const isApplyError = applyState.status === 'error';
  const isApplyActive = applyState.requestId !== null;

  const attemptInfo = parseAttemptInfo(applyState.content);

  // Parse review score from content
  const getScore = (): string | null => {
    if (!isDone || !streamState.content) return null;
    const scoreMatch = streamState.content.match(/\*\*(?:Score|Rating|Overall)(?:\s*Score)?:\*\*\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
    if (scoreMatch) return scoreMatch[1]!;
    return null;
  };

  // Count issues by severity
  const getIssueCounts = (): { critical: number; warning: number; suggestion: number } | null => {
    if (!isDone || !streamState.content) return null;
    const content = streamState.content;
    const critical = (content.match(/🔴|Critical|CRITICAL/g) || []).length;
    const warning = (content.match(/🟡|Warning|WARNING/g) || []).length;
    const suggestion = (content.match(/🟢|💡|Suggestion|SUGGESTION|Info|INFO/g) || []).length;
    if (critical + warning + suggestion === 0) return null;
    return { critical: Math.max(0, critical - 1), warning: Math.max(0, warning - 1), suggestion: Math.max(0, suggestion - 1) };
  };

  // Detect apply fix verdict
  const getApplyVerdict = (): 'pass' | 'fail' | null => {
    if (!isApplyDone || !applyState.content) return null;
    const finalIdx = applyState.content.search(/###\s*Final\s*Result/i);
    if (finalIdx >= 0) {
      const finalSection = applyState.content.slice(finalIdx);
      if (/\*\*Status:\*\*\s*(?:PASS|SUCCESS|COMPLETE)/i.test(finalSection)) return 'pass';
      if (/\*\*Status:\*\*\s*(?:FAIL|PARTIAL)/i.test(finalSection)) return 'fail';
      if (/pass(ed)?|success|complete/i.test(finalSection) && !/fail/i.test(finalSection)) return 'pass';
      if (/fail/i.test(finalSection)) return 'fail';
    }
    // Check if we have diffs (means something was changed)
    if (applyDiffs.length > 0) return 'pass';
    return null;
  };

  const score = getScore();
  const issueCounts = getIssueCounts();
  const parsedIssues = isDone ? parseReviewIssues(streamState.content) : [];
  const applyVerdict = getApplyVerdict();

  return (
    <div className="h-full overflow-y-auto">
      {/* Form section — shown when idle */}
      {isIdle && (
        <div className="p-6 space-y-5 animate-fade-in max-w-5xl mx-auto w-full">
          {/* Review scope toggle */}
          <div>
            <label className="text-sm text-gray-400 font-medium block mb-2.5">
              Review scope
            </label>
            <div className="flex gap-2.5">
              <button
                onClick={() => setScope('files')}
                className={`flex items-center gap-2.5 px-5 py-3 rounded-lg border text-[15px] transition-all flex-1 ${
                  scope === 'files'
                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                    : 'bg-surface-2 text-gray-500 border-white/5 hover:text-gray-400'
                }`}
              >
                <Eye size={16} />
                <div className="text-left">
                  <span className="font-medium block">Specific Files</span>
                  <span className="text-xs opacity-70">Review selected files or directories</span>
                </div>
              </button>
              <button
                onClick={() => setScope('framework')}
                className={`flex items-center gap-2.5 px-5 py-3 rounded-lg border text-[15px] transition-all flex-1 ${
                  scope === 'framework'
                    ? 'bg-orange-500/10 text-orange-300 border-orange-500/20'
                    : 'bg-surface-2 text-gray-500 border-white/5 hover:text-gray-400'
                }`}
              >
                <Layers size={16} />
                <div className="text-left">
                  <span className="font-medium block">Complete Framework</span>
                  <span className="text-xs opacity-70">AI discovers & reviews entire project</span>
                </div>
              </button>
            </div>
          </div>

          {/* File paths input */}
          <div>
            <label className={`text-sm block mb-1.5 font-medium ${scope === 'framework' ? 'text-gray-600' : 'text-gray-400'}`}>
              Files / directories to review
            </label>
            <textarea
              value={scope === 'framework' ? '' : filePaths}
              onChange={(e) => setFilePaths(e.target.value)}
              disabled={scope === 'framework'}
              placeholder={scope === 'framework'
                ? 'AI will automatically discover and review all test files, page objects, step definitions, utilities, and configuration across your entire project.'
                : `Enter file paths or directories (one per line):\n\ne.g., tests/login.spec.ts\ne.g., src/pages/\ne.g., features/checkout.feature\ne.g., **/*.spec.ts (glob pattern)`}
              rows={scope === 'framework' ? 2 : 4}
              className={`w-full border rounded-lg px-4 py-3 text-[15px] outline-none resize-none font-mono leading-relaxed ${
                scope === 'framework'
                  ? 'bg-surface-1 border-white/5 text-gray-600 placeholder-gray-600 cursor-not-allowed'
                  : 'bg-surface-2 border-white/10 text-gray-200 placeholder-gray-600 focus:border-brand-500/50'
              }`}
            />
            {scope !== 'framework' && (
              <p className="text-xs text-gray-600 mt-1">
                Supports file paths, directories, or glob patterns. AI will scan and discover related files automatically.
              </p>
            )}
          </div>

          {/* Review focus selection */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label className="text-sm text-gray-400 font-medium">
                Review focus areas
              </label>
              <button
                onClick={selectAllFocuses}
                className="text-xs text-gray-500 hover:text-gray-400 transition-colors"
              >
                {selectedFocuses.length === REVIEW_FOCUSES.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {REVIEW_FOCUSES.map(focus => {
                const isSelected = selectedFocuses.includes(focus.id);
                return (
                  <button
                    key={focus.id}
                    onClick={() => toggleFocus(focus.id)}
                    className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-left transition-all text-sm ${
                      isSelected
                        ? focus.color + ' border-current/30'
                        : 'text-gray-500 bg-surface-2 border-white/5 hover:bg-surface-3 hover:text-gray-400'
                    }`}
                  >
                    {focus.icon}
                    <div className="min-w-0">
                      <span className="font-medium block truncate">{focus.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-600 mt-1.5">
              Leave unselected for a comprehensive review covering all areas.
            </p>
          </div>

          {/* Depth toggle */}
          <div>
            <label className="text-sm text-gray-400 font-medium block mb-2.5">
              Review depth
            </label>
            <div className="flex gap-2.5">
              <button
                onClick={() => setDepth('quick')}
                className={`flex items-center gap-2.5 px-5 py-3 rounded-lg border text-[15px] transition-all ${
                  depth === 'quick'
                    ? 'bg-sky-500/10 text-sky-300 border-sky-500/20'
                    : 'bg-surface-2 text-gray-500 border-white/5 hover:text-gray-400'
                }`}
              >
                <Eye size={16} />
                <div className="text-left">
                  <span className="font-medium block">Quick Scan</span>
                  <span className="text-xs opacity-70">Read files, static analysis</span>
                </div>
              </button>
              <button
                onClick={() => setDepth('deep')}
                className={`flex items-center gap-2.5 px-5 py-3 rounded-lg border text-[15px] transition-all ${
                  depth === 'deep'
                    ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                    : 'bg-surface-2 text-gray-500 border-white/5 hover:text-gray-400'
                }`}
              >
                <FolderSearch size={16} />
                <div className="text-left">
                  <span className="font-medium block">Deep Review</span>
                  <span className="text-xs opacity-70">Scans project context, cross-references</span>
                </div>
              </button>
            </div>
          </div>

          {/* Advanced options */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-gray-500 hover:text-gray-400 flex items-center gap-1.5 transition-colors"
            >
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Additional context
            </button>
            {showAdvanced && (
              <div className="mt-3 pl-4 border-l border-white/5">
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder={`Optional instructions, e.g.:\n"Focus on the checkout flow tests"\n"Check for accessibility compliance"\n"Review against our team's style guide"`}
                  rows={3}
                  className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 resize-none leading-relaxed"
                />
              </div>
            )}
          </div>

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={scope === 'files' && !filePaths.trim()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-white/10"
          >
            <ClipboardCheck size={16} />
            {scope === 'framework' ? 'Review Entire Framework' : 'Start Code Review'}
          </button>

          <p className="text-sm text-gray-600 leading-relaxed">
            AI will read your test files, analyze project patterns, and provide actionable feedback with severity ratings, concrete code examples, and suggested fixes.
          </p>
        </div>
      )}

      {/* Streaming / Done / Error section */}
      {!isIdle && streamState.requestId && (
        <div className="flex-1 overflow-y-auto p-6 space-y-3 animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardCheck size={14} className="text-sky-400" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Code Review
              </span>

              {isStreaming && (
                <span className="flex items-center gap-1 text-xs text-sky-400">
                  <div className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  {streamState.statusMessage || (streamState.toolEvents.length > 0
                    ? `Analyzing... (${streamState.toolEvents.filter(e => e.phase === 'complete' || e.phase === 'error').length}/${streamState.toolEvents.filter(e => e.phase === 'start').length} tools)`
                    : 'Reading files...')}
                </span>
              )}
              {isDone && (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <CheckCircle2 size={12} /> Review Complete
                </span>
              )}
              {isError && <span className="text-xs text-red-400">Error</span>}
            </div>

            <div className="flex items-center gap-1">
              {isStreaming && !aiPaused && (
                <button
                  onClick={() => send({ type: 'screencast-pause' })}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white bg-orange-600 border border-orange-400/40 hover:bg-orange-500 transition-colors shadow-sm"
                >
                  <Pause size={10} /> Pause AI
                </button>
              )}
              {isStreaming && aiPaused && (
                <button
                  onClick={() => send({ type: 'screencast-resume' })}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white bg-emerald-600 border border-emerald-400/40 hover:bg-emerald-500 transition-colors shadow-sm animate-pulse"
                >
                  <Play size={10} /> Resume AI
                </button>
              )}
              {(isDone || isError) && (
                <>
                  <button
                    onClick={handleNewReview}
                    className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-gray-400 transition-colors"
                  >
                    <ClipboardCheck size={12} /> New
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

          {/* Score card when done */}
          {isDone && (score || issueCounts) && (
            <div className="rounded-lg border border-white/5 bg-surface-1 p-4 flex items-center gap-4">
              {score && (
                <div className="flex-shrink-0 text-center">
                  <div className={`text-2xl font-bold ${
                    parseFloat(score) >= 8 ? 'text-emerald-400'
                      : parseFloat(score) >= 6 ? 'text-amber-400'
                        : 'text-red-400'
                  }`}>
                    {score}<span className="text-sm text-gray-500">/10</span>
                  </div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Score</div>
                </div>
              )}
              {score && issueCounts && <div className="w-px h-10 bg-white/5" />}
              {issueCounts && (
                <div className="flex gap-3 text-xs">
                  {issueCounts.critical > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-red-400 font-medium">{issueCounts.critical}</span>
                      <span className="text-gray-500">Critical</span>
                    </div>
                  )}
                  {issueCounts.warning > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500" />
                      <span className="text-amber-400 font-medium">{issueCounts.warning}</span>
                      <span className="text-gray-500">Warning</span>
                    </div>
                  )}
                  {issueCounts.suggestion > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-emerald-400 font-medium">{issueCounts.suggestion}</span>
                      <span className="text-gray-500">Suggestion</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Permission prompt (review phase) */}
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
            label="Code Review"
            icon={<ClipboardCheck size={14} />}
            emptyMessage="Reading test files and analyzing patterns..."
          />

          {/* File Changes Diff Viewer (from review phase — rare) */}
          {fileDiffs.length > 0 && <DiffViewer diffs={fileDiffs} />}

          {/* ── Fix Now Button ── */}
          {isDone && parsedIssues.length > 0 && !showFixSelector && !isApplyActive && (
            <div className="pt-3 border-t border-white/5">
              <button
                onClick={handleFixNowClick}
                className="flex items-center gap-2 px-5 py-3 rounded-lg bg-brand-500/15 text-brand-300 text-sm font-semibold hover:bg-brand-500/25 transition-all border border-brand-500/20"
              >
                <Rocket size={16} />
                Fix Now — Implement Review Feedback
              </button>
              <p className="text-xs text-gray-600 mt-1.5">
                Select which review findings to fix. AI will implement the changes, run tests, and self-heal up to 3 attempts.
              </p>
            </div>
          )}

          {/* ── Issue Selection Panel ── */}
          {showFixSelector && (
            <div className="pt-3 border-t border-white/5 animate-fade-in">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wrench size={14} className="text-emerald-400" />
                    <span className="text-sm font-semibold text-emerald-300">Select Issues to Fix</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {selectedIssueIds.length}/{parsedIssues.length} selected
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => selectAllIssues(parsedIssues)}
                      className="text-[10px] text-gray-500 hover:text-gray-400 transition-colors"
                    >
                      {selectedIssueIds.length === parsedIssues.length ? 'Deselect all' : 'Select all'}
                    </button>
                    <button
                      onClick={() => setShowFixSelector(false)}
                      className="text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                </div>

                {/* Issue list */}
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {parsedIssues.map(issue => {
                    const isSelected = selectedIssueIds.includes(issue.id);
                    return (
                      <button
                        key={issue.id}
                        onClick={() => toggleIssueSelection(issue.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all text-xs ${
                          isSelected
                            ? getSeverityColor(issue.severity) + ' border-current/30'
                            : 'text-gray-400 bg-black/20 border-white/5 hover:bg-white/[0.02]'
                        }`}
                      >
                        {/* Checkbox */}
                        <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-emerald-500/30 border-emerald-500/50'
                            : 'border-white/10 bg-white/5'
                        }`}>
                          {isSelected && <CheckCircle2 size={10} className="text-emerald-400" />}
                        </div>

                        {getSeverityIcon(issue.severity)}

                        <div className="flex-1 min-w-0">
                          <span className="block truncate">{issue.title}</span>
                        </div>

                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full border flex-shrink-0 ${getSeverityColor(issue.severity)}`}>
                          {getSeverityLabel(issue.severity)}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Confirm button */}
                <button
                  onClick={handleConfirmFix}
                  disabled={selectedIssueIds.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-white/10"
                >
                  <Rocket size={14} />
                  Implement {selectedIssueIds.length} Fix{selectedIssueIds.length !== 1 ? 'es' : ''}
                </button>
              </div>
            </div>
          )}

          {/* ── Apply Fix Panel ── */}
          {isApplyActive && (
            <div className="pt-3 border-t border-white/5 animate-fade-in">
              {/* Apply header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Rocket size={14} className="text-emerald-400" />
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Implementing Fixes</span>
                  {isApplyStreaming && !attemptInfo && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {applyState.statusMessage || 'Applying changes...'}
                    </span>
                  )}
                  {isApplyStreaming && attemptInfo && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {`Attempt ${attemptInfo.current} of ${attemptInfo.total}${attemptInfo.status === 'fail' ? ' — retrying...' : attemptInfo.status === 'pass' ? ' — passed!' : ' — running...'}`}
                    </span>
                  )}
                  {isApplyDone && applyVerdict === 'pass' && (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <CheckCircle2 size={12} /> Fixes Applied
                    </span>
                  )}
                  {isApplyDone && applyVerdict === 'fail' && (
                    <span className="flex items-center gap-1 text-xs text-red-400">
                      <XCircle size={12} /> Partial — Some Issues Remain
                    </span>
                  )}
                  {isApplyDone && applyVerdict === null && (
                    <span className="text-xs text-gray-400">Complete</span>
                  )}
                  {isApplyError && <span className="text-xs text-red-400">Error</span>}
                </div>
                <div className="flex items-center gap-1">
                  {isApplyStreaming && !aiPaused && (
                    <button
                      onClick={() => send({ type: 'screencast-pause' })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white bg-orange-600 border border-orange-400/40 hover:bg-orange-500 transition-colors shadow-sm"
                    >
                      <Pause size={10} /> Pause AI
                    </button>
                  )}
                  {isApplyStreaming && aiPaused && (
                    <button
                      onClick={() => send({ type: 'screencast-resume' })}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold text-white bg-emerald-600 border border-emerald-400/40 hover:bg-emerald-500 transition-colors shadow-sm animate-pulse"
                    >
                      <Play size={10} /> Resume AI
                    </button>
                  )}
                  {(isApplyDone || isApplyError) && (
                    <button onClick={handleRetryFix}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-gray-400 transition-colors">
                      <Play size={10} /> Fix More
                    </button>
                  )}
                </div>
              </div>

              {/* Self-healing progress bar */}
              {attemptInfo && (
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Fix Progress</span>
                    <span className="text-[10px] text-gray-600">
                      {attemptInfo.status === 'pass'
                        ? '✓ Passed'
                        : attemptInfo.status === 'fail' && isApplyDone
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
                      if (attemptNum === attemptInfo.current && attemptInfo.status === 'fail' && isApplyStreaming) bgColor = 'bg-red-500 animate-pulse';
                      if (attemptNum === attemptInfo.current && attemptInfo.status === 'fail' && isApplyDone) bgColor = 'bg-red-500';
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

              {/* Permission prompt (apply phase) */}
              {applyState.pendingPermission && (
                <PermissionPrompt
                  permission={applyState.pendingPermission}
                  onRespond={handlePermissionResponse}
                />
              )}

              {/* Apply streaming panel */}
              <ScopedStreamPanel
                state={applyState}
                panelRef={applyPanelRef}
                label="Fix Implementation"
                icon={<Rocket size={14} />}
                emptyMessage="Reading files and applying review fixes..."
              />

              {/* File Changes Diff Viewer */}
              {applyDiffs.length > 0 && <DiffViewer diffs={applyDiffs} />}

              {/* Success banner */}
              {isApplyDone && applyVerdict === 'pass' && (
                <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 size={22} className="text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-300">Review Fixes Applied!</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {attemptInfo && attemptInfo.current > 1
                        ? `Fixed in ${attemptInfo.current} attempt${attemptInfo.current !== 1 ? 's' : ''} with self-healing.`
                        : 'All selected fixes were applied successfully.'}
                      {applyDiffs.length > 0 && ` ${applyDiffs.length} file${applyDiffs.length !== 1 ? 's' : ''} changed.`}
                      {' '}Check the file changes above for details.
                    </p>
                  </div>
                </div>
              )}

              {/* Failure banner */}
              {isApplyDone && applyVerdict === 'fail' && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                    <XCircle size={22} className="text-red-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-red-300">Some Fixes Need Manual Review</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      The AI applied changes but some issues remain. Review the output above and click "Fix More" to retry with different selections.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Completion banner (review only, no fix) */}
          {isDone && !isApplyActive && !showFixSelector && (
            <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-500/20 flex items-center justify-center flex-shrink-0">
                <ClipboardCheck size={22} className="text-sky-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-sky-300">Review Complete</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {score ? `Score: ${score}/10. ` : ''}
                  {parsedIssues.length > 0
                    ? `Found ${parsedIssues.length} issue${parsedIssues.length !== 1 ? 's' : ''}. Click "Fix Now" above to auto-implement the fixes.`
                    : 'Review the findings above and address any critical or warning-level issues.'}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
