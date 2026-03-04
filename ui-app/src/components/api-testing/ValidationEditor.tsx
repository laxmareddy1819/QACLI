import { Plus, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import type { ValidationRule, ValidationResult } from '../../api/types';

interface ValidationEditorProps {
  rules: ValidationRule[];
  onChange: (rules: ValidationRule[]) => void;
  results?: ValidationResult[];
  onQuickAdd?: () => void;
}

const RULE_TYPES = [
  { value: 'status', label: 'Status Code' },
  { value: 'header', label: 'Header' },
  { value: 'body-contains', label: 'Body Contains' },
  { value: 'body-json-path', label: 'JSON Path' },
  { value: 'response-time', label: 'Response Time' },
  { value: 'schema', label: 'JSON Schema' },
] as const;

const OPERATORS = [
  { value: 'equals', label: '=' },
  { value: 'not-equals', label: '!=' },
  { value: 'contains', label: 'contains' },
  { value: 'not-contains', label: '!contains' },
  { value: 'greater-than', label: '>' },
  { value: 'less-than', label: '<' },
  { value: 'exists', label: 'exists' },
  { value: 'matches-regex', label: 'regex' },
] as const;

export function ValidationEditor({ rules, onChange, results, onQuickAdd }: ValidationEditorProps) {
  const addRule = () => {
    onChange([
      ...rules,
      {
        id: `vr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'status',
        operator: 'equals',
        expected: '200',
        enabled: true,
      },
    ]);
  };

  const updateRule = (index: number, updates: Partial<ValidationRule>) => {
    const updated = [...rules];
    updated[index] = { ...updated[index]!, ...updates };
    onChange(updated);
  };

  const removeRule = (index: number) => {
    onChange(rules.filter((_, i) => i !== index));
  };

  const getResult = (ruleId: string): ValidationResult | undefined =>
    results?.find(r => r.ruleId === ruleId);

  return (
    <div className="space-y-2">
      {rules.length === 0 && (
        <p className="text-[13px] text-gray-600 italic">No validations configured</p>
      )}

      {rules.map((rule, i) => {
        const result = getResult(rule.id);
        return (
          <div key={rule.id} className="flex items-center gap-1.5 group">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={e => updateRule(i, { enabled: e.target.checked })}
              className="w-3.5 h-3.5 rounded border-gray-600 bg-surface-2 accent-brand-500 flex-shrink-0"
            />

            <select
              value={rule.type}
              onChange={e => updateRule(i, { type: e.target.value as ValidationRule['type'] })}
              className="px-1.5 py-1 text-xs bg-surface-2 border border-white/5 rounded text-gray-300 focus:outline-none focus:border-brand-500/50"
            >
              {RULE_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {(rule.type === 'header' || rule.type === 'body-json-path') && (
              <input
                type="text"
                value={rule.target || ''}
                onChange={e => updateRule(i, { target: e.target.value })}
                placeholder={rule.type === 'header' ? 'Header name' : '$.path'}
                className="w-24 px-1.5 py-1 text-xs font-mono bg-surface-2 border border-white/5 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
              />
            )}

            {rule.type !== 'schema' && (
              <select
                value={rule.operator}
                onChange={e => updateRule(i, { operator: e.target.value as ValidationRule['operator'] })}
                className="px-1.5 py-1 text-xs bg-surface-2 border border-white/5 rounded text-gray-300 focus:outline-none focus:border-brand-500/50"
              >
                {OPERATORS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}

            {rule.type === 'schema' ? (
              <textarea
                value={rule.expected}
                onChange={e => updateRule(i, { expected: e.target.value })}
                placeholder={'{"type":"object","properties":{...}}'}
                rows={3}
                className="flex-1 min-w-0 px-1.5 py-1 text-xs font-mono bg-surface-2 border border-white/5 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-500/50 resize-y"
              />
            ) : (
              <input
                type="text"
                value={rule.expected}
                onChange={e => updateRule(i, { expected: e.target.value })}
                placeholder="Expected"
                className="flex-1 min-w-0 px-1.5 py-1 text-xs font-mono bg-surface-2 border border-white/5 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
              />
            )}

            {result && (
              result.passed
                ? <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                : <XCircle size={14} className="text-red-400 flex-shrink-0" title={result.message} />
            )}

            <button
              onClick={() => removeRule(i)}
              className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
            >
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={addRule}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <Plus size={11} /> Add Validation
        </button>
        {onQuickAdd && (
          <button
            onClick={onQuickAdd}
            className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            <Plus size={11} /> Quick Add from Response
          </button>
        )}
      </div>
    </div>
  );
}
