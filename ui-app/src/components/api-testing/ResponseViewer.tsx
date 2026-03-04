import { useState } from 'react';
import { Clock, HardDrive, CheckCircle2, XCircle, ShieldCheck, Variable } from 'lucide-react';
import type { ApiResponse, ValidationResult, ValidationRule } from '../../api/types';
import { ResponseJsonPicker } from './ResponseJsonPicker';
import { suggestOperator } from './utils/json-path-utils';

interface ResponseViewerProps {
  response: ApiResponse | null;
  loading?: boolean;
  onAddValidation?: (rule: ValidationRule) => void;
  onExtractVariable?: (name: string, path: string) => void;
}

type ResponseTab = 'body' | 'headers' | 'validations' | 'timing';

function statusColorClass(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-500/15 text-emerald-400';
  if (status >= 300 && status < 400) return 'bg-blue-500/15 text-blue-400';
  if (status >= 400 && status < 500) return 'bg-amber-500/15 text-amber-400';
  if (status >= 500) return 'bg-red-500/15 text-red-400';
  return 'bg-gray-500/15 text-gray-400';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatBody(body: string): { formatted: string; language: string } {
  try {
    const parsed = JSON.parse(body);
    return { formatted: JSON.stringify(parsed, null, 2), language: 'json' };
  } catch {
    // Check if HTML
    if (body.trim().startsWith('<')) return { formatted: body, language: 'html' };
    return { formatted: body, language: 'text' };
  }
}

export function ResponseViewer({ response, loading, onAddValidation, onExtractVariable }: ResponseViewerProps) {
  const [tab, setTab] = useState<ResponseTab>('body');
  const [pickerMode, setPickerMode] = useState<'none' | 'validate' | 'extract'>('none');
  const [extractVarName, setExtractVarName] = useState('');
  const [extractVarPath, setExtractVarPath] = useState('');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-gray-500">Sending request...</span>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-[13px]">
        Send a request to see the response
      </div>
    );
  }

  const { formatted, language } = formatBody(response.body);
  const isJsonBody = language === 'json';
  const validations = response.validationResults || [];
  const passCount = validations.filter(v => v.passed).length;

  const tabs: Array<{ id: ResponseTab; label: string; badge?: string }> = [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: `Headers (${Object.keys(response.headers).length})` },
    { id: 'validations', label: `Validations`, badge: validations.length > 0 ? `${passCount}/${validations.length}` : undefined },
    { id: 'timing', label: 'Timing' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-white/5 flex-shrink-0">
        <span className={`px-2 py-0.5 rounded text-[13px] font-bold ${statusColorClass(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <Clock size={10} /> {response.duration}ms
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <HardDrive size={10} /> {formatBytes(response.size)}
        </span>
        {response.status > 0 && (
          <div className="ml-auto flex items-center gap-1.5">
            {onExtractVariable && isJsonBody && (
              <button
                onClick={() => setPickerMode(pickerMode === 'extract' ? 'none' : 'extract')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${
                  pickerMode === 'extract'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                }`}
              >
                <Variable size={11} /> Extract
              </button>
            )}
            {onAddValidation && isJsonBody && (
              <button
                onClick={() => setPickerMode(pickerMode === 'validate' ? 'none' : 'validate')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-colors ${
                  pickerMode === 'validate'
                    ? 'bg-brand-500/20 text-brand-300'
                    : 'bg-brand-500/10 text-brand-400 hover:bg-brand-500/20'
                }`}
              >
                <ShieldCheck size={11} /> Validate
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 px-3 py-1 border-b border-white/5 flex-shrink-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              tab === t.id
                ? 'bg-brand-500/15 text-brand-300'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t.label}
            {t.badge && <span className="ml-1 text-[11px] opacity-70">({t.badge})</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {tab === 'body' && (
          <>
            {pickerMode === 'validate' && isJsonBody && onAddValidation ? (
              <div>
                <div className="mb-2 px-2 py-1.5 bg-brand-500/10 border border-brand-500/20 rounded-lg">
                  <p className="text-xs text-brand-300">Click any value below to create a validation rule for it</p>
                </div>
                <ResponseJsonPicker
                  data={response.body}
                  onSelectPath={(path, value) => {
                    const op = suggestOperator(value);
                    onAddValidation({
                      id: `vr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      type: 'body-json-path',
                      target: path,
                      operator: op as ValidationRule['operator'],
                      expected: value !== null && value !== undefined && typeof value !== 'object' ? String(value) : '',
                      enabled: true,
                    });
                  }}
                />
              </div>
            ) : pickerMode === 'extract' && isJsonBody && onExtractVariable ? (
              <div>
                <div className="mb-2 px-2 py-1.5 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <p className="text-xs text-amber-300">Click any value below to extract it as a variable</p>
                </div>
                <ResponseJsonPicker
                  data={response.body}
                  onSelectPath={(path, _value) => {
                    setExtractVarPath(path);
                    // Auto-generate variable name from path
                    const parts = path.replace(/\$/g, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
                    const suggested = parts.slice(-2).join('_').replace(/[^a-zA-Z0-9_]/g, '');
                    setExtractVarName(suggested || 'myVar');
                  }}
                />
                {extractVarPath && (
                  <div className="mt-3 flex items-center gap-2 p-2 bg-surface-2 rounded-lg border border-white/5">
                    <span className="text-[11px] text-gray-500">Save as:</span>
                    <input
                      value={extractVarName}
                      onChange={e => setExtractVarName(e.target.value)}
                      className="w-28 px-2 py-1 text-xs font-mono bg-surface-1 border border-white/5 rounded text-gray-300 focus:outline-none"
                      placeholder="Variable name"
                    />
                    <span className="text-[11px] text-gray-600">=</span>
                    <code className="text-xs text-brand-300 font-mono flex-1 truncate">{extractVarPath}</code>
                    <button
                      onClick={() => {
                        if (extractVarName.trim() && extractVarPath) {
                          onExtractVariable(extractVarName.trim(), extractVarPath);
                          setExtractVarPath('');
                          setExtractVarName('');
                        }
                      }}
                      disabled={!extractVarName.trim()}
                      className="px-2.5 py-1 rounded bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 disabled:opacity-40 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <pre className="text-[13px] font-mono text-gray-300 whitespace-pre-wrap break-words">
                {formatted}
              </pre>
            )}
          </>
        )}

        {tab === 'headers' && (
          <table className="w-full text-[13px]">
            <tbody>
              {Object.entries(response.headers).map(([key, value]) => (
                <tr key={key} className="border-b border-white/5">
                  <td className="py-1.5 pr-3 text-gray-400 font-medium whitespace-nowrap align-top">{key}</td>
                  <td className="py-1.5 text-gray-300 font-mono break-all">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'validations' && (
          <div className="space-y-2">
            {validations.length === 0 ? (
              <p className="text-[13px] text-gray-600 italic">No validations configured</p>
            ) : (
              validations.map((v, i) => (
                <div key={v.ruleId || i} className={`flex items-start gap-2 px-3 py-2 rounded-lg ${
                  v.passed ? 'bg-emerald-500/5' : 'bg-red-500/5'
                }`}>
                  {v.passed
                    ? <CheckCircle2 size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                    : <XCircle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                  }
                  <div className="min-w-0">
                    <p className={`text-[13px] ${v.passed ? 'text-emerald-300' : 'text-red-300'}`}>
                      {v.passed ? 'Passed' : 'Failed'}
                    </p>
                    {v.message && <p className="text-xs text-gray-500 mt-0.5">{v.message}</p>}
                    {v.actual && <p className="text-xs text-gray-600 font-mono mt-0.5 break-all">Actual: {v.actual}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'timing' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-3 py-2 bg-surface-1 border border-white/5 rounded-lg">
              <span className="text-[13px] text-gray-400">Total Duration</span>
              <span className="text-sm font-bold text-gray-200">{response.duration}ms</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-surface-1 border border-white/5 rounded-lg">
              <span className="text-[13px] text-gray-400">Response Size</span>
              <span className="text-sm font-medium text-gray-200">{formatBytes(response.size)}</span>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-surface-1 border border-white/5 rounded-lg">
              <span className="text-[13px] text-gray-400">Timestamp</span>
              <span className="text-[13px] text-gray-300">{new Date(response.timestamp).toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
