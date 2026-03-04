import { Clock, Trash2, X } from 'lucide-react';
import type { ApiHistoryEntry, ApiRequest, HttpMethod } from '../../api/types';
import { useApiHistory, useClearHistory } from '../../hooks/useApiTesting';

interface HistoryPanelProps {
  onSelectRequest: (request: ApiRequest) => void;
  onClose: () => void;
}

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-blue-400',
  PUT: 'text-amber-400',
  PATCH: 'text-brand-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-gray-400',
};

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'text-emerald-400';
  if (status >= 300 && status < 400) return 'text-blue-400';
  if (status >= 400 && status < 500) return 'text-amber-400';
  if (status >= 500) return 'text-red-400';
  return 'text-gray-500';
}

export function HistoryPanel({ onSelectRequest, onClose }: HistoryPanelProps) {
  const { data } = useApiHistory();
  const clearHistory = useClearHistory();
  const history = data?.history || [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Clock size={13} className="text-gray-500" />
          <span className="text-[11px] font-semibold uppercase text-gray-500 tracking-wider">History</span>
        </div>
        <div className="flex gap-1">
          {history.length > 0 && (
            <button
              onClick={() => clearHistory.mutate()}
              className="p-1 text-gray-600 hover:text-red-400"
              title="Clear history"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* History items */}
      <div className="flex-1 overflow-y-auto">
        {history.length === 0 ? (
          <div className="px-3 py-6 text-center text-[13px] text-gray-600">No history yet</div>
        ) : (
          history.map(entry => (
            <div
              key={entry.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 cursor-pointer border-b border-white/[0.03]"
              onClick={() => onSelectRequest(entry.request)}
            >
              <span className={`text-[11px] font-bold w-8 flex-shrink-0 ${METHOD_COLORS[entry.request.method]}`}>
                {entry.request.method.slice(0, 3)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-300 truncate font-mono">{entry.request.url}</p>
                <p className="text-[11px] text-gray-600">{new Date(entry.timestamp).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-xs font-medium ${statusColor(entry.response.status)}`}>
                  {entry.response.status}
                </span>
                <span className="text-[11px] text-gray-600">{entry.response.duration}ms</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
