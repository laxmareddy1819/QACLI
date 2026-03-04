import { useState, useMemo, useCallback } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  TestTube2, FlaskConical, Play, RotateCcw, RefreshCw,
  CheckCircle2, XCircle, Circle, Filter,
} from 'lucide-react';
import { useTestExplorer } from '../../hooks/useTestExplorer';
import { TestSuiteList, FrameworkBadge } from './TestSuiteList';
import type { StatusFilter } from './TestSuiteList';
import { TestDetailPanel } from './TestDetailPanel';
import { LoadingState } from '../shared/LoadingState';
import { EmptyState } from '../shared/EmptyState';
import { startRun } from '../../api/client';
import type { ExplorerTestSuite, ExplorerTestCase, WSMessage } from '../../api/types';

// ── Aggregate Stats ──────────────────────────────────────────────────────────

interface AggregateStats {
  total: number;
  passed: number;
  failed: number;
  noRun: number;
  passRate: number;
}

function computeStats(suites: ExplorerTestSuite[]): AggregateStats {
  let total = 0;
  let passed = 0;
  let failed = 0;
  let noRun = 0;

  for (const suite of suites) {
    for (const test of suite.tests) {
      total++;
      if (test.runCount === 0) noRun++;
      else if (test.lastStatus === 'passed') passed++;
      else if (test.lastStatus === 'failed') failed++;
    }
  }

  const tested = total - noRun;
  const passRate = tested > 0 ? Math.round((passed / tested) * 100 * 10) / 10 : 0;

  return { total, passed, failed, noRun, passRate };
}

// ── Detect unique frameworks ─────────────────────────────────────────────────

function getFrameworks(suites: ExplorerTestSuite[]): string[] {
  const set = new Set<string>();
  for (const s of suites) set.add(s.framework);
  return Array.from(set).sort();
}

// ── Main Component ───────────────────────────────────────────────────────────

