import { useState, useMemo } from 'react';
import { CheckCircle, XCircle, MinusCircle, AlertCircle, Search, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { BrowserIcon } from '../shared/BrowserIcon';

interface TestCase {
  name: string;
  suite?: string;
  file?: string;
  status: string;
  duration?: number;
  errorMessage?: string;
  browser?: string;
}

interface Props {
  tests: TestCase[];
  filter?: string;
  onSelectTest: (name: string | null) => void;
  selectedTest: string | null;
}

const statusIcons: Record<string, React.ReactNode> = {
  passed: <CheckCircle size={14} className="text-emerald-400" />,
  failed: <XCircle size={14} className="text-red-400" />,
  skipped: <MinusCircle size={14} className="text-gray-500" />,
  error: <AlertCircle size={14} className="text-amber-400" />,
};

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

// ── Main Component ───────────────────────────────────────────────────────────

export function TestResultsTable({ tests, filter, onSelectTest, selectedTest }: Props) {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'duration' | 'status'>('status');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(filter);

  const handleSort = (col: 'name' | 'duration' | 'status') => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  };

  const filteredTests = useMemo(() => {
    let result = tests;
    if (statusFilter) {
      result = result.filter(t => statusFilter === 'failed' ? (t.status === 'failed' || t.status === 'error') : t.status === statusFilter);
    }
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(t => t.name.toLowerCase().includes(lower) || t.suite?.toLowerCase().includes(lower));
    }
    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'duration') cmp = (a.duration || 0) - (b.duration || 0);
      else if (sortBy === 'status') {
        const order: Record<string, number> = { failed: 0, error: 1, passed: 2, skipped: 3 };
        cmp = (order[a.status] ?? 4) - (order[b.status] ?? 4);
      } else {
        cmp = a.name.localeCompare(b.name);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return result;
  }, [tests, search, statusFilter, sortBy, sortDir]);

  const counts = useMemo(() => ({
    all: tests.length,
    passed: tests.filter(t => t.status === 'passed').length,
    failed: tests.filter(t => t.status === 'failed' || t.status === 'error').length,
    skipped: tests.filter(t => t.status === 'skipped').length,
  }), [tests]);

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ArrowUpDown size={10} className="text-gray-700" />;
    return sortDir === 'asc'
      ? <ArrowUp size={10} className="text-brand-400" />
      : <ArrowDown size={10} className="text-brand-400" />;
  };

  return (
    <div>
      {/* ── Filter Bar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tests..."
            className="w-full pl-10 pr-3.5 py-2 bg-surface-2 border border-white/10 rounded-xl text-sm text-gray-200 outline-none placeholder-gray-600 focus:border-brand-400/50"
          />
        </div>
        <div className="flex gap-1.5">
          <FilterChip
            label={`All (${counts.all})`}
            active={statusFilter === undefined}
            onClick={() => setStatusFilter(undefined)}
          />
          <FilterChip
            label={`Passed (${counts.passed})`}
            icon={<CheckCircle2 size={12} />}
            active={statusFilter === 'passed'}
            onClick={() => setStatusFilter('passed')}
            activeColor="text-emerald-300 bg-emerald-500/15 border-emerald-500/30"
          />
          <FilterChip
            label={`Failed (${counts.failed})`}
            icon={<XCircle size={12} />}
            active={statusFilter === 'failed'}
            onClick={() => setStatusFilter('failed')}
            activeColor="text-red-300 bg-red-500/15 border-red-500/30"
          />
          <FilterChip
            label={`Skipped (${counts.skipped})`}
            icon={<MinusCircle size={12} />}
            active={statusFilter === 'skipped'}
            onClick={() => setStatusFilter('skipped')}
            activeColor="text-gray-300 bg-gray-500/15 border-gray-500/30"
          />
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
              <th className="px-4 py-2.5 text-left w-10">Status</th>
              <th
                className="px-4 py-2.5 text-left cursor-pointer hover:text-gray-300 transition-colors"
                onClick={() => handleSort('name')}
              >
                <span className="flex items-center gap-1.5">
                  Test Name <SortIcon col="name" />
                </span>
              </th>
              <th className="px-4 py-2.5 text-left">Suite</th>
              <th className="px-4 py-2.5 text-left w-28">Browser</th>
              <th
                className="px-4 py-2.5 text-right cursor-pointer hover:text-gray-300 transition-colors w-28"
                onClick={() => handleSort('duration')}
              >
                <span className="flex items-center gap-1.5 justify-end">
                  Duration <SortIcon col="duration" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTests.map((test, i) => (
              <tr
                key={i}
                onClick={() => onSelectTest(test.name === selectedTest ? null : test.name)}
                className={`border-t border-gray-200 cursor-pointer transition-colors bg-white hover:bg-gray-50 ${
                  selectedTest === test.name ? 'ring-2 ring-brand-400 ring-inset' : ''
                }`}
              >
                <td className="px-4 py-3">{statusIcons[test.status] || statusIcons.error}</td>
                <td className="px-4 py-3">
                  <p className="text-sm text-gray-800 truncate max-w-md">{test.name}</p>
                  {test.errorMessage && (
                    <p className="text-xs text-red-600 truncate max-w-md mt-0.5">{test.errorMessage}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[150px]">{test.suite || '—'}</td>
                <td className="px-4 py-3">
                  <BrowserIcon browser={test.browser} size={14} showLabel />
                </td>
                <td className="px-4 py-3 text-right text-gray-500 text-xs">
                  {test.duration != null ? `${(test.duration / 1000).toFixed(1)}s` : '—'}
                </td>
              </tr>
            ))}
            {filteredTests.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-600 text-sm">
                {tests.length === 0 ? 'No test results available' : 'No tests match current filters'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
