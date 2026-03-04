import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertCircle } from 'lucide-react';
import { useHealingAnalytics } from '../../hooks/useHealing';
import { useChartTheme } from '../../hooks/useChartTheme';

const FRAMEWORK_COLORS: Record<string, string> = {
  playwright: '#e11d48',
  'playwright-cucumber': '#f97316',
  cypress: '#06b6d4',
  selenium: '#f59e0b',
  webdriverio: '#8b5cf6',
  robotframework: '#22c55e',
  appium: '#6366f1',
  internal: '#3b82f6',
};

export function FrameworkBreakdownChart({ days }: { days: number }) {
  const { data: analytics, isError, error } = useHealingAnalytics(days);
  const ct = useChartTheme();
  const breakdown = analytics?.frameworkBreakdown || [];

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load framework data</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  if (breakdown.length === 0) {
    return (
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">Framework Breakdown</h3>
        <div className="h-52 flex items-center justify-center text-gray-600 text-sm">
          No framework data yet
        </div>
      </div>
    );
  }

  const chartData = breakdown.map((f) => ({
    name: f.framework,
    count: f.count,
    successRate: f.successRate,
  }));

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Framework Breakdown</h3>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridStroke} />
            <XAxis type="number" tick={{ fontSize: 10, fill: ct.axisFill }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: ct.axisFill }} width={90} />
            <Tooltip
              contentStyle={{ background: ct.tooltipBackground, border: ct.tooltipBorder, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: ct.tooltipLabelColor }}
              formatter={(value: number, name: string) => [
                name === 'count' ? `${value} events` : `${value}%`,
                name === 'count' ? 'Count' : 'Success Rate',
              ]}
            />
            <Bar
              dataKey="count"
              radius={[0, 4, 4, 0]}
              fill="#3b82f6"
              fillOpacity={0.8}
              // Color per framework via shape renderer
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        {chartData.map((f) => (
          <div key={f.name} className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: FRAMEWORK_COLORS[f.name] || '#64748b' }} />
            {f.name} ({f.successRate}%)
          </div>
        ))}
      </div>
    </div>
  );
}
