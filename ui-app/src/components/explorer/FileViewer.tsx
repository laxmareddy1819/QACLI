import { useState, useRef, useCallback, useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { readFile } from '../../api/client';
import { CodeViewer } from '../viewers/CodeViewer';
import { GherkinViewer } from '../viewers/GherkinViewer';
import { DataTableViewer } from '../viewers/DataTableViewer';
import { ApiEndpointViewer } from '../viewers/ApiEndpointViewer';
import { KeywordViewer } from '../viewers/KeywordViewer';
// StepDefViewer merged into CodeViewer's unified Outline panel
import { HtmlViewer } from '../viewers/HtmlViewer';
import { LoadingState } from '../shared/LoadingState';
import { EmptyState } from '../shared/EmptyState';
import { FileText, Save, X, Play, History, GitPullRequestDraft, AlertTriangle } from 'lucide-react';
import { updateFile } from '../../api/client';
import { useToast } from '../shared/Toast';
import { useGitStatus, useGitFileHistory, useGitUncommittedDiff } from '../../hooks/useGit';
import { FileHistoryPanel } from '../git/FileHistoryPanel';
import { FileChangesPanel } from '../git/FileChangesPanel';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the line in content that contains a step definition pattern.
 */
function findStepLine(content: string, stepText: string): number | null {
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(stepText)) return i + 1;
  }

  const simplified = stepText.replace(/[\\^$.*+?()[\]{}|]/g, '');
  if (simplified.length > 5) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(simplified)) return i + 1;
    }
  }

  const words = stepText.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).filter(w => w.length > 2);
  if (words.length >= 2) {
    const searchKey = words.slice(0, 3).join('.*');
    const re = new RegExp(searchKey, 'i');
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) return i + 1;
    }
  }

  return null;
}

interface FileViewerProps {
  filePath: string | null;
  onRun?: (path: string) => void;
  /** Called when the actually displayed file changes (may differ from filePath during unsaved-changes dialogs) */
  onActiveFileChange?: (path: string | null) => void;
  /** Line number to highlight after editor loads (e.g., from ?line= query param) */
  initialHighlightLine?: number | null;
  /** Called after the highlight has been consumed so parent can clear state */
  onHighlightConsumed?: () => void;
}

