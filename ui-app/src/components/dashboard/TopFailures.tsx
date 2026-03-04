import { useTopFailures } from '../../hooks/useTestResults';
import { XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function TopFailures() {
  const { data } = useTopFailures(5);
  const failures = data?.topFailures || [];
  const navigate = useNavigate();

  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
      <h3 className="text-base font-semibold text-gray-200 mb-4">Top Failures</h3>
      {failures.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center">No failures recorded yet.</p>
      ) : (
        <div className="space-y-2">
          {failures.map((f: any, i: number) => (
            <button
              key={i}
              onClick={() => navigate('/results')}
              className="w-full flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-surface-2 transition-colors text-left"
            >
              <XCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 truncate">{f.testName}</p>
                <p className="text-xs text-gray-500 truncate">{f.lastError || 'No error details'}</p>
              </div>
              <span className="text-xs font-medium text-red-400 flex-shrink-0">{f.failureCount}x</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
