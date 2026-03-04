import { AlertTriangle, AlertCircle } from 'lucide-react';
import { useHealingAnalytics } from '../../hooks/useHealing';

export function TopFailuresTable({ days }: { days: number }) {
  const { data: analytics, isError, error } = useHealingAnalytics(days);
  const failures = analytics?.topFailures || [];

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load failure data</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  if (failures.length === 0) {
    return (
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">Top Failures</h3>
        <div className="h-32 flex items-center justify-center text-gray-600 text-sm">
          No failures recorded
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle size={14} className="text-red-400" />
        <h3 className="text-sm font-semibold text-gray-200">Top Failures</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-white/5">
              <th className="text-left py-2 pr-3 font-medium">Selector</th>
              <th className="text-left py-2 pr-3 font-medium">URL</th>
              <th className="text-right py-2 pr-3 font-medium">Failures</th>
              <th className="text-right py-2 font-medium">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {failures.slice(0, 10).map((f, i) => (
              <tr key={i} className="border-b border-white/5 last:border-0">
                <td className="py-2 pr-3 text-gray-300 max-w-[200px] truncate font-mono text-[10px]" title={f.selectorKey}>
                  {f.selectorKey}
                </td>
                <td className="py-2 pr-3 text-gray-400 max-w-[180px] truncate" title={f.url}>
                  {f.url ? new URL(f.url).pathname : '-'}
                </td>
                <td className="py-2 pr-3 text-right">
                  <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-medium">
                    {f.failureCount}
                  </span>
                </td>
                <td className="py-2 text-right text-gray-500">
                  {f.lastSeen ? new Date(f.lastSeen).toLocaleDateString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
