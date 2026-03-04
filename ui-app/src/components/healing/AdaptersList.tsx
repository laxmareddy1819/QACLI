import { Puzzle, AlertCircle } from 'lucide-react';
import { useHealingAdapters } from '../../hooks/useHealing';

const ADAPTER_ICONS: Record<string, { bg: string; text: string }> = {
  playwright: { bg: 'bg-rose-500/10', text: 'text-rose-400' },
  'playwright-cucumber': { bg: 'bg-orange-500/10', text: 'text-orange-400' },
  cypress: { bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
  selenium: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  webdriverio: { bg: 'bg-violet-500/10', text: 'text-violet-400' },
  robotframework: { bg: 'bg-green-500/10', text: 'text-green-400' },
  appium: { bg: 'bg-indigo-500/10', text: 'text-indigo-400' },
};

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  java: 'Java',
  python: 'Python',
  csharp: 'C#',
};

export function AdaptersList() {
  const { data, isLoading, isError, error } = useHealingAdapters();
  const adapters = data?.adapters || [];

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
        <AlertCircle size={24} className="mx-auto text-red-400 mb-2" />
        <p className="text-sm text-red-300">Failed to load adapters</p>
        <p className="text-xs text-gray-500 mt-1">{(error as Error)?.message}</p>
      </div>
    );
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading adapters...</div>;
  }

  if (adapters.length === 0) {
    return (
      <div className="bg-surface-1 rounded-xl border border-white/5 p-8 text-center">
        <Puzzle size={32} className="mx-auto text-gray-600 mb-3" />
        <p className="text-sm text-gray-400">No adapters available</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Available healing adapters that can be injected into test projects. Use{' '}
        <span className="font-mono text-brand-400">/heal inject</span> to add self-healing to a project.
      </p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {adapters.map((adapter) => {
          const style = ADAPTER_ICONS[adapter.framework] || { bg: 'bg-white/5', text: 'text-gray-400' };
          return (
            <div key={`${adapter.framework}-${adapter.language}`} className={`${style.bg} rounded-xl border border-white/5 p-5`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-8 h-8 rounded-lg ${style.bg} flex items-center justify-center`}>
                  <Puzzle size={16} className={style.text} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-200">{adapter.displayName}</p>
                  <p className="text-[10px] text-gray-500">
                    {adapter.framework} + {LANGUAGE_LABELS[adapter.language] || adapter.language}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${style.text} bg-black/20`}>
                  {adapter.framework}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium text-gray-400 bg-black/20">
                  {LANGUAGE_LABELS[adapter.language] || adapter.language}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
