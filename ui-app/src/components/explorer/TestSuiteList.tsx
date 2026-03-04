import { useState, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, FolderOpen, Search,
  CheckCircle2, XCircle, MinusCircle, Circle,
  Play, X,
} from 'lucide-react';
import type { ExplorerTestSuite, ExplorerTestCase, TestFramework } from '../../api/types';

// ── Types ────────────────────────────────────────────────────────────────────

export type StatusFilter = 'all' | 'passed' | 'failed' | 'norun';

interface TestSuiteListProps {
  suites: ExplorerTestSuite[];
  statusFilter: StatusFilter;
  frameworkFilter: string; // 'all' or a specific framework
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectTest: (test: ExplorerTestCase, suite: ExplorerTestSuite) => void;
  onRunTest?: (test: ExplorerTestCase, suite: ExplorerTestSuite) => void;
  onRunSuite?: (suite: ExplorerTestSuite) => void;
}

// ── Framework Badge ──────────────────────────────────────────────────────────

const FRAMEWORK_CONFIG: Record<string, { label: string; color: string }> = {
  playwright: { label: 'Playwright', color: 'bg-purple-500/20 text-purple-300' },
  jest:       { label: 'Jest', color: 'bg-red-500/20 text-red-300' },
  vitest:     { label: 'Vitest', color: 'bg-yellow-500/20 text-yellow-300' },
  cypress:    { label: 'Cypress', color: 'bg-green-500/20 text-green-300' },
  cucumber:   { label: 'Cucumber', color: 'bg-amber-500/20 text-amber-300' },
  mocha:      { label: 'Mocha', color: 'bg-orange-500/20 text-orange-300' },
  pytest:     { label: 'Pytest', color: 'bg-blue-500/20 text-blue-300' },
  junit:      { label: 'JUnit', color: 'bg-cyan-500/20 text-cyan-300' },
  testng:     { label: 'TestNG', color: 'bg-teal-500/20 text-teal-300' },
  nunit:      { label: 'NUnit', color: 'bg-indigo-500/20 text-indigo-300' },
  xunit:      { label: 'xUnit', color: 'bg-indigo-500/20 text-indigo-300' },
  mstest:     { label: 'MSTest', color: 'bg-blue-500/20 text-blue-300' },
  rspec:      { label: 'RSpec', color: 'bg-rose-500/20 text-rose-300' },
  robot:      { label: 'Robot', color: 'bg-sky-500/20 text-sky-300' },
};

export function FrameworkBadge({ framework }: { framework: TestFramework }) {
  const c = FRAMEWORK_CONFIG[framework] || {
    label: framework.slice(0, 3).toUpperCase(),
    color: 'bg-gray-500/20 text-gray-300',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${c.color}`}>
      {c.label}
    </span>
  );
}

// ── Status Icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status, size = 14 }: { status?: string; size?: number }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 size={size} className="text-emerald-400" />;
    case 'failed':
      return <XCircle size={size} className="text-red-400" />;
    case 'skipped':
      return <MinusCircle size={size} className="text-gray-500" />;
    default:
      return <Circle size={size} className="text-gray-600" />;
  }
}

// ── Mini Progress Bar ────────────────────────────────────────────────────────

function MiniProgressBar({ passed, failed, total }: { passed: number; failed: number; total: number }) {
  if (total === 0) return <div className="w-16 h-1.5 rounded-full bg-surface-2" />;

  const passedPct = (passed / total) * 100;
  const failedPct = (failed / total) * 100;

  return (
    <div className="w-16 h-1.5 rounded-full bg-surface-2 overflow-hidden flex">
      {passedPct > 0 && (
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${passedPct}%` }} />
      )}
      {failedPct > 0 && (
        <div className="h-full bg-red-500 transition-all" style={{ width: `${failedPct}%` }} />
      )}
    </div>
  );
}

// ── Run History Dots ─────────────────────────────────────────────────────────

