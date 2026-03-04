import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AlertCircle } from 'lucide-react';
import { useHealingAnalytics } from '../../hooks/useHealing';
import { useChartTheme } from '../../hooks/useChartTheme';

const STRATEGY_COLORS: Record<string, string> = {
  fingerprint: '#3b82f6',
  similarSelector: '#8b5cf6',
  textMatch: '#06b6d4',
  positionMatch: '#f59e0b',
  ancestorSearch: '#ec4899',
  aiHealing: '#10b981',
  visionHealing: '#f43f5e',
};

export function StrategyBreakdownChart({ days }: { days: number }) {
  const { data: analytics, isError, error } = useHealingAnalytics(days);
  const ct = useChartTheme();
  const breakdown = analytics?.strategyBreakdown || [];

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load strategy data</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  if (breakdown.length === 0) {
    return (
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">Strategy Breakdown</h3>
        <div className="h-52 flex items-center justify-center text-gray-600 text-sm">
          No strategy data yet
        </div>
      </div>
    );
  }

  const chartData = breakdown.map((s) => ({
    name: s.strategy,
    count: s.count,
    successRate: s.successRate,
  }));

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Strategy Breakdown</h3>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridStroke} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: ct.axisFill }} />
            <YAxis tick={{ fontSize: 10, fill: ct.axisFill }} />
            <Tooltip
              contentStyle={{ background: ct.tooltipBackground, border: ct.tooltipBorder, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: ct.tooltipLabelColor }}
              formatter={(value: number, name: string) => [
                name === 'count' ? `${value} events` : `${value}%`,
                name === 'count' ? 'Count' : 'Success Rate',
              ]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={STRATEGY_COLORS[entry.name] || '#64748b'} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3">
        {chartData.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STRATEGY_COLORS[s.name] || '#64748b' }} />
            {s.name} ({s.successRate}%)
          </div>
        ))}
      </div>
    </div>
  );
}
