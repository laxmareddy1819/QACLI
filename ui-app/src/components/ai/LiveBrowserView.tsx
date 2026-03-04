import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Globe, ArrowLeft, ArrowRight, RotateCw,
  Monitor, Wifi, WifiOff, Bot, User as UserIcon,
  Smartphone, Tablet, MonitorIcon, ChevronDown,
  PictureInPicture2, Crosshair,
  PanelBottom, PanelBottomClose,
  Eye, Pause, Play, PowerOff,
} from 'lucide-react';
import type { WSMessage } from '../../api/types';
import type { BrowserStatus } from './BrowserChat';
import { getBrowserViewport } from '../../api/client';
import { NetworkConsolePanel } from './NetworkConsolePanel';
import { WatchModeOverlay } from './WatchModeOverlay';

// ── Types ────────────────────────────────────────────────────────────────────

interface LiveBrowserViewProps {
  browserStatus: BrowserStatus;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  send: (msg: object) => void;
  /** When true, this component renders as a floating PiP overlay */
  isPiP?: boolean;
  onTogglePiP?: () => void;
  /** Called when user clicks the Close Browser button */
  onCloseBrowser?: () => void;
}

interface FrameMetadata {
  width: number;
  height: number;
  offsetTop: number;
  pageScaleFactor: number;
  timestamp: number;
}

interface ElementHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  tagName: string;
  id?: string;
  className?: string;
}

// ── Viewport Presets ─────────────────────────────────────────────────────────

const VIEWPORT_PRESETS = [
  { label: 'Mobile', icon: Smartphone, width: 375, height: 812 },
  { label: 'Tablet', icon: Tablet, width: 768, height: 1024 },
  { label: 'Desktop', icon: MonitorIcon, width: 1280, height: 720 },
  { label: 'Full HD', icon: MonitorIcon, width: 1920, height: 1080 },
];

// ── LiveBrowserView Component ────────────────────────────────────────────────

