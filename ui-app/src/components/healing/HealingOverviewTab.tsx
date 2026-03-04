import { HealingTrendChart } from './HealingTrendChart';
import { StrategyBreakdownChart } from './StrategyBreakdownChart';
import { FrameworkBreakdownChart } from './FrameworkBreakdownChart';
import { TopFailuresTable } from './TopFailuresTable';

export function HealingOverviewTab({ days }: { days: number }) {
  return (
    <div className="space-y-6">
      {/* Trend chart - full width */}
      <HealingTrendChart days={days} />

      {/* Strategy + Framework side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StrategyBreakdownChart days={days} />
        <FrameworkBreakdownChart days={days} />
      </div>

      {/* Top failures */}
      <TopFailuresTable days={days} />
    </div>
  );
}
