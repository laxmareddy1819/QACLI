import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Wand2, Loader2, CheckCircle2, AlertCircle, XCircle, ChevronDown, ChevronRight, FolderOpen, Check } from 'lucide-react';
import type { ApiRequest, ApiResponse, ApiCollection, WSMessage } from '../../api/types';
import { generateApiTest } from '../../api/client';
import { useToast } from '../shared/Toast';
import {
  ScopedStreamPanel,
  PermissionPrompt,
  parseAttemptInfo,
  type ScopedStreamState,
  type ToolEvent,
} from '../results/FailureAnalysis';
import { DiffViewer, type FileDiff } from '../ai/NewTestPanel';

interface GenerateTestDialogProps {
  collection: ApiCollection;
  currentRequest?: ApiRequest;
  lastResponse?: ApiResponse | null;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  send: (msg: object) => void;
  onClose: () => void;
}

type Phase = 'selection' | 'streaming';

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-blue-400',
  PUT: 'text-amber-400',
  PATCH: 'text-brand-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-gray-400',
};

const METHOD_BG: Record<string, string> = {
  GET: 'bg-emerald-500/15 text-emerald-400',
  POST: 'bg-blue-500/15 text-blue-400',
  PUT: 'bg-amber-500/15 text-amber-400',
  PATCH: 'bg-brand-500/15 text-brand-400',
  DELETE: 'bg-red-500/15 text-red-400',
  HEAD: 'bg-purple-500/15 text-purple-400',
  OPTIONS: 'bg-gray-500/15 text-gray-400',
};

