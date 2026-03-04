import { X, CheckCircle, XCircle, Sparkles, Clock, Globe, Code, Layers, Cpu, ArrowRight, FlaskConical, Footprints, MousePointerClick } from 'lucide-react';

interface HealingEvent {
  id: string;
  selectorKey: string;
  url: string;
  framework: string;
  language?: string;
  strategyUsed?: string;
  originalSelector: string;
  healedSelector?: string;
  confidence: number;
  success: boolean;
  durationMs: number;
  aiUsed: boolean;
  scenarioName?: string;
  stepName?: string;
  actionType?: string;
  createdAt: number;
}

const STRATEGY_DESCRIPTIONS: Record<string, string> = {
  fingerprint: 'Matched element by stored attribute fingerprint (tag, id, class, text, role, data attributes)',
  similarSelector: 'Found a CSS selector with high textual similarity to the original',
  textMatch: 'Located element by matching visible text content',
  positionMatch: 'Found element at a similar position in the DOM tree',
  ancestorSearch: 'Searched up from the expected parent/ancestor to locate the element',
  aiHealing: 'Used AI/LLM analysis to infer the correct replacement selector',
  visionHealing: 'Used multimodal LLM with page screenshot to visually identify the element',
};

export function HealingEventDetailPanel({
  event,
  onClose,
}: {
  event: HealingEvent;
  onClose: () => void;
}) {
  const confidencePercent = Math.round(event.confidence * 100);
  const confidenceColor =
    event.confidence >= 0.8 ? 'bg-emerald-500' : event.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="w-[380px] flex-shrink-0 bg-surface-1 rounded-xl border border-white/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-surface-2/50">
        <div className="flex items-center gap-2">
          {event.success ? (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-medium">
              <CheckCircle size={12} />
              Healed
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-[10px] font-medium">
              <XCircle size={12} />
              Failed
            </span>
          )}
          {event.aiUsed && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 text-[10px] font-medium">
              <Sparkles size={10} />
              AI
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-gray-300"
        >
          <X size={16} />
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto max-h-[600px]">
        {/* Selector Diff */}
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Selector Change</p>
          <div className="space-y-2">
            <div className="bg-red-500/5 border border-red-500/10 rounded-lg p-2.5">
              <p className="text-[9px] text-red-400/70 mb-1">Original</p>
              <p className="font-mono text-[10px] text-red-300 break-all">{event.originalSelector}</p>
            </div>
            {event.healedSelector ? (
              <>
                <div className="flex justify-center">
                  <ArrowRight size={14} className="text-gray-600" />
                </div>
                <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2.5">
                  <p className="text-[9px] text-emerald-400/70 mb-1">Healed</p>
                  <p className="font-mono text-[10px] text-emerald-300 break-all">{event.healedSelector}</p>
                </div>
              </>
            ) : (
              <div className="bg-surface-2 rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-gray-500">No healed selector (healing failed)</p>
              </div>
            )}
          </div>
        </div>

        {/* Strategy Explanation */}
        {event.strategyUsed && (
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Strategy</p>
            <div className="bg-surface-2 rounded-lg p-3">
              <p className="text-xs text-gray-200 font-medium mb-1">{event.strategyUsed}</p>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                {STRATEGY_DESCRIPTIONS[event.strategyUsed] || 'Custom healing strategy'}
              </p>
            </div>
          </div>
        )}

        {/* Test Context */}
        {(event.scenarioName || event.stepName || event.actionType) && (
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Test Context</p>
            <div className="bg-surface-2 rounded-lg p-3 space-y-2">
              {event.scenarioName && (
                <div className="flex items-start gap-2 text-xs">
                  <FlaskConical size={12} className="text-cyan-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-gray-500 text-[10px] block">Scenario</span>
                    <span className="text-cyan-300">{event.scenarioName}</span>
                  </div>
                </div>
              )}
              {event.stepName && (
                <div className="flex items-start gap-2 text-xs">
                  <Footprints size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-gray-500 text-[10px] block">Step</span>
                    <span className="text-amber-300">{event.stepName}</span>
                  </div>
                </div>
              )}
              {event.actionType && (
                <div className="flex items-start gap-2 text-xs">
                  <MousePointerClick size={12} className="text-violet-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-gray-500 text-[10px] block">Action</span>
                    <span className="text-violet-300 font-mono">{event.actionType}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Confidence Bar */}
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Confidence</p>
          <div className="bg-surface-2 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xl font-bold text-gray-200">{confidencePercent}%</span>
              <span className={`text-[10px] ${
                event.confidence >= 0.8 ? 'text-emerald-400' : event.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {event.confidence >= 0.8 ? 'High' : event.confidence >= 0.5 ? 'Medium' : 'Low'}
              </span>
            </div>
            <div className="w-full h-2 bg-surface-0 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${confidenceColor} transition-all`}
                style={{ width: `${confidencePercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Metadata Grid */}
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Details</p>
          <div className="bg-surface-2 rounded-lg p-3 space-y-2.5">
            <div className="flex items-center gap-2 text-xs">
              <Globe size={12} className="text-gray-500 flex-shrink-0" />
              <span className="text-gray-500 w-20 flex-shrink-0">URL</span>
              <span className="text-gray-300 truncate" title={event.url}>
                {event.url ? (() => { try { return new URL(event.url).pathname; } catch { return event.url; } })() : '-'}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Layers size={12} className="text-gray-500 flex-shrink-0" />
              <span className="text-gray-500 w-20 flex-shrink-0">Framework</span>
              <span className="text-gray-300">{event.framework}</span>
            </div>
            {event.language && (
              <div className="flex items-center gap-2 text-xs">
                <Code size={12} className="text-gray-500 flex-shrink-0" />
                <span className="text-gray-500 w-20 flex-shrink-0">Language</span>
                <span className="text-gray-300">{event.language}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs">
              <Clock size={12} className="text-gray-500 flex-shrink-0" />
              <span className="text-gray-500 w-20 flex-shrink-0">Duration</span>
              <span className="text-gray-300">{event.durationMs}ms</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Cpu size={12} className="text-gray-500 flex-shrink-0" />
              <span className="text-gray-500 w-20 flex-shrink-0">Timestamp</span>
              <span className="text-gray-300">
                {new Date(event.createdAt).toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
