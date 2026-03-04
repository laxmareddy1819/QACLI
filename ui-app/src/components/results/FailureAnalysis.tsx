import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAnalyzeFailures, useRunDetail } from '../../hooks/useTestResults';
import { aiFixFailure, aiApplyFix } from '../../api/client';
import {
  X, Brain, Bug, Cloud, AlertTriangle, Clock, HelpCircle,
  ChevronDown, ChevronRight, Lightbulb, Search, Wrench, Sparkles,
  Copy, Check, FileText, Terminal, FolderOpen, Eye, Edit3,
  Shield, ShieldCheck, ShieldX, Globe, Play, Rocket, CheckCircle2, XCircle, User,
} from 'lucide-react';
import type { WSMessage } from '../../api/types';
import { DiffViewer, type FileDiff } from '../ai/NewTestPanel';
import { useGitOwnership } from '../../hooks/useGit';
import type { FailureOwnership } from '../../api/client';

interface Props {
  runId: string;
  onClose: () => void;
}

const categoryIcons: Record<string, React.ReactNode> = {
  bug: <Bug size={16} className="text-red-400" />,
  environment: <Cloud size={16} className="text-sky-400" />,
  flaky: <AlertTriangle size={16} className="text-amber-400" />,
  'test-issue': <Wrench size={16} className="text-orange-400" />,
  timeout: <Clock size={16} className="text-purple-400" />,
  unknown: <HelpCircle size={16} className="text-gray-400" />,
};

const categoryLabels: Record<string, string> = {
  bug: 'Application Bug',
  environment: 'Environment Issue',
  flaky: 'Flaky Test',
  'test-issue': 'Test Code Issue',
  timeout: 'Timeout',
  unknown: 'Needs Investigation',
};

const categoryColors: Record<string, string> = {
  bug: 'border-red-500/20 bg-red-500/5',
  environment: 'border-sky-500/20 bg-sky-500/5',
  flaky: 'border-amber-500/20 bg-amber-500/5',
  'test-issue': 'border-orange-500/20 bg-orange-500/5',
  timeout: 'border-purple-500/20 bg-purple-500/5',
  unknown: 'border-gray-500/20 bg-gray-500/5',
};

/**
 * Render text that may contain bullet points on separate lines.
 */
function FormattedText({ text }: { text: string }) {
  const lines = text.split('\n');
  if (lines.length <= 1) {
    return <p className="text-sm text-gray-300 leading-relaxed">{text}</p>;
  }
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith('•')) {
          return (
            <div key={i} className="flex gap-2 text-sm text-gray-300 leading-relaxed">
              <span className="text-gray-500 flex-shrink-0">•</span>
              <span>{trimmed.slice(1).trim()}</span>
            </div>
          );
        }
        return <p key={i} className="text-sm text-gray-300 leading-relaxed">{trimmed}</p>;
      })}
    </div>
  );
}

// ── Shared Types (exported for reuse by NewTestPanel, etc.) ──────────────────

export interface ToolEvent {
  id: string;
  phase: 'start' | 'complete' | 'error' | 'denied';
  toolName: string;
  args: string;
  result?: string;
  error?: string;
  timestamp: number;
}

export interface PermissionRequest {
  permissionId: string;
  toolName: string;
  args: string;
}

export interface ScopedStreamState {
  requestId: string | null;
  content: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  error?: string;
  statusMessage?: string;
  toolEvents: ToolEvent[];
  pendingPermission: PermissionRequest | null;
}

// Alias for clarity
type AIFixState = ScopedStreamState;
type AIApplyState = ScopedStreamState;

// ── Self-healing attempt tracking ────────────────────────────────────────────

export interface AttemptInfo {
  current: number;
  total: number;
  status: 'running' | 'pass' | 'fail';
}

/**
 * Parse the streaming content to extract the current self-healing attempt info.
 * Flexible matching: handles "### Attempt N of M", "## Attempt N of M",
 * "Attempt N of M:", "**Attempt N of M**", etc.
 */
