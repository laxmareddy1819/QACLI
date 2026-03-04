import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Play, Sparkles, Settings,
  FlaskConical, BookOpen, Footprints, Globe, Database,
  FileBox, Wrench, FileText, FolderCog, FileKey,
  Tag, LayoutList, FolderOpen, HelpCircle,
  BarChart3, TestTube2, Workflow, Calendar, Send, GitBranch,
  Users, ScrollText, Heart,
} from 'lucide-react';
import type { ProjectModule } from '../../api/types';
import { useAuth } from '../../hooks/useAuth';

const iconMap: Record<string, React.ReactNode> = {
  'layout-dashboard': <LayoutDashboard size={18} />,
  flask: <FlaskConical size={18} />,
  book: <BookOpen size={18} />,
  footprints: <Footprints size={18} />,
  globe: <Globe size={18} />,
  database: <Database size={18} />,
  'file-box': <FileBox size={18} />,
  wrench: <Wrench size={18} />,
  'file-text': <FileText size={18} />,
  'folder-cog': <FolderCog size={18} />,
  'file-key': <FileKey size={18} />,
  tag: <Tag size={18} />,
  'layout-list': <LayoutList size={18} />,
  'folder-open': <FolderOpen size={18} />,
};

function getIcon(iconName: string): React.ReactNode {
  return iconMap[iconName] ?? <HelpCircle size={18} />;
}

interface SidebarProps {
  modules: ProjectModule[];
  collapsed: boolean;
  onToggle: () => void;
  hasActiveRun?: boolean;
}

export function DynamicSidebar({ modules, collapsed, hasActiveRun }: SidebarProps) {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');

  return (
    <aside
      className={`flex flex-col bg-surface-1 border-r border-white/5 flex-shrink-0 overflow-y-auto transition-all duration-200 ${
        collapsed ? 'w-14' : 'w-56'
      }`}
    >
      <nav className="flex-1 py-2 space-y-0.5">
        {/* Dashboard — always first */}
        <SidebarLink to="/" icon={<LayoutDashboard size={18} />} label="Dashboard" collapsed={collapsed} />
        <SidebarLink
          to="/runner"
          icon={<Play size={18} />}
          label="Runner"
          collapsed={collapsed}
          indicator={hasActiveRun ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-400" />
            </span>
          ) : undefined}
        />
        <SidebarLink to="/tests" icon={<TestTube2 size={18} />} label="Test Explorer" collapsed={collapsed} />
        <SidebarLink to="/results" icon={<BarChart3 size={18} />} label="Results" collapsed={collapsed} />
        <SidebarLink to="/healing" icon={<Heart size={18} />} label="Healing" collapsed={collapsed} />
        <SidebarLink to="/api-testing" icon={<Send size={18} />} label="API Testing" collapsed={collapsed} />
        <SidebarLink to="/cicd" icon={<Workflow size={18} />} label="CI/CD" collapsed={collapsed} />
        <SidebarLink to="/schedules" icon={<Calendar size={18} />} label="Schedules" collapsed={collapsed} />

        {/* Separator */}
        <div className="px-3 pt-4 pb-1">
          {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Project</span>}
        </div>

        {/* Project Explorer */}
        <SidebarLink to="/explorer" icon={<FolderOpen size={18} />} label="Explorer" collapsed={collapsed} />

        {/* Tools separator */}
        <div className="px-3 pt-4 pb-1">
          {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Tools</span>}
        </div>
        <SidebarLink to="/git" icon={<GitBranch size={18} />} label="Git" collapsed={collapsed} />
        <SidebarLink to="/ai" icon={<Sparkles size={18} />} label="AI Assistant" collapsed={collapsed} />
        <SidebarLink to="/settings" icon={<Settings size={18} />} label="Settings" collapsed={collapsed} />

        {/* Admin section — visible only to admins */}
        {isAdmin && (
          <>
            <div className="px-3 pt-4 pb-1">
              {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Admin</span>}
            </div>
            <SidebarLink to="/users" icon={<Users size={18} />} label="Users" collapsed={collapsed} />
            <SidebarLink to="/audit" icon={<ScrollText size={18} />} label="Audit Log" collapsed={collapsed} />
          </>
        )}
      </nav>
    </aside>
  );
}

interface SidebarLinkProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  collapsed: boolean;
  indicator?: React.ReactNode;
  activeStyles?: string;
}

function SidebarLink({ to, icon, label, badge, collapsed, indicator, activeStyles }: SidebarLinkProps) {
  const active = activeStyles || 'bg-brand-500/15 text-brand-300 font-medium';
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 mx-2 px-2.5 py-2 rounded-lg text-sm transition-colors
        ${isActive
          ? active
          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
        }
        ${collapsed ? 'justify-center' : ''}`
      }
      title={collapsed ? label : undefined}
    >
      <span className="flex-shrink-0 relative">
        {icon}
        {indicator && collapsed && (
          <span className="absolute -top-0.5 -right-0.5">{indicator}</span>
        )}
      </span>
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{label}</span>
          {indicator && <span className="flex-shrink-0">{indicator}</span>}
          {badge !== undefined && badge > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-surface-2 text-gray-400">
              {badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
