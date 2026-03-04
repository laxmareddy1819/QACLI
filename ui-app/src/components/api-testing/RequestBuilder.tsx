import { useState, useMemo } from 'react';
import { Send, Loader2, ArrowRight } from 'lucide-react';
import type { ApiRequest, HttpMethod, KeyValuePair, RequestBody, RequestAuth, ValidationRule, ValidationResult } from '../../api/types';
import { KeyValueEditor } from './KeyValueEditor';
import { BodyEditor } from './BodyEditor';
import { AuthEditor } from './AuthEditor';
import { ValidationEditor } from './ValidationEditor';
import { ScriptEditor } from './ScriptEditor';

interface RequestBuilderProps {
  request: ApiRequest;
  onChange: (request: ApiRequest) => void;
  onSend: () => void;
  onSave?: () => void;
  onQuickValidate?: () => void;
  sending?: boolean;
  validationResults?: ValidationResult[];
  variables?: Record<string, string>;
}

/** Simple {{var}} resolver for URL preview (client-side only) */
function resolveUrlPreview(url: string, vars: Record<string, string>): string | null {
  if (!url || !url.includes('{{')) return null;
  const resolved = url.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => vars[key] ?? `{{${key}}}`);
  return resolved !== url ? resolved : null;
}

type BuilderTab = 'params' | 'headers' | 'body' | 'auth' | 'validations' | 'scripts';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-blue-400',
  PUT: 'text-amber-400',
  PATCH: 'text-brand-400',
  DELETE: 'text-red-400',
  HEAD: 'text-purple-400',
  OPTIONS: 'text-gray-400',
};

export function RequestBuilder({
  request, onChange, onSend, onSave, onQuickValidate, sending, validationResults, variables,
}: RequestBuilderProps) {
  const [tab, setTab] = useState<BuilderTab>('params');

  // Resolved URL preview (only shown when URL contains {{vars}} and environment is active)
  const resolvedUrl = useMemo(() => {
    if (!variables || Object.keys(variables).length === 0) return null;
    return resolveUrlPreview(request.url, variables);
  }, [request.url, variables]);

  const updateField = <K extends keyof ApiRequest>(field: K, value: ApiRequest[K]) => {
    onChange({ ...request, [field]: value });
  };

  const tabs: Array<{ id: BuilderTab; label: string; count?: number }> = [
    { id: 'params', label: 'Params', count: request.queryParams.filter(p => p.enabled && p.key).length },
    { id: 'headers', label: 'Headers', count: request.headers.filter(h => h.enabled && h.key).length },
    { id: 'body', label: 'Body' },
    { id: 'auth', label: 'Auth' },
    { id: 'validations', label: 'Validations', count: request.validations.length },
    { id: 'scripts', label: 'Scripts', count: (request.preRequestScript || request.postResponseScript) ? 1 : 0 },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Request Name */}
      <div className="px-3 pt-2 pb-1 border-b border-white/5 flex-shrink-0">
        <input
          type="text"
          value={request.name}
          onChange={e => updateField('name', e.target.value)}
          onBlur={() => onSave?.()}
          placeholder="Request name"
          className="w-full px-1 py-0.5 text-sm font-medium bg-transparent border-none text-gray-200 placeholder-gray-600 focus:outline-none hover:bg-surface-2 focus:bg-surface-2 rounded transition-colors"
        />
      </div>

      {/* URL Bar */}
      <div className="flex gap-1.5 px-3 py-2 border-b border-white/5 flex-shrink-0">
        <select
          value={request.method}
          onChange={e => updateField('method', e.target.value as HttpMethod)}
          className={`px-2 py-1.5 text-[13px] font-bold bg-surface-2 border border-white/5 rounded-lg focus:outline-none focus:border-brand-500/50 ${METHOD_COLORS[request.method]}`}
        >
          {METHODS.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <input
          type="text"
          value={request.url}
          onChange={e => updateField('url', e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !sending) onSend(); }}
          placeholder="https://api.example.com/endpoint or {{baseUrl}}/path"
          className="flex-1 px-3 py-1.5 text-sm font-mono bg-surface-2 border border-white/5 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
        />

        <button
          onClick={onSend}
          disabled={sending || !request.url}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-500 text-white text-[13px] font-medium hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          Send
        </button>
      </div>

      {/* Resolved URL preview — shows when environment variables are substituted */}
      {resolvedUrl && (
        <div className="flex items-center gap-1.5 px-4 py-1 border-b border-white/5 bg-surface-1/50 flex-shrink-0">
          <ArrowRight size={10} className="text-emerald-500/60 flex-shrink-0" />
          <span className="text-xs font-mono text-gray-500 truncate" title={resolvedUrl}>
            {resolvedUrl}
          </span>
        </div>
      )}

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
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 text-[11px] px-1 py-0.5 rounded-full bg-surface-2 text-gray-400">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'params' && (
          <KeyValueEditor
            pairs={request.queryParams}
            onChange={params => updateField('queryParams', params)}
            keyPlaceholder="Parameter"
            valuePlaceholder="Value"
          />
        )}

        {tab === 'headers' && (
          <KeyValueEditor
            pairs={request.headers}
            onChange={headers => updateField('headers', headers)}
            keyPlaceholder="Header name"
            valuePlaceholder="Header value"
          />
        )}

        {tab === 'body' && (
          <BodyEditor
            body={request.body}
            onChange={body => updateField('body', body)}
          />
        )}

        {tab === 'auth' && (
          <AuthEditor
            auth={request.auth}
            onChange={auth => updateField('auth', auth)}
          />
        )}

        {tab === 'validations' && (
          <ValidationEditor
            rules={request.validations}
            onChange={validations => updateField('validations', validations)}
            results={validationResults}
            onQuickAdd={onQuickValidate}
          />
        )}

        {tab === 'scripts' && (
          <ScriptEditor
            preRequestScript={request.preRequestScript || ''}
            postResponseScript={request.postResponseScript || ''}
            onChangePreRequest={script => updateField('preRequestScript', script)}
            onChangePostResponse={script => updateField('postResponseScript', script)}
          />
        )}
      </div>
    </div>
  );
}
