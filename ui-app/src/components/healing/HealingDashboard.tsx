import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Heart, Activity, LayoutList, Fingerprint, FolderOpenDot, Puzzle, FileDown, Lightbulb } from 'lucide-react';
import { HealingOverviewCards } from './HealingOverviewCards';
import { HealingOverviewTab } from './HealingOverviewTab';
import { HealingEventsTable } from './HealingEventsTable';
import { FingerprintBrowser } from './FingerprintBrowser';
import { InjectedProjectsPanel } from './InjectedProjectsPanel';
import { AdaptersList } from './AdaptersList';
import { HealingExportPanel } from './HealingExportPanel';
import { FixSuggestionsPanel } from './FixSuggestionsPanel';

type TabId = 'overview' | 'events' | 'fingerprints' | 'projects' | 'adapters' | 'export' | 'fixes';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <Activity size={16} className="text-brand-400" /> },
  { id: 'events', label: 'Events', icon: <LayoutList size={16} className="text-brand-400" /> },
  { id: 'fingerprints', label: 'Fingerprints', icon: <Fingerprint size={16} className="text-brand-400" /> },
  { id: 'projects', label: 'Projects', icon: <FolderOpenDot size={16} className="text-brand-400" /> },
  { id: 'adapters', label: 'Adapters', icon: <Puzzle size={16} className="text-brand-400" /> },
  { id: 'export', label: 'Export', icon: <FileDown size={16} className="text-brand-400" /> },
  { id: 'fixes', label: 'Fix Suggestions', icon: <Lightbulb size={16} className="text-brand-400" /> },
];

const DAY_OPTIONS = [7, 30, 90];

export function HealingDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabId | null;
  const [activeTab, setActiveTab] = useState<TabId>(tabParam && TABS.some(t => t.id === tabParam) ? tabParam : 'overview');
  const [days, setDays] = useState(30);

  // Sync tab from URL params
  useEffect(() => {
    if (tabParam && TABS.some(t => t.id === tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId });
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Heart size={22} className="text-brand-400" />
          <h1 className="text-2xl font-bold text-gray-100">Self-Healing Dashboard</h1>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="px-3.5 py-2 bg-surface-1 border border-white/10 rounded-xl text-sm text-gray-300 focus:border-brand-400/50 focus:outline-none"
        >
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>Last {d} days</option>
          ))}
        </select>
      </div>

      {/* Overview Cards */}
      <HealingOverviewCards days={days} />

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-white/5 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 text-[15px] font-medium transition-colors relative whitespace-nowrap
              ${activeTab === tab.id
                ? 'text-brand-300'
                : 'text-gray-500 hover:text-gray-300'
              }`}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && <HealingOverviewTab days={days} />}
        {activeTab === 'events' && <HealingEventsTable days={days} />}
        {activeTab === 'fingerprints' && <FingerprintBrowser />}
        {activeTab === 'projects' && <InjectedProjectsPanel />}
        {activeTab === 'adapters' && <AdaptersList />}
        {activeTab === 'export' && <HealingExportPanel days={days} />}
        {activeTab === 'fixes' && <FixSuggestionsPanel days={days} />}
      </div>
    </div>
  );
}
