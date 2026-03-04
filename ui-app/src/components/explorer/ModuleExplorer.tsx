import { useState, useMemo } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { useModuleFiles } from '../../hooks/useModules';
import { useExpandedPaths } from '../../hooks/useFileTree';
import { FileTree } from './FileTree';
import { FileViewer } from './FileViewer';
import { BreadcrumbNav } from './BreadcrumbNav';
import { LoadingState } from '../shared/LoadingState';
import { EmptyState } from '../shared/EmptyState';
import { Badge } from '../shared/Badge';
import { FolderOpen } from 'lucide-react';
import type { ProjectInfo, FileNode } from '../../api/types';

export function ModuleExplorer() {
  const { moduleId } = useParams<{ moduleId: string }>();
  const { project } = useOutletContext<{ project: ProjectInfo }>();
  const { data, isLoading } = useModuleFiles(moduleId);
  const { expanded, toggle } = useExpandedPaths();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const mod = project.modules.find((m) => m.id === moduleId);

  // Build a simple tree from flat file list
  const fileNodes: FileNode[] = useMemo(() => {
    if (!data?.files) return [];
    return data.files.map((f) => ({
      name: f.name,
      path: f.path,
      type: 'file' as const,
      language: f.language,
    }));
  }, [data]);

  if (!mod) {
    return <EmptyState title="Module not found" description={`No module with id "${moduleId}"`} />;
  }

  if (isLoading) return <LoadingState text={`Loading ${mod.label}...`} />;

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Module header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-100">{mod.label}</h2>
        <Badge label={`${mod.count} files`} color="gray" />
        <Badge label={mod.language} color="blue" />
        <div className="flex-1" />
        <BreadcrumbNav path={selectedFile ?? mod.path} onNavigate={() => setSelectedFile(null)} />
      </div>

      {/* Split pane */}
      <div className="flex-1 flex overflow-hidden">
        {/* File tree */}
        <div className="w-64 border-r border-white/5 overflow-y-auto bg-surface-1 flex-shrink-0">
          {fileNodes.length === 0 ? (
            <EmptyState title="No files" description="This module has no source files" icon={<FolderOpen size={20} />} />
          ) : (
            <div className="py-1">
              <FileTree
                nodes={fileNodes}
                expanded={expanded}
                selectedPath={selectedFile}
                onToggle={toggle}
                onSelect={setSelectedFile}
              />
            </div>
          )}
        </div>

        {/* File viewer */}
        <div className="flex-1 overflow-hidden">
          <FileViewer filePath={selectedFile} />
        </div>
      </div>
    </div>
  );
}
