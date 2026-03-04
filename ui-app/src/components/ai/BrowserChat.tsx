import { useState, useEffect, useRef, useCallback } from 'react';
import { aiBrowserChat, getBrowserStatus, getBrowserScreenshot } from '../../api/client';
import {
  Globe, Send, Camera, Power, PowerOff, RefreshCw,
  Loader2, MonitorSmartphone, Layers,
  ChevronDown, X, Maximize2,
  Bot, User, Wrench, AlertCircle, CheckCircle2, XCircle, Shield,
  Pause, Play, MousePointerClick,
} from 'lucide-react';
import { AIMarkdown } from '../results/FailureAnalysis';
import type { WSMessage } from '../../api/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BrowserStatus {
  active: boolean;
  url?: string;
  title?: string;
  tabs?: Array<{ index: number; url: string; title: string; active: boolean }>;
  error?: string;
}

type TimelineEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'system'; id: string; text: string; screenshots?: string[] }
  | { kind: 'text'; id: string; text: string; done?: boolean }
  | { kind: 'tool'; id: string; phase: 'start' | 'complete' | 'error' | 'denied'; toolName: string; args: string; result?: string; error?: string }
  | { kind: 'screenshot'; id: string; data: string }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'loading'; id: string };

interface PendingPermission {
  permissionId: string;
  toolName: string;
  args: string;
}

interface BrowserChatProps {
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  send: (msg: object) => void;
  browserStatus: BrowserStatus;
  onBrowserStatusChange: (status: BrowserStatus) => void;
  /** Whether the live view panel is visible (controls status bar display) */
  hasLiveView?: boolean;
}

// ── BrowserChat Component ───────────────────────────────────────────────────

