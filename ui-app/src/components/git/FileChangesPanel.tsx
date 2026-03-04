import { RefreshCw } from 'lucide-react';
import { UncommittedDiffViewer } from './UncommittedDiffViewer';
import type { UncommittedDiffFile } from '../../api/client';

interface FileChangesPanelProps {
  files: UncommittedDiffFile[];
  isLoading: boolean;
}

export function FileChangesPanel({ files, isLoading }: FileChangesPanelProps) {
  if (isLoading) {
    return (
      <div className="px-4 py-3 text-xs text-gray-500 flex items-center gap-1.5">
        <RefreshCw size={10} className="animate-spin" /> Loading changes...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-gray-500">
        No uncommitted changes for this file.
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <UncommittedDiffViewer files={files} showGroups={true} defaultExpanded={true} />
    </div>
  );
}
