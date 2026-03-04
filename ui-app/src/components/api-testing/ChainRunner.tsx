import { useState } from 'react';
import { Play, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronRight, ArrowRight, X, Variable } from 'lucide-react';
import type { ApiRequest, ApiResponse, ApiFolder } from '../../api/types';
import { sendApiChain } from '../../api/client';

interface ChainStepResult {
  index: number;
  request: ApiRequest;
  response: ApiResponse;
  extractedVars: Record<string, string>;
  error?: string;
}

interface ChainRunnerProps {
  folder: ApiFolder;
  variables?: Record<string, string>;
  onClose: () => void;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400',
  POST: 'text-blue-400',
  PUT: 'text-amber-400',
  PATCH: 'text-brand-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-gray-400',
};

function statusColor(status: number): string {
  if (status >= 200 && status < 300) return 'text-emerald-400 bg-emerald-400/10';
  if (status >= 300 && status < 400) return 'text-blue-400 bg-blue-400/10';
  if (status >= 400 && status < 500) return 'text-amber-400 bg-amber-400/10';
  if (status >= 500) return 'text-red-400 bg-red-400/10';
  return 'text-gray-400 bg-gray-400/10';
}

export function ChainRunner({ folder, variables = {}, onClose }: ChainRunnerProps) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ChainStepResult[]>([]);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [showVars, setShowVars] = useState(false);
  const [runtimeVars, setRuntimeVars] = useState<Record<string, string>>({});

  const requests = folder.requests;

  const handleRun = async () => {
    if (requests.length === 0) return;
    setRunning(true);
    setSteps([]);
    setExpandedStep(null);
    setRuntimeVars({});

    try {
      const result = await sendApiChain(requests, variables);
      // Map the response to ChainStepResult format
      const chainSteps: ChainStepResult[] = (result as { steps?: ChainStepResult[]; responses: ApiResponse[] }).steps
        || (result.responses || []).map((resp, i) => ({
          index: i,
          request: requests[i]!,
          response: resp,
          extractedVars: {},
        }));

      setSteps(chainSteps);

      // Aggregate extracted vars
      const allVars: Record<string, string> = { ...variables };
      for (const step of chainSteps) {
        Object.assign(allVars, step.extractedVars);
      }
      setRuntimeVars(allVars);
    } catch (err) {
      setSteps([{
        index: 0,
        request: requests[0]!,
        response: {
          requestId: requests[0]!.id,
          status: 0,
          statusText: 'Error',
          headers: {},
          body: String(err),
          duration: 0,
          size: 0,
          timestamp: new Date().toISOString(),
        },
        extractedVars: {},
        error: String(err),
      }]);
    } finally {
      setRunning(false);
    }
  };

  const passCount = steps.filter(s => s.response.status >= 200 && s.response.status < 300).length;
  const failCount = steps.filter(s => s.response.status === 0 || s.response.status >= 400).length;
  const totalDuration = steps.reduce((sum, s) => sum + s.response.duration, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-1 border border-white/10 rounded-xl w-[700px] max-h-[85vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Play size={16} className="text-brand-400" />
            <h2 className="text-sm font-bold text-gray-100">Chain Runner</h2>
            <span className="text-xs text-gray-500">
              {folder.name} ({requests.length} request{requests.length !== 1 ? 's' : ''})
            </span>
          </div>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
          <button
            onClick={handleRun}
            disabled={running || requests.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {running ? (
              <><Loader2 size={12} className="animate-spin" /> Running...</>
            ) : (
              <><Play size={12} /> Run Chain</>
            )}
          </button>

          {steps.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <CheckCircle2 size={12} className="text-emerald-400" />
                {passCount} passed
              </span>
              {failCount > 0 && (
                <span className="flex items-center gap-1">
                  <XCircle size={12} className="text-red-400" />
                  {failCount} failed
                </span>
              )}
              <span className="text-gray-600">|</span>
              <span>{totalDuration}ms total</span>
            </div>
          )}

          <div className="ml-auto">
            <button
              onClick={() => setShowVars(!showVars)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors ${
                showVars ? 'bg-brand-500/15 text-brand-300' : 'bg-surface-2 text-gray-500 hover:text-gray-300'
              }`}
            >
              <Variable size={11} /> Variables
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {/* Request list (pre-run) */}
          {steps.length === 0 && !running && (
            <div className="space-y-1">
              {requests.map((req, i) => (
                <div key={req.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-2 border border-white/5">
                  <span className="text-xs text-gray-600 w-5 text-right">{i + 1}.</span>
                  <span className={`text-[10px] font-bold w-12 ${METHOD_COLORS[req.method] || 'text-gray-400'}`}>
                    {req.method}
                  </span>
                  <span className="text-xs text-gray-300 truncate flex-1">{req.name || req.url}</span>
                  {i < requests.length - 1 && (
                    <ArrowRight size={10} className="text-gray-600 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Running indicator */}
          {running && steps.length < requests.length && (
            <div className="space-y-1">
              {requests.map((req, i) => {
                const step = steps[i];
                const isRunning = i === steps.length;
                const isPending = i > steps.length;

                return (
                  <div
                    key={req.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                      step
                        ? 'bg-surface-2 border-white/5'
                        : isRunning
                        ? 'bg-brand-500/5 border-brand-500/20'
                        : 'bg-surface-2 border-white/5 opacity-50'
                    }`}
                  >
                    <span className="text-xs text-gray-600 w-5 text-right">{i + 1}.</span>
                    {step ? (
                      step.response.status >= 200 && step.response.status < 300 ? (
                        <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                      ) : (
                        <XCircle size={13} className="text-red-400 flex-shrink-0" />
                      )
                    ) : isRunning ? (
                      <Loader2 size={13} className="text-brand-400 animate-spin flex-shrink-0" />
                    ) : (
                      <div className="w-3.5 h-3.5 rounded-full border border-gray-600 flex-shrink-0" />
                    )}
                    <span className={`text-[10px] font-bold w-12 ${METHOD_COLORS[req.method] || 'text-gray-400'}`}>
                      {req.method}
                    </span>
                    <span className={`text-xs truncate flex-1 ${isPending ? 'text-gray-600' : 'text-gray-300'}`}>
                      {req.name || req.url}
                    </span>
                    {step && (
                      <span className="text-[10px] text-gray-500">{step.response.duration}ms</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Results (post-run) */}
          {!running && steps.length > 0 && (
            <div className="space-y-1">
              {steps.map((step) => (
                <div key={step.index} className="rounded-lg border border-white/5 overflow-hidden">
                  {/* Step header — clickable */}
                  <button
                    onClick={() => setExpandedStep(expandedStep === step.index ? null : step.index)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-3 transition-colors text-left"
                  >
                    {expandedStep === step.index ? (
                      <ChevronDown size={12} className="text-gray-500 flex-shrink-0" />
                    ) : (
                      <ChevronRight size={12} className="text-gray-500 flex-shrink-0" />
                    )}
                    <span className="text-xs text-gray-600 w-5 text-right">{step.index + 1}.</span>
                    {step.response.status >= 200 && step.response.status < 300 ? (
                      <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                    ) : (
                      <XCircle size={13} className="text-red-400 flex-shrink-0" />
                    )}
                    <span className={`text-[10px] font-bold w-12 ${METHOD_COLORS[step.request.method] || 'text-gray-400'}`}>
                      {step.request.method}
                    </span>
                    <span className="text-xs text-gray-300 truncate flex-1">
                      {step.request.name || step.request.url}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${statusColor(step.response.status)}`}>
                      {step.response.status || 'ERR'}
                    </span>
                    <span className="text-[10px] text-gray-500 w-14 text-right">{step.response.duration}ms</span>
                  </button>

                  {/* Expanded detail */}
                  {expandedStep === step.index && (
                    <div className="px-4 py-3 bg-surface-1 border-t border-white/5 space-y-3">
                      {step.error && (
                        <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-xs text-red-300">
                          {step.error}
                        </div>
                      )}

                      {/* URL */}
                      <div>
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">URL</span>
                        <p className="text-xs text-gray-300 font-mono mt-0.5 break-all">{step.request.url}</p>
                      </div>

                      {/* Extracted Variables */}
                      {Object.keys(step.extractedVars).length > 0 && (
                        <div>
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Extracted Variables</span>
                          <div className="mt-1 space-y-0.5">
                            {Object.entries(step.extractedVars).map(([key, val]) => (
                              <div key={key} className="flex items-center gap-2 text-xs">
                                <span className="text-brand-300 font-mono">{`{{${key}}}`}</span>
                                <span className="text-gray-600">=</span>
                                <span className="text-gray-300 font-mono truncate">{val}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Response Body (truncated) */}
                      <div>
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Response Body</span>
                        <pre className="mt-1 text-[11px] text-gray-400 font-mono bg-surface-2 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
                          {formatBody(step.response.body)}
                        </pre>
                      </div>

                      {/* Validation results */}
                      {step.response.validationResults && step.response.validationResults.length > 0 && (
                        <div>
                          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Validations</span>
                          <div className="mt-1 space-y-0.5">
                            {step.response.validationResults.map((vr, vi) => (
                              <div key={vi} className="flex items-center gap-1.5 text-xs">
                                {vr.passed ? (
                                  <CheckCircle2 size={11} className="text-emerald-400" />
                                ) : (
                                  <XCircle size={11} className="text-red-400" />
                                )}
                                <span className={vr.passed ? 'text-gray-300' : 'text-red-300'}>
                                  {vr.message || 'Passed'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Variables panel */}
        {showVars && (
          <div className="border-t border-white/5 px-5 py-3 max-h-40 overflow-y-auto">
            <h3 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Runtime Variables</h3>
            {Object.keys(runtimeVars).length === 0 && Object.keys(variables).length === 0 ? (
              <p className="text-xs text-gray-600 italic">No variables set</p>
            ) : (
              <div className="space-y-0.5">
                {Object.entries({ ...variables, ...runtimeVars }).map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="text-brand-300 font-mono w-32 truncate">{`{{${key}}}`}</span>
                    <span className="text-gray-600">=</span>
                    <span className="text-gray-300 font-mono truncate flex-1">{val}</span>
                    {runtimeVars[key] && !variables[key] && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">extracted</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBody(body: string): string {
  try {
    const parsed = JSON.parse(body);
    const pretty = JSON.stringify(parsed, null, 2);
    return pretty.length > 2000 ? pretty.slice(0, 2000) + '\n... (truncated)' : pretty;
  } catch {
    return body.length > 2000 ? body.slice(0, 2000) + '\n... (truncated)' : body;
  }
}
