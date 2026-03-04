import { Plus, Trash2 } from 'lucide-react';
import type { KeyValuePair } from '../../api/types';

interface KeyValueEditorProps {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  showDescription?: boolean;
}

export function KeyValueEditor({
  pairs, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value', showDescription = false,
}: KeyValueEditorProps) {

  const updatePair = (index: number, field: keyof KeyValuePair, value: string | boolean) => {
    const updated = [...pairs];
    updated[index] = { ...updated[index]!, [field]: value };
    onChange(updated);
  };

  const addPair = () => {
    onChange([...pairs, { key: '', value: '', enabled: true }]);
  };

  const removePair = (index: number) => {
    onChange(pairs.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1">
      {pairs.map((pair, i) => (
        <div key={i} className="flex items-center gap-1.5 group">
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={e => updatePair(i, 'enabled', e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-600 bg-surface-2 accent-brand-500 flex-shrink-0"
          />
          <input
            type="text"
            value={pair.key}
            onChange={e => updatePair(i, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            className="flex-1 min-w-0 px-2 py-1 text-[13px] bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
          />
          <input
            type="text"
            value={pair.value}
            onChange={e => updatePair(i, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            className="flex-1 min-w-0 px-2 py-1 text-[13px] bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
          />
          {showDescription && (
            <input
              type="text"
              value={pair.description || ''}
              onChange={e => updatePair(i, 'description', e.target.value)}
              placeholder="Description"
              className="w-32 px-2 py-1 text-[13px] bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
            />
          )}
          <button
            onClick={() => removePair(i)}
            className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={addPair}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors pt-1"
      >
        <Plus size={11} /> Add
      </button>
    </div>
  );
}
