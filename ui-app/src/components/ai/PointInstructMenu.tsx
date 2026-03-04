import { useState, useEffect, useRef } from 'react';
import {
  MousePointerClick, Type, Eye, Search,
  MessageSquare, Wand2, ClipboardCheck,
  X,
} from 'lucide-react';
import type { WSMessage } from '../../api/types';

// ── Types ────────────────────────────────────────────────────────────────────

interface PointInstructMenuProps {
  /** Position in canvas display pixels (relative to the canvas container) */
  position: { x: number; y: number } | null;
  /** Position in browser viewport coordinates (for sending to backend) */
  viewportPosition: { x: number; y: number } | null;
  /** Element info from highlight (if available) */
  elementInfo: {
    tagName: string;
    id?: string;
    className?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  /** Callback to send instructions */
  send: (msg: object) => void;
  /** Close the menu */
  onClose: () => void;
  /** Callback for custom instruction input */
  onCustomInstruction?: (instruction: string) => void;
  /** Callback to enter assertion builder mode */
  onAssertionMode?: (elementInfo: PointInstructMenuProps['elementInfo']) => void;
}

// ── PointInstructMenu Component ──────────────────────────────────────────────

export function PointInstructMenu({
  position,
  viewportPosition,
  elementInfo,
  send,
  onClose,
  onCustomInstruction,
  onAssertionMode,
}: PointInstructMenuProps) {
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customText, setCustomText] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Adjust menu position if it overflows the parent container
  useEffect(() => {
    if (!menuRef.current || !position) return;
    const menu = menuRef.current;
    const parent = menu.parentElement;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let adjustedLeft = position.x;
    let adjustedTop = position.y;

    // If menu overflows right edge, shift left
    if (adjustedLeft + menuRect.width > parentRect.width - 8) {
      adjustedLeft = Math.max(4, parentRect.width - menuRect.width - 8);
    }
    // If menu overflows bottom edge, shift up
    if (adjustedTop + menuRect.height > parentRect.height - 8) {
      adjustedTop = Math.max(4, parentRect.height - menuRect.height - 8);
    }

    if (adjustedLeft !== position.x || adjustedTop !== position.y) {
      menu.style.left = `${adjustedLeft}px`;
      menu.style.top = `${adjustedTop}px`;
    }
  }, [position]);

