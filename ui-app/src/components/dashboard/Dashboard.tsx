import { useOutletContext, useNavigate } from 'react-router-dom';
import { TestHealthCards } from './TestHealthCards';
import { PassFailTrend } from './PassFailTrend';
import { TopFailures } from './TopFailures';
import { FlakyTests } from './FlakyTests';

import { ActivityFeed } from './ActivityFeed';
import { HealingCard } from './HealingCard';
import { ModuleOverview } from './ModuleOverview';
import { Play, Sparkles, BarChart3 } from 'lucide-react';
import type { ProjectInfo, WSMessage } from '../../api/types';

interface OutletCtx {
  project: ProjectInfo;
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
}

export function Dashboard() {
  const { project, subscribe } = useOutletContext<OutletCtx>();
  const navigate = useNavigate();

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Test Health Dashboard</h1>
          <p className="text-base text-gray-400 mt-0.5">
            {project.framework || 'Auto-detect'} &middot; {project.stats.totalFiles} files &middot; {project.stats.totalModules} modules
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/results')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-gray-300 text-[15px] border border-white/5 transition-colors"
          >
            <BarChart3 size={16} />
            Results
          </button>
          <button
            onClick={() => navigate('/runner')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium transition-colors"
          >
            <Play size={16} />
            Run Tests
          </button>
          <button
            onClick={() => navigate('/ai')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-2 hover:bg-surface-3 text-gray-300 text-[15px] border border-white/5 transition-colors"
          >
            <Sparkles size={16} />
            AI Assistant
          </button>
        </div>
      </div>

      {/* Test Health Cards */}
      <TestHealthCards />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PassFailTrend />
        <ModuleOverview modules={project.modules} />
      </div>

      {/* Failures + Flaky + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TopFailures />
        <FlakyTests />
        <ActivityFeed subscribe={subscribe} />
      </div>

      {/* Self-Healing — only renders if healing data is available */}
      <HealingCard />
    </div>
  );
}
