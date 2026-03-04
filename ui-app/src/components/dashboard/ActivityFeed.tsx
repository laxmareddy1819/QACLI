import { useState, useEffect, useRef } from 'react';
import { FileEdit, FolderPlus, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { getActivity } from '../../api/client';
import type { WSMessage } from '../../api/types';

interface Activity {
  id: string;
  icon: React.ReactNode;
  text: string;
  time: string;
  color: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FILE_ICONS: Record<string, React.ReactNode> = {
  change: <FileEdit size={16} />,
  add: <FolderPlus size={16} />,
  unlink: <Trash2 size={16} />,
};

function rawToActivity(raw: any): Activity | null {
  const ts = raw.timestamp ? new Date(raw.timestamp) : new Date();
  const time = ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (raw.type === 'file-change') {
    const action = raw.event as string;
    const filePath = (raw.path as string).split('/').pop() ?? raw.path;
    return {
      id: `${ts.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      icon: FILE_ICONS[action] ?? <FileEdit size={16} />,
      text: `${filePath} ${action === 'add' ? 'created' : action === 'unlink' ? 'deleted' : 'modified'}`,
      time,
      color: action === 'add' ? 'text-emerald-400' : action === 'unlink' ? 'text-red-400' : 'text-sky-400',
    };
  }

  if (raw.type === 'complete') {
    const passed = raw.exitCode === 0;
    const durSec = raw.duration ? Math.round(raw.duration / 1000) : 0;
    return {
      id: `${ts.getTime()}-${Math.random().toString(36).slice(2, 6)}`,
      icon: passed ? <CheckCircle size={16} /> : <XCircle size={16} />,
      text: `Run ${passed ? 'PASSED' : 'FAILED'}${durSec ? ` (${durSec}s)` : ''}`,
      time,
      color: passed ? 'text-emerald-400' : 'text-red-400',
    };
  }

  return null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function ActivityFeed({ subscribe }: { subscribe: (handler: (msg: WSMessage) => void) => () => void }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const loaded = useRef(false);

  // Load persisted activities from server on mount
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    getActivity()
      .then(({ activities: raw }) => {
        const items = raw.map(rawToActivity).filter(Boolean) as Activity[];
        if (items.length > 0) {
          setActivities(items.slice(0, 30));
        }
      })
      .catch(() => { /* ignore — server may not support it yet */ });
  }, []);

  // Subscribe to real-time WebSocket events
  useEffect(() => {
    return subscribe((msg) => {
      const activity = rawToActivity(msg as any);
      if (activity) {
        setActivities((prev) => [activity, ...prev].slice(0, 30));
      }
    });
  }, [subscribe]);

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-base font-semibold text-gray-200 mb-4">Recent Activity</h3>
      <div className="space-y-2.5 max-h-52 overflow-y-auto">
        {activities.length === 0 && (
          <p className="text-sm text-gray-500 py-4 text-center">No activity yet. Start editing files or running tests.</p>
        )}
        {activities.map((a) => (
          <div key={a.id} className="flex items-center gap-2.5 text-sm animate-slide-in">
            <span className={`flex-shrink-0 ${a.color}`}>{a.icon}</span>
            <span className="text-gray-300 flex-1 truncate" title={a.text}>{a.text}</span>
            <span className="text-gray-500 flex-shrink-0 text-xs">{a.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
