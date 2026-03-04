import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { RunResult } from '../../api/types';
import { useChartTheme } from '../../hooks/useChartTheme';

export function TrendChart({ history }: { history: RunResult[] }) {
  const ct = useChartTheme();
  // Build chart data from run history (most recent 20)
  const data = history
    .filter((r) => r.status !== 'running')
    .slice(0, 20)
    .reverse()
    .map((r, i) => ({
      run: `#${i + 1}`,
      duration: r.duration ? Math.round(r.duration / 1000) : 0,
      passed: r.status === 'completed' ? 1 : 0,
      failed: r.status === 'failed' ? 1 : 0,
    }));

  if (data.length === 0) {
    return (
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <h3 className="text-sm font-semibold text-gray-200 mb-4">Execution Trend</h3>
        <div className="h-40 flex items-center justify-center text-sm text-gray-500">
          No runs yet. Execute tests to see trends.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-sm font-semibold text-gray-200 mb-4">Execution Trend</h3>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridStroke} />
            <XAxis dataKey="run" tick={{ fontSize: 10, fill: ct.axisFill }} />
            <YAxis tick={{ fontSize: 10, fill: ct.axisFill }} />
            <Tooltip
              contentStyle={{
                background: ct.tooltipBackground,
                border: ct.tooltipBorder,
                borderRadius: '8px',
                fontSize: '12px',
              }}
              itemStyle={{ color: ct.tooltipItemColor }}
            />
            <Line type="monotone" dataKey="duration" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} name="Duration (s)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
