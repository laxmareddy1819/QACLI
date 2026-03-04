import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertCircle } from 'lucide-react';
import { useHealingAnalytics } from '../../hooks/useHealing';
import { useChartTheme } from '../../hooks/useChartTheme';

export function HealingTrendChart({ days }: { days: number }) {
  const { data: analytics, isError, error } = useHealingAnalytics(days);
  const ct = useChartTheme();
  const timeline = analytics?.timeline || [];

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load trend data</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">Healing Trend</h3>
        <div className="h-52 flex items-center justify-center text-gray-600 text-sm">
          No healing data yet
        </div>
      </div>
    );
  }

  const chartData = timeline.map((t) => ({
    date: t.date,
    healed: t.healed,
    failed: t.failed,
    rate: t.total > 0 ? Math.round((t.healed / t.total) * 100) : 0,
  }));

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Healing Trend</h3>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridStroke} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.axisFill }} />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: ct.axisFill }} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: ct.axisFill }} />
            <Tooltip
              contentStyle={{ background: ct.tooltipBackground, border: ct.tooltipBorder, borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: ct.tooltipLabelColor }}
            />
            <Area yAxisId="left" type="monotone" dataKey="healed" stackId="1" fill="#22c55e" fillOpacity={0.3} stroke="#22c55e" />
            <Area yAxisId="left" type="monotone" dataKey="failed" stackId="1" fill="#ef4444" fillOpacity={0.3} stroke="#ef4444" />
            <Line yAxisId="right" type="monotone" dataKey="rate" stroke="#a78bfa" strokeWidth={2} dot={false} name="Success %" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
