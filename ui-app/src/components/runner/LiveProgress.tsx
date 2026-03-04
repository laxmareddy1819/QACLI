import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { LiveTest } from '../../hooks/useLiveProgress';

interface Props {
  current: number;
  passed: number;
  failed: number;
  currentTestName: string;
  tests: LiveTest[];
  elapsedMs: number;
}

export function LiveProgress({ current, passed, failed, currentTestName, tests, elapsedMs }: Props) {
  const total = passed + failed;
  const elapsed = Math.round(elapsedMs / 1000);

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 bg-surface-2 rounded-full h-2 overflow-hidden">
          <div className="h-full flex">
            {total > 0 && (
              <>
                <div className="bg-emerald-500 transition-all" style={{ width: `${(passed / Math.max(total, 1)) * 100}%` }} />
                <div className="bg-red-500 transition-all" style={{ width: `${(failed / Math.max(total, 1)) * 100}%` }} />
              </>
            )}
          </div>
        </div>
        <span className="text-xs text-gray-500 flex-shrink-0">{elapsed}s</span>
      </div>

      {/* Counters */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-gray-400">Test #{current}</span>
        <span className="text-emerald-400 flex items-center gap-1"><CheckCircle size={12} /> {passed}</span>
        <span className="text-red-400 flex items-center gap-1"><XCircle size={12} /> {failed}</span>
        {currentTestName && (
          <span className="text-gray-500 flex items-center gap-1 truncate">
            <Loader2 size={12} className="animate-spin" />
            <span className="truncate">{currentTestName}</span>
          </span>
        )}
      </div>

      {/* Live test list */}
      <div className="max-h-64 overflow-y-auto space-y-0.5">
        {tests.slice(-30).map((test, i) => (
          <div key={i} className="flex items-center gap-2 text-xs py-0.5 animate-slide-in">
            {test.status === 'passed' ? (
              <CheckCircle size={12} className="text-emerald-400 flex-shrink-0" />
            ) : (
              <XCircle size={12} className="text-red-400 flex-shrink-0" />
            )}
            <span className={`truncate ${test.status === 'passed' ? 'text-gray-400' : 'text-red-300'}`}>
              {test.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
