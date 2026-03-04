import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAuditLog, getUsers, getAuditStats, exportAuditLog, type AuditEntry } from '../../api/client';
import { Badge } from '../shared/Badge';
import {
  ScrollText, Download, ChevronDown, ChevronRight,
  LogIn, LogOut, UserPlus, Shield, Play, FileEdit,
  GitCommit, Settings, Sparkles, AlertCircle,
} from 'lucide-react';

const ACTION_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  'auth.login': { icon: <LogIn size={14} />, color: 'text-emerald-400' },
  'auth.logout': { icon: <LogOut size={14} />, color: 'text-gray-400' },
  'auth.login_failed': { icon: <AlertCircle size={14} />, color: 'text-red-400' },
  'auth.password_change': { icon: <Shield size={14} />, color: 'text-amber-400' },
  'auth.setup': { icon: <Shield size={14} />, color: 'text-brand-400' },
  'user.create': { icon: <UserPlus size={14} />, color: 'text-brand-400' },
  'user.update': { icon: <Settings size={14} />, color: 'text-sky-400' },
  'user.delete': { icon: <AlertCircle size={14} />, color: 'text-red-400' },
  'user.role_change': { icon: <Shield size={14} />, color: 'text-amber-400' },
  'user.disable': { icon: <AlertCircle size={14} />, color: 'text-red-400' },
  'user.enable': { icon: <UserPlus size={14} />, color: 'text-emerald-400' },
  'run.start': { icon: <Play size={14} />, color: 'text-emerald-400' },
  'run.cancel': { icon: <AlertCircle size={14} />, color: 'text-amber-400' },
  'file.create': { icon: <FileEdit size={14} />, color: 'text-sky-400' },
  'file.update': { icon: <FileEdit size={14} />, color: 'text-sky-400' },
  'file.delete': { icon: <FileEdit size={14} />, color: 'text-red-400' },
  'git.commit': { icon: <GitCommit size={14} />, color: 'text-emerald-400' },
  'git.push': { icon: <GitCommit size={14} />, color: 'text-brand-400' },
  'git.pull': { icon: <GitCommit size={14} />, color: 'text-sky-400' },
  'ai.generate': { icon: <Sparkles size={14} />, color: 'text-purple-400' },
  'ai.fix': { icon: <Sparkles size={14} />, color: 'text-purple-400' },
  'ai.chat': { icon: <Sparkles size={14} />, color: 'text-purple-400' },
};

function getActionMeta(action: string) {
  return ACTION_ICONS[action] ?? { icon: <Settings size={14} />, color: 'text-gray-400' };
}

const PAGE_SIZE = 50;

const ACTION_FILTER_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'auth.*', label: 'Authentication' },
  { value: 'user.*', label: 'User Management' },
  { value: 'run.*', label: 'Test Runs' },
  { value: 'file.*', label: 'File Operations' },
  { value: 'git.*', label: 'Git Operations' },
  { value: 'ai.*', label: 'AI Actions' },
  { value: 'settings.*', label: 'Settings' },
];

export function AuditLogPage() {
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: getUsers });
  const { data: statsData } = useQuery({ queryKey: ['audit-stats'], queryFn: getAuditStats });

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, actionFilter, userFilter],
    queryFn: () => getAuditLog({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      action: actionFilter || undefined,
      userId: userFilter || undefined,
    }),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleExport = async () => {
    try {
      const result = await exportAuditLog();
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText size={24} className="text-brand-400" />
          <h1 className="text-2xl font-bold text-gray-100">Audit Log</h1>
          {total > 0 && <Badge label={`${total} entries`} color="gray" />}
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-surface-2 hover:bg-surface-3 text-gray-300 text-[15px] rounded-xl border border-white/5 transition-colors"
        >
          <Download size={14} />
          Export JSON
        </button>
      </div>

      {/* Stats cards */}
      {statsData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Events" value={statsData.totalEntries} />
          <StatCard label="Unique Users" value={statsData.uniqueUsers} />
          <StatCard label="Logins (24h)" value={statsData.recentLoginCount} color="emerald" />
          <StatCard label="Failed Logins (24h)" value={statsData.recentFailedLogins} color={statsData.recentFailedLogins > 0 ? 'red' : 'gray'} />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
          className="px-3.5 py-2 bg-surface-2 border border-white/10 rounded-xl text-[15px] text-gray-300 focus:outline-none focus:border-brand-500/50"
        >
          {ACTION_FILTER_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <select
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setPage(0); }}
          className="px-3.5 py-2 bg-surface-2 border border-white/10 rounded-xl text-[15px] text-gray-300 focus:outline-none focus:border-brand-500/50"
        >
          <option value="">All Users</option>
          {usersData?.users.map(u => (
            <option key={u.id} value={u.id}>{u.displayName} (@{u.username})</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-gray-500">Loading audit log...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12">
          <ScrollText size={40} className="mx-auto text-gray-600 mb-3" />
          <p className="text-gray-400">No audit entries found</p>
          <p className="text-xs text-gray-600 mt-1">Entries will appear as users perform actions</p>
        </div>
      ) : (
        <div className="bg-surface-1 rounded-xl border border-white/5 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 text-sm text-gray-500">
                <th className="text-left px-4 py-3 font-medium w-8" />
                <th className="text-left px-4 py-3 font-medium">Timestamp</th>
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {entries.map((entry) => {
                const meta = getActionMeta(entry.action);
                const isExpanded = expandedId === entry.id;
                return (
                  <RowGroup key={entry.id}>
                    <tr
                      className="hover:bg-white/[0.02] cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    >
                      <td className="px-4 py-2.5 text-gray-500">
                        {entry.details ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                        {formatTimestamp(entry.timestamp)}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-300">
                        @{entry.username}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`flex items-center gap-1.5 text-sm ${meta.color}`}>
                          {meta.icon}
                          {formatAction(entry.action)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">
                        {entry.resourceType && (
                          <span>
                            {entry.resourceType}
                            {entry.resourceId && <span className="text-gray-600"> / {entry.resourceId}</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && entry.details && (
                      <tr className="bg-surface-2/50">
                        <td colSpan={5} className="px-8 py-3">
                          <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap">
                            {JSON.stringify(entry.details, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </RowGroup>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[15px]">
          <span className="text-gray-500">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-4 py-1.5 bg-surface-2 rounded-xl text-gray-400 hover:text-gray-200 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-gray-500">Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-4 py-1.5 bg-surface-2 rounded-xl text-gray-400 hover:text-gray-200 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function StatCard({ label, value, color = 'gray' }: { label: string; value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    gray: 'text-gray-200',
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    brand: 'text-brand-400',
  };
  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colorMap[color] ?? colorMap.gray}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60_000) return 'Just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;

  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatAction(action: string): string {
  return action
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
