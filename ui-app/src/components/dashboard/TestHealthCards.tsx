import { useTestTrends } from '../../hooks/useTestResults';
import { CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export function TestHealthCards() {
  const { data } = useTestTrends(20);
  const trends = data?.trends || [];
  const latest = trends[trends.length - 1];
  const previous = trends.length > 1 ? trends[trends.length - 2] : null;

  if (!latest) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {['Total Tests', 'Pass Rate', 'Failures', 'Avg Duration'].map(label => (
          <div key={label} className="bg-surface-1 rounded-xl border border-white/5 p-5">
            <p className="text-sm text-gray-500 mb-1">{label}</p>
            <p className="text-3xl font-bold text-gray-600">&mdash;</p>
            <p className="text-xs text-gray-600 mt-1">No test data yet</p>
          </div>
        ))}
      </div>
    );
  }

  const passRateDelta = previous ? latest.passRate - previous.passRate : 0;
  const failDelta = previous ? latest.failed - previous.failed : 0;
  const avgDuration = trends.length > 0
    ? Math.round(trends.reduce((s, t) => s + t.duration, 0) / trends.length / 1000)
    : 0;

  const passRateColor = latest.passRate >= 90 ? 'text-emerald-400' : latest.passRate >= 70 ? 'text-amber-400' : 'text-red-400';
  const passRateBg = latest.passRate >= 90 ? 'bg-emerald-500/10' : latest.passRate >= 70 ? 'bg-amber-500/10' : 'bg-red-500/10';

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Total Tests */}
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-gray-500">Total Tests</p>
          <CheckCircle size={16} className="text-brand-400" />
        </div>
        <p className="text-3xl font-bold text-gray-100">{latest.total}</p>
        <p className="text-xs text-gray-500 mt-1">{trends.length} runs recorded</p>
      </div>

      {/* Pass Rate */}
      <div className={`rounded-xl border border-white/5 p-5 ${passRateBg}`}>
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-gray-500">Pass Rate</p>
          {passRateDelta > 0 ? <TrendingUp size={16} className="text-emerald-400" /> :
            passRateDelta < 0 ? <TrendingDown size={16} className="text-red-400" /> :
              <Minus size={16} className="text-gray-500" />}
        </div>
        <p className={`text-3xl font-bold ${passRateColor}`}>{latest.passRate}%</p>
        <p className="text-xs text-gray-500 mt-1">
          {passRateDelta > 0 ? `+${passRateDelta.toFixed(1)}%` : passRateDelta < 0 ? `${passRateDelta.toFixed(1)}%` : 'No change'} vs previous
        </p>
      </div>

      {/* Failures */}
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-gray-500">Failures</p>
          <XCircle size={16} className={latest.failed > 0 ? 'text-red-400' : 'text-gray-600'} />
        </div>
        <p className={`text-3xl font-bold ${latest.failed > 0 ? 'text-red-400' : 'text-gray-100'}`}>{latest.failed}</p>
        <p className="text-xs text-gray-500 mt-1">
          {failDelta > 0 ? <span className="text-red-400">+{failDelta} new</span> :
            failDelta < 0 ? <span className="text-emerald-400">{failDelta} fixed</span> :
              'Same as previous'}
        </p>
      </div>

      {/* Avg Duration */}
      <div className="bg-surface-1 rounded-xl border border-white/5 p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-gray-500">Avg Duration</p>
          <Clock size={16} className="text-sky-400" />
        </div>
        <p className="text-3xl font-bold text-gray-100">{avgDuration}s</p>
        <p className="text-xs text-gray-500 mt-1">Across {trends.length} runs</p>
      </div>
    </div>
  );
}