export function GenerateTestDialog({ collection, currentRequest, lastResponse, subscribe, send, onClose }: GenerateTestDialogProps) {
  // Phase state
  const [phase, setPhase] = useState<Phase>('selection');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [testName, setTestName] = useState('');

  // Streaming state
  const [streamState, setStreamState] = useState<ScopedStreamState>({
    requestId: null,
    content: '',
    status: 'idle',
    toolEvents: [],
    pendingPermission: null,
  });
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Pre-select current request if provided
  useEffect(() => {
    if (currentRequest) {
      setSelectedIds(new Set([currentRequest.id]));
    }
  }, []);

  // Expand all folders by default
  useEffect(() => {
    const folderIds = new Set(collection.folders.map(f => f.id));
    setExpandedFolders(folderIds);
  }, [collection]);

  // ── WebSocket message handler ──────────────────────────────────────────
  const handleMessage = useCallback((msg: WSMessage) => {
    const msgRequestId = msg.requestId as string | undefined;
    if (!msgRequestId) return;

    // Handle file diff messages
    if (msg.type === 'ai-fix-file-diff') {
      setFileDiffs(prev => {
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
        const toolPhase = msg.phase as string;
        const toolName = msg.toolName as string;
        const args = msg.args as string;

        if (toolPhase === 'complete' || toolPhase === 'error' || toolPhase === 'denied') {
          const updatedEvents = prev.toolEvents.map(evt =>
            evt.toolName === toolName && evt.phase === 'start'
              ? { ...evt, phase: toolPhase as ToolEvent['phase'], result: msg.result as string | undefined, error: msg.error as string | undefined }
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

  // ── Selection handlers ─────────────────────────────────────────────────

  const toggleRequest = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFolder = (folderRequests: ApiRequest[]) => {
    const ids = folderRequests.map(r => r.id);
    const allSelected = ids.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const toggleFolderExpand = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(getAllRequestIds(collection)));
  const selectNone = () => setSelectedIds(new Set());

  const selectedCount = selectedIds.size;

  // ── Generate handler ───────────────────────────────────────────────────

  const handleGenerate = async () => {
    const selectedRequests = getSelectedRequests(collection, selectedIds);
    if (selectedRequests.length === 0) return;

    const requestId = `api-gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setPhase('streaming');
    setStreamState({
      requestId,
      content: '',
      status: 'streaming',
      toolEvents: [],
      pendingPermission: null,
    });
    setFileDiffs([]);

    // Only include response for the request that has one
    const responses: ApiResponse[] = [];
    if (lastResponse && currentRequest && selectedIds.has(currentRequest.id)) {
      for (const req of selectedRequests) {
        if (req.id === currentRequest.id) {
          responses.push(lastResponse);
        }
      }
    }

    try {
      await generateApiTest({
        requestId,
        apiRequests: selectedRequests,
        responses: responses.length > 0 ? responses : undefined,
        testName: testName || undefined,
      });
    } catch (err) {
      setStreamState(prev => ({ ...prev, status: 'error', error: String(err) }));
      toast('error', `Failed to start generation: ${err}`);
    }
  };

  // ── Permission response ────────────────────────────────────────────────

  const handlePermissionResponse = (permissionId: string, granted: boolean, remember?: boolean) => {
    send({
      type: 'ai-fix-permission-response',
      permissionId,
      granted,
      remember: remember || false,
    });
    setStreamState(prev => ({ ...prev, pendingPermission: null }));
  };

  // ── Back to selection ──────────────────────────────────────────────────

  const handleBackToSelection = () => {
    setPhase('selection');
    setStreamState({
      requestId: null,
      content: '',
      status: 'idle',
      toolEvents: [],
      pendingPermission: null,
    });
    setFileDiffs([]);
  };

  // ── Derived state ──────────────────────────────────────────────────────

  const isStreaming = streamState.status === 'streaming';
  const isDone = streamState.status === 'done';
  const isError = streamState.status === 'error';
  const attemptInfo = parseAttemptInfo(streamState.content);

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
    return null;
  };

  const verdict = getVerdict();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[800px] max-h-[90vh] bg-surface-1 rounded-xl border border-white/10 flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Wand2 size={16} className="text-purple-400" />
            <h2 className="text-sm font-bold text-gray-200">Generate API Test</h2>
            {phase === 'streaming' && isStreaming && !attemptInfo && (
              <span className="flex items-center gap-1 text-xs text-purple-400 ml-2">
                <Loader2 size={11} className="animate-spin" />
                {streamState.statusMessage || (streamState.toolEvents.length > 0
                  ? `Working... (${streamState.toolEvents.filter(e => e.phase === 'complete' || e.phase === 'error').length}/${streamState.toolEvents.filter(e => e.phase === 'start').length} tools)`
                  : 'Scanning project...')}
              </span>
            )}
            {phase === 'streaming' && isStreaming && attemptInfo && (
              <span className="flex items-center gap-1 text-xs text-emerald-400 ml-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Attempt {attemptInfo.current} of {attemptInfo.total}
                {attemptInfo.status === 'pass' ? ' — passed!' : attemptInfo.status === 'fail' ? ' — retrying...' : ' — running...'}
              </span>
            )}
            {phase === 'streaming' && isDone && verdict === 'pass' && (
              <span className="flex items-center gap-1 text-xs text-emerald-400 ml-2">
                <CheckCircle2 size={12} /> Test Created & Passed
              </span>
            )}
            {phase === 'streaming' && isDone && verdict === 'fail' && (
              <span className="flex items-center gap-1 text-xs text-red-400 ml-2">
                <XCircle size={12} /> Needs Manual Fix
              </span>
            )}
            {phase === 'streaming' && isDone && verdict === null && (
              <span className="text-xs text-gray-400 ml-2">Complete</span>
            )}
            {phase === 'streaming' && isError && (
              <span className="flex items-center gap-1 text-xs text-red-400 ml-2">
                <AlertCircle size={12} /> Error
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1">
            <X size={16} />
          </button>
        </div>

        {/* ── Phase 1: Selection ────────────────────────────────────────── */}
        {phase === 'selection' && (
          <>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {/* Instructions + Select All/None */}
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  Select endpoints and scenarios to include in the test:
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={selectAll} className="text-[10px] text-brand-400 hover:text-brand-300">Select All</button>
                  <span className="text-gray-700">|</span>
                  <button onClick={selectNone} className="text-[10px] text-gray-500 hover:text-gray-300">Select None</button>
                </div>
              </div>

              {/* Endpoint tree */}
              <div className="border border-white/5 rounded-lg overflow-hidden max-h-[40vh] overflow-y-auto">
                {/* Root requests (no folder) */}
                {collection.requests.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-2 border-b border-white/5">
                      <span className="text-[11px] text-gray-400 font-medium">Root Requests</span>
                      <span className="text-[10px] text-gray-600 ml-auto">
                        {collection.requests.filter(r => selectedIds.has(r.id)).length}/{collection.requests.length}
                      </span>
                    </div>
                    {collection.requests.map(req => (
                      <RequestRow key={req.id} request={req} selected={selectedIds.has(req.id)} onToggle={() => toggleRequest(req.id)} />
                    ))}
                  </div>
                )}

                {/* Folders */}
                {collection.folders.map(folder => {
                  const isAI = folder.name.startsWith('[AI]');
                  const isExpanded = expandedFolders.has(folder.id);
                  const folderSelectedCount = folder.requests.filter(r => selectedIds.has(r.id)).length;
                  const allSelected = folder.requests.length > 0 && folderSelectedCount === folder.requests.length;
                  const someSelected = folderSelectedCount > 0 && !allSelected;

                  return (
                    <div key={folder.id}>
                      <div className={`flex items-center gap-2 px-3 py-1.5 border-b border-white/5 ${isAI ? 'bg-purple-500/5' : 'bg-surface-2'}`}>
                        {/* Expand/collapse toggle */}
                        <button
                          onClick={() => toggleFolderExpand(folder.id)}
                          className="text-gray-500 hover:text-gray-300 p-0.5"
                        >
                          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        </button>

                        {/* Folder checkbox */}
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => { if (el) el.indeterminate = someSelected; }}
                          onChange={() => toggleFolder(folder.requests)}
                          className="w-3.5 h-3.5 rounded border-gray-600 bg-surface-2 accent-brand-500"
                        />

                        {isAI
                          ? <Wand2 size={11} className="text-purple-400" />
                          : <FolderOpen size={11} className="text-amber-500/60" />
                        }
                        <span className={`text-[11px] font-medium ${isAI ? 'text-purple-300' : 'text-gray-300'}`}>
                          {folder.name}
                        </span>
                        {isAI && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 uppercase tracking-wider font-bold">AI</span>
                        )}
                        <span className="text-[10px] text-gray-600 ml-auto">{folderSelectedCount}/{folder.requests.length}</span>
                      </div>

                      {isExpanded && folder.requests.map(req => (
                        <RequestRow key={req.id} request={req} selected={selectedIds.has(req.id)} onToggle={() => toggleRequest(req.id)} />
                      ))}
                    </div>
                  );
                })}

                {/* Empty state */}
                {collection.requests.length === 0 && collection.folders.length === 0 && (
                  <div className="py-8 text-center text-xs text-gray-600">
                    No endpoints in this collection
                  </div>
                )}
              </div>

              {/* Test name */}
              <div>
                <label className="text-[10px] uppercase text-gray-500 font-medium mb-1 block">
                  Test name (optional)
                </label>
                <input
                  type="text"
                  value={testName}
                  onChange={e => setTestName(e.target.value)}
                  placeholder="e.g., Pet Store API CRUD tests"
                  className="w-full px-3 py-1.5 text-xs bg-surface-2 border border-white/5 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
                />
              </div>

              <p className="text-[11px] text-gray-500">
                AI will scan your project, discover your test framework, generate framework-native API test code,
                run it, and self-heal if tests fail. Permission will be requested before creating or editing files.
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-white/5 flex-shrink-0">
              <span className="text-xs text-gray-500">
                {selectedCount} endpoint{selectedCount !== 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={selectedCount === 0}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-purple-500 text-white text-xs font-medium hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Wand2 size={13} /> Generate Test
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Phase 2: Streaming Output ────────────────────────────────── */}
        {phase === 'streaming' && (
          <div ref={panelRef} className="flex-1 overflow-y-auto p-5 space-y-3">
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
              label="API Test Generation"
              icon={<Wand2 size={14} />}
              emptyMessage="Scanning project structure and analyzing existing tests..."
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
                  <p className="text-sm font-semibold text-emerald-300">API Test Created & Verified!</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {attemptInfo && attemptInfo.current > 1
                      ? `The AI created the test and self-healed in ${attemptInfo.current} attempts.`
                      : 'The new API test was created and passed on the first run.'}
                    {' '}Check the "Final Result" section above for details.
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
                    The AI created the test files but couldn't get them to pass after all attempts.
                    Check the output above for details on what was tried.
                  </p>
                </div>
              </div>
            )}

            {/* Error banner */}
            {isError && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3 flex items-center gap-2">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-300">{streamState.error || 'An error occurred during generation.'}</p>
              </div>
            )}

            {/* Footer actions */}
            {(isDone || isError) && (
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={handleBackToSelection}
                  className="px-3 py-1.5 rounded-lg bg-surface-2 text-gray-400 text-xs hover:bg-surface-3 hover:text-gray-300 transition-colors"
                >
                  Back to Selection
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function RequestRow({ request, selected, onToggle }: { request: ApiRequest; selected: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center gap-2 px-4 py-1.5 hover:bg-white/5 cursor-pointer border-b border-white/[2%]">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="w-3.5 h-3.5 rounded border-gray-600 bg-surface-2 accent-brand-500"
      />
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${METHOD_BG[request.method] || 'bg-gray-500/15 text-gray-400'}`}>
        {request.method}
      </span>
      <span className="text-[11px] text-gray-400 font-mono truncate flex-1">{request.url || '(no URL)'}</span>
      {request.name && request.name !== request.url && (
        <span className="text-[10px] text-gray-600 truncate max-w-[180px]">{request.name}</span>
      )}
    </label>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getAllRequestIds(collection: ApiCollection): string[] {
  const ids = collection.requests.map(r => r.id);
  for (const folder of collection.folders) {
    for (const req of folder.requests) {
      ids.push(req.id);
    }
  }
  return ids;
}

function getSelectedRequests(collection: ApiCollection, selectedIds: Set<string>): ApiRequest[] {
  const requests: ApiRequest[] = [];
  for (const req of collection.requests) {
    if (selectedIds.has(req.id)) requests.push(req);
  }
  for (const folder of collection.folders) {
    for (const req of folder.requests) {
      if (selectedIds.has(req.id)) requests.push(req);
    }
  }
  return requests;
}
