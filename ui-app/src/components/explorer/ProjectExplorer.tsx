import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search, ChevronsDownUp, ChevronsUpDown,
  FolderOpen, X, FileText, Loader2,
} from 'lucide-react';
import { getFileTree } from '../../api/client';
import { useExpandedPaths } from '../../hooks/useFileTree';
import { FileTree } from './FileTree';
import { FileViewer } from './FileViewer';
import { LoadingState } from '../shared/LoadingState';
import { EmptyState } from '../shared/EmptyState';
import type { FileNode } from '../../api/types';

/** Collect all directory paths from a tree (for expand-all) */
function collectDirPaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'directory') {
      paths.push(node.path);
      if (node.children) {
        paths.push(...collectDirPaths(node.children));
      }
    }
  }
  return paths;
}

/** Count total files recursively */
function countTotalFiles(nodes: FileNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'file') count++;
    else if (node.children) count += countTotalFiles(node.children);
  }
  return count;
}

/** Given a file path, compute all ancestor directory paths to expand */
function getAncestorPaths(filePath: string, tree: FileNode[]): string[] {
  const ancestors: string[] = [];

  function search(nodes: FileNode[], chain: string[]): boolean {
    for (const node of nodes) {
      if (node.path === filePath) {
        ancestors.push(...chain);
        return true;
      }
      if (node.type === 'directory' && node.children) {
        if (search(node.children, [...chain, node.path])) return true;
      }
    }
    return false;
  }

  search(tree, []);
  return ancestors;
}

export function ProjectExplorer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { expanded, toggle, expandAll, collapseAll } = useExpandedPaths();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  // Tracks the file actually displayed by FileViewer (may lag behind selectedFile during unsaved-changes dialogs)
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [treeWidth, setTreeWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const initialFileHandled = useRef(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['fileTree'],
    queryFn: getFileTree,
    staleTime: 30_000,
  });

  const treeNodes = useMemo<FileNode[]>(() => {
    if (!tree) return [];
    // The API returns a single root FileNode; we show its children
    return tree.children ?? [tree];
  }, [tree]);

  const totalFiles = useMemo(() => countTotalFiles(treeNodes), [treeNodes]);
  const allDirPaths = useMemo(() => collectDirPaths(treeNodes), [treeNodes]);

  // Handle ?file= and ?line= query params on mount
  useEffect(() => {
    if (initialFileHandled.current || !treeNodes.length) return;
    const fileParam = searchParams.get('file');
    const lineParam = searchParams.get('line');
    if (fileParam) {
      initialFileHandled.current = true;
      setSelectedFile(fileParam);
      // Store line number for highlighting after editor loads
      if (lineParam) {
        const lineNum = parseInt(lineParam, 10);
        if (!isNaN(lineNum) && lineNum > 0) setHighlightLine(lineNum);
      }
      // Expand ancestor directories
      const ancestors = getAncestorPaths(fileParam, treeNodes);
      if (ancestors.length > 0) {
        expandAll([...expanded, ...ancestors]);
      }
      // Clear the query param to keep URL clean
      setSearchParams({}, { replace: true });
    } else {
      initialFileHandled.current = true;
    }
  }, [treeNodes, searchParams, setSearchParams, expandAll, expanded]);

  // Keyboard shortcut: Ctrl+F to focus filter
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && filterInputRef.current) {
        // Only capture if focus is within explorer (not in monaco editor)
        const active = document.activeElement;
        if (!active || !active.closest('.monaco-editor')) {
          e.preventDefault();
          filterInputRef.current.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Resizable tree panel
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = treeWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(500, startWidth + e.clientX - startX));
      setTreeWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [treeWidth]);

  if (isLoading) return <LoadingState text="Loading project tree..." />;

  if (!treeNodes.length) {
    return <EmptyState title="No project files" description="No files found in this project" icon={<FolderOpen size={28} />} />;
  }

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Split pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left: Tree Panel ─────────────────────────────────────── */}
        <div
          className="flex flex-col border-r border-white/5 bg-surface-1 flex-shrink-0 overflow-hidden"
          style={{ width: `${treeWidth}px` }}
        >
          {/* Tree toolbar */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/5 flex-shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mr-auto">
              Explorer
              <span className="ml-1.5 font-normal text-gray-600">{totalFiles} files</span>
            </span>
            <button
              onClick={() => expandAll(allDirPaths)}
              className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
              title="Expand all"
            >
              <ChevronsUpDown size={14} />
            </button>
            <button
              onClick={collapseAll}
              className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
              title="Collapse all"
            >
              <ChevronsDownUp size={14} />
            </button>
          </div>

          {/* Search / filter */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-white/5 flex-shrink-0">
            <Search size={13} className="text-gray-500 flex-shrink-0" />
            <input
              ref={filterInputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files..."
              className="flex-1 bg-transparent border-none outline-none text-xs text-gray-300 placeholder-gray-600 min-w-0"
            />
            {filter && (
              <button
                onClick={() => setFilter('')}
                className="p-0.5 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Tree content */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 scrollbar-thin">
            <FileTree
              nodes={treeNodes}
              expanded={expanded}
              selectedPath={activeFile ?? selectedFile}
              onToggle={toggle}
              onSelect={setSelectedFile}
              filter={filter || undefined}
            />
          </div>
        </div>

        {/* ── Resize handle ────────────────────────────────────────── */}
        <div
          ref={resizeRef}
          className={`w-1 cursor-col-resize hover:bg-brand-500/30 transition-colors flex-shrink-0 ${
            isResizing ? 'bg-brand-500/40' : ''
          }`}
          onMouseDown={handleMouseDown}
        />

        {/* ── Right: File Viewer ───────────────────────────────────── */}
        <div className="flex-1 overflow-hidden">
          {selectedFile ? (
            <FileViewer filePath={selectedFile} onActiveFileChange={setActiveFile} initialHighlightLine={highlightLine} onHighlightConsumed={() => setHighlightLine(null)} />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-gray-500">
                <FileText size={40} strokeWidth={1} className="text-gray-600" />
                <p className="text-sm">Select a file to view its contents</p>
                <p className="text-xs text-gray-600">Browse the project tree on the left or use <kbd className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] font-mono">Ctrl+K</kbd> to search</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
