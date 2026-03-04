import {
  Github, GitBranch, Server, Cloud, Circle, CheckCircle2,
} from 'lucide-react';
import type { CICDPlatformInfo, CICDDetectedConfig } from '../../api/types';

const platformIcons: Record<string, React.ReactNode> = {
  github: <Github size={28} />,
  gitlab: <GitBranch size={28} />,
  server: <Server size={28} />,
  cloud: <Cloud size={28} />,
  'git-branch': <GitBranch size={28} />,
  circle: <Circle size={28} />,
};

interface PlatformCardProps {
  platform: CICDPlatformInfo;
  selected: boolean;
  hasExisting: boolean;
  onClick: () => void;
}

export function PlatformCard({ platform, selected, hasExisting, onClick }: PlatformCardProps) {
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 text-center cursor-pointer group
        ${selected
          ? 'border-brand-500 bg-brand-500/10 '
          : 'border-white/10 bg-surface-2 hover:border-white/20 hover:bg-surface-3'
        }`}
    >
      {/* Existing indicator */}
      {hasExisting && (
        <div className="absolute top-2 right-2">
          <CheckCircle2 size={14} className="text-emerald-400" />
        </div>
      )}

      {/* Icon */}
      <div className={`transition-colors ${selected ? 'text-brand-400' : 'text-gray-400 group-hover:text-gray-200'}`}>
        {platformIcons[platform.icon] ?? <Server size={28} />}
      </div>

      {/* Name */}
      <span className={`text-sm font-medium ${selected ? 'text-brand-300' : 'text-gray-200'}`}>
        {platform.name}
      </span>

      {/* Description */}
      <span className="text-[11px] text-gray-500 leading-tight">
        {platform.description}
      </span>
    </button>
  );
}
