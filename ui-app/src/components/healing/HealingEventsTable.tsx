import { useState } from 'react';
import { Search, CheckCircle, XCircle, Sparkles, Clock, AlertCircle, ChevronLeft, ChevronRight, FlaskConical, Footprints, MousePointerClick } from 'lucide-react';
import { useHealingEvents } from '../../hooks/useHealing';
import { HealingEventDetailPanel } from './HealingEventDetailPanel';

const PAGE_SIZE = 25;

interface HealingEvent {
  id: string;
  selectorKey: string;
  url: string;
  framework: string;
  language?: string;
  strategyUsed?: string;
  originalSelector: string;
  healedSelector?: string;
  confidence: number;
  success: boolean;
  durationMs: number;
  aiUsed: boolean;
  scenarioName?: string;
  stepName?: string;
  actionType?: string;
  createdAt: number;
}

export function HealingEventsTable({ days }: { days: number }) {
  const [search, setSearch] = useState('');
  const [frameworkFilter, setFrameworkFilter] = useState<string>('');
  const [successFilter, setSuccessFilter] = useState<string>('');
  const [selectedEvent, setSelectedEvent] = useState<HealingEvent | null>(null);
  const [page, setPage] = useState(0);

  const { data, isLoading, isError, error } = useHealingEvents({
    days,
    framework: frameworkFilter || undefined,
    success: successFilter === '' ? undefined : successFilter === 'true',
    limit: 200,
  });

  const events = data?.events || [];
  const filtered = search
    ? events.filter(
        (e) => {
          const q = search.toLowerCase();
          return (
            e.selectorKey.toLowerCase().includes(q) ||
            e.originalSelector.toLowerCase().includes(q) ||
            (e.healedSelector && e.healedSelector.toLowerCase().includes(q)) ||
            e.url.toLowerCase().includes(q) ||
            (e.scenarioName && e.scenarioName.toLowerCase().includes(q)) ||
            (e.stepName && e.stepName.toLowerCase().includes(q)) ||
            (e.actionType && e.actionType.toLowerCase().includes(q))
          );
        },
      )
    : events;

  const total = filtered.length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load events</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search selectors, scenarios, steps..."
            className="w-full pl-9 pr-3 py-2 bg-surface-1 border border-white/10 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:border-brand-400/50 focus:outline-none"
          />
        </div>
        <select
          value={frameworkFilter}
          onChange={(e) => { setFrameworkFilter(e.target.value); setPage(0); }}
          className="px-3 py-2 bg-surface-1 border border-white/10 rounded-lg text-xs text-gray-300 focus:border-brand-400/50 focus:outline-none"
        >
          <option value="">All Frameworks</option>
          <option value="playwright">Playwright</option>
          <option value="cypress">Cypress</option>
          <option value="selenium">Selenium</option>
          <option value="webdriverio">WebdriverIO</option>
          <option value="internal">Internal</option>
        </select>
        <select
          value={successFilter}
          onChange={(e) => { setSuccessFilter(e.target.value); setPage(0); }}
          className="px-3 py-2 bg-surface-1 border border-white/10 rounded-lg text-xs text-gray-300 focus:border-brand-400/50 focus:outline-none"
        >
          <option value="">All Results</option>
          <option value="true">Healed</option>
          <option value="false">Failed</option>
        </select>
        <span className="text-[10px] text-gray-500">{total} events</span>
      </div>

      {/* Table + Detail Panel layout */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading events...</div>
      ) : paged.length === 0 ? (
        <div className="bg-surface-1 rounded-xl border border-white/5 p-8 text-center text-gray-500 text-sm">
          No healing events found
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Table */}
          <div className="flex-1 min-w-0">
            <div className="bg-surface-1 rounded-xl border border-white/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 border-b border-white/5 bg-surface-2/50">
                      <th className="text-left py-2.5 px-3 font-medium">Status</th>
                      <th className="text-left py-2.5 px-3 font-medium">Selector</th>
                      <th className="text-left py-2.5 px-3 font-medium">Healed To</th>
                      <th className="text-left py-2.5 px-3 font-medium">Strategy</th>
                      <th className="text-left py-2.5 px-3 font-medium">Scenario / Step</th>
                      <th className="text-left py-2.5 px-3 font-medium">Framework</th>
                      <th className="text-right py-2.5 px-3 font-medium">Confidence</th>
                      <th className="text-right py-2.5 px-3 font-medium">Duration</th>
                      <th className="text-right py-2.5 px-3 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paged.map((event) => (
                      <tr
                        key={event.id}
                        onClick={() => setSelectedEvent(event)}
                        className={`border-b border-white/5 last:border-0 cursor-pointer transition-colors ${
                          selectedEvent?.id === event.id
                            ? 'bg-brand-500/5 border-l-2 border-l-brand-400'
                            : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <td className="py-2 px-3">
                          {event.success ? (
                            <CheckCircle size={14} className="text-emerald-400" />
                          ) : (
                            <XCircle size={14} className="text-red-400" />
                          )}
                        </td>
                        <td className="py-2 px-3 max-w-[140px]">
                          <span className="font-mono text-[10px] text-gray-300 truncate block" title={event.originalSelector}>
                            {event.originalSelector}
                          </span>
                        </td>
                        <td className="py-2 px-3 max-w-[140px]">
                          {event.healedSelector ? (
                            <span className="font-mono text-[10px] text-emerald-300 truncate block" title={event.healedSelector}>
                              {event.healedSelector}
                            </span>
                          ) : (
                            <span className="text-gray-600">-</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            <span className="text-gray-300">{event.strategyUsed || '-'}</span>
                            {event.aiUsed && <Sparkles size={10} className="text-violet-400" title="AI-powered" />}
                          </div>
                        </td>
                        <td className="py-2 px-3 max-w-[180px]">
                          {event.scenarioName || event.stepName ? (
                            <div className="space-y-0.5">
                              {event.scenarioName && (
                                <div className="flex items-center gap-1" title={event.scenarioName}>
                                  <FlaskConical size={9} className="text-cyan-400 flex-shrink-0" />
                                  <span className="text-[10px] text-cyan-300 truncate">{event.scenarioName}</span>
                                </div>
                              )}
                              {event.stepName && (
                                <div className="flex items-center gap-1" title={event.stepName}>
                                  <Footprints size={9} className="text-gray-500 flex-shrink-0" />
                                  <span className="text-[10px] text-gray-400 truncate">{event.stepName}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-600 text-[10px]">-</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <span className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{event.framework}</span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <span className={event.confidence >= 0.8 ? 'text-emerald-400' : event.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400'}>
                            {event.confidence.toFixed(2)}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-400">
                          <div className="flex items-center gap-1 justify-end">
                            <Clock size={10} />
                            {event.durationMs}ms
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-500">
                          {new Date(event.createdAt).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-3 py-2 border-t border-white/5 bg-surface-2/30">
                  <span className="text-[10px] text-gray-500">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="p-1 rounded hover:bg-white/5 text-gray-400 disabled:opacity-30"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[10px] text-gray-400 px-2">
                      {page + 1} / {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="p-1 rounded hover:bg-white/5 text-gray-400 disabled:opacity-30"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Detail Panel */}
          {selectedEvent && (
            <HealingEventDetailPanel
              event={selectedEvent}
              onClose={() => setSelectedEvent(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