function RunHistoryDots({ test }: { test: ExplorerTestCase }) {
  if (test.runCount === 0) return null;

  // We don't have per-run history here, so show a simple representation
  // based on pass/fail counts (last N as approximation)
  const total = Math.min(test.runCount, 6);
  const failCount = Math.min(test.failCount, total);
  const passCount = total - failCount;

  const dots: string[] = [];
  // Show most recent first: failures then passes (approximation)
  for (let i = 0; i < passCount; i++) dots.push('passed');
  for (let i = 0; i < failCount; i++) dots.push('failed');
  // Reverse so failures show at end (most recent)
  dots.reverse();

  return (
    <div className="flex items-center gap-0.5">
      {dots.map((status, i) => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            status === 'passed' ? 'bg-emerald-400' : 'bg-red-400'
          }`}
        />
      ))}
    </div>
  );
}

// ── Suite Key ────────────────────────────────────────────────────────────────

function suiteKey(suite: ExplorerTestSuite): string {
  return `${suite.file}::${suite.name}`;
}

// ── Filter Helpers ───────────────────────────────────────────────────────────

function testMatchesStatus(test: ExplorerTestCase, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'passed') return test.lastStatus === 'passed';
  if (filter === 'failed') return test.lastStatus === 'failed';
  if (filter === 'norun') return test.runCount === 0;
  return true;
}

function suitePassedCount(suite: ExplorerTestSuite): number {
  return suite.tests.filter(t => t.lastStatus === 'passed').length;
}

function suiteFailedCount(suite: ExplorerTestSuite): number {
  return suite.tests.filter(t => t.lastStatus === 'failed').length;
}

// ── Main Component ───────────────────────────────────────────────────────────

export function TestSuiteList({
  suites,
  statusFilter,
  frameworkFilter,
  searchQuery,
  onSearchChange,
  onSelectTest,
  onRunTest,
  onRunSuite,
}: TestSuiteListProps) {
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());

  // Apply filters
  const filteredSuites = useMemo(() => {
    let result = suites;

    // Framework filter
    if (frameworkFilter !== 'all') {
      result = result.filter(s => s.framework === frameworkFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result
        .map(s => ({
          ...s,
          tests: s.tests.filter(
            t => t.name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
          ),
        }))
        .filter(s => s.tests.length > 0);
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result
        .map(s => ({
          ...s,
          tests: s.tests.filter(t => testMatchesStatus(t, statusFilter)),
        }))
        .filter(s => s.tests.length > 0);
    }

    return result;
  }, [suites, frameworkFilter, searchQuery, statusFilter]);

  // Auto-expand when searching or filtering
  const effectiveExpanded = (searchQuery.trim() || statusFilter !== 'all')
    ? new Set(filteredSuites.map(s => suiteKey(s)))
    : expandedSuites;

  const toggleSuite = (key: string) => {
    setExpandedSuites(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search box */}
      <div className="px-4 py-3 flex-shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search suites and tests..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-surface-2 border border-white/10 rounded-lg pl-9 pr-8 py-2 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-brand-500/50 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Suite cards list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {filteredSuites.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-500">
              {searchQuery ? 'No tests match your search' : 'No tests match the current filters'}
            </p>
          </div>
        ) : (
          filteredSuites.map((suite) => {
            const key = suiteKey(suite);
            const isExpanded = effectiveExpanded.has(key);
            const passed = suitePassedCount(suite);
            const failed = suiteFailedCount(suite);
            const total = suite.tests.length;
            const allPassed = passed === total && total > 0;
            const anyFailed = failed > 0;

            const borderColor = allPassed
              ? 'border-l-emerald-500/40'
              : anyFailed
                ? 'border-l-red-500/40'
                : 'border-l-transparent';

            return (
              <div
                key={key}
                className={`bg-surface-1 border border-white/5 rounded-lg overflow-hidden border-l-2 ${borderColor} transition-all`}
              >
                {/* Suite header */}
                <button
                  onClick={() => toggleSuite(key)}
                  className="w-full flex items-center gap-2.5 px-3 py-3 text-left hover:bg-white/[0.03] transition-colors group"
                >
                  <span className="text-gray-500 flex-shrink-0">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>

                  <FolderOpen size={15} className="text-amber-400/70 flex-shrink-0" />

                  <span className="flex-1 text-sm font-medium text-gray-200 truncate">
                    {suite.name}
                  </span>

                  <FrameworkBadge framework={suite.framework} />

                  {/* Pass/fail fraction */}
                  <span className={`text-[11px] font-medium flex-shrink-0 ${
                    allPassed ? 'text-emerald-400' : anyFailed ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                    {passed}/{total}
                  </span>

                  <MiniProgressBar passed={passed} failed={failed} total={total} />

                  {/* Run suite button (on hover) */}
                  {onRunSuite && (
                    <span
                      onClick={(e) => { e.stopPropagation(); onRunSuite(suite); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-brand-500/20 text-gray-500 hover:text-brand-300 transition-all flex-shrink-0"
                      title="Run all tests in suite"
                    >
                      <Play size={12} />
                    </span>
                  )}
                </button>

                {/* Expanded test rows */}
                {isExpanded && suite.tests.length > 0 && (
                  <div className="border-t border-white/5">
                    {suite.tests.map((test, i) => (
                      <TestRow
                        key={`${test.name}-${test.line || i}`}
                        test={test}
                        suite={suite}
                        isLast={i === suite.tests.length - 1}
                        onSelect={() => onSelectTest(test, suite)}
                        onRun={onRunTest ? () => onRunTest(test, suite) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Test Row ─────────────────────────────────────────────────────────────────

interface TestRowProps {
  test: ExplorerTestCase;
  suite: ExplorerTestSuite;
  isLast: boolean;
  onSelect: () => void;
  onRun?: () => void;
}

function TestRow({ test, isLast, onSelect, onRun }: TestRowProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-4 pl-10 py-2.5 text-left hover:bg-white/[0.04] transition-colors group ${
        !isLast ? 'border-b border-white/[0.03]' : ''
      }`}
    >
      <span className="flex-shrink-0">
        <StatusIcon status={test.lastStatus} size={13} />
      </span>

      <span className="flex-1 text-[13px] text-gray-300 truncate">{test.name}</span>

      {/* Mini run history dots */}
      <RunHistoryDots test={test} />

      {/* Duration from last run */}
      {test.lastStatus && test.runCount > 0 && (
        <span className="text-[10px] text-gray-600 flex-shrink-0 tabular-nums">
          {test.runCount}x
        </span>
      )}

      {/* Run button on hover */}
      {onRun && (
        <span
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-brand-500/20 text-gray-500 hover:text-brand-300 transition-all flex-shrink-0"
          title="Run this test"
        >
          <Play size={11} />
        </span>
      )}
    </button>
  );
}
