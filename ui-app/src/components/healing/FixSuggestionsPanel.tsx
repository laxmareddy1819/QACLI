import { useState } from 'react';
import { Lightbulb, AlertCircle, Loader2, ArrowRight, Shield, ShieldAlert, ShieldCheck, Copy, Check } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

interface FixSuggestion {
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  reasoning: string;
  codeChange: string;
  selectorType: string;
  stability: 'high' | 'medium' | 'low';
}

const STABILITY_STYLES: Record<string, { bg: string; text: string; icon: typeof Shield }> = {
  high: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: ShieldCheck },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', icon: Shield },
  low: { bg: 'bg-red-500/10', text: 'text-red-400', icon: ShieldAlert },
};

export function FixSuggestionsPanel({ days }: { days: number }) {
  const [suggestions, setSuggestions] = useState<FixSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('qabot_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const resp = await fetch(`${API_BASE}/api/heal/suggest-fixes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ days, limit: 20 }),
      });

      if (!resp.ok) throw new Error(`Analysis failed: ${resp.statusText}`);

      const data = await resp.json();
      setSuggestions(data.suggestions || []);
      setAnalyzedCount(data.analyzedEvents || 0);
      setAnalyzed(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-200 mb-2">AI Fix Suggestions</h3>
        <p className="text-xs text-gray-400 mb-4">
          Analyze healed selectors from the last {days} days and get AI-powered suggestions for permanent code fixes.
          This uses your configured LLM provider to review healing patterns and recommend stable replacements.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {!analyzed ? (
        <div className="bg-surface-1 rounded-xl border border-white/5 p-8 text-center">
          <Lightbulb size={32} className="mx-auto text-amber-400/50 mb-4" />
          <p className="text-sm text-gray-300 mb-2">Analyze Healing History</p>
          <p className="text-xs text-gray-500 mb-6 max-w-md mx-auto">
            The AI will review your healed selectors from the last {days} days and suggest permanent fixes
            to make your test selectors more resilient.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2 mx-auto"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Lightbulb size={14} />
                Analyze & Suggest Fixes
              </>
            )}
          </button>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="bg-surface-1 rounded-xl border border-white/5 p-8 text-center">
          <Lightbulb size={32} className="mx-auto text-gray-600 mb-3" />
          <p className="text-sm text-gray-400 mb-1">No suggestions generated</p>
          <p className="text-xs text-gray-500">
            {analyzedCount === 0
              ? 'No healed events found in this time period. Run tests that trigger healing first.'
              : 'The AI could not generate fix suggestions from the available healing data. Make sure an LLM provider is configured.'}
          </p>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="mt-4 px-4 py-2 bg-surface-2 hover:bg-surface-1 text-xs text-gray-300 rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Analyzed {analyzedCount} healed event(s) — {suggestions.length} suggestion(s)
            </p>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Lightbulb size={12} />}
              Re-analyze
            </button>
          </div>

          {suggestions.map((fix, i) => {
            const style = STABILITY_STYLES[fix.stability] || STABILITY_STYLES.medium;
            const StabilityIcon = style.icon;

            return (
              <div key={i} className="bg-surface-1 rounded-xl border border-white/5 overflow-hidden">
                {/* Header */}
                <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${style.bg} ${style.text} text-[10px] font-medium`}>
                      <StabilityIcon size={12} />
                      {fix.stability} stability
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {fix.selectorType} • {Math.round(fix.confidence * 100)}% confidence
                    </span>
                  </div>
                  <button
                    onClick={() => handleCopy(fix.suggestedSelector, i)}
                    className="text-gray-500 hover:text-gray-300 p-1 rounded hover:bg-white/5"
                    title="Copy selector"
                  >
                    {copiedIdx === i ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>

                {/* Selector Change */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2 flex-1 min-w-0">
                      <p className="text-[9px] text-red-400/70 mb-0.5">Original (fragile)</p>
                      <p className="font-mono text-[11px] text-red-300 truncate" title={fix.originalSelector}>
                        {fix.originalSelector}
                      </p>
                    </div>
                    <ArrowRight size={16} className="text-gray-600 flex-shrink-0" />
                    <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2 flex-1 min-w-0">
                      <p className="text-[9px] text-emerald-400/70 mb-0.5">Suggested (stable)</p>
                      <p className="font-mono text-[11px] text-emerald-300 truncate" title={fix.suggestedSelector}>
                        {fix.suggestedSelector}
                      </p>
                    </div>
                  </div>

                  {/* Reasoning */}
                  {fix.reasoning && (
                    <p className="text-[11px] text-gray-400 leading-relaxed mb-3">{fix.reasoning}</p>
                  )}

                  {/* Code Change */}
                  {fix.codeChange && (
                    <div className="bg-surface-0 rounded-lg p-3">
                      <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-1.5">Code Change</p>
                      <pre className="text-[10px] text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
                        {fix.codeChange}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
