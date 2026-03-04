import { useState, useEffect } from 'react';
import { Search, Trash2, AlertCircle, Fingerprint, ChevronLeft, ChevronRight, FlaskConical, Footprints } from 'lucide-react';
import { useHealingFingerprints, useDeleteFingerprint } from '../../hooks/useHealing';

const PAGE_SIZE = 25;

export function FingerprintBrowser() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isError, error } = useHealingFingerprints({
    search: debouncedSearch || undefined,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  const deleteMutation = useDeleteFingerprint();

  const fingerprints = data?.fingerprints || [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id, {
      onSuccess: () => setDeleteConfirm(null),
    });
  };

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load fingerprints</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by selector key or URL..."
          className="w-full pl-9 pr-3 py-2 bg-surface-1 border border-white/10 rounded-lg text-xs text-gray-200 placeholder-gray-500 focus:border-brand-400/50 focus:outline-none"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading fingerprints...</div>
      ) : fingerprints.length === 0 ? (
        <div className="bg-surface-1 rounded-xl border border-white/5 p-8 text-center">
          <Fingerprint size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-sm text-gray-400 mb-1">No fingerprints found</p>
          <p className="text-xs text-gray-600">
            Fingerprints are created when the healing engine encounters and stores element signatures.
          </p>
        </div>
      ) : (
        <div className="bg-surface-1 rounded-xl border border-white/5 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-white/5 bg-surface-2/50">
                  <th className="text-left py-2.5 px-3 font-medium">Selector Key</th>
                  <th className="text-left py-2.5 px-3 font-medium">URL</th>
                  <th className="text-left py-2.5 px-3 font-medium">Scenario / Step</th>
                  <th className="text-right py-2.5 px-3 font-medium">Success</th>
                  <th className="text-right py-2.5 px-3 font-medium">Failures</th>
                  <th className="text-right py-2.5 px-3 font-medium">Updated</th>
                  <th className="text-right py-2.5 px-3 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {fingerprints.map((fp) => (
                  <tr key={fp.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="py-2 px-3 max-w-[200px]">
                      <span className="font-mono text-[10px] text-gray-300 truncate block" title={fp.selectorKey}>
                        {fp.selectorKey}
                      </span>
                    </td>
                    <td className="py-2 px-3 max-w-[200px]">
                      <span className="text-gray-400 truncate block text-[10px]" title={fp.url}>
                        {fp.url ? (() => { try { return new URL(fp.url).pathname; } catch { return fp.url; } })() : '-'}
                      </span>
                    </td>
                    <td className="py-2 px-3 max-w-[180px]">
                      {fp.scenarioName || fp.stepName ? (
                        <div className="space-y-0.5">
                          {fp.scenarioName && (
                            <div className="flex items-center gap-1" title={fp.scenarioName}>
                              <FlaskConical size={9} className="text-cyan-400 flex-shrink-0" />
                              <span className="text-[10px] text-cyan-300 truncate">{fp.scenarioName}</span>
                            </div>
                          )}
                          {fp.stepName && (
                            <div className="flex items-center gap-1" title={fp.stepName}>
                              <Footprints size={9} className="text-gray-500 flex-shrink-0" />
                              <span className="text-[10px] text-gray-400 truncate">{fp.stepName}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-600 text-[10px]">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className="text-emerald-400">{fp.successCount ?? 0}</span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className={`${(fp.failureCount ?? 0) > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                        {fp.failureCount ?? 0}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-gray-500">
                      {fp.updatedAt
                        ? new Date(fp.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : '-'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {deleteConfirm === fp.id ? (
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => handleDelete(fp.id)}
                            disabled={deleteMutation.isPending}
                            className="text-red-400 hover:text-red-300 text-[10px] font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-gray-500 hover:text-gray-300 text-[10px]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(fp.id)}
                          className="text-gray-600 hover:text-red-400 transition-colors"
                          title="Delete fingerprint"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
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
      )}
    </div>
  );
}
