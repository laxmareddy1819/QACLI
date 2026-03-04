import { useFlakyTests } from '../../hooks/useTestResults';
import { AlertTriangle } from 'lucide-react';

export function FlakyTests() {
  const { data } = useFlakyTests();
  const flaky = data?.flaky || [];

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-base font-semibold text-gray-200 mb-4">Flaky Tests</h3>
      {flaky.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No flaky tests detected.</p>
      ) : (
        <div className="space-y-2.5 max-h-52 overflow-y-auto">
          {flaky.slice(0, 5).map((f: any, i: number) => (
            <div key={i} className="flex items-center gap-2.5">
              <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">{f.testName}</p>
                <div className="flex items-center gap-1 mt-1">
                  {f.recentStatuses?.slice(0, 10).map((s: string, j: number) => (
                    <span
                      key={j}
                      className={`w-2.5 h-2.5 rounded-full ${s === 'passed' ? 'bg-emerald-400' : s === 'failed' ? 'bg-red-400' : 'bg-gray-600'}`}
                    />
                  ))}
                </div>
              </div>
              <span className="text-xs font-medium text-amber-400 flex-shrink-0">
                {Math.round(f.flakinessRate * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
