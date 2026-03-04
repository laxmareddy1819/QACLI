import { useState, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Eye, EyeOff, Copy, Info } from 'lucide-react';
import type { ApiEnvironment, EnvironmentVariable } from '../../api/types';

interface EnvironmentEditorProps {
  environments: ApiEnvironment[];
  activeEnvId: string | null;
  onSelectEnv: (id: string | null) => void;
  onSave: (env: ApiEnvironment) => void;
  onDelete: (envId: string) => void;
  onClose: () => void;
}

export function EnvironmentEditor({
  environments, activeEnvId, onSelectEnv, onSave, onDelete, onClose,
}: EnvironmentEditorProps) {
  const [editingEnv, setEditingEnv] = useState<ApiEnvironment | null>(
    environments.find(e => e.id === activeEnvId) || null,
  );
  const [newEnvName, setNewEnvName] = useState('');
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  // Track whether the user has unsaved local edits
  const hasPendingEdits = useRef(false);

  // Re-sync editingEnv when environments prop refreshes (after save/invalidation)
  // but only if the user doesn't have pending local edits
  useEffect(() => {
    if (!editingEnv || hasPendingEdits.current) return;
    const refreshed = environments.find(e => e.id === editingEnv.id);
    if (refreshed) {
      setEditingEnv(refreshed);
    }
  }, [environments]);

  // Wrapper around setEditingEnv that marks pending edits for user-initiated changes
  const editEnvLocally = (env: ApiEnvironment) => {
    hasPendingEdits.current = true;
    setEditingEnv(env);
  };

  const handleCreateEnv = () => {
    if (!newEnvName.trim()) return;
    const env: ApiEnvironment = {
      id: `env-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: newEnvName.trim(),
      variables: [],
    };
    onSave(env);
    setEditingEnv(env);
    setNewEnvName('');
  };

  const handleDuplicateEnv = () => {
    if (!editingEnv) return;
    const dup: ApiEnvironment = {
      id: `env-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${editingEnv.name} (copy)`,
      variables: editingEnv.variables.map(v => ({ ...v })),
    };
    onSave(dup);
    setEditingEnv(dup);
  };

  const updateVariable = (index: number, field: keyof EnvironmentVariable, value: string | boolean) => {
    if (!editingEnv) return;
    const vars = [...editingEnv.variables];
    vars[index] = { ...vars[index]!, [field]: value };
    editEnvLocally({ ...editingEnv, variables: vars });
  };

  const addVariable = () => {
    if (!editingEnv) return;
    editEnvLocally({
      ...editingEnv,
      variables: [...editingEnv.variables, { key: '', value: '', enabled: true, secret: false }],
    });
  };

  const removeVariable = (index: number) => {
    if (!editingEnv) return;
    editEnvLocally({
      ...editingEnv,
      variables: editingEnv.variables.filter((_, i) => i !== index),
    });
  };

  const handleSave = () => {
    if (!editingEnv) return;
    hasPendingEdits.current = false; // Clear flag so useEffect can re-sync after save
    onSave(editingEnv);
  };

  const handleCopyRef = (key: string) => {
    navigator.clipboard.writeText(`{{${key}}}`).catch(() => {});
    setCopiedVar(key);
    setTimeout(() => setCopiedVar(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[700px] max-h-[85vh] bg-surface-1 rounded-xl border border-white/10 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <h2 className="text-sm font-bold text-gray-200">Manage Environments</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300"><X size={16} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: environment list */}
          <div className="w-48 border-r border-white/5 overflow-y-auto py-2 flex flex-col">
            <div className="flex-1">
              {environments.map(env => (
                <div
                  key={env.id}
                  className={`flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-white/5 group ${
                    editingEnv?.id === env.id ? 'bg-brand-500/10' : ''
                  }`}
                  onClick={() => { hasPendingEdits.current = false; setEditingEnv(env); }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="radio"
                      name="activeEnv"
                      checked={activeEnvId === env.id}
                      onChange={() => onSelectEnv(activeEnvId === env.id ? null : env.id)}
                      onClick={e => e.stopPropagation()}
                      className="w-3 h-3 accent-brand-500"
                    />
                    <span className="text-xs text-gray-300 truncate">{env.name}</span>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(env.id); if (editingEnv?.id === env.id) setEditingEnv(null); }}
                    className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>

            {/* Create new */}
            <div className="px-3 pt-2 border-t border-white/5">
              <input
                value={newEnvName}
                onChange={e => setNewEnvName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateEnv(); }}
                placeholder="New environment..."
                className="w-full px-2 py-1 text-[11px] bg-surface-2 border border-white/5 rounded text-gray-300 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
              />
            </div>
          </div>

          {/* Right: variable editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
              {editingEnv ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <input
                      value={editingEnv.name}
                      onChange={e => editEnvLocally({ ...editingEnv, name: e.target.value })}
                      className="text-sm font-medium bg-transparent border-none text-gray-200 focus:outline-none flex-1"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={handleDuplicateEnv}
                        className="px-2 py-1 text-[11px] rounded bg-surface-2 text-gray-400 hover:text-gray-200 hover:bg-surface-3 transition-colors"
                        title="Duplicate environment"
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        onClick={handleSave}
                        className="px-3 py-1 text-[11px] rounded bg-brand-500 text-white hover:bg-brand-600 transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    {/* Header row */}
                    <div className="flex gap-1.5 text-[10px] text-gray-600 uppercase">
                      <span className="w-5" />
                      <span className="flex-1">Variable</span>
                      <span className="flex-1">Value</span>
                      <span className="w-16" />
                    </div>

                    {editingEnv.variables.map((v, i) => (
                      <div key={i} className="flex items-center gap-1.5 group">
                        <input
                          type="checkbox"
                          checked={v.enabled}
                          onChange={e => updateVariable(i, 'enabled', e.target.checked)}
                          className="w-3.5 h-3.5 accent-brand-500"
                        />
                        <input
                          value={v.key}
                          onChange={e => updateVariable(i, 'key', e.target.value)}
                          placeholder="variable_name"
                          className="flex-1 px-2 py-1 text-xs font-mono bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
                        />
                        <input
                          type={v.secret ? 'password' : 'text'}
                          value={v.value}
                          onChange={e => updateVariable(i, 'value', e.target.value)}
                          placeholder="value"
                          className="flex-1 px-2 py-1 text-xs font-mono bg-surface-2 border border-white/5 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500/50"
                        />
                        <button
                          onClick={() => updateVariable(i, 'secret', !v.secret)}
                          className="p-1 text-gray-600 hover:text-gray-400"
                          title={v.secret ? 'Show value' : 'Hide value'}
                        >
                          {v.secret ? <EyeOff size={11} /> : <Eye size={11} />}
                        </button>
                        {v.key && (
                          <button
                            onClick={() => handleCopyRef(v.key)}
                            className="p-1 text-gray-600 hover:text-brand-400 opacity-0 group-hover:opacity-100"
                            title={`Copy {{${v.key}}}`}
                          >
                            <Copy size={11} />
                          </button>
                        )}
                        <button
                          onClick={() => removeVariable(i)}
                          className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}

                    <button onClick={addVariable} className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-300 pt-1">
                      <Plus size={11} /> Add Variable
                    </button>
                  </div>

                  {/* Copyable variable chips */}
                  {editingEnv.variables.filter(v => v.key && v.enabled).length > 0 && (
                    <div className="pt-2 border-t border-white/5">
                      <p className="text-[10px] text-gray-600 uppercase mb-1.5">Available Variables</p>
                      <div className="flex flex-wrap gap-1">
                        {editingEnv.variables.filter(v => v.key && v.enabled).map(v => (
                          <button
                            key={v.key}
                            onClick={() => handleCopyRef(v.key)}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                              copiedVar === v.key
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-surface-2 text-gray-400 hover:text-gray-200 hover:bg-surface-3'
                            }`}
                            title={`Click to copy {{${v.key}}}`}
                          >
                            {copiedVar === v.key ? 'Copied!' : `{{${v.key}}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-gray-600">
                  Select or create an environment
                </div>
              )}
            </div>

            {/* Help section at bottom */}
            <div className="px-4 py-3 border-t border-white/5 bg-surface-2/30">
              <div className="flex items-start gap-2">
                <Info size={12} className="text-brand-400 mt-0.5 flex-shrink-0" />
                <div className="text-[11px] text-gray-500 space-y-1">
                  <p>
                    Use <code className="px-1 py-0.5 bg-surface-2 rounded text-gray-400 font-mono">{'{{variableName}}'}</code> in
                    URLs, headers, body, and auth fields to reference environment variables.
                  </p>
                  <p>
                    Example: <code className="px-1 py-0.5 bg-surface-2 rounded text-gray-400 font-mono">{'{{baseUrl}}/api/users'}</code> or
                    Header <code className="px-1 py-0.5 bg-surface-2 rounded text-gray-400 font-mono">{'Authorization: Bearer {{token}}'}</code>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
