import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, MinusCircle, Brain, RotateCcw, ExternalLink } from 'lucide-react';

interface Summary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  passRate: number;
  duration: number;
}

interface Props {
  runId: string;
  summary: Summary;
  onRerunFailed?: () => void;
}

export function RunSummary({ runId, summary, onRerunFailed }: Props) {
  const navigate = useNavigate();

  const passRateColor = summary.passRate >= 90 ? 'text-emerald-400' : summary.passRate >= 70 ? 'text-amber-400' : 'text-red-400';
  const passRateBg = summary.passRate >= 90 ? 'bg-emerald-500/10' : summary.passRate >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10';

  return (
    <div className={`rounded-xl border border-white/5 p-5 ${passRateBg}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200">Run Complete</h3>
        <span className="text-xs text-gray-500">{(summary.duration / 1000).toFixed(1)}s</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-100">{summary.total}</p>
          <p className="text-[10px] text-gray-500">Total</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-emerald-400 flex items-center justify-center gap-1">
            <CheckCircle size={16} /> {summary.passed}
          </p>
          <p className="text-[10px] text-gray-500">Passed</p>
        </div>
        <div className="text-center">
          <p className={`text-2xl font-bold flex items-center justify-center gap-1 ${summary.failed > 0 ? 'text-red-400' : 'text-gray-600'}`}>
            <XCircle size={16} /> {summary.failed}
          </p>
          <p className="text-[10px] text-gray-500">Failed</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-500 flex items-center justify-center gap-1">
            <MinusCircle size={16} /> {summary.skipped}
          </p>
          <p className="text-[10px] text-gray-500">Skipped</p>
        </div>
      </div>

      {/* Pass Rate */}
      <div className="text-center mb-4">
        <p className={`text-3xl font-bold ${passRateColor}`}>{summary.passRate}%</p>
        <p className="text-[10px] text-gray-500">Pass Rate</p>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => navigate(`/results`)}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-surface-2 text-gray-300 text-xs hover:bg-surface-3 transition-colors"
        >
          <ExternalLink size={12} /> View Details
        </button>
        {summary.failed > 0 && (
          <>
            <button
              onClick={() => navigate(`/results`)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-500/15 text-purple-300 text-xs hover:bg-purple-500/25 transition-colors"
            >
              <Brain size={12} /> Analyze
            </button>
            {onRerunFailed && (
              <button
                onClick={onRerunFailed}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-surface-2 text-gray-300 text-xs hover:bg-surface-3 transition-colors"
              >
                <RotateCcw size={12} /> Re-run Failed
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