export function parseAttemptInfo(content: string): AttemptInfo | null {
  if (!content) return null;
  // Match many variations: ### Attempt N of M, ## Attempt N of M, **Attempt N of M**, Attempt N of M:, Attempt N/M
  const attempts = [...content.matchAll(/(?:#{1,4}\s*)?(?:\*\*)?Attempt\s+(\d+)\s*(?:of|\/)\s*(\d+)(?:\*\*)?/gi)];
  if (attempts.length === 0) return null;

  const last = attempts[attempts.length - 1]!;
  const current = parseInt(last[1]!, 10);
  const total = parseInt(last[2]!, 10);

  // Check if this attempt has a result yet
  const lastIdx = content.lastIndexOf(last[0]);
  const afterAttempt = content.slice(lastIdx);

  // Check for pass/fail indicators in this attempt's section
  // Priority: explicit "Test Result:" marker, then general pass/fail mentions
  if (/\*\*Test Result:?\*\*\s*:?\s*PASS/i.test(afterAttempt) || /\ball\s+\d+\s+(tests?\s+)?passed/i.test(afterAttempt) || /test(s)?\s+(run\s+)?pass(ed)?/i.test(afterAttempt)) {
    return { current, total, status: 'pass' };
  }
  if (/\*\*Test Result:?\*\*\s*:?\s*FAIL/i.test(afterAttempt) || /test(s)?\s+(still\s+)?fail(ed|ing)?/i.test(afterAttempt) || /\d+\s+fail(ed|ing|ure)/i.test(afterAttempt)) {
    return { current, total, status: 'fail' };
  }

  return { current, total, status: 'running' };
}

// ── Tool icon helper ─────────────────────────────────────────────────────────

export function getToolIcon(toolName: string) {
  if (toolName === 'read_file') return <Eye size={12} className="text-sky-400" />;
  if (toolName === 'write_file' || toolName === 'edit_file' || toolName === 'find_replace') return <Edit3 size={12} className="text-amber-400" />;
  if (toolName === 'run_command' || toolName === 'run_tests') return <Terminal size={12} className="text-emerald-400" />;
  if (toolName === 'create_directory' || toolName === 'list_directory') return <FolderOpen size={12} className="text-purple-400" />;
  if (toolName === 'glob_search' || toolName === 'grep') return <Search size={12} className="text-indigo-400" />;
  if (toolName.startsWith('browser_')) return <Globe size={12} className="text-pink-400" />;
  return <FileText size={12} className="text-gray-400" />;
}

export function getPhaseColor(phase: string) {
  if (phase === 'start') return 'text-sky-400';
  if (phase === 'complete') return 'text-emerald-400';
  if (phase === 'error') return 'text-red-400';
  if (phase === 'denied') return 'text-amber-400';
  return 'text-gray-400';
}

export function getPhaseLabel(phase: string) {
  if (phase === 'start') return 'Running';
  if (phase === 'complete') return 'Done';
  if (phase === 'error') return 'Failed';
  if (phase === 'denied') return 'Denied';
  return phase;
}

// ── Tool Activity Log ────────────────────────────────────────────────────────

export function ToolActivityLog({ events, label }: { events: ToolEvent[]; label?: string }) {
  if (events.length === 0) return null;

  // Merge start+complete into single entries
  const merged: ToolEvent[] = [];
  const startMap = new Map<string, ToolEvent>();

  for (const evt of events) {
    if (evt.phase === 'start') {
      startMap.set(evt.toolName + '-' + evt.id, evt);
      merged.push(evt);
    } else if (evt.phase === 'complete') {
      const key = evt.toolName + '-' + evt.id;
      const existing = startMap.get(key);
      if (existing) {
        const idx = merged.indexOf(existing);
        if (idx >= 0) {
          merged[idx] = { ...existing, phase: 'complete', result: evt.result };
        }
      } else {
        merged.push(evt);
      }
    } else {
      merged.push(evt);
    }
  }

  return (
    <div className="mb-3 space-y-0.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Terminal size={11} className="text-gray-500" />
        <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label || 'Tool Activity'}</span>
      </div>
      <div className="max-h-[240px] overflow-y-auto rounded-lg bg-black/20 border border-white/5">
        {merged.map((evt, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors"
          >
            {getToolIcon(evt.toolName)}
            <span className="text-xs text-gray-300 font-mono truncate flex-1">
              {evt.toolName}
              {evt.args && <span className="text-gray-500 ml-1">{evt.args}</span>}
            </span>
            <span className={`text-[10px] font-medium ${getPhaseColor(evt.phase)}`}>
              {evt.phase === 'start' ? (
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                  {getPhaseLabel(evt.phase)}
                </span>
              ) : getPhaseLabel(evt.phase)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Permission Prompt ────────────────────────────────────────────────────────

export function PermissionPrompt({
  permission,
  onRespond,
}: {
  permission: PermissionRequest;
  onRespond: (permissionId: string, granted: boolean, remember?: boolean) => void;
}) {
  return (
    <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 animate-in fade-in">
      <div className="flex items-center gap-2 mb-2">
        <Shield size={16} className="text-amber-400" />
        <span className="text-sm font-semibold text-amber-300">Permission Required</span>
      </div>
      <div className="mb-3">
        <p className="text-sm text-gray-300">
          AI wants to execute: <span className="font-mono text-amber-300">{permission.toolName}</span>
        </p>
        {permission.args && (
          <p className="text-xs text-gray-500 font-mono mt-1 truncate">{permission.args}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onRespond(permission.permissionId, true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500/20 text-emerald-300 text-sm font-medium hover:bg-emerald-500/30 transition-colors border border-emerald-500/20"
        >
          <ShieldCheck size={14} />
          Allow
        </button>
        <button
          onClick={() => onRespond(permission.permissionId, true, true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500/20 text-sky-300 text-sm font-medium hover:bg-sky-500/30 transition-colors border border-sky-500/20"
        >
          <ShieldCheck size={14} />
          Always Allow
        </button>
        <button
          onClick={() => onRespond(permission.permissionId, false)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/20 text-red-300 text-sm font-medium hover:bg-red-500/30 transition-colors border border-red-500/20"
        >
          <ShieldX size={14} />
          Deny
        </button>
      </div>
    </div>
  );
}

// ── AI Markdown Renderer ─────────────────────────────────────────────────────

export function AIMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let tableLines: string[] = [];
  let key = 0;

  const flushCode = (streaming = false) => {
    if (codeLines.length > 0) {
      const codeContent = codeLines.join('\n');
      elements.push(
        <div key={key++} className="my-2">
          {codeLang && (
            <div className="text-[10px] text-gray-500 bg-black/30 px-3 py-1 rounded-t-lg border border-b-0 border-white/5 font-mono flex items-center gap-2">
              <span>{codeLang}</span>
              {streaming && <span className="text-[9px] text-gray-600 italic">(streaming...)</span>}
            </div>
          )}
          <pre className={`bg-black/30 border border-white/5 ${codeLang ? 'rounded-b-lg' : 'rounded-lg'} p-3 text-xs text-gray-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-[500px] overflow-y-auto`}>
            {codeContent}
          </pre>
        </div>,
      );
      codeLines = [];
      codeLang = '';
    }
  };

  const parseTableRow = (row: string): string[] => {
    // Split "| a | b | c |" → ["a", "b", "c"]
    return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
  };

  const isSeparatorRow = (row: string): boolean => {
    // Matches rows like |---|---|---| or | :---: | --- | ---: |
    return /^\|[\s:]*-{2,}[\s:]*(\|[\s:]*-{2,}[\s:]*)*\|?$/.test(row.trim());
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    // Need at least header + separator (2 rows) for a proper table
    // If only 1 row, still render as a single-row table
    const rows = tableLines.map(parseTableRow);
    let headerCells: string[] | null = null;
    let dataCells: string[][] = [];

    if (tableLines.length >= 2 && isSeparatorRow(tableLines[1]!)) {
      headerCells = rows[0]!;
      dataCells = rows.slice(2);
    } else {
      // No separator row — treat all as data rows
      dataCells = rows;
    }

    elements.push(
      <div key={key++} className="my-2 overflow-x-auto rounded-lg border border-white/5">
        <table className="w-full text-xs text-gray-300">
          {headerCells && (
            <thead>
              <tr className="bg-white/5 border-b border-white/5">
                {headerCells.map((cell, i) => (
                  <th key={i} className="px-3 py-2 text-left font-semibold text-gray-200 whitespace-nowrap">
                    {renderInlineBoldAndCode(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {dataCells.map((row, ri) => (
              <tr key={ri} className={`border-b border-white/5 last:border-0 ${ri % 2 === 0 ? 'bg-black/20' : 'bg-black/10'}`}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-1.5 text-gray-300">
                    {renderInlineBoldAndCode(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableLines = [];
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      flushTable();
      if (inCodeBlock) {
        inCodeBlock = false;
        flushCode();
      } else {
        inCodeBlock = true;
        codeLang = line.trimStart().slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) { codeLines.push(line); continue; }

    const trimmed = line.trim();

    // Table rows: lines starting and optionally ending with |
    if (trimmed.startsWith('|')) {
      tableLines.push(trimmed);
      continue;
    }

    // Not a table line — flush any accumulated table
    flushTable();

    if (!trimmed) { elements.push(<div key={key++} className="h-2" />); continue; }

    // Horizontal rule: --- or *** or ___
    if (/^[-*_]{3,}$/.test(trimmed)) {
      elements.push(<hr key={key++} className="border-white/5 my-3" />);
      continue;
    }

    // #### h4 heading (must check before ### to avoid mis-match)
    if (trimmed.startsWith('#### ')) {
      elements.push(<h5 key={key++} className="text-[13px] font-semibold text-gray-200 mt-2.5 mb-1">{renderInlineBoldAndCode(trimmed.slice(5))}</h5>);
      continue;
    }
    if (trimmed.startsWith('### ')) {
      elements.push(<h4 key={key++} className="text-sm font-semibold text-gray-200 mt-3 mb-1">{renderInlineBoldAndCode(trimmed.slice(4))}</h4>);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(<h3 key={key++} className="text-base font-semibold text-gray-100 mt-4 mb-1">{renderInlineBoldAndCode(trimmed.slice(3))}</h3>);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(<h2 key={key++} className="text-lg font-bold text-gray-100 mt-4 mb-1.5">{renderInlineBoldAndCode(trimmed.slice(2))}</h2>);
      continue;
    }

    // Numbered list items: "1. ...", "2. ..."
    const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numMatch) {
      elements.push(
        <div key={key++} className="flex gap-2 text-sm text-gray-300 leading-relaxed ml-2">
          <span className="text-gray-500 flex-shrink-0 w-4 text-right">{numMatch[1]}.</span>
          <span>{renderInlineBoldAndCode(numMatch[2]!)}</span>
        </div>,
      );
      continue;
    }

    // Bullet list items
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div key={key++} className="flex gap-2 text-sm text-gray-300 leading-relaxed ml-2">
          <span className="text-gray-500 flex-shrink-0">•</span>
          <span>{renderInlineBoldAndCode(trimmed.slice(2))}</span>
        </div>,
      );
      continue;
    }

    // Line starts with bold: **Something:** rest
    if (trimmed.startsWith('**')) {
      elements.push(<p key={key++} className="text-sm text-gray-200 mt-2">{renderInlineBoldAndCode(trimmed)}</p>);
      continue;
    }

    // Default paragraph
    elements.push(<p key={key++} className="text-sm text-gray-300 leading-relaxed">{renderInlineBoldAndCode(trimmed)}</p>);
  }
  // Flush unclosed code block (streaming or LLM cut off mid-block)
  if (inCodeBlock) flushCode(true);
  // Flush any trailing table (e.g., text ends with table rows during streaming)
  flushTable();

  return <div className="space-y-0.5">{elements}</div>;
}

/**
 * Render inline **bold**, `code`, and plain text segments.
 * Handles mixed content like: **File:** `path/to/file.ts` (Line 45)
 */
function renderInlineBoldAndCode(text: string): React.ReactNode {
  // Split on bold (**...**) and code (`...`) segments
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  if (parts.length === 1) return text;
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold text-gray-200">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={i} className="bg-white/5 text-amber-300 px-1 py-0.5 rounded text-xs font-mono">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export function renderInlineCode(text: string): React.ReactNode {
  return renderInlineBoldAndCode(text);
}

// ── Scoped Stream Panel (reused for both AI Fix and Apply Fix) ───────────────

export function ScopedStreamPanel({
  state,
  panelRef,
  label,
  icon,
  emptyMessage,
}: {
  state: ScopedStreamState;
  panelRef?: React.RefObject<HTMLDivElement | null>;
  label: string;
  icon: React.ReactNode;
  emptyMessage: string;
}) {
  // Determine current activity from tool events for a more informative status message
  const activeToolStatus = (() => {
    if (state.status !== 'streaming' || state.content) return null;
    const activeTools = state.toolEvents.filter(e => e.phase === 'start');
    if (activeTools.length === 0) return null;
    const last = activeTools[activeTools.length - 1]!;
    const toolLabels: Record<string, string> = {
      read_file: 'Reading file',
      write_file: 'Writing file',
      edit_file: 'Editing file',
      find_replace: 'Editing file',
      run_command: 'Running command',
      run_tests: 'Running tests',
      glob_search: 'Searching files',
      grep: 'Searching code',
      create_directory: 'Creating directory',
      list_directory: 'Listing directory',
      browser_launch: 'Launching browser',
      browser_navigate: 'Navigating',
      browser_click: 'Clicking element',
      browser_type: 'Typing text',
      browser_inspect: 'Inspecting page',
      browser_screenshot: 'Taking screenshot',
      browser_get_text: 'Reading page text',
    };
    return toolLabels[last.toolName] || `Running ${last.toolName}`;
  })();

  return (
    <>
      {/* Tool activity log */}
      {state.toolEvents.length > 0 && (
        <ToolActivityLog events={state.toolEvents} label={label === 'AI Fix' ? 'Analysis Activity' : 'Implementation Activity'} />
      )}

      {/* Content */}
      <div
        ref={panelRef}
        className="bg-surface-1 rounded-lg border border-white/5 p-4 max-h-[600px] overflow-y-auto"
      >
        {state.status === 'error' && (
          <div className="text-sm text-red-400">
            <p>Failed: {state.error}</p>
            <p className="text-xs text-gray-500 mt-1">Make sure an LLM provider is configured (set OPENAI_API_KEY or another provider key).</p>
          </div>
        )}

        {state.content ? (
          <AIMarkdown text={state.content} />
        ) : state.status === 'streaming' ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <div>
              <span>{state.statusMessage || activeToolStatus || emptyMessage}</span>
              {state.toolEvents.length > 0 && !activeToolStatus && (
                <span className="text-gray-600 ml-1">({state.toolEvents.length} tools executed)</span>
              )}
            </div>
          </div>
        ) : null}

        {state.status === 'streaming' && state.content && (
          <span className="inline-block w-2 h-4 bg-purple-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </div>
    </>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function FailureAnalysis({ runId, onClose }: Props) {
  const { subscribe, send } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    send: (msg: object) => void;
  }>();
  const { data: runDetail } = useRunDetail(runId);
  const analyzeMutation = useAnalyzeFailures();
  const { data: ownershipData } = useGitOwnership(runId);
  const ownershipMap = new Map<string, FailureOwnership>(
    (ownershipData?.ownership || []).map((o: FailureOwnership) => [o.testName, o]),
  );
  const [expandedGroup, setExpandedGroup] = useState<number | null>(0);

  // AI Fix state (analysis) — keyed by group index
  const [aiFixes, setAiFixes] = useState<Record<number, AIFixState>>({});
  // AI Apply state (implement + re-run) — keyed by group index
  const [aiApplies, setAiApplies] = useState<Record<number, AIApplyState>>({});
  // File diffs collected during apply fix — keyed by group index
  const [applyDiffs, setApplyDiffs] = useState<Record<number, FileDiff[]>>({});
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const aiPanelRef = useRef<HTMLDivElement>(null);
  const applyPanelRef = useRef<HTMLDivElement>(null);

  const groups = runDetail?.failureAnalysis || [];
  const isAnalyzing = analyzeMutation.isPending;
  const totalAffected = groups.reduce((s: number, g: any) => s + g.count, 0);

  // Helper to update a scoped stream state map (works for both aiFixes and aiApplies)
  const updateScopedState = useCallback(
    <T extends ScopedStreamState>(
      setter: React.Dispatch<React.SetStateAction<Record<number, T>>>,
      requestId: string,
      updater: (existing: T) => Partial<T>,
    ) => {
      setter(prev => {
        const idx = findGroupByRequestId(prev, requestId);
        const existing = prev[idx];
        if (!existing) return prev;
        return { ...prev, [idx]: { ...existing, ...updater(existing) } };
      });
    },
    [],
  );

  // Generic scoped stream handler — works for both fix and apply requestIds
  const handleScopedMessage = useCallback((msg: WSMessage) => {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;

    // Handle file diff messages — track for apply fix actions
    if (msg.type === 'ai-fix-file-diff' && requestId.startsWith('apply-')) {
      setApplyDiffs(prev => {
        // Parse group index from requestId: "apply-<timestamp>-<groupIndex>"
        const parts = requestId.split('-');
        const gIdx = parseInt(parts[parts.length - 1]!, 10);
        if (isNaN(gIdx)) return prev;

        const existing = prev[gIdx] || [];
        const newDiff: FileDiff = {
          filePath: msg.filePath as string,
          diffType: msg.diffType as 'new' | 'modified',
          diff: msg.diff as string,
          linesAdded: msg.linesAdded as number,
          linesRemoved: msg.linesRemoved as number,
          timestamp: Date.now(),
        };
        // Replace if same file already has a diff
        const fileIdx = existing.findIndex(d => d.filePath === newDiff.filePath);
        if (fileIdx >= 0) {
          const updated = [...existing];
          updated[fileIdx] = newDiff;
          return { ...prev, [gIdx]: updated };
        }
        return { ...prev, [gIdx]: [...existing, newDiff] };
      });
      return;
    }

    // Determine which state map to update based on requestId prefix
    const isApply = requestId.startsWith('apply-');
    const setter = isApply
      ? setAiApplies as React.Dispatch<React.SetStateAction<Record<number, ScopedStreamState>>>
      : setAiFixes as React.Dispatch<React.SetStateAction<Record<number, ScopedStreamState>>>;

    if (msg.type === 'ai-fix-stream') {
      updateScopedState(setter, requestId, (ex) => ({
        content: ex.content + (msg.content as string),
        status: 'streaming' as const,
      }));
    }

    if (msg.type === 'ai-fix-status') {
      updateScopedState(setter, requestId, () => ({
        statusMessage: msg.message as string,
      }));
    }

    if (msg.type === 'ai-fix-tool') {
      const phase = msg.phase as string;
      const toolName = msg.toolName as string;
      const args = msg.args as string;

      setter(prev => {
        const idx = findGroupByRequestId(prev, requestId);
        const existing = prev[idx];
        if (!existing) return prev;

        if (phase === 'complete' || phase === 'error' || phase === 'denied') {
          const updatedEvents = existing.toolEvents.map(evt =>
            evt.toolName === toolName && evt.phase === 'start'
              ? { ...evt, phase: phase as ToolEvent['phase'], result: msg.result as string | undefined, error: msg.error as string | undefined }
              : evt,
          );
          return { ...prev, [idx]: { ...existing, toolEvents: updatedEvents } };
        }

        const newEvent: ToolEvent = {
          id: `${Date.now()}-${existing.toolEvents.length}`,
          phase: 'start',
          toolName,
          args,
          timestamp: Date.now(),
        };
        return { ...prev, [idx]: { ...existing, toolEvents: [...existing.toolEvents, newEvent] } };
      });
    }

    if (msg.type === 'ai-fix-permission') {
      updateScopedState(setter, requestId, () => ({
        pendingPermission: {
          permissionId: msg.permissionId as string,
          toolName: msg.toolName as string,
          args: msg.args as string,
        },
      }));
    }

    if (msg.type === 'ai-fix-done') {
      updateScopedState(setter, requestId, () => ({
        status: 'done' as const,
        statusMessage: undefined,
        pendingPermission: null,
      }));
    }

    if (msg.type === 'ai-fix-error') {
      updateScopedState(setter, requestId, () => ({
        status: 'error' as const,
        error: msg.message as string,
        pendingPermission: null,
      }));
    }
  }, [updateScopedState]);

  // Subscribe to WebSocket
  useEffect(() => {
    return subscribe(handleScopedMessage);
  }, [subscribe, handleScopedMessage]);

  // Auto-scroll panels
  useEffect(() => {
    if (aiPanelRef.current) aiPanelRef.current.scrollTop = aiPanelRef.current.scrollHeight;
    if (applyPanelRef.current) applyPanelRef.current.scrollTop = applyPanelRef.current.scrollHeight;
  }, [aiFixes, aiApplies]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAIFix = useCallback(async (groupIndex: number, group: any) => {
    const requestId = `fix-${Date.now()}-${groupIndex}`;
    setAiFixes(prev => ({
      ...prev,
      [groupIndex]: { requestId, content: '', status: 'streaming', toolEvents: [], pendingPermission: null },
    }));
    // Clear any previous apply state
    setAiApplies(prev => {
      const next = { ...prev };
      delete next[groupIndex];
      return next;
    });

    try {
      await aiFixFailure({
        requestId,
        errorSignature: group.errorSignature,
        category: group.category,
        rootCause: group.rootCause,
        suggestedFix: group.suggestedFix,
        affectedTests: group.affectedTests || [],
        errorMessage: group.errorSignature,
      });
    } catch (err) {
      setAiFixes(prev => ({
        ...prev,
        [groupIndex]: { requestId, content: '', status: 'error', error: String(err), toolEvents: [], pendingPermission: null },
      }));
    }
  }, []);

  const handleApplyFix = useCallback(async (groupIndex: number, group: any) => {
    const fix = aiFixes[groupIndex];
    if (!fix?.content) return;

    const requestId = `apply-${Date.now()}-${groupIndex}`;
    setAiApplies(prev => ({
      ...prev,
      [groupIndex]: { requestId, content: '', status: 'streaming', toolEvents: [], pendingPermission: null },
    }));
    // Clear previous diffs for this group
    setApplyDiffs(prev => ({ ...prev, [groupIndex]: [] }));

    try {
      await aiApplyFix({
        requestId,
        aiFixContent: fix.content,
        affectedTests: group.affectedTests || [],
        errorSignature: group.errorSignature,
        originalCommand: runDetail?.command || '',
      });
    } catch (err) {
      setAiApplies(prev => ({
        ...prev,
        [groupIndex]: { requestId, content: '', status: 'error', error: String(err), toolEvents: [], pendingPermission: null },
      }));
    }
  }, [aiFixes, runDetail]);

  const handlePermissionResponse = useCallback((permissionId: string, granted: boolean, remember?: boolean) => {
    send({
      type: 'ai-fix-permission-response',
      permissionId,
      granted,
      remember: remember || false,
    });

    // Clear from both state maps
    const clearPerm = (prev: Record<number, ScopedStreamState>) => {
      const updated = { ...prev };
      for (const [idx, s] of Object.entries(updated)) {
        if (s.pendingPermission?.permissionId === permissionId) {
          updated[parseInt(idx, 10)] = { ...s, pendingPermission: null };
        }
      }
      return updated;
    };
    setAiFixes(clearPerm);
    setAiApplies(clearPerm);
  }, [send]);

  const handleCopyAIFix = useCallback((groupIndex: number) => {
    const fix = aiFixes[groupIndex];
    if (fix?.content) {
      navigator.clipboard.writeText(fix.content);
      setCopiedIdx(groupIndex);
      setTimeout(() => setCopiedIdx(null), 2000);
    }
  }, [aiFixes]);

  const handleDismissAIFix = useCallback((groupIndex: number) => {
    setAiFixes(prev => { const n = { ...prev }; delete n[groupIndex]; return n; });
    setAiApplies(prev => { const n = { ...prev }; delete n[groupIndex]; return n; });
    setApplyDiffs(prev => { const n = { ...prev }; delete n[groupIndex]; return n; });
  }, []);

  // ── Detect if apply result mentions PASS or FAIL ───────────────────────────
  // Self-healing-aware: only checks the "### Final Result" section,
  // NOT intermediate attempt results (which may show FAIL before retrying).

  const getApplyVerdict = (apply: AIApplyState | undefined): 'pass' | 'fail' | null => {
    if (!apply || apply.status !== 'done' || !apply.content) return null;

    // Look for the "### Final Result" section — the definitive answer
    const finalIdx = apply.content.search(/###\s*Final\s*Result/i);
    if (finalIdx >= 0) {
      const finalSection = apply.content.slice(finalIdx);
      if (/\*\*Status:\*\*\s*PASS/i.test(finalSection)) return 'pass';
      if (/\*\*Status:\*\*\s*FAIL/i.test(finalSection)) return 'fail';
      // Fallback patterns within Final Result
      if (/pass(ed)?/i.test(finalSection) && !/fail/i.test(finalSection)) return 'pass';
      if (/fail/i.test(finalSection)) return 'fail';
    }

    // No "Final Result" section yet — check if the last attempt passed
    const attemptInfo = parseAttemptInfo(apply.content);
    if (attemptInfo?.status === 'pass') return 'pass';

    // Fallback: check overall content (only if no attempts were detected)
    if (!attemptInfo) {
      const lower = apply.content.toLowerCase();
      if (/\bstatus\b.*\bpass\b/i.test(apply.content) || /\ball\s+\d+\s+(tests?\s+)?passed/i.test(lower)) return 'pass';
      if (/\bstatus\b.*\bfail\b/i.test(apply.content) || /still\s+fail/i.test(lower)) return 'fail';
      // Check tool events for run_command exit
      const runEvents = apply.toolEvents.filter(e => (e.toolName === 'run_command' || e.toolName === 'run_tests') && e.phase === 'complete');
      if (runEvents.length > 0) return 'pass';
      const failEvents = apply.toolEvents.filter(e => (e.toolName === 'run_command' || e.toolName === 'run_tests') && e.phase === 'error');
      if (failEvents.length > 0) return 'fail';
    }

    return null;
  };

  // ── Get current attempt info from streaming apply content ─────────────────
  const getAttemptInfo = (apply: AIApplyState | undefined): AttemptInfo | null => {
    if (!apply || !apply.content) return null;
    return parseAttemptInfo(apply.content);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-purple-400" />
          <h3 className="text-base font-semibold text-gray-200">Failure Analysis</h3>
        </div>
        <div className="flex items-center gap-2">
          {groups.length > 0 && (
            <button
              onClick={() => analyzeMutation.mutate(runId)}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
              disabled={isAnalyzing}
            >
              Re-analyze
            </button>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>
      </div>

      {/* Empty state */}
      {groups.length === 0 && !isAnalyzing && (
        <div className="text-center py-10">
          <Brain size={36} className="mx-auto text-gray-600 mb-4" />
          <p className="text-sm text-gray-300 mb-1">Intelligent Failure Analysis</p>
          <p className="text-xs text-gray-500 mb-4 max-w-xs mx-auto">
            Analyze test failures to identify root causes, group related errors, and get actionable fix suggestions.
          </p>
          <button onClick={() => analyzeMutation.mutate(runId)}
            className="px-5 py-2.5 rounded-lg bg-purple-500/20 text-purple-300 text-sm font-medium hover:bg-purple-500/30 transition-colors border border-purple-500/20">
            <span className="flex items-center gap-2">
              <Search size={14} />
              Analyze Failures
            </span>
          </button>
        </div>
      )}

      {/* Loading */}
      {isAnalyzing && (
        <div className="text-center py-10">
          <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-300">Analyzing failure patterns...</p>
          <p className="text-xs text-gray-500 mt-1">Grouping errors and identifying root causes</p>
        </div>
      )}

      {/* Results */}
      {groups.length > 0 && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex items-center gap-4 text-xs text-gray-500">
            <span>{groups.length} root cause{groups.length !== 1 ? 's' : ''} identified</span>
            <span>•</span>
            <span>{totalAffected} test{totalAffected !== 1 ? 's' : ''} affected</span>
            <div className="flex-1" />
            <div className="flex gap-2">
              {Object.entries(
                groups.reduce<Record<string, number>>((acc, g: any) => {
                  acc[g.category] = (acc[g.category] || 0) + g.count;
                  return acc;
                }, {}),
              ).map(([cat, count]) => (
                <span key={cat} className="flex items-center gap-1">
                  {categoryIcons[cat]}
                  <span>{count}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Groups */}
          {groups.map((group: any, i: number) => {
            const isExpanded = expandedGroup === i;
            const colorClass = categoryColors[group.category] || categoryColors.unknown;
            const aiFix = aiFixes[i];
            const aiApply = aiApplies[i];
            const verdict = getApplyVerdict(aiApply);
            const attemptInfo = getAttemptInfo(aiApply);

            return (
              <div key={i} className={`rounded-xl border overflow-hidden ${colorClass}`}>
                {/* Group header */}
                <button onClick={() => setExpandedGroup(isExpanded ? null : i)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-white/[0.02] transition-colors text-left">
                  {categoryIcons[group.category] || categoryIcons.unknown}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-200">
                        {categoryLabels[group.category] || group.category}
                      </p>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-gray-400">
                        {group.count} test{group.count !== 1 ? 's' : ''}
                      </span>
                      {aiFix?.status === 'done' && !aiApply && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          AI fix ready
                        </span>
                      )}
                      {aiFix?.status === 'streaming' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                          AI analyzing
                        </span>
                      )}
                      {aiApply?.status === 'streaming' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                          {attemptInfo
                            ? `Self-healing: Attempt ${attemptInfo.current}/${attemptInfo.total}`
                            : 'AI fixing & running'}
                        </span>
                      )}
                      {verdict === 'pass' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                          <CheckCircle2 size={12} />
                          Fixed{attemptInfo && attemptInfo.current > 1 ? ` (${attemptInfo.current} attempts)` : ''}
                        </span>
                      )}
                      {verdict === 'fail' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-1">
                          <XCircle size={12} />
                          Failed after {attemptInfo?.total || '?'} attempts
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 truncate mt-0.5 font-mono">{group.errorSignature}</p>
                  </div>
                  {isExpanded
                    ? <ChevronDown size={16} className="text-gray-500 flex-shrink-0" />
                    : <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />}
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-3">
                    {/* Root Cause */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Lightbulb size={12} className="text-amber-400" />
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Root Cause</p>
                      </div>
                      <FormattedText text={group.rootCause} />
                    </div>

                    {/* Suggested Fix */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Wrench size={12} className="text-emerald-400" />
                        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Suggested Fix</p>
                      </div>
                      <div className="bg-surface-1 rounded-lg p-3 border border-white/5">
                        <FormattedText text={group.suggestedFix} />
                      </div>
                    </div>

                    {/* Affected Tests */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                        Affected Tests ({group.affectedTests?.length || 0})
                      </p>
                      <div className="space-y-1">
                        {group.affectedTests?.map((t: string, j: number) => {
                          const ownership = ownershipMap.get(t);
                          return (
                            <div key={j} className="flex items-center gap-2 text-sm text-gray-300">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                              <span className="truncate flex-1">{t}</span>
                              {ownership && (
                                <span className="flex items-center gap-1 text-[11px] text-gray-500 flex-shrink-0" title={ownership.suggestedOwner.reason}>
                                  <User size={9} className="text-gray-600" />
                                  {ownership.suggestedOwner.name}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── Step 1: AI Fix (Analysis) ── */}
                    {!aiFix && (
                      <div className="pt-2 border-t border-white/5">
                        <button
                          onClick={() => handleAIFix(i, group)}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500/15 text-brand-300 text-sm font-medium hover:bg-brand-500/25 transition-all border border-brand-500/20"
                        >
                          <Sparkles size={14} />
                          Ask AI to Fix
                        </button>
                        <p className="text-xs text-gray-600 mt-1.5">
                          AI will read your test files, analyze the error, and suggest concrete code changes.
                        </p>
                      </div>
                    )}

                    {/* AI Fix Panel */}
                    {aiFix && (
                      <div className="pt-2 border-t border-white/5">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Sparkles size={14} className="text-purple-400" />
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">AI Fix</span>
                            {aiFix.status === 'streaming' && (
                              <span className="flex items-center gap-1 text-xs text-purple-400">
                                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                                {aiFix.statusMessage || (aiFix.toolEvents.length > 0
                                  ? `Working... (${aiFix.toolEvents.filter(e => e.phase === 'complete' || e.phase === 'error').length}/${aiFix.toolEvents.filter(e => e.phase === 'start').length} tools done)`
                                  : 'Working...')}
                              </span>
                            )}
                            {aiFix.status === 'done' && <span className="text-xs text-emerald-400">Analysis Complete</span>}
                            {aiFix.status === 'error' && <span className="text-xs text-red-400">Error</span>}
                          </div>
                          <div className="flex items-center gap-1">
                            {aiFix.status === 'done' && aiFix.content && (
                              <button onClick={() => handleCopyAIFix(i)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-gray-400 transition-colors">
                                {copiedIdx === i ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                {copiedIdx === i ? 'Copied' : 'Copy'}
                              </button>
                            )}
                            {aiFix.status !== 'streaming' && (
                              <button onClick={() => handleDismissAIFix(i)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-gray-400 transition-colors">
                                <X size={12} />
                              </button>
                            )}
                            {aiFix.status === 'done' && (
                              <button onClick={() => handleAIFix(i, group)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-gray-400 transition-colors">
                                <Sparkles size={10} /> Retry
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Permission prompt for fix analysis */}
                        {aiFix.pendingPermission && (
                          <PermissionPrompt permission={aiFix.pendingPermission} onRespond={handlePermissionResponse} />
                        )}

                        <ScopedStreamPanel
                          state={aiFix}
                          panelRef={!aiApply ? aiPanelRef : undefined}
                          label="AI Fix"
                          icon={<Sparkles size={14} />}
                          emptyMessage="Reading test files and analyzing the error..."
                        />

                        {/* ── Step 2: Self-Healing Fix & Re-run ── */}
                        {aiFix.status === 'done' && aiFix.content && !aiApply && (
                          <div className="mt-4 pt-3 border-t border-white/5">
                            <button
                              onClick={() => handleApplyFix(i, group)}
                              className="flex items-center gap-2 px-5 py-3 rounded-lg bg-brand-500/15 text-brand-300 text-sm font-semibold hover:bg-brand-500/25 transition-all border border-brand-500/20"
                            >
                              <Rocket size={16} />
                              Self-Heal & Fix Test
                            </button>
                            <p className="text-xs text-gray-600 mt-1.5">
                              {(group.affectedTests?.length || 0) > 1
                                ? `AI will fix and run 1 representative scenario (out of ${group.affectedTests.length} affected). Same fix applies to all since they share the same root cause. Up to 5 self-healing attempts.`
                                : 'AI will apply the fix, run the test, and if it still fails, automatically analyze the new error and retry — up to 5 attempts until the test passes.'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Apply Fix Panel ── */}
                    {aiApply && (
                      <div className="pt-2 border-t border-white/5">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Rocket size={14} className="text-emerald-400" />
                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Self-Healing Fix</span>
                            {aiApply.status === 'streaming' && (() => {
                              const att = getAttemptInfo(aiApply);
                              return (
                                <span className="flex items-center gap-1 text-xs text-emerald-400">
                                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  {att
                                    ? `Attempt ${att.current} of ${att.total}${att.status === 'fail' ? ' — retrying...' : att.status === 'pass' ? ' — passed!' : ' — running...'}`
                                    : aiApply.statusMessage || 'Applying changes...'}
                                </span>
                              );
                            })()}
                            {aiApply.status === 'done' && verdict === 'pass' && (
                              <span className="flex items-center gap-1 text-xs text-emerald-400">
                                <CheckCircle2 size={12} /> Test Passed
                                {attemptInfo && attemptInfo.current > 1 && (
                                  <span className="text-gray-500 ml-1">({attemptInfo.current} attempts)</span>
                                )}
                              </span>
                            )}
                            {aiApply.status === 'done' && verdict === 'fail' && (
                              <span className="flex items-center gap-1 text-xs text-red-400">
                                <XCircle size={12} /> All {attemptInfo?.total || '5'} Attempts Failed
                              </span>
                            )}
                            {aiApply.status === 'done' && verdict === null && (
                              <span className="text-xs text-gray-400">Finished — check results below</span>
                            )}
                            {aiApply.status === 'error' && <span className="text-xs text-red-400">Error</span>}
                          </div>
                          <div className="flex items-center gap-1">
                            {aiApply.status === 'done' && (
                              <button onClick={() => handleApplyFix(i, group)}
                                className="flex items-center gap-1 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 text-xs text-gray-400 transition-colors">
                                <Play size={10} /> Retry Self-Heal
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Self-healing progress indicator — shown during streaming AND after done */}
                        {(() => {
                          const att = getAttemptInfo(aiApply);
                          if (!att) return null;
                          return (
                            <div className="mb-3">
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Self-Healing Progress</span>
                                <span className="text-[10px] text-gray-600">
                                  {att.status === 'pass' ? '✓ Passed' : att.status === 'fail' && aiApply.status === 'done' ? '✗ All attempts exhausted' : `Attempt ${att.current} of ${att.total}`}
                                </span>
                              </div>
                              <div className="flex gap-1">
                                {Array.from({ length: att.total }, (_, idx) => {
                                  const attemptNum = idx + 1;
                                  let bgColor = 'bg-gray-700'; // future attempt
                                  if (attemptNum < att.current) bgColor = 'bg-red-500/50'; // previous attempts failed
                                  if (attemptNum === att.current && att.status === 'running') bgColor = 'bg-amber-500 animate-pulse';
                                  if (attemptNum === att.current && att.status === 'pass') bgColor = 'bg-emerald-500';
                                  if (attemptNum === att.current && att.status === 'fail' && aiApply.status === 'streaming') bgColor = 'bg-red-500 animate-pulse'; // failed but retrying
                                  if (attemptNum === att.current && att.status === 'fail' && aiApply.status === 'done') bgColor = 'bg-red-500'; // final fail
                                  return (
                                    <div key={idx} className="flex-1 flex flex-col items-center gap-0.5">
                                      <div className={`h-2 w-full rounded-full ${bgColor} transition-colors`} />
                                      <span className="text-[9px] text-gray-600">{attemptNum}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Permission prompt for apply */}
                        {aiApply.pendingPermission && (
                          <PermissionPrompt permission={aiApply.pendingPermission} onRespond={handlePermissionResponse} />
                        )}

                        <ScopedStreamPanel
                          state={aiApply}
                          panelRef={applyPanelRef}
                          label="Self-Healing Fix"
                          icon={<Rocket size={14} />}
                          emptyMessage="Starting self-healing loop — applying fix and running test..."
                        />

                        {/* File Changes Diff Viewer */}
                        {(applyDiffs[i]?.length || 0) > 0 && (
                          <DiffViewer diffs={applyDiffs[i]!} />
                        )}

                        {/* Success/Failure summary banner */}
                        {aiApply.status === 'done' && verdict === 'pass' && (
                          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                              <CheckCircle2 size={22} className="text-emerald-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-emerald-300">Test Fixed Successfully!</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                {attemptInfo && attemptInfo.current > 1
                                  ? `Self-healed in ${attemptInfo.current} attempt${attemptInfo.current !== 1 ? 's' : ''} — the AI analyzed ${attemptInfo.current - 1} intermediate failure${attemptInfo.current - 1 !== 1 ? 's' : ''} and adapted its approach.`
                                  : 'The fix was applied and the test passed on the first attempt.'}
                              </p>
                              {(group.affectedTests?.length || 0) > 1 && (
                                <p className="text-xs text-emerald-400/70 mt-1">
                                  Same fix applies to all {group.affectedTests.length} scenario(s) in this group — they share the same root cause.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        {aiApply.status === 'done' && verdict === 'fail' && (
                          <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                              <XCircle size={22} className="text-red-400" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-red-300">Could Not Fix Automatically</p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                The AI tried {attemptInfo?.total || 5} different approaches but the test still fails.
                                Review the attempts above for insights, or click "Retry Self-Heal" to try again.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findGroupByRequestId(fixes: Record<number, ScopedStreamState>, requestId: string): number {
  for (const [idx, fix] of Object.entries(fixes)) {
    if (fix.requestId === requestId) return parseInt(idx, 10);
  }
  return -1;
}
