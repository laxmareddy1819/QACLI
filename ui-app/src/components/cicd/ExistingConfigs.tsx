import { FileCode, ExternalLink, CheckCircle2 } from 'lucide-react';
import type { CICDDetectedConfig, CICDPlatformInfo } from '../../api/types';

const platformNames: Record<string, string> = {
  'github-actions': 'GitHub Actions',
  'gitlab-ci': 'GitLab CI',
  'jenkins': 'Jenkins',
  'azure-pipelines': 'Azure Pipelines',
  'bitbucket': 'Bitbucket Pipelines',
  'circleci': 'CircleCI',
};

interface ExistingConfigsProps {
  configs: CICDDetectedConfig[];
  onViewFile?: (filePath: string) => void;
}

export function ExistingConfigs({ configs, onViewFile }: ExistingConfigsProps) {
  if (configs.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={14} className="text-emerald-400" />
        <h3 className="text-sm font-semibold text-gray-200">Existing CI/CD Configurations</h3>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
          {configs.length} found
        </span>
      </div>

      <div className="space-y-1">
        {configs.map((config, i) => (
          <div
            key={`${config.platform}-${config.fileName}-${i}`}
            className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-2 border border-white/5 group"
          >
            <FileCode size={14} className="text-gray-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm text-gray-200 font-medium">{config.fileName}</span>
              <span className="text-[11px] text-gray-500 ml-2">{platformNames[config.platform] ?? config.platform}</span>
            </div>
            <span className="text-[11px] text-gray-500 font-mono truncate max-w-[200px]">
              {config.filePath}
            </span>
            {onViewFile && (
              <button
                onClick={() => onViewFile(config.filePath)}
                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-gray-200 transition-all"
                title="View file"
              >
                <ExternalLink size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
