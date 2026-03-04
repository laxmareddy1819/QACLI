import { useEffect, useRef, useCallback, useState } from 'react';
import type { WSMessage } from '../../api/types';

// ── Types ────────────────────────────────────────────────────────────────────

interface WatchModeOverlayProps {
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  canvasWidth: number;
  canvasHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  enabled: boolean;
}

interface AIAction {
  id: string;
  type: 'click' | 'type' | 'hover' | 'navigate' | 'select' | 'key' | 'screenshot' | 'scroll' | 'wait' | 'launch' | 'close' | 'action';
  toolName: string;
  selector?: string;
  text?: string;
  url?: string;
  x?: number;
  y?: number;
  timestamp: number;
}

interface ClickRipple {
  id: string;
  x: number;
  y: number;
  startTime: number;
  duration: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const RIPPLE_DURATION = 800; // ms
const ACTION_LABEL_DURATION = 2000; // ms
const CURSOR_FADE_DURATION = 3000; // ms

// ── WatchModeOverlay Component ───────────────────────────────────────────────

export function WatchModeOverlay({
  subscribe,
  canvasWidth,
  canvasHeight,
  viewportWidth,
  viewportHeight,
  enabled,
}: WatchModeOverlayProps) {
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const ripples = useRef<ClickRipple[]>([]);
  const [currentAction, setCurrentAction] = useState<AIAction | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const cursorLastUpdate = useRef(0);
  const animFrameRef = useRef<number>(0);

  // ── Coordinate scaling (viewport → canvas display) ──────────────────────

  const scaleToCanvas = useCallback((vx: number, vy: number) => {
    const sx = canvasWidth / viewportWidth;
    const sy = canvasHeight / viewportHeight;
    return { x: vx * sx, y: vy * sy };
  }, [canvasWidth, canvasHeight, viewportWidth, viewportHeight]);

  // ── Handle AI action messages ───────────────────────────────────────────

  const handleMessage = useCallback((msg: WSMessage) => {
    if (!enabled) return;

    if (msg.type === 'ai-cursor-action') {
      const action: AIAction = {
        id: `action-${Date.now()}-${Math.random()}`,
        type: (msg.action as AIAction['type']) || 'action',
        toolName: msg.toolName as string,
        selector: msg.selector as string | undefined,
        text: msg.text as string | undefined,
        url: msg.url as string | undefined,
        x: msg.x as number | undefined,
        y: msg.y as number | undefined,
        timestamp: Date.now(),
      };

      setCurrentAction(action);

      // Auto-clear action label after duration
      setTimeout(() => {
        setCurrentAction(prev => prev?.id === action.id ? null : prev);
      }, ACTION_LABEL_DURATION);

      // Click ripple effect
      if (action.type === 'click' && action.x !== undefined && action.y !== undefined) {
        const scaled = scaleToCanvas(action.x, action.y);
        ripples.current.push({
          id: action.id,
          x: scaled.x,
          y: scaled.y,
          startTime: Date.now(),
          duration: RIPPLE_DURATION,
        });
        setCursorPos({ x: action.x, y: action.y });
        cursorLastUpdate.current = Date.now();
      }

      // Hover/type actions — show cursor at element position if coordinates available
      if (['hover', 'type', 'select'].includes(action.type) && action.x !== undefined && action.y !== undefined) {
        setCursorPos({ x: action.x, y: action.y });
        cursorLastUpdate.current = Date.now();
      }
    }
  }, [enabled, scaleToCanvas]);

  useEffect(() => subscribe(handleMessage), [subscribe, handleMessage]);

  // ── Animation loop ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!enabled) return;

    const animate = () => {
      const overlay = overlayRef.current;
      if (!overlay) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Resize overlay to match canvas
      if (overlay.width !== canvasWidth || overlay.height !== canvasHeight) {
        overlay.width = canvasWidth;
        overlay.height = canvasHeight;
      }

      const ctx = overlay.getContext('2d');
      if (!ctx) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      ctx.clearRect(0, 0, overlay.width, overlay.height);
      const now = Date.now();

      // ── Draw click ripples ──────────────────────────────────────────────
      ripples.current = ripples.current.filter(r => now - r.startTime < r.duration);
      for (const ripple of ripples.current) {
        const elapsed = now - ripple.startTime;
        const progress = elapsed / ripple.duration;
        const maxRadius = 30;
        const radius = maxRadius * progress;
        const alpha = 1 - progress;

        // Outer ring
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(168, 85, 247, ${alpha * 0.8})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Inner fill
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(168, 85, 247, ${alpha * 0.3})`;
        ctx.fill();

        // Center dot
        if (progress < 0.3) {
          ctx.beginPath();
          ctx.arc(ripple.x, ripple.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(168, 85, 247, ${(1 - progress / 0.3) * 0.9})`;
          ctx.fill();
        }
      }

      // ── Draw AI cursor ──────────────────────────────────────────────────
      if (cursorPos) {
        const cursorAge = now - cursorLastUpdate.current;
        if (cursorAge < CURSOR_FADE_DURATION) {
          const alpha = Math.max(0, 1 - cursorAge / CURSOR_FADE_DURATION);
          const scaled = scaleToCanvas(cursorPos.x, cursorPos.y);

          // Cursor crosshair
          const size = 12;
          ctx.strokeStyle = `rgba(168, 85, 247, ${alpha * 0.9})`;
          ctx.lineWidth = 1.5;

          // Horizontal line
          ctx.beginPath();
          ctx.moveTo(scaled.x - size, scaled.y);
          ctx.lineTo(scaled.x + size, scaled.y);
          ctx.stroke();

          // Vertical line
          ctx.beginPath();
          ctx.moveTo(scaled.x, scaled.y - size);
          ctx.lineTo(scaled.x, scaled.y + size);
          ctx.stroke();

          // Pulsing circle
          const pulsePhase = (now % 1000) / 1000;
          const pulseRadius = 6 + Math.sin(pulsePhase * Math.PI * 2) * 2;
          ctx.beginPath();
          ctx.arc(scaled.x, scaled.y, pulseRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(168, 85, 247, ${alpha * 0.5})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [enabled, canvasWidth, canvasHeight, cursorPos, scaleToCanvas]);

  if (!enabled) return null;

  // ── Get action label ────────────────────────────────────────────────────

  const getActionLabel = (action: AIAction): string => {
    switch (action.type) {
      case 'click': return `Click ${action.selector || ''}`.trim();
      case 'type': return `Type "${(action.text || '').slice(0, 30)}${(action.text || '').length > 30 ? '...' : ''}"`;
      case 'hover': return `Hover ${action.selector || ''}`.trim();
      case 'navigate': return `Navigate → ${(action.url || '').slice(0, 40)}`;
      case 'select': return `Select ${action.selector || ''}`.trim();
      case 'key': return `Press ${action.text || 'key'}`;
      case 'screenshot': return 'Taking screenshot';
      case 'scroll': return 'Scrolling';
      case 'wait': return `Waiting for ${action.selector || 'element'}`;
      case 'launch': return 'Launching browser';
      case 'close': return 'Closing browser';
      default: return action.toolName;
    }
  };

  return (
    <>
      {/* Canvas overlay for ripples and cursor */}
      <canvas
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none z-10"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Action label overlay */}
      {currentAction && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-900/95 border border-purple-400/40 shadow-lg shadow-black/40 backdrop-blur-md">
            <ActionIcon type={currentAction.type} />
            <span className="text-[11px] font-semibold text-white whitespace-nowrap max-w-[280px] truncate drop-shadow-sm">
              {getActionLabel(currentAction)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

// ── Action Icon ──────────────────────────────────────────────────────────────

function ActionIcon({ type }: { type: AIAction['type'] }) {
  const size = 12;
  const cls = "text-purple-300";

  switch (type) {
    case 'click':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={cls} fill="currentColor">
          <circle cx="8" cy="8" r="3" />
          <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'type':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={cls} fill="currentColor">
          <rect x="2" y="4" width="12" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <line x1="5" y1="7" x2="11" y2="7" stroke="currentColor" strokeWidth="1" />
          <line x1="5" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case 'navigate':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={cls} fill="currentColor">
          <path d="M3 8h10M10 5l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'hover':
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={cls} fill="currentColor">
          <path d="M4 2l8 6-4 1-2 4z" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" className={cls} fill="currentColor">
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
  }
}