  // Focus input when custom mode activates
  useEffect(() => {
    if (showCustomInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showCustomInput]);

  if (!position || !viewportPosition) return null;

  const elLabel = elementInfo
    ? `<${elementInfo.tagName}${elementInfo.id ? '#' + elementInfo.id : ''}${elementInfo.className ? '.' + elementInfo.className.split(' ')[0] : ''}>`
    : 'this element';

  const sendInstruction = (instruction: string) => {
    send({
      type: 'screencast-instruct',
      instruction,
      elementInfo: elementInfo
        ? {
            tagName: elementInfo.tagName,
            id: elementInfo.id,
            className: elementInfo.className,
            x: viewportPosition.x,
            y: viewportPosition.y,
          }
        : { x: viewportPosition.x, y: viewportPosition.y },
    });
    onClose();
  };

  const handleCustomSubmit = () => {
    if (!customText.trim()) return;
    sendInstruction(customText.trim());
    onCustomInstruction?.(customText.trim());
  };

  // Menu positioning — keep within parent bounds, shift left/up if near edges
  const MENU_WIDTH = 220;
  const MENU_HEIGHT = 260;
  const menuStyle: React.CSSProperties = {
    left: Math.max(4, position.x),
    top: Math.max(4, position.y),
  };

  // Build coordinate-based click instruction so AI uses exact position
  const coordStr = `at page coordinates (${Math.round(viewportPosition.x)}, ${Math.round(viewportPosition.y)})`;

  // Build a unique selector hint — prefer ID, then a compound selector
  const selectorHint = elementInfo?.id
    ? `#${elementInfo.id}`
    : elementInfo
      ? `the ${elementInfo.tagName} element ${coordStr}`
      : `the element ${coordStr}`;

  const menuItems = [
    {
      icon: MousePointerClick,
      label: `Click here`,
      action: () => sendInstruction(
        `Click at exact page coordinates x=${Math.round(viewportPosition.x)}, y=${Math.round(viewportPosition.y)}. ` +
        `Use browser_click with the "coordinate" strategy or use browser_evaluate to dispatch a click event at these exact coordinates. ` +
        `The element at this position is a ${elementInfo?.tagName || 'unknown'} element.`
      ),
      color: 'text-blue-400',
    },
    {
      icon: Type,
      label: `Type into this field`,
      action: () => {
        setShowCustomInput(true);
        setCustomText('');
      },
      color: 'text-green-400',
    },
    {
      icon: Eye,
      label: `Inspect this element`,
      action: () => sendInstruction(
        `Inspect the element at page coordinates x=${Math.round(viewportPosition.x)}, y=${Math.round(viewportPosition.y)}. ` +
        `First use browser_inspect to find what element is there, then describe its properties, text content, and attributes.`
      ),
      color: 'text-amber-400',
    },
    {
      icon: Search,
      label: 'Find similar elements',
      action: () => sendInstruction(
        `Find all elements similar to the ${elementInfo?.tagName || 'element'} at coordinates (${Math.round(viewportPosition.x)}, ${Math.round(viewportPosition.y)}) on this page. ` +
        `First inspect the element to identify it, then search for similar elements and list them.`
      ),
      color: 'text-cyan-400',
    },
    {
      icon: ClipboardCheck,
      label: 'Add assertion',
      action: () => {
        if (onAssertionMode) {
          onAssertionMode(elementInfo);
          onClose();
        } else {
          sendInstruction(
            `Generate a test assertion for the element at coordinates (${Math.round(viewportPosition.x)}, ${Math.round(viewportPosition.y)}). ` +
            `First inspect it to identify its selector, then generate assertions to check visibility and text content.`
          );
        }
      },
      color: 'text-purple-400',
    },
    {
      icon: Wand2,
      label: 'Ask AI about this...',
      action: () => {
        setShowCustomInput(true);
        setCustomText('');
      },
      color: 'text-pink-400',
    },
  ];

  return (
    <div
      ref={menuRef}
      className="absolute z-50 animate-in fade-in zoom-in-95 duration-150"
      style={menuStyle}
    >
      <div className="bg-surface-1 border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden min-w-[200px]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 bg-surface-2/60">
          <div className="flex items-center gap-1.5 min-w-0">
            <MousePointerClick size={11} className="text-brand-400 flex-shrink-0" />
            <span className="text-[10px] text-gray-300 font-semibold">Point & Instruct</span>
          </div>
          {elementInfo && (
            <span className="text-[9px] font-mono text-purple-300 truncate max-w-[100px]">
              {elLabel}
            </span>
          )}
          <button onClick={onClose} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0">
            <X size={11} />
          </button>
        </div>

        {showCustomInput ? (
          <div className="p-2">
            <div className="flex gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCustomSubmit();
                  if (e.key === 'Escape') { setShowCustomInput(false); setCustomText(''); }
                }}
                placeholder="Tell AI what to do..."
                className="flex-1 px-2 py-1.5 rounded-lg bg-surface-2 border border-white/10 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/30"
              />
              <button
                onClick={handleCustomSubmit}
                disabled={!customText.trim()}
                className="px-2.5 py-1.5 rounded-lg bg-brand-600 text-white text-[10px] font-medium hover:bg-brand-500 transition-colors disabled:opacity-30"
              >
                Send
              </button>
            </div>
            <button
              onClick={() => { setShowCustomInput(false); setCustomText(''); }}
              className="text-[10px] text-gray-500 hover:text-gray-400 mt-1.5 transition-colors"
            >
              ← Back to menu
            </button>
          </div>
        ) : (
          <div className="py-1">
            {menuItems.map((item, i) => {
              const Icon = item.icon;
              return (
                <button
                  key={i}
                  onClick={item.action}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-white/5 transition-colors flex items-center gap-2"
                >
                  <Icon size={12} className={item.color} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Coordinates footer */}
        <div className="px-3 py-1 border-t border-white/5 bg-surface-2/30">
          <span className="text-[9px] text-gray-600 font-mono">
            ({Math.round(viewportPosition.x)}, {Math.round(viewportPosition.y)})
          </span>
        </div>
      </div>
    </div>
  );
}
