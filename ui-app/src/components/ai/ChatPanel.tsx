import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  aiChatStream, aiChatReset, uploadFiles,
  getChatSessions, getChatSession, createChatSession,
  addChatMessage, deleteChatSession, renameChatSession,
} from '../../api/client';
import type { ChatSessionSummary } from '../../api/client';
import {
  Send, Bot, User, Loader2, AlertCircle,
  CheckCircle2, XCircle, Shield, Maximize2, X,
  FileText, FilePlus, FileMinus, Paperclip, Trash2,
  Sparkles, Upload, Image, FileSpreadsheet, File,
  History, Plus, MessageSquare, ChevronLeft, ChevronRight,
  Pencil, Check,
} from 'lucide-react';
import { AIMarkdown } from '../results/FailureAnalysis';
import type { WSMessage } from '../../api/types';
import { LiveBrowserWrapper } from './LiveBrowserWrapper';

// ── Types ────────────────────────────────────────────────────────────────────

type TimelineEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'system'; id: string; text: string }
  | { kind: 'text'; id: string; text: string; done?: boolean }
  | { kind: 'tool'; id: string; phase: 'start' | 'complete' | 'error' | 'denied'; toolName: string; args: string; result?: string; error?: string }
  | { kind: 'diff'; id: string; filePath: string; diffType: 'new' | 'modified'; diff: string; linesAdded: number; linesRemoved: number }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'loading'; id: string };

interface PendingPermission {
  permissionId: string;
  toolName: string;
  args: string;
}

interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

interface UploadedFile {
  id: string;
  originalName: string;
  type: string;
  mimeType: string;
  size: number;
  isImage: boolean;
  preview: string;
}

// ── ChatPanel Component ─────────────────────────────────────────────────────

