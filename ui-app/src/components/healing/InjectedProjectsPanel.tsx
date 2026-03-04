import { FolderOpen, Trash2, ExternalLink, FileCode, AlertCircle } from 'lucide-react';
import { useHealingInjections, useRemoveInjection } from '../../hooks/useHealing';
import { useToast } from '../shared/Toast';

export function InjectedProjectsPanel() {
  const { data, isLoading, isError, error } = useHealingInjections();
  const removeMutation = useRemoveInjection();
  const { toast } = useToast();

  const injections = data?.injections || [];

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load projects</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading projects...</div>;
  }

  if (injections.length === 0) {
    return (
      <div className="bg-surface-1 rounded-xl border border-white/5 p-8 text-center">
        <FolderOpen size={32} className="mx-auto text-gray-600 mb-3" />
        <p className="text-sm text-gray-400 mb-1">No injected projects</p>
        <p className="text-xs text-gray-600">
          Use the <span className="font-mono text-brand-400">/heal inject</span> command or{' '}
          <span className="font-mono text-brand-400">heal_project</span> tool to inject self-healing
        </p>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    active: 'bg-emerald-500/10 text-emerald-400',
    disabled: 'bg-amber-500/10 text-amber-400',
    removed: 'bg-red-500/10 text-red-400',
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {injections.map((inj) => (
        <div key={inj.id} className="bg-surface-1 rounded-xl border border-white/5 p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <FolderOpen size={16} className="text-brand-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-200 truncate" title={inj.projectPath}>
                  {inj.projectPath.split(/[\\/]/).pop()}
                </p>
                <p className="text-[10px] text-gray-500 truncate" title={inj.projectPath}>
                  {inj.projectPath}
                </p>
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[inj.status] || 'bg-white/5 text-gray-400'}`}>
              {inj.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400 mb-3">
            <div>
              <span className="text-gray-500">Framework:</span>{' '}
              <span className="text-gray-300">{inj.framework}</span>
            </div>
            <div>
              <span className="text-gray-500">Language:</span>{' '}
              <span className="text-gray-300">{inj.language}</span>
            </div>
            <div>
              <span className="text-gray-500">Confidence:</span>{' '}
              <span className="text-gray-300">{inj.confidenceThreshold}</span>
            </div>
            <div>
              <span className="text-gray-500">AI:</span>{' '}
              <span className={inj.aiEnabled ? 'text-emerald-400' : 'text-gray-500'}>{inj.aiEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>

          {/* Files */}
          <div className="mb-3">
            <p className="text-[10px] text-gray-500 mb-1">Generated files ({inj.filesCreated.length}):</p>
            <div className="flex flex-wrap gap-1">
              {inj.filesCreated.slice(0, 4).map((f) => (
                <span key={f} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-gray-400" title={f}>
                  <FileCode size={8} />
                  {f.split('/').pop()}
                </span>
              ))}
              {inj.filesCreated.length > 4 && (
                <span className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-gray-500">
                  +{inj.filesCreated.length - 4} more
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-gray-500 pt-2 border-t border-white/5">
            <div className="flex items-center gap-1">
              <ExternalLink size={10} />
              <span className="truncate max-w-[180px]" title={inj.healingServerUrl}>{inj.healingServerUrl}</span>
            </div>
            {inj.status !== 'removed' && (
              <button
                onClick={() => removeMutation.mutate(inj.id, {
                  onSuccess: () => toast('success', 'Injection removed successfully'),
                  onError: (err) => toast('error', `Remove failed: ${err}`),
                })}
                disabled={removeMutation.isPending}
                className="flex items-center gap-1 text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 size={10} />
                Remove
              </button>
            )}
          </div>

          <div className="text-[9px] text-gray-600 mt-2">
            Injected: {new Date(inj.injectedAt).toLocaleString()}
            {inj.lastActivityAt && <> | Last activity: {new Date(inj.lastActivityAt).toLocaleString()}</>}
          </div>
        </div>
      ))}
    </div>
  );
}
