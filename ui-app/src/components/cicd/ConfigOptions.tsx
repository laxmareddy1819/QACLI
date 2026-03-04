import { useState, useEffect } from 'react';
import type { CICDOptions, CICDPlatform } from '../../api/types';

interface ConfigOptionsProps {
  platform: CICDPlatform;
  framework: string | null;
  options: CICDOptions;
  onChange: (options: CICDOptions) => void;
}

export function ConfigOptions({ platform, framework, options, onChange }: ConfigOptionsProps) {
  const fw = framework?.toLowerCase();
  const isPython = fw === 'pytest' || fw === 'robot';
  const isJava = fw === 'maven';
  const isDotnet = fw === 'dotnet';
  const isNode = !isPython && !isJava && !isDotnet;

  function update(partial: Partial<CICDOptions>) {
    onChange({ ...options, ...partial });
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-200">Configuration Options</h3>

      {/* Runtime Version */}
      <div className="grid grid-cols-2 gap-3">
        {isNode && (
          <OptionField label="Node.js Version">
            <select
              value={options.nodeVersion ?? '20'}
              onChange={e => update({ nodeVersion: e.target.value })}
              className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
            >
              <option value="18">18 LTS</option>
              <option value="20">20 LTS</option>
              <option value="22">22</option>
            </select>
          </OptionField>
        )}
        {isPython && (
          <OptionField label="Python Version">
            <select
              value={options.pythonVersion ?? '3.11'}
              onChange={e => update({ pythonVersion: e.target.value })}
              className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
            >
              <option value="3.10">3.10</option>
              <option value="3.11">3.11</option>
              <option value="3.12">3.12</option>
            </select>
          </OptionField>
        )}
        {isJava && (
          <OptionField label="Java Version">
            <select
              value={options.javaVersion ?? '17'}
              onChange={e => update({ javaVersion: e.target.value })}
              className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
            >
              <option value="11">11</option>
              <option value="17">17</option>
              <option value="21">21</option>
            </select>
          </OptionField>
        )}
        {isDotnet && (
          <OptionField label=".NET Version">
            <select
              value={options.dotnetVersion ?? '8.0'}
              onChange={e => update({ dotnetVersion: e.target.value })}
              className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
            >
              <option value="6.0">6.0</option>
              <option value="7.0">7.0</option>
              <option value="8.0">8.0</option>
            </select>
          </OptionField>
        )}

        <OptionField label="Timeout (min)">
          <input
            type="number"
            min={5}
            max={120}
            value={options.timeout ?? 30}
            onChange={e => update({ timeout: parseInt(e.target.value) || 30 })}
            className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
          />
        </OptionField>
      </div>

      {/* Triggers */}
      <OptionField label="Triggers">
        <div className="flex flex-wrap gap-2">
          {(['push', 'pull_request', 'schedule', 'manual'] as const).map(trigger => {
            const active = options.triggers?.includes(trigger) ?? (trigger === 'push' || trigger === 'pull_request');
            return (
              <button
                key={trigger}
                onClick={() => {
                  const current = options.triggers ?? ['push', 'pull_request'];
                  const next = active ? current.filter(t => t !== trigger) : [...current, trigger];
                  update({ triggers: next });
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                  ${active
                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                    : 'bg-surface-2 text-gray-500 border border-white/5 hover:text-gray-300'
                  }`}
              >
                {trigger.replace('_', ' ')}
              </button>
            );
          })}
        </div>
      </OptionField>

      {/* Branches */}
      <OptionField label="Branches">
        <input
          type="text"
          value={options.branches?.join(', ') ?? 'main'}
          onChange={e => update({ branches: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          placeholder="main, develop"
          className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
        />
      </OptionField>

      {/* Toggles */}
      <div className="grid grid-cols-2 gap-3">
        <Toggle
          label="Upload Artifacts"
          checked={options.uploadArtifacts ?? true}
          onChange={v => update({ uploadArtifacts: v })}
        />
        {(fw === 'playwright') && (
          <Toggle
            label="Parallel (Shard)"
            checked={options.parallel ?? false}
            onChange={v => update({ parallel: v })}
          />
        )}
        {platform === 'jenkins' && (
          <Toggle
            label="Use Docker"
            checked={options.useDocker ?? false}
            onChange={v => update({ useDocker: v })}
          />
        )}
      </div>

      {/* Shard count (if parallel on) */}
      {fw === 'playwright' && options.parallel && (
        <OptionField label="Shard Count">
          <input
            type="number"
            min={2}
            max={10}
            value={options.shardCount ?? 4}
            onChange={e => update({ shardCount: parseInt(e.target.value) || 4 })}
            className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-brand-500"
          />
        </OptionField>
      )}

      {/* Cron schedule (if schedule trigger) */}
      {options.triggers?.includes('schedule') && (
        <OptionField label="Cron Schedule">
          <input
            type="text"
            value={options.cronSchedule ?? '0 6 * * *'}
            onChange={e => update({ cronSchedule: e.target.value })}
            placeholder="0 6 * * *"
            className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-brand-500"
          />
          <span className="text-[10px] text-gray-500 mt-0.5 block">Daily at 6:00 AM UTC</span>
        </OptionField>
      )}
    </div>
  );
}

function OptionField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-left"
    >
      <div className={`w-8 h-4 rounded-full transition-colors relative ${checked ? 'bg-brand-500' : 'bg-gray-600'}`}>
        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-xs text-gray-300">{label}</span>
    </button>
  );
}