export function LiveBrowserView({ browserStatus, subscribe, send, isPiP, onTogglePiP, onCloseBrowser }: LiveBrowserViewProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 720 });
  const [urlInput, setUrlInput] = useState('');
  const [fps, setFps] = useState(0);
  const [controlMode, setControlMode] = useState<'ai' | 'user'>('ai');

  // Phase 2 states
  const [highlightEnabled, setHighlightEnabled] = useState(false);
  const [currentHighlight, setCurrentHighlight] = useState<ElementHighlight | null>(null);
  const [canvasCursor, setCanvasCursor] = useState('default');
  const [showPresets, setShowPresets] = useState(false);
  const [showDevPanel, setShowDevPanel] = useState(false);
  const [devPanelHeight, setDevPanelHeight] = useState(200);

  // Phase 3 states
  const [watchModeEnabled, setWatchModeEnabled] = useState(true); // On by default
  const [aiPaused, setAiPaused] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frameCountRef = useRef(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverThrottleRef = useRef(0);

  // ── Initialize canvas + image object ────────────────────────────────────────

  useEffect(() => {
    if (!imageRef.current) {
      imageRef.current = new Image();
    }
  }, []);

  // ── FPS counter ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fpsIntervalRef.current = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);
    return () => {
      if (fpsIntervalRef.current) clearInterval(fpsIntervalRef.current);
    };
  }, []);

  // ── Start/stop screencast based on browser status ───────────────────────────

  useEffect(() => {
    if (browserStatus.active && !isStreaming && !isConnecting) {
      startScreencast();
    } else if (!browserStatus.active && isStreaming) {
      stopScreencast();
    }
  }, [browserStatus.active]);

  const startScreencast = useCallback(async () => {
    setIsConnecting(true);
    try {
      const vp = await getBrowserViewport();
      setViewportSize({ width: vp.width, height: vp.height });
      send({ type: 'screencast-start', options: { quality: 50 } });
      setIsStreaming(true);
    } catch {
      send({ type: 'screencast-start', options: { quality: 50 } });
      setIsStreaming(true);
    }
    setIsConnecting(false);
  }, [send]);

  const stopScreencast = useCallback(() => {
    send({ type: 'screencast-stop' });
    setIsStreaming(false);
    setFps(0);
  }, [send]);

  // ── Handle screencast frames + viewport updates + highlight responses ──────

  const handleMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'screencast-frame') {
      const data = msg.data as string;
      const metadata = msg.metadata as FrameMetadata | undefined;

      if (metadata) {
        setViewportSize(prev => {
          if (prev.width !== metadata.width || prev.height !== metadata.height) {
            return { width: metadata.width, height: metadata.height };
          }
          return prev;
        });
      }

      const img = imageRef.current;
      if (!img) return;

      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        if (canvas.width !== (metadata?.width || viewportSize.width) || canvas.height !== (metadata?.height || viewportSize.height)) {
          canvas.width = metadata?.width || viewportSize.width;
          canvas.height = metadata?.height || viewportSize.height;
        }

        if (!ctxRef.current) {
          ctxRef.current = canvas.getContext('2d');
        }

        ctxRef.current?.drawImage(img, 0, 0, canvas.width, canvas.height);
        frameCountRef.current++;
      };

      img.src = `data:image/jpeg;base64,${data}`;
      return;
    }

    if (msg.type === 'screencast-viewport') {
      setViewportSize({ width: msg.width as number, height: msg.height as number });
      return;
    }

    if (msg.type === 'screencast-stopped') {
      setIsStreaming(false);
      setFps(0);
      return;
    }

    if (msg.type === 'screencast-error') {
      setIsStreaming(false);
      setIsConnecting(false);
      return;
    }

    // Phase 2: Element highlight response
    if (msg.type === 'screencast-highlight') {
      setCurrentHighlight(msg.highlight as ElementHighlight | null);
      return;
    }

    // Tab switched — update URL bar
    if (msg.type === 'browser-tab-switched') {
      if (msg.url) setUrlInput(msg.url as string);
      return;
    }

    // URL/title changed (page navigation detected by screencast service)
    if (msg.type === 'screencast-url-changed') {
      if (msg.url) setUrlInput(msg.url as string);
      return;
    }

    // Cursor style from browser page — apply to canvas
    if (msg.type === 'screencast-cursor') {
      setCanvasCursor(msg.cursor as string || 'default');
      return;
    }

    // Phase 3: AI orchestrator status
    if (msg.type === 'ai-orchestrator-paused') {
      setAiPaused(true);
      return;
    }
    if (msg.type === 'ai-orchestrator-resumed') {
      setAiPaused(false);
      return;
    }

    // Phase 3: Track AI running state from tool events
    if (msg.type === 'ai-fix-tool') {
      setAiRunning(true);
      return;
    }
    if (msg.type === 'ai-fix-done' || msg.type === 'ai-fix-error') {
      setAiRunning(false);
      setAiPaused(false);
      return;
    }
  }, [viewportSize]);

  useEffect(() => subscribe(handleMessage), [subscribe, handleMessage]);

  // ── Update URL input when browser navigates ─────────────────────────────────

  useEffect(() => {
    if (browserStatus.url) setUrlInput(browserStatus.url);
  }, [browserStatus.url]);

  // ── Phase 2: Draw highlight overlay ────────────────────────────────────────

  useEffect(() => {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Keep overlay same size as canvas
    if (overlay.width !== canvas.width || overlay.height !== canvas.height) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    }

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    if (currentHighlight && highlightEnabled) {
      const h = currentHighlight;

      // Fill
      ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
      ctx.fillRect(h.x, h.y, h.width, h.height);

      // Border
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(h.x, h.y, h.width, h.height);

      // Label
      const label = `${h.tagName}${h.id ? '#' + h.id : ''}${h.className ? '.' + h.className.split(' ')[0] : ''}`;
      ctx.font = '11px monospace';
      const textWidth = ctx.measureText(label).width;
      const labelX = h.x;
      const labelY = h.y > 18 ? h.y - 4 : h.y + h.height + 14;

      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.fillRect(labelX, labelY - 12, textWidth + 8, 16);
      ctx.fillStyle = '#93c5fd';
      ctx.fillText(label, labelX + 4, labelY);
    }
  }, [currentHighlight, highlightEnabled]);

  // ── Coordinate scaling ──────────────────────────────────────────────────────

  const scaleCoordinates = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;

    const scaleX = viewportSize.width / rect.width;
    const scaleY = viewportSize.height / rect.height;

    return {
      x: Math.round(canvasX * scaleX),
      y: Math.round(canvasY * scaleY),
    };
  }, [viewportSize]);

  // ── Mouse event handlers ────────────────────────────────────────────────────

  const getModifiers = (e: React.MouseEvent | React.KeyboardEvent | React.WheelEvent): number => {
    let mod = 0;
    if (e.altKey) mod |= 1;
    if (e.ctrlKey) mod |= 2;
    if (e.metaKey) mod |= 4;
    if (e.shiftKey) mod |= 8;
    return mod;
  };

  const getButton = (e: React.MouseEvent): 'left' | 'right' | 'middle' => {
    if (e.button === 2) return 'right';
    if (e.button === 1) return 'middle';
    return 'left';
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (controlMode !== 'user') return;
    e.preventDefault();
    const { x, y } = scaleCoordinates(e.clientX, e.clientY);
    send({
      type: 'screencast-mouse',
      mouseType: 'mousePressed',
      x, y,
      button: getButton(e),
      clickCount: e.detail || 1,
      modifiers: getModifiers(e),
    });
  }, [controlMode, scaleCoordinates, send]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (controlMode !== 'user') return;
    e.preventDefault();
    const { x, y } = scaleCoordinates(e.clientX, e.clientY);
    send({
      type: 'screencast-mouse',
      mouseType: 'mouseReleased',
      x, y,
      button: getButton(e),
      clickCount: e.detail || 1,
      modifiers: getModifiers(e),
    });
  }, [controlMode, scaleCoordinates, send]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (controlMode !== 'user') return;

    const now = Date.now();
    // Throttle move events to ~50ms to avoid flooding CDP
    if (now - hoverThrottleRef.current < 50) return;
    hoverThrottleRef.current = now;

    const { x, y } = scaleCoordinates(e.clientX, e.clientY);

    // Phase 2: Element highlighting on hover
    if (highlightEnabled) {
      send({ type: 'screencast-hover', x, y });
    }

    // Forward mouseMoved to browser so hover effects (tooltips, dropdowns, :hover CSS) work
    send({
      type: 'screencast-mouse',
      mouseType: 'mouseMoved',
      x, y,
      button: 'none',
      modifiers: getModifiers(e),
    });
  }, [controlMode, scaleCoordinates, send, highlightEnabled]);

  const handleMouseLeave = useCallback(() => {
    if (highlightEnabled) {
      setCurrentHighlight(null);
    }
  }, [highlightEnabled]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (controlMode !== 'user') return;
    e.preventDefault();
    const { x, y } = scaleCoordinates(e.clientX, e.clientY);
    send({
      type: 'screencast-mouse',
      mouseType: 'mousePressed',
      x, y,
      button: 'left',
      clickCount: 2,
      modifiers: getModifiers(e),
    });
    send({
      type: 'screencast-mouse',
      mouseType: 'mouseReleased',
      x, y,
      button: 'left',
      clickCount: 2,
      modifiers: getModifiers(e),
    });
  }, [controlMode, scaleCoordinates, send]);

  // ── Keyboard event handlers ─────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (controlMode !== 'user') return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    send({
      type: 'screencast-key',
      keyType: 'keyDown',
      key: e.key,
      code: e.code,
      text: e.key.length === 1 ? e.key : undefined,
      modifiers: getModifiers(e),
    });
  }, [controlMode, send]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (controlMode !== 'user') return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    send({
      type: 'screencast-key',
      keyType: 'keyUp',
      key: e.key,
      code: e.code,
      modifiers: getModifiers(e),
    });
  }, [controlMode, send]);

  // ── Scroll handler ──────────────────────────────────────────────────────────

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (controlMode !== 'user') return;
    e.preventDefault();
    const { x, y } = scaleCoordinates(e.clientX, e.clientY);
    send({
      type: 'screencast-scroll',
      x, y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
    });
  }, [controlMode, scaleCoordinates, send]);

  // ── URL bar navigation ──────────────────────────────────────────────────────

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    let url = urlInput.trim();
    if (!url.match(/^https?:\/\//)) url = `https://${url}`;
    send({ type: 'screencast-navigate', url });
  };

  // ── Tab switching ───────────────────────────────────────────────────────────

  const handleTabClick = (index: number) => {
    send({ type: 'screencast-tab', index });
  };

  // ── Phase 2: Viewport preset ───────────────────────────────────────────────

  const handleViewportPreset = (width: number, height: number) => {
    send({ type: 'screencast-resize-viewport', width, height });
    setShowPresets(false);
  };

  // ── Dev panel resize ───────────────────────────────────────────────────────

  const devPanelResizeRef = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!devPanelResizeRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newHeight = rect.bottom - e.clientY;
      setDevPanelHeight(Math.min(400, Math.max(100, newHeight)));
    };
    const handleMouseUp = () => {
      devPanelResizeRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const tabs = browserStatus.tabs || [];
  const aspectRatio = viewportSize.width / viewportSize.height;

  return (
    <div ref={containerRef} className="flex flex-col h-full bg-surface-0" tabIndex={0} onKeyDown={handleKeyDown} onKeyUp={handleKeyUp}>
      {/* Tab Bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-white/5 bg-surface-1 flex-shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.index}
            onClick={() => handleTabClick(tab.index)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-t-lg text-[11px] max-w-[150px] truncate flex-shrink-0 transition-colors ${
              tab.active
                ? 'bg-surface-0 text-gray-200 border-t border-x border-white/10'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
            title={tab.url}
          >
            <Globe size={10} className="flex-shrink-0" />
            <span className="truncate">{tab.title || `Tab ${tab.index + 1}`}</span>
          </button>
        ))}
        {tabs.length === 0 && (
          <span className="text-[11px] text-gray-600 px-2">No tabs</span>
        )}

        {/* Right side: Control mode toggle + Phase 3 controls + PiP */}
        <div className="ml-auto flex items-center gap-1 flex-shrink-0">
          {/* Phase 3: Pause/Resume AI (only when AI is running) */}
          {aiRunning && (
            <button
              onClick={() => {
                if (aiPaused) {
                  send({ type: 'screencast-resume' });
                } else {
                  send({ type: 'screencast-pause' });
                }
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-colors ${
                aiPaused
                  ? 'bg-emerald-600 text-white border border-emerald-400/50 hover:bg-emerald-500 shadow-sm shadow-emerald-500/20'
                  : 'bg-orange-600 text-white border border-orange-400/50 hover:bg-orange-500 shadow-sm shadow-orange-500/20'
              }`}
              title={aiPaused ? 'Resume AI execution' : 'Pause AI execution'}
            >
              {aiPaused ? <><Play size={10} /> Resume</> : <><Pause size={10} /> Pause</>}
            </button>
          )}

          {/* Phase 3: Watch mode toggle */}
          <button
            onClick={() => setWatchModeEnabled(!watchModeEnabled)}
            className={`p-1 rounded transition-colors ${
              watchModeEnabled
                ? 'text-purple-400 bg-purple-500/15'
                : 'text-gray-500 hover:text-gray-400 hover:bg-white/5'
            }`}
            title={watchModeEnabled ? 'Disable watch mode overlay' : 'Enable watch mode overlay'}
          >
            <Eye size={11} />
          </button>

          <div className="w-px h-3 bg-white/10" />

          <button
            onClick={() => setControlMode('ai')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              controlMode === 'ai'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'text-gray-500 hover:text-gray-400'
            }`}
            title="AI is controlling the browser"
          >
            <Bot size={10} /> AI
          </button>
          <button
            onClick={() => setControlMode('user')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              controlMode === 'user'
                ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                : 'text-gray-500 hover:text-gray-400'
            }`}
            title="You are controlling the browser"
          >
            <UserIcon size={10} /> User
          </button>
          {onTogglePiP && (
            <button
              onClick={onTogglePiP}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${isPiP ? 'text-brand-400 bg-brand-500/15' : 'text-gray-500 hover:text-gray-400'}`}
              title={isPiP ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
            >
              <PictureInPicture2 size={11} /> PiP
            </button>
          )}
          {onCloseBrowser && (
            <>
              <div className="w-px h-3 bg-white/10" />
              <button
                onClick={onCloseBrowser}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                title="Close browser session"
              >
                <PowerOff size={10} /> Close
              </button>
            </>
          )}
        </div>
      </div>

      {/* URL Bar + Viewport Presets */}
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <button onClick={() => send({ type: 'screencast-go-back' })}
          className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-400 transition-colors"
          title="Go back">
          <ArrowLeft size={12} />
        </button>
        <button onClick={() => send({ type: 'screencast-go-forward' })}
          className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-400 transition-colors"
          title="Go forward">
          <ArrowRight size={12} />
        </button>
        <button onClick={() => send({ type: 'screencast-navigate', url: browserStatus.url || '' })}
          className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-400 transition-colors">
          <RotateCw size={12} />
        </button>
        <form onSubmit={handleUrlSubmit} className="flex-1">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL..."
            className="w-full px-2.5 py-1 rounded-lg bg-surface-2 border border-white/5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-500/30"
          />
        </form>

        {/* Phase 2: Viewport presets dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-gray-500 hover:text-gray-400 hover:bg-white/5 transition-colors"
            title="Viewport presets"
          >
            <Monitor size={11} />
            <ChevronDown size={9} />
          </button>
          {showPresets && (
            <div className="absolute right-0 top-full mt-1 bg-surface-1 border border-white/10 rounded-lg z-50 py-1 w-40">
              {VIEWPORT_PRESETS.map((preset) => {
                const PresetIcon = preset.icon;
                const isActive = viewportSize.width === preset.width && viewportSize.height === preset.height;
                return (
                  <button
                    key={preset.label}
                    onClick={() => handleViewportPreset(preset.width, preset.height)}
                    className={`w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                      isActive ? 'text-brand-300 bg-brand-500/10' : 'text-gray-300 hover:bg-white/5'
                    }`}
                  >
                    <PresetIcon size={11} className="flex-shrink-0" />
                    <span>{preset.label}</span>
                    <span className="ml-auto text-gray-600 text-[10px]">{preset.width}x{preset.height}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Phase 2: Element highlight toggle */}
        <button
          onClick={() => setHighlightEnabled(!highlightEnabled)}
          className={`p-1 rounded transition-colors ${
            highlightEnabled
              ? 'text-blue-400 bg-blue-500/15'
              : 'text-gray-500 hover:text-gray-400 hover:bg-white/5'
          }`}
          title={highlightEnabled ? 'Disable element highlight' : 'Enable element highlight'}
        >
          <Crosshair size={12} />
        </button>

        {/* Phase 2: DevTools panel toggle */}
        <button
          onClick={() => setShowDevPanel(!showDevPanel)}
          className={`p-1 rounded transition-colors ${
            showDevPanel
              ? 'text-purple-400 bg-purple-500/15'
              : 'text-gray-500 hover:text-gray-400 hover:bg-white/5'
          }`}
          title={showDevPanel ? 'Hide DevTools' : 'Show DevTools'}
        >
          {showDevPanel ? <PanelBottomClose size={12} /> : <PanelBottom size={12} />}
        </button>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 overflow-hidden bg-black/50 flex items-center justify-center relative min-h-0">
        {isStreaming ? (
          <div className="relative max-w-full max-h-full" style={{ aspectRatio: `${aspectRatio}` }}>
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full block"
              style={{ aspectRatio: `${aspectRatio}`, cursor: controlMode === 'user' ? canvasCursor : 'not-allowed' }}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onWheel={handleWheel}
            />
            {/* Overlay canvas for element highlights */}
            {highlightEnabled && (
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 pointer-events-none max-w-full max-h-full"
                style={{ aspectRatio: `${aspectRatio}` }}
              />
            )}

            {/* Phase 3: Watch mode overlay — AI action indicators */}
            {watchModeEnabled && canvasRef.current && (
              <WatchModeOverlay
                subscribe={subscribe}
                canvasWidth={canvasRef.current?.width || viewportSize.width}
                canvasHeight={canvasRef.current?.height || viewportSize.height}
                viewportWidth={viewportSize.width}
                viewportHeight={viewportSize.height}
                enabled={watchModeEnabled}
              />
            )}

            {/* Phase 3: AI Paused indicator overlay — semi-transparent so browser is visible behind */}
            {aiPaused && (
              <div
                className="absolute inset-0 flex items-center justify-center z-30"
                style={{ pointerEvents: 'none', background: 'rgba(0, 0, 0, 0.15)' }}
              >
                <div
                  className="flex items-center gap-4 px-5 py-3 rounded-2xl border"
                  style={{
                    pointerEvents: 'auto',
                    background: 'rgba(20, 20, 30, 0.7)',
                    borderColor: 'rgba(251, 191, 36, 0.5)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                  }}
                >
                  <div className="w-10 h-10 rounded-full bg-orange-500/25 flex items-center justify-center flex-shrink-0">
                    <Pause size={20} className="text-orange-400" />
                  </div>
                  <div>
                    <div className="text-base font-bold text-white">AI Paused</div>
                    <div className="text-xs mt-0.5" style={{ color: '#ffffff' }}>Execution paused before next action</div>
                  </div>
                  <button
                    onClick={() => send({ type: 'screencast-resume' })}
                    className="ml-3 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 transition-colors shadow-md shadow-emerald-500/20"
                  >
                    <Play size={14} /> Resume
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : isConnecting ? (
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs">Connecting to browser...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-600">
            <Monitor size={32} />
            <span className="text-xs">No live view available</span>
            <span className="text-[10px] text-gray-700">Launch a browser to see it here</span>
          </div>
        )}
      </div>

      {/* Phase 2: Network/Console DevTools Panel */}
      {showDevPanel && isStreaming && (
        <>
          {/* Resize handle */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              devPanelResizeRef.current = true;
              document.body.style.cursor = 'row-resize';
              document.body.style.userSelect = 'none';
            }}
            className="h-1 flex-shrink-0 cursor-row-resize bg-white/5 hover:bg-brand-500/40 active:bg-brand-500/40 transition-colors"
          />
          <div className="flex-shrink-0 overflow-hidden" style={{ height: `${devPanelHeight}px` }}>
            <NetworkConsolePanel
              subscribe={subscribe}
              send={send}
              isStreaming={isStreaming}
            />
          </div>
        </>
      )}

      {/* Status Bar */}
      <div className="flex items-center justify-between px-2.5 py-1 border-t border-white/5 bg-surface-1 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {isStreaming ? (
              <Wifi size={10} className="text-emerald-400" />
            ) : (
              <WifiOff size={10} className="text-gray-600" />
            )}
            <span className={`text-[10px] ${isStreaming ? 'text-emerald-400' : 'text-gray-600'}`}>
              {isStreaming ? 'Live' : 'Offline'}
            </span>
          </div>
          {isStreaming && (
            <>
              <span className="text-[10px] text-gray-500">{fps} fps</span>
              <span className="text-[10px] text-gray-600">{viewportSize.width}x{viewportSize.height}</span>
            </>
          )}
          {highlightEnabled && currentHighlight && (
            <span className="text-[10px] text-blue-400 font-mono truncate max-w-[200px]">
              &lt;{currentHighlight.tagName}{currentHighlight.id ? `#${currentHighlight.id}` : ''}&gt;
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {aiPaused && (
            <span className="text-[10px] text-orange-300 font-semibold animate-pulse">AI Paused</span>
          )}
          {aiRunning && !aiPaused && (
            <span className="text-[10px] text-purple-300 font-medium">AI Working</span>
          )}
          {controlMode === 'user' && (
            <span className="text-[10px] text-brand-400 font-medium">Interactive Mode</span>
          )}
          {isStreaming && (
            <button
              onClick={stopScreencast}
              className="text-[10px] text-gray-500 hover:text-gray-400 transition-colors"
            >
              Disconnect
            </button>
          )}
          {!isStreaming && browserStatus.active && (
            <button
              onClick={startScreencast}
              className="text-[10px] text-brand-400 hover:text-brand-300 transition-colors"
            >
              Connect
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