export function ChatPanel() {
  const { subscribe, send } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    send: (msg: object) => void;
  }>();

  // ── Session state ──────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  // Timeline: flat list of independently-rendered entries
  const [timeline, setTimeline] = useState<TimelineEntry[]>([{
    kind: 'system',
    id: 'welcome',
    text: 'Hi! I\'m your AI assistant with full access to your project. I can read/write files, run commands, launch browsers, and help with test automation. Upload files (PDF, Word, Excel, images, code) or ask me anything!',
  }]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  // Conversation history for LLM context
  const chatHistory = useRef<ChatHistoryEntry[]>([]);

  // Uploaded files
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stream text accumulation
  const streamTextRef = useRef('');
  const streamTextIdRef = useRef<string | null>(null);
  const textSegmentCounter = useRef(0);

  // Permission
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);

  // Diff viewer
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgCounter = useRef(0);
  const activeSessionRef = useRef<string | null>(null);

  // Keep ref in sync for use inside callbacks
  activeSessionRef.current = activeSessionId;

  // ── Load sessions on mount ─────────────────────────────────────────────────
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const result = await getChatSessions();
      setSessions(result.sessions);
    } catch { /* ignore */ }
  };

  // ── Session management ─────────────────────────────────────────────────────

  const startNewChat = async () => {
    if (isStreaming) return;
    const sessionId = `session-${Date.now()}`;
    try {
      await createChatSession(sessionId, 'New Chat');
    } catch { /* ignore — we'll still work locally */ }

    // Reset orchestrator conversation context so LLM starts fresh
    aiChatReset().catch(() => {});

    setActiveSessionId(sessionId);
    chatHistory.current = [];
    setUploadedFiles([]);
    setTimeline([{
      kind: 'system',
      id: 'welcome-' + Date.now(),
      text: 'New chat started. How can I help you?',
    }]);
    loadSessions();
  };

  const loadSession = async (sessionId: string) => {
    if (isStreaming) return;
    try {
      const session = await getChatSession(sessionId);

      // Reset orchestrator so LLM doesn't carry over previous chat context
      await aiChatReset().catch(() => {});

      setActiveSessionId(sessionId);

      // Rebuild timeline and chatHistory from stored messages
      const newTimeline: TimelineEntry[] = [{
        kind: 'system',
        id: 'session-start',
        text: `Continuing chat: ${session.title}`,
      }];

      const newChatHistory: ChatHistoryEntry[] = [];

      for (const msg of session.messages) {
        const entryId = `restored-${Date.now()}-${Math.random()}`;
        if (msg.role === 'user') {
          newTimeline.push({ kind: 'user', id: entryId, text: msg.content });
        } else {
          newTimeline.push({ kind: 'text', id: entryId, text: msg.content, done: true });
        }
        newChatHistory.push({ role: msg.role, content: msg.content });
      }

      chatHistory.current = newChatHistory;
      setTimeline(newTimeline);
      setUploadedFiles([]);
      setSidebarOpen(false);
    } catch (err) {
      setTimeline(prev => [...prev, {
        kind: 'error',
        id: `err-${Date.now()}`,
        text: `Failed to load session: ${err}`,
      }]);
    }
  };

  const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteChatSession(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        startNewChat();
      }
    } catch { /* ignore */ }
  };

  const handleStartRename = (sessionId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(sessionId);
    setEditTitle(currentTitle);
  };

  const handleConfirmRename = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editingSessionId || !editTitle.trim()) {
      setEditingSessionId(null);
      return;
    }
    try {
      await renameChatSession(editingSessionId, editTitle.trim());
      setSessions(prev => prev.map(s =>
        s.id === editingSessionId ? { ...s, title: editTitle.trim() } : s,
      ));
    } catch { /* ignore */ }
    setEditingSessionId(null);
  };

  // ── Helpers for timeline manipulation ───────────────────────────────────────

  const removeLoading = useCallback((reqId: string) => {
    setTimeline(prev => prev.filter(e => !(e.kind === 'loading' && e.id === `loading-${reqId}`)));
  }, []);

  const flushStreamText = useCallback(() => {
    const textId = streamTextIdRef.current;
    const text = streamTextRef.current;
    if (!textId) return;
    setTimeline(prev => {
      const idx = prev.findIndex(e => e.id === textId);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx]!, kind: 'text', text } as TimelineEntry;
        return updated;
      }
      return prev;
    });
  }, []);

  // ── WebSocket message handler ─────────────────────────────────────────────

  const handleMessage = useCallback((msg: WSMessage) => {
    const msgRequestId = msg.requestId as string | undefined;
    if (!msgRequestId || !msgRequestId.startsWith('chat-')) return;

    // Remove loading indicator once we get first content
    removeLoading(msgRequestId);

    // Stream content
    if (msg.type === 'ai-fix-stream') {
      const chunk = msg.content as string;

      if (!streamTextIdRef.current) {
        const segId = `text-${msgRequestId}-${++textSegmentCounter.current}`;
        streamTextRef.current = '';
        streamTextIdRef.current = segId;
        setTimeline(prev => [...prev, { kind: 'text', id: segId, text: '' }]);
      }

      streamTextRef.current += chunk;
      flushStreamText();
      return;
    }

    // Tool events
    if (msg.type === 'ai-fix-tool') {
      const phase = msg.phase as string;
      const toolName = msg.toolName as string;
      const args = msg.args as string;

      if (phase === 'start') {
        // Finalize streaming text before tool
        if (streamTextIdRef.current) {
          if (streamTextRef.current) flushStreamText();
          const doneId = streamTextIdRef.current;
          setTimeline(prev => {
            const idx = prev.findIndex(e => e.id === doneId);
            if (idx >= 0) {
              const updated = [...prev];
              const entry = updated[idx]!;
              if (entry.kind === 'text') updated[idx] = { ...entry, done: true };
              return updated;
            }
            return prev;
          });
          streamTextRef.current = '';
          streamTextIdRef.current = null;
        }

        const toolId = `tool-${toolName}-${Date.now()}-${Math.random()}`;
        setTimeline(prev => [...prev, {
          kind: 'tool', id: toolId, phase: 'start', toolName, args,
        }]);
      } else {
        // Update existing tool entry
        setTimeline(prev => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            const e = updated[i]!;
            if (e.kind === 'tool' && e.toolName === toolName && e.phase === 'start') {
              updated[i] = { ...e, phase: phase as 'complete' | 'error' | 'denied', result: msg.result as string, error: msg.error as string };
              break;
            }
          }
          return updated;
        });
      }
      return;
    }

    // File diffs
    if (msg.type === 'ai-fix-file-diff') {
      setTimeline(prev => [...prev, {
        kind: 'diff',
        id: `diff-${Date.now()}-${Math.random()}`,
        filePath: msg.filePath as string,
        diffType: msg.diffType as 'new' | 'modified',
        diff: msg.diff as string,
        linesAdded: msg.linesAdded as number,
        linesRemoved: msg.linesRemoved as number,
      }]);
      return;
    }

    // Permission request
    if (msg.type === 'ai-fix-permission') {
      setPendingPermission({
        permissionId: msg.permissionId as string,
        toolName: msg.toolName as string,
        args: msg.args as string,
      });
      return;
    }

    // Done
    if (msg.type === 'ai-fix-done') {
      flushStreamText();
      // Capture assistant response for history
      const assistantText = streamTextRef.current || '';
      if (assistantText) {
        chatHistory.current.push({ role: 'assistant', content: assistantText });
        // Persist to backend
        const sid = activeSessionRef.current;
        if (sid) {
          addChatMessage(sid, 'assistant', assistantText).catch(() => {});
          loadSessions();
        }
      }
      if (streamTextIdRef.current) {
        setTimeline(prev => {
          const idx = prev.findIndex(e => e.id === streamTextIdRef.current);
          if (idx >= 0) {
            const updated = [...prev];
            const entry = updated[idx]!;
            if (entry.kind === 'text') updated[idx] = { ...entry, done: true };
            return updated;
          }
          return prev;
        });
        streamTextRef.current = '';
        streamTextIdRef.current = null;
      }
      setIsStreaming(false);
      setCurrentRequestId(null);
      setPendingPermission(null);
      return;
    }

    // Error
    if (msg.type === 'ai-fix-error') {
      flushStreamText();
      streamTextRef.current = '';
      streamTextIdRef.current = null;
      setTimeline(prev => [...prev, { kind: 'error', id: `err-${Date.now()}`, text: msg.message as string }]);
      setIsStreaming(false);
      setCurrentRequestId(null);
      setPendingPermission(null);
      return;
    }
  }, [removeLoading, flushStreamText]);

  useEffect(() => subscribe(handleMessage), [subscribe, handleMessage]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [timeline, pendingPermission]);

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;
    const requestId = `chat-${Date.now()}-${++msgCounter.current}`;

    // Reset stream accumulators
    streamTextRef.current = '';
    streamTextIdRef.current = null;
    textSegmentCounter.current = 0;

    // Auto-create session if none active
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = `session-${Date.now()}`;
      try {
        await createChatSession(sessionId, 'New Chat');
      } catch { /* ignore */ }
      setActiveSessionId(sessionId);
    }

    // Build display text with file indicators
    const fileNames = uploadedFiles.map(f => f.originalName);
    const displayText = fileNames.length > 0
      ? `${text}\n📎 ${fileNames.join(', ')}`
      : text;

    // Add to conversation history
    chatHistory.current.push({ role: 'user', content: text });

    // Persist user message to backend
    addChatMessage(sessionId, 'user', text).catch(() => {});
    loadSessions();

    // Add user message + loading to timeline
    setTimeline(prev => [
      ...prev,
      { kind: 'user', id: `user-${requestId}`, text: displayText },
      { kind: 'loading', id: `loading-${requestId}` },
    ]);

    setInput('');
    setIsStreaming(true);
    setCurrentRequestId(requestId);

    // Gather uploaded file IDs and clear
    const currentFileIds = uploadedFiles.map(f => f.id);
    setUploadedFiles([]);

    try {
      // Send last 20 messages as history to keep context manageable
      const recentHistory = chatHistory.current.slice(-20);
      // Remove the current message from history (it's in the message field)
      const historyForApi = recentHistory.slice(0, -1);

      await aiChatStream({
        requestId,
        message: text,
        history: historyForApi.length > 0 ? historyForApi : undefined,
        uploadedFileIds: currentFileIds.length > 0 ? currentFileIds : undefined,
      });
    } catch (err) {
      removeLoading(requestId);
      setTimeline(prev => [...prev, { kind: 'error', id: `err-${Date.now()}`, text: `Failed to send: ${err}` }]);
      setIsStreaming(false);
      setCurrentRequestId(null);
    }
  };

  const handleSend = () => sendMessage(input.trim());

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── File upload handling ────────────────────────────────────────────────

  const handleFileUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setIsUploading(true);
    try {
      const result = await uploadFiles(fileArray);
      setUploadedFiles(prev => [...prev, ...result.files]);
    } catch (err) {
      setTimeline(prev => [...prev, {
        kind: 'error',
        id: `upload-err-${Date.now()}`,
        text: `Upload failed: ${err}`,
      }]);
    } finally {
      setIsUploading(false);
    }
  };

  const removeUploadedFile = (id: string) => {
    setUploadedFiles(prev => prev.filter(f => f.id !== id));
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  // ── Clear chat ─────────────────────────────────────────────────────────

  const clearChat = () => {
    if (isStreaming) return;

    // Reset orchestrator so LLM starts completely fresh
    aiChatReset().catch(() => {});

    chatHistory.current = [];
    setUploadedFiles([]);
    setActiveSessionId(null);
    setTimeline([{
      kind: 'system',
      id: 'welcome-' + Date.now(),
      text: 'Chat cleared. How can I help you?',
    }]);
  };

  // ── Permission handling ──────────────────────────────────────────────────

  const handlePermission = (granted: boolean) => {
    if (!pendingPermission) return;
    send({
      type: 'ai-fix-permission-response',
      permissionId: pendingPermission.permissionId,
      granted,
      remember: false,
    });
    setPendingPermission(null);
  };

  // ── Helpers ─────────────────────────────────────────────────────────────

  const formatTimeAgo = (dateStr: string) => {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <LiveBrowserWrapper>
    <div className="flex h-full">
      {/* History Sidebar */}
      <div className={`flex-shrink-0 border-r border-white/5 bg-surface-1 transition-all duration-200 flex flex-col ${sidebarOpen ? 'w-64' : 'w-0'} overflow-hidden`}>
        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <History size={12} className="text-gray-400" />
            <span className="text-xs font-medium text-gray-400">Chat History</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            <ChevronLeft size={12} />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-2 py-2 flex-shrink-0">
          <button
            onClick={startNewChat}
            disabled={isStreaming}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-brand-300 bg-brand-500/10 border border-brand-500/20 hover:bg-brand-500/20 transition-colors disabled:opacity-30"
          >
            <Plus size={12} /> New Chat
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto pb-2">
          {sessions.length === 0 && (
            <div className="text-center py-8 text-xs text-gray-600">
              No chat history yet
            </div>
          )}
          {sessions.map((session, idx) => (
            <div
              key={session.id}
              onClick={() => loadSession(session.id)}
              className={`group flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer transition-colors border-b border-white/5 ${
                activeSessionId === session.id
                  ? 'bg-brand-500/10 border-l-2 border-l-brand-400'
                  : 'hover:bg-white/5 border-l-2 border-l-transparent'
              }`}
            >
              <MessageSquare size={14} className={`flex-shrink-0 ${activeSessionId === session.id ? 'text-brand-400' : 'text-gray-600'}`} />
              <div className="flex-1 min-w-0">
                {editingSessionId === session.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => { if (e.key === 'Enter') handleConfirmRename(e as any); if (e.key === 'Escape') setEditingSessionId(null); }}
                      className="flex-1 bg-surface-2 border border-white/10 rounded px-2 py-0.5 text-xs text-gray-200 outline-none focus:border-brand-500/50 min-w-0"
                      autoFocus
                    />
                    <button onClick={handleConfirmRename} className="p-0.5 text-emerald-400 hover:text-emerald-300">
                      <Check size={12} />
                    </button>
                  </div>
                ) : (
                  <div className={`text-xs truncate leading-snug ${activeSessionId === session.id ? 'text-gray-200 font-medium' : 'text-gray-400'}`}>
                    {session.title}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-gray-600">{session.messageCount} msgs</span>
                  <span className="text-[10px] text-gray-600">·</span>
                  <span className="text-[10px] text-gray-600">{formatTimeAgo(session.updatedAt)}</span>
                </div>
              </div>
              {/* Actions (visible on hover) */}
              {editingSessionId !== session.id && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={(e) => handleStartRename(session.id, session.title, e)}
                    className="p-1 rounded text-gray-600 hover:text-sky-400 hover:bg-sky-500/10"
                    title="Rename"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(e) => handleDeleteSession(session.id, e)}
                    className="p-1 rounded text-gray-600 hover:text-red-400 hover:bg-red-500/10"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header bar */}
        <div className="flex-shrink-0 px-5 py-3 border-b border-white/5 bg-surface-1 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors mr-1"
                title="Chat history"
              >
                <History size={15} />
              </button>
            )}
            <Sparkles size={15} className="text-brand-400" />
            <span className="text-sm font-medium text-gray-400">Project Assistant</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              All Tools
            </span>
            {activeSessionId && (
              <span className="text-xs text-gray-600 truncate max-w-[200px]">
                {sessions.find(s => s.id === activeSessionId)?.title || ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={startNewChat}
              disabled={isStreaming}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:text-sky-400 hover:bg-sky-500/10 transition-colors disabled:opacity-30"
              title="New chat"
            >
              <Plus size={13} /> New
            </button>
            <button
              onClick={clearChat}
              disabled={isStreaming}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
              title="Clear chat"
            >
              <Trash2 size={13} /> Clear
            </button>
          </div>
        </div>

        {/* Timeline */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
          {timeline.map((entry) => (
            <TimelineItem key={entry.id} entry={entry} onExpandDiff={setExpandedDiff} />
          ))}

          {/* Permission prompt */}
          {pendingPermission && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mx-1">
              <div className="flex items-center gap-2 mb-2">
                <Shield size={13} className="text-amber-400" />
                <span className="text-xs font-semibold text-amber-300">Permission Required</span>
              </div>
              <div className="text-xs text-gray-300 mb-1">
                <span className="font-mono text-amber-400">{pendingPermission.toolName}</span>
              </div>
              {pendingPermission.args && (
                <div className="text-[11px] text-gray-500 font-mono bg-black/20 rounded px-2 py-1 mb-2 truncate">
                  {pendingPermission.args}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => handlePermission(true)}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors">
                  <CheckCircle2 size={11} /> Allow
                </button>
                <button onClick={() => handlePermission(false)}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors">
                  <XCircle size={11} /> Deny
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Uploaded file chips */}
        {uploadedFiles.length > 0 && (
          <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 flex-wrap border-t border-white/5 bg-surface-1">
            {uploadedFiles.map(f => (
              <div key={f.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-brand-500/10 border border-brand-500/20 text-[10px] text-brand-300">
                <FileTypeIcon type={f.type} isImage={f.isImage} />
                <span className="truncate max-w-[120px]" title={f.originalName}>{f.originalName}</span>
                <span className="text-gray-600">({formatFileSize(f.size)})</span>
                <button onClick={() => removeUploadedFile(f.id)} className="text-gray-500 hover:text-red-400 transition-colors ml-0.5">
                  <X size={9} />
                </button>
              </div>
            ))}
            {isUploading && (
              <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-400">
                <Loader2 size={10} className="animate-spin" /> Uploading...
              </div>
            )}
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.html,.md,.xml,.json,.js,.ts,.jsx,.tsx,.py,.java,.rb,.go,.feature,.yaml,.yml,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp"
          onChange={(e) => { if (e.target.files) handleFileUpload(e.target.files); e.target.value = ''; }}
        />

        {/* Input area with drag-drop */}
        <div
          className={`p-4 border-t bg-surface-1 flex-shrink-0 transition-colors ${isDragOver ? 'border-brand-500/50 bg-brand-500/5' : 'border-white/5'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragOver && (
            <div className="flex items-center justify-center gap-2 py-3 mb-2 rounded-xl border-2 border-dashed border-brand-500/40 bg-brand-500/5">
              <Upload size={16} className="text-brand-400" />
              <span className="text-sm text-brand-300 font-medium">Drop files here to upload</span>
            </div>
          )}

          <div className="flex gap-2.5 items-end">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming || isUploading}
              className="p-2.5 rounded-xl text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-30 flex-shrink-0"
              title="Upload files (PDF, Word, Excel, images, code)"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask me anything... Drop files here or click 📎 to upload"
              rows={1}
              disabled={isStreaming}
              className="flex-1 bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 resize-none max-h-24 disabled:opacity-40"
              style={{ minHeight: '40px' }}
            />
            <button
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              className="p-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-30 transition-colors flex-shrink-0"
            >
              {isStreaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>

          {/* Quick action chips */}
          <div className="flex gap-2 mt-2 flex-wrap">
            <QuickChip label="Explain project structure" onClick={() => sendMessage('Explain the project structure — what frameworks, patterns, and directories are used?')} disabled={isStreaming} />
            <QuickChip label="Find flaky tests" onClick={() => sendMessage('Search the project for potential flaky tests — look for hardcoded waits, race conditions, and non-deterministic patterns.')} disabled={isStreaming} />
            <QuickChip label="Test coverage gaps" onClick={() => sendMessage('Analyze the project and identify areas that lack test coverage or have weak assertions.')} disabled={isStreaming} />
            <QuickChip label="Suggest improvements" onClick={() => sendMessage('Review the test automation project and suggest the top 5 improvements for reliability and maintainability.')} disabled={isStreaming} />
          </div>
        </div>

        {/* Expanded diff overlay */}
        {expandedDiff && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8" onClick={() => setExpandedDiff(null)}>
            <div className="relative max-w-[90vw] max-h-[90vh] w-full bg-surface-1 rounded-xl border border-white/10 overflow-hidden" onClick={e => e.stopPropagation()}>
              <button onClick={() => setExpandedDiff(null)}
                className="absolute top-3 right-3 bg-surface-1 border border-white/10 rounded-full p-1.5 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400 transition-colors z-10">
                <X size={14} className="text-gray-400" />
              </button>
              <pre className="p-4 text-xs font-mono text-gray-300 overflow-auto max-h-[85vh] whitespace-pre-wrap">
                {expandedDiff}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
    </LiveBrowserWrapper>
  );
}

// ── TimelineItem ─────────────────────────────────────────────────────────────

function TimelineItem({ entry, onExpandDiff }: {
  entry: TimelineEntry;
  onExpandDiff: (diff: string) => void;
}) {
  if (entry.kind === 'user') {
    return (
      <div className="flex gap-2.5 justify-end">
        <div className="max-w-[80%] rounded-xl px-3 py-2 bg-brand-600 text-white text-[13px]">
          {entry.text}
        </div>
        <div className="w-6 h-6 rounded-lg bg-surface-2 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User size={12} className="text-gray-400" />
        </div>
      </div>
    );
  }

  if (entry.kind === 'system') {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="w-6 h-6 rounded-lg bg-gray-700/50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <AlertCircle size={12} className="text-gray-400" />
        </div>
        <div className="bg-surface-2/50 chat-ai-bubble text-gray-400 border border-white/5 rounded-xl px-3 py-2 text-[13px]">
          {entry.text}
        </div>
      </div>
    );
  }

  if (entry.kind === 'text') {
    const trimmedText = entry.text.trimEnd();
    if (!trimmedText) return null;
    return (
      <div className="flex gap-2.5 items-start">
        <div className="w-6 h-6 rounded-lg bg-brand-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot size={12} className="text-brand-400" />
        </div>
        <div className="bg-surface-2 chat-ai-bubble text-gray-200 border border-white/5 rounded-xl px-3 py-2 flex-1 min-w-0 max-w-[85%] overflow-hidden">
          <AIMarkdown text={trimmedText} />
        </div>
      </div>
    );
  }

  if (entry.kind === 'tool') {
    return (
      <div className="flex items-center gap-2 ml-8 py-0.5">
        {entry.phase === 'start' && <Loader2 size={11} className="text-blue-400 animate-spin flex-shrink-0" />}
        {entry.phase === 'complete' && <CheckCircle2 size={11} className="text-emerald-400 flex-shrink-0" />}
        {entry.phase === 'error' && <XCircle size={11} className="text-red-400 flex-shrink-0" />}
        {entry.phase === 'denied' && <Shield size={11} className="text-amber-400 flex-shrink-0" />}
        <span className="text-[11px] font-mono text-gray-500">{entry.toolName}</span>
        {entry.args && (
          <span className="text-[10px] text-gray-600 truncate max-w-[300px]">{entry.args}</span>
        )}
        {entry.phase === 'error' && entry.error && (
          <span className="text-[10px] text-red-400 truncate max-w-[200px]">{entry.error}</span>
        )}
      </div>
    );
  }

  if (entry.kind === 'diff') {
    return (
      <div className="ml-8 my-1">
        <div
          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-2 chat-ai-bubble border border-white/5 cursor-pointer hover:border-brand-500/30 transition-colors"
          onClick={() => onExpandDiff(entry.diff)}
        >
          {entry.diffType === 'new' ? (
            <FilePlus size={12} className="text-emerald-400" />
          ) : (
            <FileMinus size={12} className="text-amber-400" />
          )}
          <span className="text-[11px] font-mono text-gray-300">{entry.filePath}</span>
          <span className="text-[10px] text-emerald-400">+{entry.linesAdded}</span>
          {entry.linesRemoved > 0 && (
            <span className="text-[10px] text-red-400">-{entry.linesRemoved}</span>
          )}
          <Maximize2 size={9} className="text-gray-600" />
        </div>
      </div>
    );
  }

  if (entry.kind === 'error') {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <XCircle size={12} className="text-red-400" />
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 text-[13px] text-red-300">
          {entry.text}
        </div>
      </div>
    );
  }

  if (entry.kind === 'loading') {
    return (
      <div className="flex gap-2.5 items-start">
        <div className="w-6 h-6 rounded-lg bg-brand-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot size={12} className="text-brand-400" />
        </div>
        <div className="bg-surface-2 chat-ai-bubble rounded-xl px-3 py-2 border border-white/5">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── QuickChip ─────────────────────────────────────────────────────────────────

function QuickChip({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-0.5 rounded-full text-[10px] text-gray-500 bg-surface-2 border border-white/5 hover:text-brand-300 hover:border-brand-500/20 hover:bg-brand-500/5 transition-colors disabled:opacity-30"
    >
      {label}
    </button>
  );
}

// ── FileTypeIcon ──────────────────────────────────────────────────────────────

function FileTypeIcon({ type, isImage }: { type: string; isImage: boolean }) {
  if (isImage) return <Image size={10} className="text-purple-400" />;
  if (type === 'pdf') return <FileText size={10} className="text-red-400" />;
  if (type === 'word') return <FileText size={10} className="text-blue-400" />;
  if (type === 'excel' || type === 'csv') return <FileSpreadsheet size={10} className="text-emerald-400" />;
  if (type === 'code') return <FileText size={10} className="text-amber-400" />;
  return <File size={10} className="text-gray-400" />;
}

// ── Format file size ──────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
