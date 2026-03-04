import { useMemo } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import type { FileNode } from '../../api/types';
import { getFileIcon } from './fileIcons';

interface FileTreeProps {
  nodes: FileNode[];
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  depth?: number;
  filter?: string;
}

/** Count total files (recursively) inside a directory node */
function countFiles(node: FileNode): number {
  if (node.type === 'file') return 1;
  if (!node.children) return 0;
  return node.children.reduce((sum, child) => sum + countFiles(child), 0);
}

/** Check if a node (or any descendant) matches the filter string */
function matchesFilter(node: FileNode, filter: string): boolean {
  const q = filter.toLowerCase();
  if (node.name.toLowerCase().includes(q)) return true;
  if (node.type === 'directory' && node.children) {
    return node.children.some(child => matchesFilter(child, filter));
  }
  return false;
}

export function FileTree({ nodes, expanded, selectedPath, onToggle, onSelect, depth = 0, filter }: FileTreeProps) {
  const sorted = useMemo(() => {
    let filtered = [...nodes];
    // Apply filter
    if (filter && filter.trim()) {
      filtered = filtered.filter(node => matchesFilter(node, filter.trim()));
    }
    // Sort: directories first, then alphabetical
    return filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [nodes, filter]);

  if (sorted.length === 0) return null;

  return (
    <div className="relative">
      {sorted.map((node) => {
        const isOpen = expanded.has(node.path);
        const isSelected = selectedPath === node.path;
        const fileCount = node.type === 'directory' ? countFiles(node) : 0;
        const fileIcon = node.type === 'file' ? getFileIcon(node.name) : null;

        return (
          <div key={node.path} className="relative">
            {/* Indent guides */}
            {depth > 0 && (
              <div className="absolute inset-y-0 left-0 pointer-events-none" aria-hidden="true">
                {Array.from({ length: depth }, (_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-white/[0.06]"
                    style={{ left: `${i * 16 + 16}px` }}
                  />
                ))}
              </div>
            )}

            <button
              className={`
                group w-full flex items-center gap-1.5 py-[3px] text-[13px] text-left
                transition-colors duration-75 relative
                ${isSelected
                  ? 'bg-brand-500/12 text-gray-100 before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-brand-400'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                }
              `}
              style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: '8px' }}
              onClick={() => {
                if (node.type === 'directory') onToggle(node.path);
                else onSelect(node.path);
              }}
              title={node.path}
            >
              {/* Chevron / spacer */}
              {node.type === 'directory' ? (
                <span className={`flex-shrink-0 w-4 h-4 flex items-center justify-center transition-transform duration-100 ${isOpen ? '' : ''} text-gray-500`}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              ) : (
                <span className="w-4 flex-shrink-0" />
              )}

              {/* Icon */}
              {node.type === 'directory' ? (
                <span className="text-amber-400/80 flex-shrink-0">
                  {isOpen ? <FolderOpen size={15} /> : <Folder size={15} />}
                </span>
              ) : (
                <span className={`flex-shrink-0 ${fileIcon?.color ?? 'text-gray-500'}`}>
                  {fileIcon?.icon}
                </span>
              )}

              {/* Name */}
              <span className={`truncate flex-1 ${isSelected ? 'font-medium' : ''}`}>
                {node.name}
              </span>

              {/* Directory file count */}
              {node.type === 'directory' && fileCount > 0 && (
                <span className="text-[10px] text-gray-600 flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {fileCount}
                </span>
              )}

              {/* Language badge for files */}
              {node.type === 'file' && node.language && (
                <span className="text-[10px] text-gray-600 flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {node.language}
                </span>
              )}
            </button>

            {/* Children */}
            {node.type === 'directory' && isOpen && node.children && (
              <FileTree
                nodes={node.children}
                expanded={expanded}
                selectedPath={selectedPath}
                onToggle={onToggle}
                onSelect={onSelect}
                depth={depth + 1}
                filter={filter}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