export function BrowserChat({ subscribe, send, browserStatus, onBrowserStatusChange, hasLiveView }: BrowserChatProps) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([{
    kind: 'system',
    id: 'welcome',
    text: 'Welcome to the Interactive Browser Session. Launch a browser to get started, then give me natural language instructions to interact with web pages.',
  }]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);

  const streamTextRef = useRef('');
  const streamTextIdRef = useRef<string | null>(null);
  const textSegmentCounter = useRef(0);

  const [statusLoading, setStatusLoading] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [expandedScreenshot, setExpandedScreenshot] = useState<string | null>(null);
  const [showLaunchOptions, setShowLaunchOptions] = useState(false);
  const [aiPaused, setAiPaused] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgCounter = useRef(0);

  // ── Fetch browser status ────────────────────────────────────────────────────

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await getBrowserStatus();
      onBrowserStatusChange(status);
    } catch {
      onBrowserStatusChange({ active: false });
    } finally {
      setStatusLoading(false);
    }
  }, [onBrowserStatusChange]);

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

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
    // Phase 3: Handle global AI status messages (no requestId filter needed)
    if (msg.type === 'ai-orchestrator-paused') {
      setAiPaused(true);
      return;
    }
    if (msg.type === 'ai-orchestrator-resumed') {
      setAiPaused(false);
      return;
    }

    // Browser closed notification (externally or via Close button)
    if (msg.type === 'browser-closed') {
      onBrowserStatusChange({ active: false });
      return;
    }

    // Browser launched notification
    if (msg.type === 'browser-launched') {
      onBrowserStatusChange({
        ...browserStatus,
        active: true,
        url: (msg.url as string) || browserStatus.url || '',
      });
      return;
    }

    // Tab switch notification — update browserStatus with new tabs/url/title
    if (msg.type === 'browser-tab-switched') {
      onBrowserStatusChange({
        active: true,
        url: (msg.url as string) || '',
        title: (msg.title as string) || '',
        tabs: (msg.tabs as Array<{ index: number; url: string; title: string; active: boolean }>) || [],
      });
      return;
    }

    // URL/title changed (screencast navigation detection)
    if (msg.type === 'screencast-url-changed') {
      onBrowserStatusChange({
        ...browserStatus,
        url: (msg.url as string) || browserStatus.url || '',
        title: (msg.title as string) || browserStatus.title || '',
      });
      return;
    }

    const msgRequestId = msg.requestId as string | undefined;
    if (!msgRequestId || !msgRequestId.startsWith('browser-')) return;

    removeLoading(msgRequestId);

    if (msg.type === 'ai-browser-screenshot') {
      const base64 = msg.data as string;
      setTimeline(prev => [...prev, { kind: 'screenshot', id: `ss-${Date.now()}-${Math.random()}`, data: base64 }]);
      return;
    }

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

    if (msg.type === 'ai-fix-tool') {
      const phase = msg.phase as string;
      const toolName = msg.toolName as string;
      const args = msg.args as string;

      if (phase === 'start') {
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
        setTimeline(prev => [...prev, { kind: 'tool', id: toolId, phase: 'start', toolName, args }]);
      } else {
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

      if (phase === 'complete' && ['browser_navigate', 'browser_click', 'browser_type', 'browser_launch', 'browser_close', 'browser_new_tab', 'browser_close_tab', 'browser_switch_tab'].includes(toolName)) {
        setTimeout(refreshStatus, 500);
      }
      return;
    }

    if (msg.type === 'ai-fix-permission') {
      setPendingPermission({
        permissionId: msg.permissionId as string,
        toolName: msg.toolName as string,
        args: msg.args as string,
      });
      return;
    }

    if (msg.type === 'ai-fix-done') {
      flushStreamText();
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
      setAiPaused(false);
      refreshStatus();
      return;
    }

    if (msg.type === 'ai-fix-error') {
      flushStreamText();
      streamTextRef.current = '';
      streamTextIdRef.current = null;
      setTimeline(prev => [...prev, { kind: 'error', id: `err-${Date.now()}`, text: msg.message as string }]);
      setIsStreaming(false);
      setCurrentRequestId(null);
      setPendingPermission(null);
      setAiPaused(false);
      return;
    }
  }, [refreshStatus, removeLoading, flushStreamText]);

  useEffect(() => subscribe(handleMessage), [subscribe, handleMessage]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [timeline, pendingPermission]);

  // ── Send message ─────────────────────────────────────────────────────────

  const sendMessage = async (text: string) => {
    if (!text.trim() || isStreaming) return;
    const requestId = `browser-${Date.now()}-${++msgCounter.current}`;

    streamTextRef.current = '';
    streamTextIdRef.current = null;
    textSegmentCounter.current = 0;

    setTimeline(prev => [
      ...prev,
      { kind: 'user', id: `user-${requestId}`, text },
      { kind: 'loading', id: `loading-${requestId}` },
    ]);

    setInput('');
    setIsStreaming(true);
    setCurrentRequestId(requestId);

    try {
      await aiBrowserChat({
        requestId,
        message: text,
        context: browserStatus.active ? {
          currentUrl: browserStatus.url,
          currentTitle: browserStatus.title,
          tabCount: browserStatus.tabs?.length || 0,
        } : undefined,
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

  const handleLaunch = (browser: string, headless: boolean) => {
    setShowLaunchOptions(false);
    sendMessage(`Launch a ${browser} browser${headless ? ' in headless mode' : ''} so I can give you instructions to interact with web pages.`);
  };

  const handleScreenshot = async () => {
    if (!browserStatus.active) return;
    try {
      const res = await getBrowserScreenshot();
      if (res.screenshot) {
        setTimeline(prev => [...prev, { kind: 'screenshot', id: `manual-ss-${Date.now()}`, data: res.screenshot }]);
      }
    } catch (err) {
      setTimeline(prev => [...prev, { kind: 'error', id: `ss-err-${Date.now()}`, text: `Failed to capture screenshot: ${err}` }]);
    }
  };

  const handleClose = () => sendMessage('Close the browser session.');

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Browser Status Bar — always visible */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-white/5 bg-surface-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${browserStatus.active ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-gray-600'}`} />
            <span className="text-xs font-medium text-gray-400">
              {browserStatus.active ? 'Browser Active' : 'No Session'}
            </span>
            {browserStatus.active && browserStatus.tabs && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-500/10 text-brand-400 border border-brand-500/20">
                {browserStatus.tabs.length} tab{browserStatus.tabs.length !== 1 ? 's' : ''}
              </span>
            )}
            <button onClick={refreshStatus} disabled={statusLoading}
              className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-400 transition-colors disabled:opacity-30">
              <RefreshCw size={11} className={statusLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {!browserStatus.active ? (
              <div className="relative">
                <button
                  onClick={() => setShowLaunchOptions(!showLaunchOptions)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
                >
                  <Power size={11} /> Launch
                  <ChevronDown size={10} />
                </button>
                {showLaunchOptions && (
                  <div className="absolute right-0 top-full mt-1 bg-surface-1 border border-white/10 rounded-lg z-50 py-1 w-48">
                    <button onClick={() => handleLaunch('chromium', false)}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 transition-colors">
                      <Globe size={11} className="inline mr-2 text-blue-400" /> Chromium
                    </button>
                    <button onClick={() => handleLaunch('firefox', false)}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 transition-colors">
                      <Globe size={11} className="inline mr-2 text-orange-400" /> Firefox
                    </button>
                    <button onClick={() => handleLaunch('webkit', false)}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 transition-colors">
                      <Globe size={11} className="inline mr-2 text-purple-400" /> WebKit
                    </button>
                    <div className="border-t border-white/5 my-1" />
                    <button onClick={() => handleLaunch('chromium', true)}
                      className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 transition-colors">
                      <MonitorSmartphone size={11} className="inline mr-2 text-gray-400" /> Chromium (Headless)
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button onClick={handleScreenshot} disabled={isStreaming}
                  title="Take browser screenshot"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-sky-400 bg-sky-500/10 border border-sky-500/20 hover:bg-sky-500/20 transition-colors disabled:opacity-30">
                  <Camera size={11} /> Screenshot
                </button>
                <button onClick={handleClose} disabled={isStreaming}
                  title="Close browser session"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-colors disabled:opacity-30">
                  <PowerOff size={11} /> Close
                </button>
              </>
            )}
          </div>
        </div>

        {/* URL bar + tabs list — only when there's no live view (live view has its own URL bar) */}
        {!hasLiveView && (
          <>
            {browserStatus.active && browserStatus.url && (
              <div className="mt-2 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/5">
                <Globe size={11} className="text-gray-500 flex-shrink-0" />
                <span className="text-[11px] text-gray-400 truncate flex-1" title={browserStatus.url}>
                  {browserStatus.url}
                </span>
                {browserStatus.title && (
                  <span className="text-[10px] text-gray-600 truncate max-w-[200px]" title={browserStatus.title}>
                    {browserStatus.title}
                  </span>
                )}
              </div>
            )}

            {browserStatus.active && browserStatus.tabs && browserStatus.tabs.length > 1 && (
              <div className="mt-1.5 flex items-center gap-1 overflow-x-auto">
                <Layers size={10} className="text-gray-600 flex-shrink-0" />
                {browserStatus.tabs.map((tab) => (
                  <div
                    key={tab.index}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] flex-shrink-0 ${
                      tab.active
                        ? 'bg-brand-500/15 text-brand-300 border border-brand-500/20'
                        : 'text-gray-500 bg-black/10 border border-white/5'
                    }`}
                    title={tab.url}
                  >
                    <span className="truncate max-w-[100px]">{tab.title || `Tab ${tab.index + 1}`}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {timeline.map((entry) => (
          <TimelineItem key={entry.id} entry={entry} onExpandScreenshot={setExpandedScreenshot} />
        ))}

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

      {/* Input */}
      <div className="p-4 border-t border-white/5 bg-surface-1 flex-shrink-0">
        <div className="flex gap-2.5 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={browserStatus.active
              ? 'Tell me what to do... (e.g., "go to google.com", "click the search box")'
              : 'Launch a browser first, or type an instruction...'
            }
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
        <div className="flex gap-2 mt-2 flex-wrap">
          {/* Phase 3: Pause/Resume buttons when AI is streaming */}
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
          {browserStatus.active && !isStreaming && (
            <>
              <QuickChip label="Take screenshot" onClick={() => sendMessage('Take a screenshot of the current page.')} disabled={isStreaming} />
              <QuickChip label="Get page text" onClick={() => sendMessage('Get the text content of the current page.')} disabled={isStreaming} />
              <QuickChip label="Inspect page" onClick={() => sendMessage('Inspect the page and list all interactive elements.')} disabled={isStreaming} />
              <QuickChip label="List tabs" onClick={() => sendMessage('List all open browser tabs.')} disabled={isStreaming} />
            </>
          )}
        </div>
      </div>

      {/* Expanded screenshot overlay */}
      {expandedScreenshot && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8" onClick={() => setExpandedScreenshot(null)}>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <button onClick={() => setExpandedScreenshot(null)}
              className="absolute -top-3 -right-3 bg-surface-2 border border-white/10 rounded-full p-1.5 hover:bg-surface-1 transition-colors z-10">
              <X size={14} className="text-gray-400" />
            </button>
            <img src={`data:image/png;base64,${expandedScreenshot}`} alt="Browser screenshot"
              className="rounded-lg border border-white/10 max-w-full max-h-[85vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── TimelineItem ──────────────────────────────────────────────────────────────

function TimelineItem({ entry, onExpandScreenshot }: {
  entry: TimelineEntry;
  onExpandScreenshot: (base64: string) => void;
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
          {entry.screenshots && entry.screenshots.length > 0 && (
            <div className="mt-2 space-y-2">
              {entry.screenshots.map((ss, i) => (
                <ScreenshotImage key={i} data={ss} onExpand={onExpandScreenshot} />
              ))}
            </div>
          )}
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

  if (entry.kind === 'screenshot') {
    return (
      <div className="ml-8 my-1">
        <ScreenshotImage data={entry.data} onExpand={onExpandScreenshot} />
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

function ScreenshotImage({ data, onExpand }: { data: string; onExpand: (base64: string) => void }) {
  return (
    <div className="relative group inline-block">
      <img
        src={`data:image/png;base64,${data}`}
        alt="Browser screenshot"
        className="rounded-lg border border-white/10 max-w-full max-h-[250px] object-contain cursor-pointer hover:border-brand-500/30 transition-colors"
        onClick={() => onExpand(data)}
      />
      <button
        onClick={() => onExpand(data)}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-black/60 rounded-lg p-1.5 transition-opacity"
      >
        <Maximize2 size={12} className="text-white" />
      </button>
    </div>
  );
}

function QuickChip({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-2 py-0.5 rounded-full text-[10px] text-gray-500 bg-surface-2 border border-white/5 hover:text-gray-300 hover:border-white/10 transition-colors disabled:opacity-30"
    >
      {label}
    </button>
  );
}
