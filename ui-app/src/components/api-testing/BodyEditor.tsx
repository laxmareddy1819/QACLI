import type { RequestBody, KeyValuePair } from '../../api/types';
import { KeyValueEditor } from './KeyValueEditor';

interface BodyEditorProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
}

const BODY_TYPES: Array<{ value: RequestBody['type']; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'text', label: 'Text' },
  { value: 'form-data', label: 'Form Data' },
  { value: 'graphql', label: 'GraphQL' },
];

export function BodyEditor({ body, onChange }: BodyEditorProps) {
  return (
    <div className="space-y-3">
      {/* Type selector */}
      <div className="flex gap-1">
        {BODY_TYPES.map(bt => (
          <button
            key={bt.value}
            onClick={() => onChange({ ...body, type: bt.value })}
            className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
              body.type === bt.value
                ? 'bg-brand-500/20 text-brand-300'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            {bt.label}
          </button>
        ))}
      </div>

      {/* Body content */}
      {body.type === 'none' && (
        <p className="text-xs text-gray-600 italic">No body content</p>
      )}

      {(body.type === 'json' || body.type === 'text') && (
        <textarea
          value={body.raw || ''}
          onChange={e => onChange({ ...body, raw: e.target.value })}
          placeholder={body.type === 'json' ? '{\n  "key": "value"\n}' : 'Plain text body...'}
          className="w-full h-48 px-3 py-2 text-xs font-mono bg-surface-2 border border-white/5 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50 resize-y"
          spellCheck={false}
        />
      )}

      {body.type === 'form-data' && (
        <KeyValueEditor
          pairs={body.formData || []}
          onChange={formData => onChange({ ...body, formData })}
          keyPlaceholder="Field name"
          valuePlaceholder="Field value"
        />
      )}

      {body.type === 'graphql' && (
        <div className="space-y-2">
          <div>
            <label className="text-[10px] uppercase text-gray-500 font-medium mb-1 block">Query</label>
            <textarea
              value={body.raw || ''}
              onChange={e => onChange({ ...body, raw: e.target.value })}
              placeholder={'query {\n  users {\n    id\n    name\n  }\n}'}
              className="w-full h-36 px-3 py-2 text-xs font-mono bg-surface-2 border border-white/5 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50 resize-y"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-gray-500 font-medium mb-1 block">Variables</label>
            <textarea
              value={body.graphqlVariables || ''}
              onChange={e => onChange({ ...body, graphqlVariables: e.target.value })}
              placeholder={'{\n  "id": 1\n}'}
              className="w-full h-20 px-3 py-2 text-xs font-mono bg-surface-2 border border-white/5 rounded-lg text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50 resize-y"
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );
}
