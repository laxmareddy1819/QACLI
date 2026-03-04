import { Activity, CheckCircle, Clock, Cpu, Sparkles, FolderOpen, AlertCircle } from 'lucide-react';
import { useHealingAnalytics, useHealingInjections } from '../../hooks/useHealing';

export function HealingOverviewCards({ days }: { days: number }) {
  const { data: analytics, isError, error } = useHealingAnalytics(days);
  const { data: injData } = useHealingInjections('active');

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load healing overview</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Events',
      value: analytics?.totalEvents ?? 0,
      sub: `${analytics?.totalHealed ?? 0} healed, ${analytics?.totalFailed ?? 0} failed`,
      icon: <Activity size={14} />,
      color: 'text-blue-400',
    },
    {
      label: 'Success Rate',
      value: `${analytics?.overallSuccessRate ?? 0}%`,
      sub: `last ${days} days`,
      icon: <CheckCircle size={14} />,
      color: (analytics?.overallSuccessRate ?? 0) >= 80 ? 'text-emerald-400' : (analytics?.overallSuccessRate ?? 0) >= 50 ? 'text-amber-400' : 'text-red-400',
      bg: (analytics?.overallSuccessRate ?? 0) >= 80 ? 'bg-emerald-500/10' : (analytics?.overallSuccessRate ?? 0) >= 50 ? 'bg-amber-500/10' : 'bg-red-500/10',
    },
    {
      label: 'Avg Confidence',
      value: analytics?.averageConfidence ?? 0,
      sub: 'score 0-1',
      icon: <CheckCircle size={14} />,
      color: 'text-brand-400',
    },
    {
      label: 'Avg Duration',
      value: `${analytics?.averageDurationMs ?? 0}ms`,
      sub: 'per heal attempt',
      icon: <Clock size={14} />,
      color: 'text-cyan-400',
    },
    {
      label: 'AI Usage',
      value: `${analytics?.aiHealingRate ?? 0}%`,
      sub: 'AI-powered heals',
      icon: <Sparkles size={14} />,
      color: 'text-violet-400',
    },
    {
      label: 'Active Projects',
      value: injData?.total ?? 0,
      sub: 'with healing injected',
      icon: <FolderOpen size={14} />,
      color: 'text-brand-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div key={card.label} className={`${card.bg || 'bg-surface-1'} rounded-xl border border-white/5 p-4`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] text-gray-500">{card.label}</p>
            <span className={card.color}>{card.icon}</span>
          </div>
          <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          <p className="text-[10px] text-gray-500 mt-1">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}
