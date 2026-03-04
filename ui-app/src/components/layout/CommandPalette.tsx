import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, FileText, Play, Sparkles, LayoutDashboard, FolderOpen, BarChart3, TestTube2, Heart, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ProjectModule } from '../../api/types';
import { searchFiles } from '../../api/client';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  modules: ProjectModule[];
}

interface ResultItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
}

export function CommandPalette({ open, onClose, modules }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const go = useCallback((path: string) => { navigate(path); onClose(); }, [navigate, onClose]);

  // Build static items
  const staticItems: ResultItem[] = [
    { id: 'dashboard', label: 'Dashboard', description: 'Overview', icon: <LayoutDashboard size={16} />, action: () => go('/') },
    { id: 'explorer', label: 'Project Explorer', description: 'Browse project files', icon: <FolderOpen size={16} />, action: () => go('/explorer') },
    { id: 'runner', label: 'Runner', description: 'Execute tests', icon: <Play size={16} />, action: () => go('/runner') },
    { id: 'test-explorer', label: 'Test Explorer', description: 'Browse test suites', icon: <TestTube2 size={16} />, action: () => go('/tests') },
    { id: 'results', label: 'Results', description: 'Test results & analytics', icon: <BarChart3 size={16} />, action: () => go('/results') },
    { id: 'healing', label: 'Healing', description: 'Self-healing dashboard', icon: <Heart size={16} />, action: () => go('/healing') },
    { id: 'ai', label: 'AI Assistant', description: 'AI-powered actions', icon: <Sparkles size={16} />, action: () => go('/ai') },
  ];

  // Filter on query
  useEffect(() => {
    if (!open) return;
    const q = query.toLowerCase().trim();
    if (!q) {
      setResults(staticItems);
    } else {
      const filtered = staticItems.filter(
        (item) => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q),
      );
      setResults(filtered);

      // Also search files if query has 3+ chars
      if (q.length >= 3) {
        searchFiles(q).then((res) => {
          const fileResults: ResultItem[] = res.results.slice(0, 8).map((r) => ({
            id: `file-${r.file}-${r.line}`,
            label: r.file.split(/[/\\]/).pop() || r.file,
            description: `Line ${r.line}: ${r.content.substring(0, 60)}`,
            icon: <FileText size={16} />,
            action: () => go(`/explorer?file=${encodeURIComponent(r.file)}`),
          }));
          setResults((prev) => [...prev, ...fileResults]);
        }).catch(() => {});
      }
    }
    setSelected(0);
  }, [query, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input on open
  useEffect(() => {
    if (open) { inputRef.current?.focus(); setQuery(''); }
  }, [open]);

  // Keyboard
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, results.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
      if (e.key === 'Enter' && results[selected]) { results[selected].action(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, results, selected, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-[560px] bg-surface-1 rounded-xl border border-white/10 overflow-hidden animate-fade-in">
        {/* Input */}
        <div className="flex items-center px-4 border-b border-white/5">
          <Search size={18} className="text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files, modules, commands..."
            className="flex-1 bg-transparent border-none outline-none px-3 py-3.5 text-sm text-gray-100 placeholder-gray-500"
          />
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">No results found</div>
          )}
          {results.map((item, i) => (
            <button
              key={item.id}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                i === selected ? 'bg-brand-500/15 text-brand-200' : 'text-gray-300 hover:bg-white/5'
              }`}
              onMouseEnter={() => setSelected(i)}
              onClick={item.action}
            >
              <span className="text-gray-400">{item.icon}</span>
              <span className="font-medium flex-1">{item.label}</span>
              <span className="text-xs text-gray-500 truncate max-w-[200px]">{item.description}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-white/5 flex gap-3 text-[10px] text-gray-500">
          <span><kbd className="px-1 py-0.5 rounded bg-surface-2 font-mono">↑↓</kbd> Navigate</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-2 font-mono">Enter</kbd> Select</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-2 font-mono">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
