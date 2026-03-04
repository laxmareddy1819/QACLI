import { useState } from 'react';
import { ShieldCheck, X, Plus } from 'lucide-react';
import { ResponseJsonPicker } from './ResponseJsonPicker';
import { suggestOperator } from './utils/json-path-utils';
import type { ValidationRule } from '../../api/types';

interface QuickValidationPickerProps {
  responseBody: string;
  onAddValidation: (rule: ValidationRule) => void;
  onClose: () => void;
}

export function QuickValidationPicker({ responseBody, onAddValidation, onClose }: QuickValidationPickerProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedValue, setSelectedValue] = useState<unknown>(null);
  const [operator, setOperator] = useState('equals');
  const [expected, setExpected] = useState('');

  let parsedBody: unknown;
  try { parsedBody = JSON.parse(responseBody); } catch { parsedBody = null; }

  const handleSelectPath = (path: string, value: unknown) => {
    setSelectedPath(path);
    setSelectedValue(value);
    const suggestedOp = suggestOperator(value);
    setOperator(suggestedOp);
    setExpected(value !== null && value !== undefined && typeof value !== 'object' ? String(value) : '');
  };

  const handleAdd = () => {
    if (!selectedPath) return;
    const rule: ValidationRule = {
      id: `vr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'body-json-path',
      target: selectedPath,
      operator: operator as ValidationRule['operator'],
      expected,
      enabled: true,
    };
    onAddValidation(rule);
    setSelectedPath(null);
    setSelectedValue(null);
    setExpected('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-1 border border-white/10 rounded-xl w-[600px] max-h-[80vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-brand-400" />
            <h3 className="text-sm font-bold text-gray-100">Quick Validate</h3>
            <span className="text-[11px] text-gray-500">Click any value to create a validation</span>
          </div>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        {/* JSON tree */}
        <div className="flex-1 overflow-auto p-4">
          {parsedBody ? (
            <ResponseJsonPicker data={parsedBody} onSelectPath={handleSelectPath} />
          ) : (
            <p className="text-xs text-gray-500 italic">Response body is not valid JSON</p>
          )}
        </div>

        {/* Selected path & add validation */}
        {selectedPath && (
          <div className="border-t border-white/5 px-4 py-3 bg-surface-2 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider w-16">Path</span>
              <code className="text-xs text-brand-300 font-mono bg-surface-1 px-2 py-0.5 rounded flex-1 truncate">
                {selectedPath}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500 uppercase tracking-wider w-16">Assert</span>
              <select
                value={operator}
                onChange={e => setOperator(e.target.value)}
                className="px-2 py-1 text-[11px] bg-surface-1 border border-white/5 rounded text-gray-300 focus:outline-none"
              >
                <option value="equals">equals (=)</option>
                <option value="not-equals">not equals (!=)</option>
                <option value="contains">contains</option>
                <option value="not-contains">not contains</option>
                <option value="greater-than">greater than (&gt;)</option>
                <option value="less-than">less than (&lt;)</option>
                <option value="exists">exists</option>
                <option value="matches-regex">regex match</option>
              </select>
              {operator !== 'exists' && (
                <input
                  value={expected}
                  onChange={e => setExpected(e.target.value)}
                  placeholder="Expected value"
                  className="flex-1 px-2 py-1 text-[11px] font-mono bg-surface-1 border border-white/5 rounded text-gray-300 placeholder-gray-600 focus:outline-none"
                />
              )}
              <button
                onClick={handleAdd}
                className="flex items-center gap-1 px-3 py-1 rounded-lg bg-brand-500 text-white text-xs font-medium hover:bg-brand-600 transition-colors"
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
