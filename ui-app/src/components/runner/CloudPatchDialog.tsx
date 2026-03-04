import { useState } from 'react';
import { Cloud, CheckCircle, AlertTriangle, FileCode, Eye, EyeOff, Zap, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { CloudAnalysisResult, CloudPatchInfo } from '../../api/client';

interface CloudPatchDialogProps {
  open: boolean;
  analysis: CloudAnalysisResult;
  providerLabel: string;
  onApplyAndRun: (patches: CloudPatchInfo[]) => void;
  onSkipAndRun: () => void;
  onCancel: () => void;
  applying?: boolean;
}

export function CloudPatchDialog({
  open,
  analysis,
  providerLabel,
  onApplyAndRun,
  onSkipAndRun,
  onCancel,
  applying,
}: CloudPatchDialogProps) {
  const [showDiff, setShowDiff] = useState(false);
  const [expandedPatch, setExpandedPatch] = useState<number | null>(null);

  if (!open) return null;

  const isCloudReady = analysis.cloudReady;
  const isAlreadyPatched = analysis.alreadyPatched;
  const hasPatches = analysis.patches.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancel} />
      <div className="relative bg-surface-1 rounded-xl border border-white/10 p-0 w-[600px] max-h-[85vh] animate-fade-in flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                isCloudReady ? 'bg-emerald-500/15' : 'bg-amber-500/15'
              }`}>
                {isCloudReady ? (
                  <CheckCircle size={20} className="text-emerald-400" />
                ) : (
                  <Cloud size={20} className="text-amber-400" />
                )}
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-100">
                  {isCloudReady ? 'Cloud Ready' : 'Cloud Configuration Needed'}
                </h3>
                <p className="text-sm text-gray-400 mt-0.5">
                  {isCloudReady
                    ? `Your project is ready to run on ${providerLabel}.`
                    : `Your project needs changes to run on ${providerLabel}.`
                  }
                </p>
              </div>
            </div>
            <button onClick={onCancel} className="text-gray-500 hover:text-gray-300 p-1">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Detection Summary */}
          <div className="bg-surface-2 rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
              <FileCode size={14} />
              Detection Summary
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <div className="text-gray-500">Framework:</div>
              <div className="text-gray-200">{analysis.framework || 'Unknown'}</div>
              <div className="text-gray-500">Language:</div>
              <div className="text-gray-200">{analysis.language || 'Unknown'}</div>
              <div className="text-gray-500">Hooks File:</div>
              <div className="text-gray-200 font-mono text-xs">{analysis.hookFile || 'Not found'}</div>
              <div className="text-gray-500">Cloud Connect:</div>
              <div className={analysis.hasCloudConnect ? 'text-emerald-400' : 'text-amber-400'}>
                {analysis.hasCloudConnect ? 'Present' : 'Missing'}
              </div>
              <div className="text-gray-500">Session Status:</div>
              <div className={analysis.hasSessionStatus ? 'text-emerald-400' : 'text-amber-400'}>
                {analysis.hasSessionStatus ? 'Present' : 'Missing'}
              </div>
            </div>
          </div>

          {/* Already Patched Notice */}
          {isAlreadyPatched && (
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2">
              <CheckCircle size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-blue-300">
                This file was previously patched by qabot for cloud readiness.
              </p>
            </div>
          )}

          {/* Cloud Ready Message */}
          {isCloudReady && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-start gap-2">
              <CheckCircle size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-emerald-300">
                Your hooks already handle cloud grid connection and session status reporting.
                No changes needed — proceed with your test run.
              </p>
            </div>
          )}

          {/* Patches Needed */}
          {!isCloudReady && hasPatches && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-400 uppercase tracking-wide">
                <AlertTriangle size={14} className="text-amber-400" />
                Changes Required
              </div>

              {analysis.patches.map((patch, idx) => (
                <div key={idx} className="bg-surface-2 rounded-lg border border-white/5 overflow-hidden">
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      <Zap size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm text-gray-200">{patch.description}</p>
                        <p className="text-xs text-gray-500 mt-1 font-mono">{patch.file}</p>
                      </div>
                      <button
                        onClick={() => {
                          setExpandedPatch(expandedPatch === idx ? null : idx);
                          setShowDiff(true);
                        }}
                        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded bg-surface-3 hover:bg-surface-3/80"
                      >
                        {expandedPatch === idx ? <EyeOff size={12} /> : <Eye size={12} />}
                        {expandedPatch === idx ? 'Hide' : 'Preview'}
                        {expandedPatch === idx ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                  </div>

                  {/* Diff Preview */}
                  {expandedPatch === idx && showDiff && (
                    <div className="border-t border-white/5">
                      <div className="flex border-b border-white/5">
                        <div className="flex-1 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-500/5">
                          Original
                        </div>
                        <div className="flex-1 px-3 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/5">
                          Patched
                        </div>
                      </div>
                      <div className="flex max-h-80 overflow-auto">
                        <div className="flex-1 p-2 border-r border-white/5 bg-red-500/[0.02]">
                          <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap break-all leading-relaxed">
                            {truncateContent(patch.original)}
                          </pre>
                        </div>
                        <div className="flex-1 p-2 bg-emerald-500/[0.02]">
                          <pre className="text-xs text-gray-400 font-mono whitespace-pre-wrap break-all leading-relaxed">
                            {truncateContent(patch.preview)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* No Hooks Found */}
          {!isCloudReady && !hasPatches && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-amber-300">
                  Could not find hooks/setup files to patch automatically.
                </p>
                <p className="text-xs text-amber-400/70 mt-1">
                  You can still run with cloud env vars injected — your test code needs to check for
                  SELENIUM_REMOTE_URL or provider-specific env vars to connect to the cloud grid.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-300"
          >
            Cancel
          </button>

          {!isCloudReady && (
            <button
              onClick={onSkipAndRun}
              disabled={applying}
              className="px-4 py-2 text-sm rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5"
            >
              Skip & Run Anyway
            </button>
          )}

          {!isCloudReady && hasPatches ? (
            <button
              onClick={() => onApplyAndRun(analysis.patches)}
              disabled={applying}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium disabled:opacity-50"
            >
              {applying ? (
                <>
                  <span className="animate-spin">&#8635;</span>
                  Applying...
                </>
              ) : (
                <>
                  <Zap size={14} />
                  Apply & Run
                </>
              )}
            </button>
          ) : (
            <button
              onClick={onSkipAndRun}
              className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium"
            >
              <Cloud size={14} />
              {isCloudReady ? 'Run on Cloud' : 'Run Anyway'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Truncate content for display in diff preview */
function truncateContent(content: string): string {
  const maxLines = 60;
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + `\n\n... (${lines.length - maxLines} more lines)`;
}
