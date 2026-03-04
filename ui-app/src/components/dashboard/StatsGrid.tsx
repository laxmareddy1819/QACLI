import {
  FlaskConical, BookOpen, Globe, Database, FileBox, Wrench,
  FileText, FolderCog, FileKey, Tag, Footprints, LayoutList, FolderOpen,
} from 'lucide-react';
import type { ProjectModule } from '../../api/types';

const iconComponents: Record<string, React.ReactNode> = {
  flask: <FlaskConical size={20} />,
  book: <BookOpen size={20} />,
  footprints: <Footprints size={20} />,
  globe: <Globe size={20} />,
  database: <Database size={20} />,
  'file-box': <FileBox size={20} />,
  wrench: <Wrench size={20} />,
  'file-text': <FileText size={20} />,
  'folder-cog': <FolderCog size={20} />,
  'file-key': <FileKey size={20} />,
  tag: <Tag size={20} />,
  'layout-list': <LayoutList size={20} />,
  'folder-open': <FolderOpen size={20} />,
};

const gradients: string[] = [
  'from-brand-500/20 to-brand-600/5',
  'from-emerald-500/20 to-emerald-600/5',
  'from-sky-500/20 to-sky-600/5',
  'from-amber-500/20 to-amber-600/5',
  'from-rose-500/20 to-rose-600/5',
  'from-violet-500/20 to-violet-600/5',
  'from-cyan-500/20 to-cyan-600/5',
  'from-fuchsia-500/20 to-fuchsia-600/5',
];

export function StatsGrid({ modules }: { modules: ProjectModule[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {modules.map((mod, i) => (
        <div
          key={mod.id}
          className={`relative overflow-hidden rounded-xl bg-gradient-to-br ${gradients[i % gradients.length]} border border-white/5 p-4 hover:border-white/10 transition-all group cursor-pointer`}
        >
          <div className="flex items-start justify-between mb-3">
            <div className="w-9 h-9 rounded-lg bg-surface-1/80 flex items-center justify-center text-gray-300 group-hover:scale-110 transition-transform">
              {iconComponents[mod.icon] ?? <FolderOpen size={20} />}
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-100">{mod.count}</div>
          <div className="text-xs text-gray-400 mt-0.5 truncate">{mod.label}</div>
          <div className="text-[10px] text-gray-500 mt-1 truncate">{mod.path}</div>
        </div>
      ))}
    </div>
  );
}
