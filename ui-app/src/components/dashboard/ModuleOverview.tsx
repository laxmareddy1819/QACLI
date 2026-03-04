import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import type { ProjectModule } from '../../api/types';
import { useChartTheme } from '../../hooks/useChartTheme';

const COLORS = [
  '#6366f1', '#10b981', '#0ea5e9', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899',
  '#14b8a6', '#f97316',
];

export function ModuleOverview({ modules }: { modules: ProjectModule[] }) {
  const ct = useChartTheme();
  const data = modules.map((m) => ({ name: m.label, value: m.count }));

  if (data.length === 0) return null;

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-base font-semibold text-gray-200 mb-4">Module Distribution</h3>
      <div className="flex items-center gap-4">
        <div className="w-44 h-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={35}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: ct.tooltipBackground,
                  border: ct.tooltipBorder,
                  borderRadius: '8px',
                  fontSize: '13px',
                }}
                itemStyle={{ color: ct.tooltipItemColor }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2 max-h-44 overflow-y-auto">
          {data.map((item, i) => (
            <div key={item.name} className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="text-gray-300 flex-1 truncate">{item.name}</span>
              <span className="text-gray-500 tabular-nums">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
