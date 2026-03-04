import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart } from 'recharts';
import { useTestTrends } from '../../hooks/useTestResults';
import { useChartTheme } from '../../hooks/useChartTheme';

export function PassFailTrend() {
  const { data } = useTestTrends(20);
  const ct = useChartTheme();
  const trends = data?.trends || [];

  if (trends.length === 0) {
    return (
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <h3 className="text-base font-semibold text-gray-200 mb-4">Test Trend</h3>
        <div className="h-52 flex items-center justify-center text-gray-600 text-sm">
          No test runs yet. Run tests to see trends.
        </div>
      </div>
    );
  }

  const chartData = trends.map((t, i) => ({
    run: `#${i + 1}`,
    passed: t.passed,
    failed: t.failed,
    skipped: t.skipped,
    passRate: t.passRate,
  }));

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-base font-semibold text-gray-200 mb-4">Test Trend</h3>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridStroke} />
            <XAxis dataKey="run" tick={{ fontSize: 11, fill: ct.axisFill }} />
            <YAxis yAxisId="left" tick={{ fontSize: 11, fill: ct.axisFill }} />
            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: ct.axisFill }} />
            <Tooltip
              contentStyle={{ background: ct.tooltipBackground, border: ct.tooltipBorder, borderRadius: 8, fontSize: 13 }}
              labelStyle={{ color: ct.tooltipLabelColor }}
            />
            <Area yAxisId="left" type="monotone" dataKey="passed" stackId="1" fill="#22c55e" fillOpacity={0.3} stroke="#22c55e" />
            <Area yAxisId="left" type="monotone" dataKey="failed" stackId="1" fill="#ef4444" fillOpacity={0.3} stroke="#ef4444" />
            <Area yAxisId="left" type="monotone" dataKey="skipped" stackId="1" fill="#64748b" fillOpacity={0.2} stroke="#64748b" />
            <Line yAxisId="right" type="monotone" dataKey="passRate" stroke="#a78bfa" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
