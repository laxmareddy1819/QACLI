import { useState, useEffect } from 'react';
import { PanelRightClose, PanelRightOpen, Footprints } from 'lucide-react';
import type { FileMetadata } from '../../api/types';

const STORAGE_KEY = 'qabot_steps_visible';

interface StepDefViewerProps {
  metadata: FileMetadata;
  onStepClick?: (step: string) => void;
}

export function StepDefViewer({ metadata, onStepClick }: StepDefViewerProps) {
  const steps = metadata.metadata?.steps ?? [];

  const [visible, setVisible] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === null ? true : stored === '1';
    } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, visible ? '1' : '0'); } catch {}
  }, [visible]);

  if (steps.length === 0) return null;

  if (!visible) {
    /* ── Collapsed strip ──────────────────────────────── */
    return (
      <button
        onClick={() => setVisible(true)}
        className="w-7 border-l border-white/5 bg-surface-1 flex flex-col items-center justify-center
          gap-2 flex-shrink-0 hover:bg-white/[0.03] transition-colors group cursor-pointer"
        title="Show step patterns"
      >
        <PanelRightOpen size={14} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
        <span className="text-[10px] font-medium text-gray-600 group-hover:text-gray-400 transition-colors
          [writing-mode:vertical-lr] tracking-wider select-none">
          STEPS
        </span>
        <span className="text-[9px] text-gray-600 bg-surface-2 rounded-full px-1 min-w-[16px] text-center">
          {steps.length}
        </span>
      </button>
    );
  }

  /* ── Expanded panel ───────────────────────────────── */
  return (
    <div className="w-56 border-l border-white/5 bg-surface-1 flex flex-col flex-shrink-0
      animate-[slideInRight_150ms_ease-out]">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 flex-shrink-0">
        <Footprints size={12} className="text-gray-500" />
        <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider">
          Steps
        </span>
        <span className="text-[9px] text-gray-600 ml-0.5">{steps.length}</span>
        <div className="flex-1" />
        <button
          onClick={() => setVisible(false)}
          className="p-0.5 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
          title="Hide step patterns"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      {/* Step list */}
      <div className="flex-1 overflow-y-auto p-3 pt-2">
        {steps.map((step, i) => {
          const type = step.match(/^(Given|When|Then|And|But)/)?.[1];
          const colors: Record<string, string> = {
            Given: 'text-sky-300',
            When: 'text-amber-300',
            Then: 'text-emerald-300',
            And: 'text-gray-300',
            But: 'text-rose-300',
          };
          const baseColor = colors[type ?? ''] ?? 'text-gray-300';
          return (
            <button
              key={i}
              onClick={() => onStepClick?.(step)}
              className={`block w-full text-left text-xs py-1.5 px-1.5 -mx-1.5 rounded truncate
                transition-colors cursor-pointer ${baseColor} hover:bg-white/5 hover:brightness-125`}
              title={`Go to: ${step}`}
            >
              {step}
            </button>
          );
        })}
      </div>
    </div>
  );
}