export function TestExplorerPage() {
  const { subscribe } = useOutletContext<{
    subscribe: (handler: (msg: WSMessage) => void) => () => void;
  }>();
  const { data, isLoading, error, refetch } = useTestExplorer();

  // View state: list or detail
  const [selectedTest, setSelectedTest] = useState<{
    test: ExplorerTestCase;
    suite: ExplorerTestSuite;
  } | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [frameworkFilter, setFrameworkFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const suites = data?.suites || [];
  const stats = useMemo(() => computeStats(suites), [suites]);
  const frameworks = useMemo(() => getFrameworks(suites), [suites]);

  const handleSelectTest = useCallback((test: ExplorerTestCase, suite: ExplorerTestSuite) => {
    setSelectedTest({ test, suite });
  }, []);

  const handleBack = useCallback(() => {
    setSelectedTest(null);
  }, []);

  const handleRunTest = useCallback(async (test: ExplorerTestCase, _suite: ExplorerTestSuite) => {
    if (test.runCommand) {
      // Just select the test — the detail panel handles running
      setSelectedTest({ test, suite: _suite });
    }
  }, []);

  const handleRunSuite = useCallback(async (suite: ExplorerTestSuite) => {
    // Find the first test with a runCommand and derive the suite-level command
    const firstTest = suite.tests.find(t => t.runCommand);
    if (firstTest?.runCommand) {
      // Try to run the suite command (run the file, not individual test)
      try {
        await startRun({ command: firstTest.runCommand });
      } catch {
        // API error
      }
    }
  }, []);

  // Loading / Error states
  if (isLoading) return <LoadingState text="Scanning test files..." />;

  if (error) {
    return (
      <EmptyState
        title="Error loading tests"
        description={String(error)}
        icon={<FlaskConical size={20} />}
      />
    );
  }

  // Detail view (full-width, replaces list)
  if (selectedTest) {
    return (
      <TestDetailPanel
        test={selectedTest.test}
        suite={selectedTest.suite}
        subscribe={subscribe}
        onBack={handleBack}
      />
    );
  }

  // List view
  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* ── Header Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 bg-surface-1 flex-shrink-0">
        {/* Left: Title */}
        <TestTube2 size={22} className="text-brand-400 flex-shrink-0" />
        <h2 className="text-xl font-bold text-gray-100 flex-shrink-0">Test Explorer</h2>

        {/* Center: Status filter chips */}
        <div className="flex items-center gap-1.5 ml-4">
          <FilterChip
            label="All"
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
          />
          <FilterChip
            label="Passed"
            icon={<CheckCircle2 size={12} />}
            active={statusFilter === 'passed'}
            onClick={() => setStatusFilter('passed')}
            activeColor="text-emerald-300 bg-emerald-500/15 border-emerald-500/30"
          />
          <FilterChip
            label="Failed"
            icon={<XCircle size={12} />}
            active={statusFilter === 'failed'}
            onClick={() => setStatusFilter('failed')}
            activeColor="text-red-300 bg-red-500/15 border-red-500/30"
          />
          <FilterChip
            label="No Run"
            icon={<Circle size={12} />}
            active={statusFilter === 'norun'}
            onClick={() => setStatusFilter('norun')}
            activeColor="text-gray-300 bg-gray-500/15 border-gray-500/30"
          />
        </div>

        {/* Framework filter (only if >1 framework) */}
        {frameworks.length > 1 && (
          <div className="flex items-center gap-1.5 ml-2">
            <Filter size={13} className="text-gray-600" />
            <select
              value={frameworkFilter}
              onChange={(e) => setFrameworkFilter(e.target.value)}
              className="bg-surface-2 border border-white/10 rounded-xl px-3 py-1.5 text-sm text-gray-300 outline-none cursor-pointer"
            >
              <option value="all">All Frameworks</option>
              {frameworks.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        )}

        {/* Right: Actions */}
        <div className="ml-auto flex items-center gap-2">
          {stats.failed > 0 && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-surface-2 hover:bg-surface-3 text-gray-400 hover:text-gray-200 border border-white/5 transition-colors"
              title="Rerun failed tests"
            >
              <RotateCcw size={13} />
              <span className="hidden sm:inline">Rerun Failed</span>
            </button>
          )}
          <button
            onClick={() => refetch()}
            className="p-2 rounded-xl hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* ── Stats Strip ─────────────────────────────────────────────── */}
      <div className="flex items-stretch gap-2 px-4 py-3 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <StatPill label="Total" value={stats.total} />
        <StatPill
          label="Passed"
          value={stats.passed}
          icon={<CheckCircle2 size={11} />}
          color="text-emerald-400"
        />
        <StatPill
          label="Failed"
          value={stats.failed}
          icon={<XCircle size={11} />}
          color="text-red-400"
        />
        <StatPill
          label="No Run"
          value={stats.noRun}
          icon={<Circle size={11} />}
          color="text-gray-500"
        />
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-2/50 border border-white/5">
          <span className={`text-[15px] font-bold ${
            stats.passRate >= 90 ? 'text-emerald-400'
              : stats.passRate >= 70 ? 'text-amber-400'
                : stats.total === 0 ? 'text-gray-500'
                  : 'text-red-400'
          }`}>
            {stats.total > 0 ? `${stats.passRate}%` : '-'}
          </span>
          <span className="text-[10px] text-gray-500">Pass Rate</span>
        </div>
      </div>

      {/* ── Suite List ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {suites.length === 0 ? (
          <EmptyState
            title="No tests found"
            description="No test files found in the project. Add test files (.spec.ts, .test.ts, .feature, test_*.py, *Test.java, etc.) to see them here."
            icon={<FlaskConical size={24} />}
          />
        ) : (
          <TestSuiteList
            suites={suites}
            statusFilter={statusFilter}
            frameworkFilter={frameworkFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectTest={handleSelectTest}
            onRunTest={handleRunTest}
            onRunSuite={handleRunSuite}
          />
        )}
      </div>
    </div>
  );
}

// ── Filter Chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, icon, active, onClick, activeColor }: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  activeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
        active
          ? activeColor || 'text-brand-300 bg-brand-500/15 border-brand-500/30'
          : 'text-gray-500 bg-transparent border-transparent hover:text-gray-300 hover:bg-white/5'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ── Stat Pill ────────────────────────────────────────────────────────────────

function StatPill({ label, value, icon, color }: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-2/50 border border-white/5">
      {icon && <span className={color || 'text-gray-400'}>{icon}</span>}
      <span className={`text-[15px] font-bold ${color || 'text-gray-200'}`}>{value}</span>
      <span className="text-xs text-gray-500">{label}</span>
    </div>
  );
}
