import { useState } from 'react';
import {
  ChevronDown, ChevronRight, FileEdit, FilePlus, FileX, FileMinus2,
  ChevronsUpDown, CheckCircle2, Circle, Plus, Minus,
} from 'lucide-react';
import type { UncommittedDiffFile } from '../../api/client';

interface UncommittedDiffViewerProps {
  files: UncommittedDiffFile[];
  /** Show staged/unstaged grouping headers */
  showGroups?: boolean;
  /** Start with all files expanded */
  defaultExpanded?: boolean;
  /** Callback to stage a file (shows Stage button when provided) */
  onStageFile?: (path: string) => void;
  /** Callback to unstage a file (shows Unstage button when provided) */
  onUnstageFile?: (path: string) => void;
  /** Callback to stage all unstaged files */
  onStageAll?: () => void;
  /** Callback to unstage all staged files */
  onUnstageAll?: () => void;
}

export function UncommittedDiffViewer({
  files,
  showGroups = true,
  defaultExpanded = false,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
}: UncommittedDiffViewerProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    if (defaultExpanded) {
      const map: Record<string, boolean> = {};
      files.forEach((f, i) => { map[`${f.staged ? 's' : 'u'}-${i}`] = true; });
      return map;
    }
    return {};
  });
  const [allExpanded, setAllExpanded] = useState(defaultExpanded);

  if (files.length === 0) return null;

  const staged = files.filter(f => f.staged);
  const unstaged = files.filter(f => !f.staged);

  const toggleAll = () => {
    const newState = !allExpanded;
    setAllExpanded(newState);
    const map: Record<string, boolean> = {};
    files.forEach((f, i) => { map[`${f.staged ? 's' : 'u'}-${i}`] = newState; });
    setExpanded(map);
  };

  const toggleOne = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'added':
      case 'untracked':
        return <FilePlus size={13} className="text-emerald-400" />;
      case 'deleted':
        return <FileX size={13} className="text-red-400" />;
      case 'renamed':
        return <FileMinus2 size={13} className="text-sky-400" />;
      default:
        return <FileEdit size={13} className="text-amber-400" />;
    }
  };

  const renderFileCard = (file: UncommittedDiffFile, key: string) => {
    const isExp = expanded[key] ?? false;
    const showStageBtn = !file.staged && onStageFile;
    const showUnstageBtn = file.staged && onUnstageFile;

    return (
      <div key={key} className="rounded-lg border border-white/5 bg-black/20 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2/50 transition-colors">
          <button
            onClick={() => toggleOne(key)}
            className="flex items-center gap-2 flex-1 text-left min-w-0"
          >
            <span className="text-gray-600 flex-shrink-0">
              {isExp ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </span>
            {getStatusIcon(file.status)}
            <span className="text-[11px] text-gray-300 font-mono truncate flex-1">{file.path}</span>
            {file.additions > 0 && (
              <span className="text-[10px] text-emerald-400 flex-shrink-0">+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span className="text-[10px] text-red-400 flex-shrink-0">-{file.deletions}</span>
            )}
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${
              file.status === 'untracked' ? 'bg-emerald-500/10 text-emerald-400' :
              file.status === 'added' ? 'bg-emerald-500/10 text-emerald-400' :
              file.status === 'deleted' ? 'bg-red-500/10 text-red-400' :
              'bg-amber-500/10 text-amber-400'
            }`}>
              {file.status}
            </span>
          </button>

          {/* Stage / Unstage button */}
          {showStageBtn && (
            <button
              onClick={(e) => { e.stopPropagation(); onStageFile!(file.path); }}
              className="flex items-center gap-0.5 px-2 py-1 rounded text-[10px] text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/20 flex-shrink-0 transition-colors"
              title={`Stage ${file.path}`}
            >
              <Plus size={10} /> Stage
            </button>
          )}
          {showUnstageBtn && (
            <button
              onClick={(e) => { e.stopPropagation(); onUnstageFile!(file.path); }}
              className="flex items-center gap-0.5 px-2 py-1 rounded text-[10px] text-gray-400 hover:bg-gray-500/10 border border-white/10 flex-shrink-0 transition-colors"
              title={`Unstage ${file.path}`}
            >
              <Minus size={10} /> Unstage
            </button>
          )}
        </div>

        {isExp && file.patch && (
          <div className="border-t border-white/5 max-h-[400px] overflow-auto">
            <pre className="text-[11px] font-mono leading-[1.6] whitespace-pre">
              {file.patch.split('\n').slice(0, 200).map((line, li) => {
                let bgClass = '';
                let textClass = 'text-gray-400';
                if (line.startsWith('+++') || line.startsWith('---')) {
                  textClass = 'text-gray-500 font-bold';
                  bgClass = 'bg-white/[0.02]';
                } else if (line.startsWith('@@')) {
                  textClass = 'text-sky-400/50';
                  bgClass = 'bg-sky-500/5';
                } else if (line.startsWith('+')) {
                  textClass = 'text-emerald-400/70';
                  bgClass = 'bg-emerald-500/8';
                } else if (line.startsWith('-')) {
                  textClass = 'text-red-400/70';
                  bgClass = 'bg-red-500/8';
                }
                return (
                  <div key={li} className={`px-3 ${bgClass} ${textClass}`}>
                    {line || ' '}
                  </div>
                );
              })}
            </pre>
          </div>
        )}

        {isExp && !file.patch && (
          <div className="border-t border-white/5 px-3 py-2 text-[11px] text-gray-500">
            No diff content available.
          </div>
        )}
      </div>
    );
  };

  const renderSection = (
    sectionFiles: UncommittedDiffFile[],
    prefix: string,
    label: string,
    icon: React.ReactNode,
    colorClass: string,
    bulkAction?: { label: string; onClick: () => void },
  ) => {
    if (sectionFiles.length === 0) return null;
    return (
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          {icon}
          <span className={`text-[10px] font-semibold uppercase flex-1 ${colorClass}`}>
            {label} ({sectionFiles.length})
          </span>
          {bulkAction && (
            <button
              onClick={bulkAction.onClick}
              className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {bulkAction.label}
            </button>
          )}
        </div>
        <div className="space-y-1">
          {sectionFiles.map((f, i) => renderFileCard(f, `${prefix}-${i}`))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-400 uppercase">
          {files.length} changed file{files.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={toggleAll}
          className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ChevronsUpDown size={11} />
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {showGroups ? (
        <div className="space-y-4">
          {renderSection(
            staged, 's', 'Staged',
            <CheckCircle2 size={12} className="text-emerald-400" />,
            'text-emerald-400',
            onUnstageAll && staged.length > 0 ? { label: 'Unstage All', onClick: onUnstageAll } : undefined,
          )}
          {renderSection(
            unstaged, 'u', 'Unstaged',
            <Circle size={12} className="text-amber-400" />,
            'text-amber-400',
            onStageAll && unstaged.length > 0 ? { label: 'Stage All', onClick: onStageAll } : undefined,
          )}
        </div>
      ) : (
        <div className="space-y-1">
          {files.map((f, i) => renderFileCard(f, `f-${i}`))}
        </div>
      )}
    </div>
  );
}
