import { useState, useEffect, useRef, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import { X, Maximize2, Minimize2, GripHorizontal, MonitorX } from 'lucide-react';
import type { WSMessage } from '../../api/types';
import { LiveBrowserView } from './LiveBrowserView';
import type { BrowserStatus } from './BrowserChat';
import { getBrowserStatus, closeBrowserSession } from '../../api/client';

// ── LiveBrowserWrapper — Adds split-panel Live Browser View to any tab ───────
//
// Wraps any child content with browser-aware split panel + PiP support.
// When a browser session is active, the panel splits to show LiveBrowserView
// on the right side. When no browser is active, children fill the full width.

interface LiveBrowserWrapperProps {
  children: React.ReactNode;
}

export function LiveBrowserWrapper({ children }: LiveBrowserWrapperProps) {
  const { subscribe, send } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
    send: (msg: object) => void;
  }>();

  const [browserStatus, setBrowserStatus] = useState<BrowserStatus>({ active: false });
  const [splitPercent, setSplitPercent] = useState(50);
  const [isPiP, setIsPiP] = useState(false);
  const [pipSize, setPipSize] = useState({ w: 480, h: 360 });
  const [pipPos, setPipPos] = useState({ x: -1, y: -1 }); // -1 = auto (bottom-right)
  const [closedNotification, setClosedNotification] = useState(false);

  const isResizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const closedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Check browser status on mount ──────────────────────────────────────────

  useEffect(() => {
    getBrowserStatus()
      .then((status) => {
        if (status.active) {
          setBrowserStatus({
            active: true,
            url: status.url || '',
            title: status.title || '',
            tabs: status.tabs || [],
          });
        }
      })
      .catch(() => {});
  }, []);

  // ── Helper: fetch full browser status (tabs, URL, title) from API ────────

  const refreshFullStatus = useCallback((delay = 0) => {
    const doFetch = () => {
      getBrowserStatus()
        .then((status) => {
          if (status.active) {
            setBrowserStatus({
              active: true,
              url: status.url || '',
              title: status.title || '',
              tabs: status.tabs || [],
            });
          }
        })
        .catch(() => {});
    };
    if (delay > 0) {
      setTimeout(doFetch, delay);
    } else {
      doFetch();
    }
  }, []);

  // ── Listen for browser status changes via WebSocket ────────────────────────

  useEffect(() => {
    const unsub = subscribe((msg: WSMessage) => {
      if (msg.type === 'browser-launched') {
        // Show immediately, then fetch full status (tabs, URL) from API
        setBrowserStatus(prev => ({
          ...prev,
          active: true,
          url: (msg.url as string) || prev.url || '',
        }));
        refreshFullStatus(300);
        return;
      }

      if (msg.type === 'browser-closed') {
        setBrowserStatus({ active: false });
        // Show notification that browser session was closed
        setClosedNotification(true);
        if (closedTimerRef.current) clearTimeout(closedTimerRef.current);
        closedTimerRef.current = setTimeout(() => setClosedNotification(false), 4000);
        return;
      }

      if (msg.type === 'browser-tab-switched') {
        setBrowserStatus(prev => ({
          ...prev,
          active: true,
          url: (msg.url as string) || prev.url || '',
          title: (msg.title as string) || prev.title || '',
          tabs: (msg.tabs as BrowserStatus['tabs']) || prev.tabs || [],
        }));
        return;
      }

      // URL/title changed (screencast navigation detection)
      if (msg.type === 'screencast-url-changed') {
        setBrowserStatus(prev => ({
          ...prev,
          url: (msg.url as string) || prev.url || '',
          title: (msg.title as string) || prev.title || '',
        }));
        return;
      }

      // Also listen for browser action messages that include URL updates
      if (msg.type === 'ai-fix-browser-action') {
        setBrowserStatus(prev => ({
          ...prev,
          active: true,
          url: (msg.url as string) || prev.url || '',
          title: (msg.title as string) || prev.title || '',
        }));
        return;
      }

      // Listen for screenshots that carry URL info (covers navigate, click, etc.)
      if (msg.type === 'ai-fix-screenshot') {
        if (msg.url) {
          setBrowserStatus(prev => ({
            ...prev,
            url: (msg.url as string) || prev.url || '',
            title: (msg.title as string) || prev.title || '',
          }));
        }
        return;
      }

      // Detect recorder starting (which launches a browser)
      if (msg.type === 'recorder-status' && msg.status === 'recording') {
        setBrowserStatus(prev => ({
          ...prev,
          active: true,
          url: (msg.url as string) || prev.url || '',
        }));
        // Fetch full status with tabs after a short delay for browser to be ready
        refreshFullStatus(500);
        return;
      }

      // Detect recorder reset/stop that might close browser
      if (msg.type === 'recorder-status' && msg.status === 'reset') {
        refreshFullStatus(200);
        return;
      }

      // Fallback: detect browser_launch/browser_close tool completion via ai-fix-tool
      if (msg.type === 'ai-fix-tool' && msg.phase === 'complete') {
        if (msg.toolName === 'browser_launch') {
          setBrowserStatus(prev => ({ ...prev, active: true }));
          refreshFullStatus(300);
          return;
        }
        if (msg.toolName === 'browser_close') {
          setBrowserStatus({ active: false });
          return;
        }
      }
    });
    return unsub;
  }, [subscribe, refreshFullStatus]);

  // ── Split panel resize ─────────────────────────────────────────────────────

  const handleSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = 100 - (x / rect.width) * 100;
      setSplitPercent(Math.min(75, Math.max(25, pct)));
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── PiP toggle ─────────────────────────────────────────────────────────────

  const togglePiP = useCallback(() => {
    setIsPiP(prev => !prev);
  }, []);

  // ── Close browser session ────────────────────────────────────────────────

  const handleCloseBrowser = useCallback(async () => {
    try {
      await closeBrowserSession();
    } catch {
      // Fallback: send WS message
      send({ type: 'screencast-close-browser' });
    }
  }, [send]);

  // ── Clean up notification timer ──────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (closedTimerRef.current) clearTimeout(closedTimerRef.current);
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  const showLiveView = browserStatus.active;
  const showInlineLiveView = showLiveView && !isPiP;

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden relative">
      {/* Left: Original panel content */}
      <div
        className="flex-shrink-0 overflow-hidden"
        style={{ width: showInlineLiveView ? `${100 - splitPercent}%` : '100%' }}
      >
        {children}
      </div>

      {/* Resize Handle (inline mode) */}
      {showInlineLiveView && (
        <div
          onMouseDown={handleSplitMouseDown}
          className="w-1 flex-shrink-0 cursor-col-resize bg-white/5 hover:bg-brand-500/40 active:bg-brand-500/40 transition-colors relative group"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>
      )}

      {/* Right: Inline Live Browser View */}
      {showInlineLiveView && (
        <div
          className="flex-shrink-0 overflow-hidden"
          style={{ width: `${splitPercent}%` }}
        >
          <LiveBrowserView
            browserStatus={browserStatus}
            subscribe={subscribe}
            send={send}
            isPiP={false}
            onTogglePiP={togglePiP}
            onCloseBrowser={handleCloseBrowser}
          />
        </div>
      )}

      {/* PiP: Floating overlay */}
      {showLiveView && isPiP && (
        <PiPOverlay
          browserStatus={browserStatus}
          subscribe={subscribe}
          send={send}
          size={pipSize}
          onSizeChange={setPipSize}
          pos={pipPos}
          onPosChange={setPipPos}
          onTogglePiP={togglePiP}
          onCloseBrowser={handleCloseBrowser}
          containerRef={containerRef}
        />
      )}

      {/* Browser closed notification */}
      {closedNotification && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-surface-1 border border-white/10 shadow-lg shadow-black/30">
            <MonitorX size={16} className="text-red-400 flex-shrink-0" />
            <span className="text-sm text-gray-300 font-medium">Browser session closed</span>
            <button
              onClick={() => setClosedNotification(false)}
              className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-400 transition-colors ml-1"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PiP Overlay Component ────────────────────────────────────────────────────

interface PiPOverlayProps {
  browserStatus: BrowserStatus;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  send: (msg: object) => void;
  size: { w: number; h: number };
  onSizeChange: (size: { w: number; h: number }) => void;
  pos: { x: number; y: number };
  onPosChange: (pos: { x: number; y: number }) => void;
  onTogglePiP: () => void;
  onCloseBrowser?: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function PiPOverlay({ browserStatus, subscribe, send, size, onSizeChange, pos, onPosChange, onTogglePiP, onCloseBrowser, containerRef }: PiPOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isResizingPiP = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [isMaximized, setIsMaximized] = useState(false);
  const savedSizeBeforeMax = useRef(size);

  // Compute effective position (auto = bottom-right corner with margin)
  const getEffectivePos = useCallback(() => {
    if (pos.x >= 0 && pos.y >= 0) return pos;
    const container = containerRef.current;
    if (!container) return { x: 20, y: 20 };
    const rect = container.getBoundingClientRect();
    return {
      x: rect.width - size.w - 16,
      y: rect.height - size.h - 16,
    };
  }, [pos, size, containerRef]);

  // ── Drag handling ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
    e.preventDefault();
    isDragging.current = true;
    const ePos = getEffectivePos();
    dragOffset.current = { x: e.clientX - ePos.x, y: e.clientY - ePos.y };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [getEffectivePos, isMaximized]);

  // ── Resize handling ────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizingPiP.current = true;
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        const container = containerRef.current;
        const rawX = e.clientX - dragOffset.current.x;
        const rawY = e.clientY - dragOffset.current.y;

        if (container) {
          const cRect = container.getBoundingClientRect();
          const minVisible = 60;
          const clampedX = Math.min(
            Math.max(-size.w + minVisible, rawX),
            cRect.width - minVisible,
          );
          const clampedY = Math.min(
            Math.max(0, rawY),
            cRect.height - minVisible,
          );
          onPosChange({ x: clampedX, y: clampedY });
        } else {
          onPosChange({ x: Math.max(0, rawX), y: Math.max(0, rawY) });
        }
      }
      if (isResizingPiP.current && overlayRef.current) {
        const rect = overlayRef.current.getBoundingClientRect();
        const container = containerRef.current;
        const maxW = container ? container.getBoundingClientRect().width - 16 : 1200;
        const maxH = container ? container.getBoundingClientRect().height - 16 : 800;
        const newW = Math.min(maxW, Math.max(320, e.clientX - rect.left));
        const newH = Math.min(maxH, Math.max(240, e.clientY - rect.top));
        onSizeChange({ w: newW, h: newH });
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      isResizingPiP.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onPosChange, onSizeChange]);

  // ── Maximize toggle ────────────────────────────────────────────────────────

  const toggleMaximize = () => {
    if (isMaximized) {
      onSizeChange(savedSizeBeforeMax.current);
      setIsMaximized(false);
    } else {
      savedSizeBeforeMax.current = size;
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        onSizeChange({ w: rect.width - 32, h: rect.height - 32 });
        onPosChange({ x: 16, y: 16 });
      }
      setIsMaximized(true);
    }
  };

  const effectivePos = getEffectivePos();
  const effectiveSize = size;

  return (
    <div
      ref={overlayRef}
      className="absolute z-50 rounded-xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50 bg-surface-0"
      style={{
        left: effectivePos.x,
        top: effectivePos.y,
        width: effectiveSize.w,
        height: effectiveSize.h,
      }}
    >
      {/* PiP title bar */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center gap-2 px-2 py-1 bg-surface-1 border-b border-white/5 cursor-grab active:cursor-grabbing flex-shrink-0"
      >
        <GripHorizontal size={10} className="text-gray-600" />
        <span className="text-[10px] text-gray-400 font-medium flex-1">Live Browser</span>
        <button onClick={toggleMaximize} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-400 transition-colors">
          {isMaximized ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
        </button>
        <button onClick={onTogglePiP} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-400 transition-colors">
          <X size={10} />
        </button>
      </div>

      {/* Live view content */}
      <div className="h-[calc(100%-24px)]">
        <LiveBrowserView
          browserStatus={browserStatus}
          subscribe={subscribe}
          send={send}
          isPiP={true}
          onTogglePiP={onTogglePiP}
          onCloseBrowser={onCloseBrowser}
        />
      </div>

      {/* Resize handle (bottom-right corner) */}
      {!isMaximized && (
        <div
          onMouseDown={handleResizeStart}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{
            background: 'linear-gradient(135deg, transparent 50%, rgba(255,255,255,0.1) 50%)',
          }}
        />
      )}
    </div>
  );
}