export function FileViewer({ filePath, onRun, onActiveFileChange, initialHighlightLine, onHighlightConsumed }: FileViewerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editorInstanceRef = useRef<any>(null);

  // editContent: null = read-only mode, string = edit mode
  const [editContent, setEditContent] = useState<string | null>(null);
  const [gitPanel, setGitPanel] = useState<'none' | 'history' | 'changes'>('none');
  const [saving, setSaving] = useState(false);

  // Track the original file content when entering edit mode, so we can
  // detect whether the user actually made any modifications.
  const originalContentRef = useRef<string | null>(null);

  // Track WHICH file is being edited — prevents stale edit state leaking to other files
  const editingFileRef = useRef<string | null>(null);

  // When user tries to switch files while having real changes, store the target
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);

  // Ref to always have access to the latest editContent inside effects/callbacks
  const editContentRef = useRef<string | null>(editContent);
  editContentRef.current = editContent;

  // Helper: are there real unsaved modifications?
  const hasRealChanges = editContent !== null && editContent !== originalContentRef.current;

  // When parent changes filePath — intercept if there are real unsaved changes
  useEffect(() => {
    if (filePath === null) {
      editingFileRef.current = null;
      setEditContent(null);
      originalContentRef.current = null;
      setPendingFilePath(null);
      return;
    }

    // Read the latest values from refs (not stale closure)
    const currentEdit = editContentRef.current;
    const originalContent = originalContentRef.current;
    const reallyChanged = currentEdit !== null && currentEdit !== originalContent;

    if (reallyChanged) {
      // User has actual modifications — show confirmation dialog
      setPendingFilePath(filePath);
    } else {
      // No real changes — exit edit mode and switch directly
      editingFileRef.current = null;
      setEditContent(null);
      originalContentRef.current = null;
      setPendingFilePath(null);
    }
  }, [filePath]); // eslint-disable-line react-hooks/exhaustive-deps

  // Browser tab/window close warning only when there are real unsaved changes
  useEffect(() => {
    if (!hasRealChanges) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasRealChanges]);

  // Block React Router navigations (sidebar clicks, etc.) when there are real changes
  const blocker = useBlocker(hasRealChanges);

  // Track which file is actually displayed. Only update when safe (no unsaved changes blocking).
  const displayFileRef = useRef<string | null>(filePath);

  // Only switch the displayed file if:
  // 1. No pending file-switch dialog is showing
  // 2. No real unsaved changes that would trigger a dialog (prevents flash before useEffect fires)
  const wouldBlock = editContentRef.current !== null
    && editContentRef.current !== originalContentRef.current
    && editingFileRef.current !== null
    && editingFileRef.current !== filePath;

  if (pendingFilePath === null && !wouldBlock) {
    displayFileRef.current = filePath;
  }
  const displayFile = displayFileRef.current;

  // Notify parent whenever the actually-displayed file changes
  // (may differ from filePath when unsaved-changes dialog is open)
  useEffect(() => {
    onActiveFileChange?.(displayFile);
  }, [displayFile, onActiveFileChange]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['file', displayFile],
    queryFn: () => readFile(displayFile!),
    enabled: !!displayFile,
  });

  // Reusable line-highlight helper
  const highlightEditorLine = useCallback((editor: any, line: number) => {
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
    const decorations = editor.deltaDecorations([], [{
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
      options: {
        isWholeLine: true,
        className: 'symbol-highlight-line',
        overviewRuler: { color: '#7c3aed', position: 1 },
      },
    }]);
    setTimeout(() => { editor.deltaDecorations(decorations, []); }, 1500);
  }, []);

  const handleEditorReady = useCallback((editor: any) => {
    editorInstanceRef.current = editor;
    // If there's an initial line to highlight, do it after a short delay so the editor is fully rendered
    if (initialHighlightLine && initialHighlightLine > 0) {
      setTimeout(() => {
        highlightEditorLine(editor, initialHighlightLine);
        onHighlightConsumed?.();
      }, 200);
    }
  }, [initialHighlightLine, highlightEditorLine, onHighlightConsumed]);

  // Also handle initialHighlightLine changes when editor is already mounted (e.g., same file, different line)
  useEffect(() => {
    const editor = editorInstanceRef.current;
    if (editor && initialHighlightLine && initialHighlightLine > 0) {
      setTimeout(() => {
        highlightEditorLine(editor, initialHighlightLine);
        onHighlightConsumed?.();
      }, 200);
    }
  }, [initialHighlightLine, highlightEditorLine, onHighlightConsumed]);

  const handleStepClick = useCallback((stepText: string) => {
    const editor = editorInstanceRef.current;
    if (!editor || !data) return;

    const currentContent = editContent ?? data.content;
    const line = findStepLine(currentContent, stepText);
    if (line) highlightEditorLine(editor, line);
  }, [editContent, data, highlightEditorLine]);

  // Git hooks
  const { data: gitStatus } = useGitStatus();
  const gitAvailable = gitStatus?.available ?? false;

  const hasGitChanges = gitAvailable && gitStatus?.uncommittedChanges?.some(
    c => displayFile && (c.path === displayFile || displayFile.endsWith(c.path) || c.path.endsWith(displayFile.replace(/\\/g, '/'))),
  );

  const { data: fileHistoryData, isLoading: historyLoading } = useGitFileHistory(
    gitPanel === 'history' ? displayFile : null,
  );

  const { data: fileDiffData, isLoading: diffLoading } = useGitUncommittedDiff(
    gitPanel === 'changes' ? displayFile : null,
    gitPanel === 'changes',
  );

  // --- Enter edit mode ---
  const enterEditMode = useCallback(() => {
    if (data && displayFile) {
      editingFileRef.current = displayFile;
      originalContentRef.current = data.content;
      setEditContent(data.content);
    }
  }, [data, displayFile]);

  // --- Exit edit mode (discard) ---
  const exitEditMode = useCallback(() => {
    editingFileRef.current = null;
    setEditContent(null);
    originalContentRef.current = null;
  }, []);

  // --- Save current file ---
  const handleSave = useCallback(async () => {
    if (editContent === null || !displayFile) return;

    setSaving(true);
    try {
      await updateFile(displayFile, editContent);
      // Update the query cache directly with the saved content so it's instant
      queryClient.setQueryData(['file', displayFile], (old: any) =>
        old ? { ...old, content: editContent } : old,
      );
      toast('success', 'File saved');
      // Exit edit mode
      editingFileRef.current = null;
      setEditContent(null);
      originalContentRef.current = null;
    } catch (err) {
      toast('error', `Save failed: ${err}`);
    }
    setSaving(false);
  }, [editContent, displayFile, queryClient, toast]);

  // --- Dialog: Discard & Switch ---
  const handleDiscardAndSwitch = useCallback(() => {
    editingFileRef.current = null;
    setEditContent(null);
    originalContentRef.current = null;
    // Allow the file switch to proceed
    displayFileRef.current = filePath;
    setPendingFilePath(null);
  }, [filePath]);

  // --- Dialog: Save & Switch ---
  const handleSaveAndSwitch = useCallback(async () => {
    if (editContent !== null && displayFile) {
      setSaving(true);
      try {
        await updateFile(displayFile, editContent);
        queryClient.setQueryData(['file', displayFile], (old: any) =>
          old ? { ...old, content: editContent } : old,
        );
        toast('success', 'File saved');
      } catch (err) {
        toast('error', `Save failed: ${err}`);
        setSaving(false);
        return; // Stay on current file if save fails
      }
      setSaving(false);
    }
    // Clear edit mode and switch
    editingFileRef.current = null;
    setEditContent(null);
    originalContentRef.current = null;
    displayFileRef.current = filePath;
    setPendingFilePath(null);
  }, [editContent, displayFile, filePath, queryClient, toast]);

  // --- Dialog: Stay on file ---
  const handleStayOnFile = useCallback(() => {
    setPendingFilePath(null);
    // Note: displayFileRef stays on the old file since pendingFilePath is cleared
  }, []);

  // --- Route blocker: Discard & Navigate ---
  const handleBlockerDiscard = useCallback(() => {
    editingFileRef.current = null;
    setEditContent(null);
    originalContentRef.current = null;
    if (blocker.state === 'blocked') blocker.proceed();
  }, [blocker]);

  // --- Route blocker: Save & Navigate ---
  const handleBlockerSave = useCallback(async () => {
    if (editContent !== null && displayFile) {
      setSaving(true);
      try {
        await updateFile(displayFile, editContent);
        queryClient.setQueryData(['file', displayFile], (old: any) =>
          old ? { ...old, content: editContent } : old,
        );
        toast('success', 'File saved');
      } catch (err) {
        toast('error', `Save failed: ${err}`);
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    editingFileRef.current = null;
    setEditContent(null);
    originalContentRef.current = null;
    if (blocker.state === 'blocked') blocker.proceed();
  }, [blocker, editContent, displayFile, queryClient, toast]);

  // --- Route blocker: Stay ---
  const handleBlockerStay = useCallback(() => {
    if (blocker.state === 'blocked') blocker.reset();
  }, [blocker]);

  if (!displayFile) {
    return <EmptyState title="Select a file" description="Choose a file from the tree to view its contents" icon={<FileText size={28} />} />;
  }

  if (isLoading) return <LoadingState text="Loading file..." />;
  if (error || !data) return <EmptyState title="Error loading file" description={String(error)} />;

  const { content, metadata } = data;
  const lang = metadata.language;
  // Only consider editing if editContent exists AND the edit belongs to THIS file
  const isEditing = editContent !== null && editingFileRef.current === displayFile;
  const displayContent = isEditing ? editContent! : content;

  // Select viewer based on language/type
  const renderViewer = () => {
    if (lang === 'html') return <HtmlViewer content={displayContent} metadata={metadata} readOnly={!isEditing} onChange={isEditing ? setEditContent : undefined} />;
    if (lang === 'gherkin') return <GherkinViewer content={displayContent} />;
    if (lang === 'robot') return <KeywordViewer content={displayContent} keywords={metadata.metadata?.keywords} />;
    if (lang === 'csv' || (lang === 'json' && metadata.type === 'data') || lang === 'yaml')
      return <DataTableViewer content={displayContent} language={lang} />;

    // API file with endpoints
    if (metadata.metadata?.endpoints && metadata.metadata.endpoints.length > 0) {
      return (
        <div className="h-full flex flex-col">
          <ApiEndpointViewer content={displayContent} metadata={metadata} />
          <div className="flex-1 border-t border-white/5">
            <CodeViewer
              content={displayContent}
              metadata={metadata}
              readOnly={!isEditing}
              onChange={isEditing ? setEditContent : undefined}
              onEditorReady={handleEditorReady}
            />
          </div>
        </div>
      );
    }

    // Step definitions — rendered inside CodeViewer's unified Outline panel
    if (metadata.metadata?.steps && metadata.metadata.steps.length > 0) {
      return (
        <CodeViewer
          content={displayContent}
          metadata={metadata}
          readOnly={!isEditing}
          onChange={isEditing ? setEditContent : undefined}
          onEditorReady={handleEditorReady}
          steps={metadata.metadata.steps}
          onStepClick={handleStepClick}
        />
      );
    }

    // Default: code viewer
    return (
      <CodeViewer
        content={displayContent}
        metadata={metadata}
        readOnly={!isEditing}
        onChange={isEditing ? setEditContent : undefined}
        onEditorReady={handleEditorReady}
      />
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* File toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <span className="text-xs text-gray-400 font-mono flex-1 truncate">{displayFile}</span>
        {isEditing && (
          <span className="text-[9px] font-medium text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
            {hasRealChanges ? 'MODIFIED' : 'EDITING'}
          </span>
        )}
        <span className="text-[10px] text-gray-500">{metadata.lines} lines</span>
        <span className="text-[10px] text-gray-500">{lang}</span>

        {/* Git buttons */}
        {gitAvailable && (
          <>
            <button
              onClick={() => setGitPanel(gitPanel === 'history' ? 'none' : 'history')}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 border transition-colors ${
                gitPanel === 'history'
                  ? 'bg-sky-600/20 text-sky-300 border-sky-500/30'
                  : 'bg-surface-2 hover:bg-surface-3 text-gray-400 border-white/5'
              }`}
              title="View git history for this file"
            >
              <History size={12} /> History
            </button>
            {hasGitChanges && (
              <button
                onClick={() => setGitPanel(gitPanel === 'changes' ? 'none' : 'changes')}
                className={`px-2 py-1 text-xs rounded flex items-center gap-1 border transition-colors ${
                  gitPanel === 'changes'
                    ? 'bg-amber-600/20 text-amber-300 border-amber-500/30'
                    : 'bg-surface-2 hover:bg-surface-3 text-amber-400 border-white/5'
                }`}
                title="View uncommitted changes for this file"
              >
                <GitPullRequestDraft size={12} /> Changes
              </button>
            )}
          </>
        )}

        {!isEditing ? (
          <button
            onClick={enterEditMode}
            className="px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5"
          >
            Edit
          </button>
        ) : (
          <>
            <button
              onClick={exitEditMode}
              className="px-2 py-1 text-xs rounded bg-surface-2 hover:bg-surface-3 text-gray-400 border border-white/5 flex items-center gap-1"
              title="Discard changes"
            >
              <X size={12} /> Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-2 py-1 text-xs rounded bg-brand-600 hover:bg-brand-500 text-white flex items-center gap-1 disabled:opacity-50"
            >
              <Save size={12} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}

        {metadata.type === 'test' && onRun && (
          <button
            onClick={() => onRun(displayFile)}
            className="px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1"
          >
            <Play size={12} /> Run
          </button>
        )}
      </div>

      {/* Git Panel (slides between toolbar and viewer) */}
      {gitPanel !== 'none' && (
        <div className="border-b border-white/5 bg-surface-1/80 max-h-[40vh] overflow-y-auto flex-shrink-0">
          {gitPanel === 'history' && (
            <FileHistoryPanel
              commits={fileHistoryData?.commits || []}
              isLoading={historyLoading}
              filePath={displayFile}
            />
          )}
          {gitPanel === 'changes' && (
            <FileChangesPanel
              files={fileDiffData?.files || []}
              isLoading={diffLoading}
            />
          )}
        </div>
      )}

      {/* Viewer */}
      <div className="flex-1 overflow-hidden">
        {renderViewer()}
      </div>

      {/* ── Unsaved Changes Dialog (file switch within explorer) ─── */}
      {pendingFilePath !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={handleStayOnFile} />
          <div className="relative bg-surface-1 rounded-xl border border-white/10 p-6 w-[420px] animate-fade-in">
            <button
              onClick={handleStayOnFile}
              className="absolute top-3 right-3 p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
              title="Stay on file"
            >
              <X size={16} />
            </button>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-100">Unsaved Changes</h3>
                <p className="text-sm text-gray-400 mt-1">
                  You have unsaved changes in the current file. What would you like to do?
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleDiscardAndSwitch}
                className="px-4 py-2 text-sm rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-300 transition-colors"
              >
                Discard Changes
              </button>
              <button
                onClick={handleSaveAndSwitch}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <Save size={14} /> {saving ? 'Saving...' : 'Save & Switch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Unsaved Changes Dialog (route navigation — sidebar, etc.) ─── */}
      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={handleBlockerStay} />
          <div className="relative bg-surface-1 rounded-xl border border-white/10 p-6 w-[420px] animate-fade-in">
            <button
              onClick={handleBlockerStay}
              className="absolute top-3 right-3 p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
              title="Stay on file"
            >
              <X size={16} />
            </button>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-100">Unsaved Changes</h3>
                <p className="text-sm text-gray-400 mt-1">
                  You have unsaved changes. If you leave this page, your changes will be lost.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleBlockerDiscard}
                className="px-4 py-2 text-sm rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-300 transition-colors"
              >
                Discard & Leave
              </button>
              <button
                onClick={handleBlockerSave}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                <Save size={14} /> {saving ? 'Saving...' : 'Save & Leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
