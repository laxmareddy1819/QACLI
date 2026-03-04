import { useState, useMemo } from 'react';
import {
  ChevronRight, ChevronDown, FolderOpen, FileText,
  CheckCircle2, XCircle, MinusCircle, Circle,
  Search,
} from 'lucide-react';
import type { ExplorerTestSuite, ExplorerTestCase, TestFramework } from '../../api/types';

interface TestTreeProps {
  suites: ExplorerTestSuite[];
  selectedTest: string | null;
  onSelectTest: (name: string, suite: ExplorerTestSuite) => void;
}

export function TestTree({ suites, selectedTest, onSelectTest }: TestTreeProps) {
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSuites = useMemo(() => {
    if (!searchQuery.trim()) return suites;
    const q = searchQuery.toLowerCase();
    return suites
      .map(s => ({
        ...s,
        tests: s.tests.filter(
          t => t.name.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
        ),
      }))
      .filter(s => s.tests.length > 0);
  }, [suites, searchQuery]);

  const toggleSuite = (key: string) => {
    setExpandedSuites(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Auto-expand all when searching
  const effectiveExpanded = searchQuery.trim()
    ? new Set(filteredSuites.map(s => suiteKey(s)))
    : expandedSuites;

  return (
    <div className="flex flex-col h-full">
      {/* Search box */}
      <div className="p-2 border-b border-white/5">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search tests..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-2 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 outline-none focus:border-brand-500/50"
          />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredSuites.length === 0 ? (
          <div className="p-4 text-center text-xs text-gray-500">
            {searchQuery ? 'No tests match your search' : 'No test files found'}
          </div>
        ) : (
          filteredSuites.map((suite) => (
            <SuiteNode
              key={suiteKey(suite)}
              suite={suite}
              isExpanded={effectiveExpanded.has(suiteKey(suite))}
              selectedTest={selectedTest}
              onToggle={() => toggleSuite(suiteKey(suite))}
              onSelectTest={(test) => onSelectTest(test.name, suite)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function suiteKey(suite: ExplorerTestSuite): string {
  return `${suite.file}::${suite.name}`;
}

// ── Framework Badge ──────────────────────────────────────────────────────────

const FRAMEWORK_CONFIG: Record<string, { label: string; color: string }> = {
  playwright: { label: 'PW', color: 'bg-purple-500/20 text-purple-300' },
  jest:       { label: 'Jest', color: 'bg-red-500/20 text-red-300' },
  vitest:     { label: 'Vite', color: 'bg-yellow-500/20 text-yellow-300' },
  cypress:    { label: 'Cy', color: 'bg-green-500/20 text-green-300' },
  cucumber:   { label: 'Cuc', color: 'bg-amber-500/20 text-amber-300' },
  mocha:      { label: 'Mch', color: 'bg-orange-500/20 text-orange-300' },
  pytest:     { label: 'Py', color: 'bg-blue-500/20 text-blue-300' },
  junit:      { label: 'JU', color: 'bg-cyan-500/20 text-cyan-300' },
  testng:     { label: 'TNG', color: 'bg-teal-500/20 text-teal-300' },
  nunit:      { label: 'NU', color: 'bg-indigo-500/20 text-indigo-300' },
  xunit:      { label: 'xU', color: 'bg-indigo-500/20 text-indigo-300' },
  mstest:     { label: 'MS', color: 'bg-blue-500/20 text-blue-300' },
  rspec:      { label: 'RS', color: 'bg-rose-500/20 text-rose-300' },
  robot:      { label: 'RF', color: 'bg-sky-500/20 text-sky-300' },
};

export function FrameworkBadge({ framework }: { framework: TestFramework }) {
  const c = FRAMEWORK_CONFIG[framework] || { label: framework.slice(0, 3).toUpperCase(), color: 'bg-gray-500/20 text-gray-300' };
  return (
    <span className={`inline-flex items-center px-1 py-0 rounded text-[9px] font-medium flex-shrink-0 ${c.color}`}>
      {c.label}
    </span>
  );
}

// ── Suite Node ───────────────────────────────────────────────────────────────

interface SuiteNodeProps {
  suite: ExplorerTestSuite;
  isExpanded: boolean;
  selectedTest: string | null;
  onToggle: () => void;
  onSelectTest: (test: ExplorerTestCase) => void;
}

function SuiteNode({ suite, isExpanded, selectedTest, onToggle, onSelectTest }: SuiteNodeProps) {
  const tests = suite.tests;
  const withHistory = tests.filter(t => t.runCount > 0);
  const allPassed = withHistory.length > 0 && withHistory.every(t => t.lastStatus === 'passed');
  const anyFailed = withHistory.some(t => t.lastStatus === 'failed');

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-left hover:bg-white/5 transition-colors group"
      >
        <span className="text-gray-500 w-4 flex-shrink-0">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="text-amber-400/70 flex-shrink-0">
          <FolderOpen size={14} />
        </span>
        <span className="flex-1 truncate text-gray-200 font-medium">{suite.name}</span>

        <FrameworkBadge framework={suite.framework} />

        {/* Mini status indicator */}
        {withHistory.length > 0 && (
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
            allPassed ? 'bg-emerald-400' : anyFailed ? 'bg-red-400' : 'bg-gray-500'
          }`} />
        )}

        <span className="text-[10px] text-gray-600 flex-shrink-0 ml-1">
          {suite.testCount}
        </span>
      </button>

      {isExpanded && (
        <div>
          {tests.map((test) => (
            <TestNode
              key={`${test.name}-${test.line || 0}`}
              test={test}
              isSelected={selectedTest === test.name}
              onSelect={() => onSelectTest(test)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Test Node ────────────────────────────────────────────────────────────────

interface TestNodeProps {
  test: ExplorerTestCase;
  isSelected: boolean;
  onSelect: () => void;
}

function TestNode({ test, isSelected, onSelect }: TestNodeProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-1.5 pl-9 pr-2 py-1.5 text-xs text-left transition-colors ${
        isSelected
          ? 'bg-brand-500/15 text-brand-300'
          : 'text-gray-300 hover:bg-white/5'
      }`}
    >
      <span className="flex-shrink-0">
        <StatusIcon status={test.lastStatus} />
      </span>
      <span className="flex-shrink-0 text-gray-500">
        <FileText size={12} />
      </span>
      <span className="flex-1 truncate">{test.name}</span>
      {test.runCount > 0 && (
        <span className="text-[10px] text-gray-600 flex-shrink-0">
          {test.runCount}x
        </span>
      )}
    </button>
  );
}

// ── Status Icon ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status?: string }) {
  switch (status) {
    case 'passed':
      return <CheckCircle2 size={12} className="text-emerald-400" />;
    case 'failed':
      return <XCircle size={12} className="text-red-400" />;
    case 'skipped':
      return <MinusCircle size={12} className="text-gray-500" />;
    default:
      return <Circle size={12} className="text-gray-600" />;
  }
}
