import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Network, Terminal, Trash2, Filter, X,
  ArrowDown, AlertTriangle, XCircle as XCircleIcon, Info, Bug,
} from 'lucide-react';
import type { WSMessage } from '../../api/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NetworkEntry {
  id: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  contentLength?: number;
  timestamp: number;
  duration?: number;
  failed?: boolean;
  errorText?: string;
}

export interface ConsoleEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  text: string;
  timestamp: number;
  source?: string;
  lineNumber?: number;
}

interface NetworkConsolePanelProps {
  subscribe: (handler: (msg: WSMessage) => void) => () => void;
  send: (msg: object) => void;
  isStreaming: boolean;
}

type ActiveTab = 'network' | 'console';

// ── NetworkConsolePanel ──────────────────────────────────────────────────────

export function NetworkConsolePanel({ subscribe, send, isStreaming }: NetworkConsolePanelProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>('console');
  const [networkEntries, setNetworkEntries] = useState<NetworkEntry[]>([]);
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([]);
  const [networkEnabled, setNetworkEnabled] = useState(false);
  const [consoleEnabled, setConsoleEnabled] = useState(false);
  const [networkFilter, setNetworkFilter] = useState('');
  const [consoleFilter, setConsoleFilter] = useState<string>('all'); // all, error, warn, log
  const [autoScroll, setAutoScroll] = useState(true);

  const networkScrollRef = useRef<HTMLDivElement>(null);
  const consoleScrollRef = useRef<HTMLDivElement>(null);

  // ── WebSocket message handler ──────────────────────────────────────────────

  const handleMessage = useCallback((msg: WSMessage) => {
    if (msg.type === 'screencast-network-request') {
      const entry = msg.entry as NetworkEntry;
      setNetworkEntries(prev => {
        // Update existing or add new
        const idx = prev.findIndex(e => e.id === entry.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx]!, ...entry };
          return updated;
        }
        // Keep max 500 entries
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
      return;
    }

    if (msg.type === 'screencast-network-response') {
      const entry = msg.entry as NetworkEntry;
      setNetworkEntries(prev => {
        const idx = prev.findIndex(e => e.id === entry.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx]!, ...entry };
          return updated;
        }
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
      return;
    }

    if (msg.type === 'screencast-console-message') {
      const entry = msg.entry as ConsoleEntry;
      setConsoleEntries(prev => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
      return;
    }
  }, []);

  useEffect(() => subscribe(handleMessage), [subscribe, handleMessage]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoScroll) return;
    const ref = activeTab === 'network' ? networkScrollRef : consoleScrollRef;
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [networkEntries, consoleEntries, activeTab, autoScroll]);

  // ── Enable/disable monitoring ──────────────────────────────────────────────

  const toggleNetwork = () => {
    if (networkEnabled) {
      send({ type: 'screencast-network-disable' });
      setNetworkEnabled(false);
    } else {
      send({ type: 'screencast-network-enable' });
      setNetworkEnabled(true);
    }
  };

  const toggleConsole = () => {
    if (consoleEnabled) {
      send({ type: 'screencast-console-disable' });
      setConsoleEnabled(false);
    } else {
      send({ type: 'screencast-console-enable' });
      setConsoleEnabled(true);
    }
  };

  // Auto-enable when streaming starts
  useEffect(() => {
    if (isStreaming && !networkEnabled) {
      send({ type: 'screencast-network-enable' });
      setNetworkEnabled(true);
    }
    if (isStreaming && !consoleEnabled) {
      send({ type: 'screencast-console-enable' });
      setConsoleEnabled(true);
    }
  }, [isStreaming]);

  // ── Filtered entries ───────────────────────────────────────────────────────

  const filteredNetwork = networkFilter
    ? networkEntries.filter(e =>
        e.url.toLowerCase().includes(networkFilter.toLowerCase()) ||
        e.method.toLowerCase().includes(networkFilter.toLowerCase())
      )
    : networkEntries;

  const filteredConsole = consoleFilter === 'all'
    ? consoleEntries
    : consoleEntries.filter(e => e.level === consoleFilter);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-surface-0 border-t border-white/5">
      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <button
          onClick={() => setActiveTab('network')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
            activeTab === 'network'
              ? 'bg-blue-500/15 text-blue-300'
              : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          <Network size={11} />
          Network
          {networkEntries.length > 0 && (
            <span className="text-[9px] px-1 rounded-full bg-blue-500/20 text-blue-400">
              {networkEntries.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('console')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
            activeTab === 'console'
              ? 'bg-purple-500/15 text-purple-300'
              : 'text-gray-500 hover:text-gray-400'
          }`}
        >
          <Terminal size={11} />
          Console
          {consoleEntries.filter(e => e.level === 'error').length > 0 && (
            <span className="text-[9px] px-1 rounded-full bg-red-500/20 text-red-400">
              {consoleEntries.filter(e => e.level === 'error').length}
            </span>
          )}
        </button>

        <div className="ml-auto flex items-center gap-1">
          {activeTab === 'network' && (
            <button
              onClick={toggleNetwork}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                networkEnabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              {networkEnabled ? 'ON' : 'OFF'}
            </button>
          )}
          {activeTab === 'console' && (
            <button
              onClick={toggleConsole}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                consoleEnabled ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              {consoleEnabled ? 'ON' : 'OFF'}
            </button>
          )}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1 rounded transition-colors ${autoScroll ? 'text-brand-400' : 'text-gray-600'}`}
            title={autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
          >
            <ArrowDown size={10} />
          </button>
          <button
            onClick={() => {
              if (activeTab === 'network') setNetworkEntries([]);
              else setConsoleEntries([]);
            }}
            className="p-1 rounded text-gray-600 hover:text-gray-400 transition-colors"
            title="Clear"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {activeTab === 'network' && (
        <div className="flex items-center gap-2 px-2 py-1 border-b border-white/5 bg-surface-1/50">
          <Filter size={10} className="text-gray-600" />
          <input
            type="text"
            value={networkFilter}
            onChange={(e) => setNetworkFilter(e.target.value)}
            placeholder="Filter by URL or method..."
            className="flex-1 bg-transparent text-[11px] text-gray-300 placeholder-gray-600 outline-none"
          />
          {networkFilter && (
            <button onClick={() => setNetworkFilter('')} className="text-gray-500 hover:text-gray-400">
              <X size={10} />
            </button>
          )}
        </div>
      )}
      {activeTab === 'console' && (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-white/5 bg-surface-1/50">
          <ConsoleFilterChip label="All" active={consoleFilter === 'all'} onClick={() => setConsoleFilter('all')} />
          <ConsoleFilterChip label="Errors" active={consoleFilter === 'error'} onClick={() => setConsoleFilter('error')} color="red" />
          <ConsoleFilterChip label="Warnings" active={consoleFilter === 'warn'} onClick={() => setConsoleFilter('warn')} color="amber" />
          <ConsoleFilterChip label="Info" active={consoleFilter === 'info'} onClick={() => setConsoleFilter('info')} color="blue" />
          <ConsoleFilterChip label="Log" active={consoleFilter === 'log'} onClick={() => setConsoleFilter('log')} />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'network' ? (
          <div ref={networkScrollRef} className="h-full overflow-y-auto">
            {filteredNetwork.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                <Network size={20} />
                <span className="text-[11px]">{networkEnabled ? 'Waiting for requests...' : 'Enable network monitoring to capture requests'}</span>
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-surface-1 z-10">
                  <tr className="text-gray-500 text-left">
                    <th className="px-2 py-1 font-medium w-14">Method</th>
                    <th className="px-2 py-1 font-medium w-14">Status</th>
                    <th className="px-2 py-1 font-medium">URL</th>
                    <th className="px-2 py-1 font-medium w-16">Type</th>
                    <th className="px-2 py-1 font-medium w-16 text-right">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNetwork.map((entry) => (
                    <NetworkRow key={entry.id + (entry.status || '')} entry={entry} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div ref={consoleScrollRef} className="h-full overflow-y-auto font-mono">
            {filteredConsole.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
                <Terminal size={20} />
                <span className="text-[11px] font-sans">{consoleEnabled ? 'Waiting for console output...' : 'Enable console monitoring to capture logs'}</span>
              </div>
            ) : (
              filteredConsole.map((entry, i) => (
                <ConsoleRow key={`${entry.timestamp}-${i}`} entry={entry} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── NetworkRow ────────────────────────────────────────────────────────────────

function NetworkRow({ entry }: { entry: NetworkEntry }) {
  const statusColor = entry.failed
    ? 'text-red-400'
    : entry.status && entry.status >= 400
      ? 'text-red-400'
      : entry.status && entry.status >= 300
        ? 'text-amber-400'
        : entry.status
          ? 'text-emerald-400'
          : 'text-gray-500';

  const methodColor = entry.method === 'POST' ? 'text-amber-400'
    : entry.method === 'PUT' ? 'text-blue-400'
    : entry.method === 'DELETE' ? 'text-red-400'
    : entry.method === 'PATCH' ? 'text-purple-400'
    : 'text-gray-400';

  // Extract pathname from URL for compact display
  let displayUrl = entry.url;
  try {
    const u = new URL(entry.url);
    displayUrl = u.pathname + u.search;
  } catch { /* use full url */ }

  const mimeShort = entry.mimeType
    ? entry.mimeType.replace('application/', '').replace('text/', '').split(';')[0]
    : '';

  return (
    <tr className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors">
      <td className={`px-2 py-0.5 font-medium ${methodColor}`}>{entry.method}</td>
      <td className={`px-2 py-0.5 ${statusColor}`}>
        {entry.failed ? 'ERR' : entry.status || '...'}
      </td>
      <td className="px-2 py-0.5 text-gray-300 truncate max-w-0" title={entry.url}>
        {displayUrl}
      </td>
      <td className="px-2 py-0.5 text-gray-600 truncate">{mimeShort}</td>
      <td className="px-2 py-0.5 text-gray-500 text-right">
        {entry.duration != null ? `${entry.duration}ms` : '...'}
      </td>
    </tr>
  );
}

// ── ConsoleRow ────────────────────────────────────────────────────────────────

function ConsoleRow({ entry }: { entry: ConsoleEntry }) {
  const levelConfig = {
    error: { bg: 'bg-red-500/5', border: 'border-red-500/20', text: 'text-red-300', icon: <XCircleIcon size={10} /> },
    warn: { bg: 'bg-amber-500/5', border: 'border-amber-500/20', text: 'text-amber-300', icon: <AlertTriangle size={10} /> },
    info: { bg: 'bg-blue-500/5', border: 'border-blue-500/10', text: 'text-blue-300', icon: <Info size={10} /> },
    debug: { bg: 'bg-gray-500/5', border: 'border-white/5', text: 'text-gray-400', icon: <Bug size={10} /> },
    log: { bg: '', border: 'border-white/[0.02]', text: 'text-gray-300', icon: null },
  };

  const cfg = levelConfig[entry.level] || levelConfig.log;
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className={`flex items-start gap-2 px-2 py-0.5 border-b ${cfg.border} ${cfg.bg} text-[11px]`}>
      <span className="text-gray-600 flex-shrink-0 tabular-nums">{time}</span>
      {cfg.icon && <span className={cfg.text + ' flex-shrink-0 mt-0.5'}>{cfg.icon}</span>}
      <span className={`${cfg.text} break-all flex-1 whitespace-pre-wrap`}>{entry.text}</span>
      {entry.source && (
        <span className="text-gray-700 flex-shrink-0 truncate max-w-[120px]" title={entry.source}>
          {entry.source.split('/').pop()}
          {entry.lineNumber != null ? `:${entry.lineNumber}` : ''}
        </span>
      )}
    </div>
  );
}

// ── ConsoleFilterChip ─────────────────────────────────────────────────────────

function ConsoleFilterChip({ label, active, onClick, color }: {
  label: string; active: boolean; onClick: () => void; color?: string;
}) {
  const colorMap: Record<string, string> = {
    red: active ? 'bg-red-500/20 text-red-300' : 'text-gray-500',
    amber: active ? 'bg-amber-500/20 text-amber-300' : 'text-gray-500',
    blue: active ? 'bg-blue-500/20 text-blue-300' : 'text-gray-500',
  };
  const style = color ? colorMap[color] || '' : active ? 'bg-white/10 text-gray-300' : 'text-gray-500';

  return (
    <button
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors hover:text-gray-300 ${style}`}
    >
      {label}
    </button>
  );
}
