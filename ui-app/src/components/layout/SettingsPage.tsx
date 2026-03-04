import { useOutletContext } from 'react-router-dom';
import { Settings, Monitor, Palette, Cloud, Plus, Trash2, CheckCircle, XCircle, Loader2, Eye, EyeOff, Copy, Heart, Brain, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { toggleTheme, getTheme } from '../../styles/theme';
import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../shared/Toast';
import {
  getCloudProviders,
  saveCloudProvider,
  deleteCloudProvider,
  testCloudConnection,
  getCloudHubUrl,
  getHealingConfig,
  saveHealingConfig,
  getLLMConfig,
  saveLLMConfig,
  testLLMConnection,
  type CloudProviderId,
  type CloudProviderInfo,
  type LLMProviderId,
  type LLMProviderConfig,
  type LLMConfigResponse,
} from '../../api/client';
import type { ProjectInfo } from '../../api/types';

const PROVIDER_META: Record<CloudProviderId, { label: string; color: string }> = {
  browserstack: { label: 'BrowserStack', color: 'text-orange-400' },
  lambdatest: { label: 'LambdaTest', color: 'text-purple-400' },
  saucelabs: { label: 'Sauce Labs', color: 'text-red-400' },
};

const ALL_PROVIDERS: CloudProviderId[] = ['browserstack', 'lambdatest', 'saucelabs'];
const KEY_SENTINEL = '••••••••';

type SettingsTab = 'general' | 'llm' | 'healing' | 'cloud';

interface ProviderForm {
  username: string;
  accessKey: string;
  region: string;
  hubUrl: string;
  defaultBuildName: string;
  enabled: boolean;
}

const emptyForm = (): ProviderForm => ({
  username: '',
  accessKey: '',
  region: 'us-west-1',
  hubUrl: '',
  defaultBuildName: '',
  enabled: true,
});

export function SettingsPage() {
  const { project } = useOutletContext<{ project: ProjectInfo }>();
  const [theme, setTheme] = useState(getTheme);
  const { toast } = useToast();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');

  // Cloud state
  const [providers, setProviders] = useState<CloudProviderInfo[]>([]);
  const [activeCloudTab, setActiveCloudTab] = useState<CloudProviderId>('browserstack');
  const [forms, setForms] = useState<Record<CloudProviderId, ProviderForm>>({
    browserstack: emptyForm(),
    lambdatest: emptyForm(),
    saucelabs: emptyForm(),
  });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [saving, setSaving] = useState(false);

  // Healing config state
  const [healingEnabled, setHealingEnabled] = useState(true);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.7);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [retentionDays, setRetentionDays] = useState(90);
  const [healingSaving, setHealingSaving] = useState(false);

  const loadHealingConfig = useCallback(async () => {
    try {
      const cfg = await getHealingConfig();
      setHealingEnabled(cfg.enabled);
      setConfidenceThreshold(cfg.confidenceThreshold);
      setAiEnabled(cfg.aiEnabled);
      setRetentionDays(cfg.retentionDays);
    } catch { /* healing not available */ }
  }, []);

  useEffect(() => { loadHealingConfig(); }, [loadHealingConfig]);

  const handleSaveHealing = async () => {
    setHealingSaving(true);
    try {
      await saveHealingConfig({ enabled: healingEnabled, confidenceThreshold, aiEnabled, retentionDays });
      toast('success', 'Healing settings saved');
    } catch (err) {
      toast('error', `Failed to save: ${err}`);
    } finally {
      setHealingSaving(false);
    }
  };

  const loadProviders = useCallback(async () => {
    try {
      const data = await getCloudProviders();
      setProviders(data.providers);
      // Populate forms from saved providers
      const newForms = { ...forms };
      for (const p of data.providers) {
        newForms[p.id] = {
          username: p.username,
          accessKey: p.accessKey,
          region: p.region || 'us-west-1',
          hubUrl: p.hubUrl || '',
          defaultBuildName: p.defaultBuildName || '',
          enabled: p.enabled,
        };
      }
      setForms(newForms);
    } catch {
      // silent — providers not available yet
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  const updateForm = (id: CloudProviderId, field: keyof ProviderForm, value: string | boolean) => {
    setForms(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSave = async (id: CloudProviderId) => {
    const f = forms[id];
    if (!f.username) {
      toast('error', 'Username is required');
      return;
    }
    if (!f.accessKey || (f.accessKey === KEY_SENTINEL && !isConfigured(id))) {
      toast('error', 'Please enter the Access Key');
      return;
    }
    setSaving(true);
    try {
      await saveCloudProvider({
        id,
        enabled: f.enabled,
        username: f.username,
        accessKey: f.accessKey,
        region: id === 'saucelabs' ? f.region : undefined,
        hubUrl: f.hubUrl || undefined,
        defaultBuildName: f.defaultBuildName || undefined,
      });
      toast('success', `${PROVIDER_META[id].label} saved`);
      await loadProviders();
    } catch (err) {
      toast('error', `Save failed: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: CloudProviderId) => {
    try {
      await deleteCloudProvider(id);
      setForms(prev => ({ ...prev, [id]: emptyForm() }));
      setTestResults(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast('info', `${PROVIDER_META[id].label} removed`);
      await loadProviders();
    } catch (err) {
      toast('error', `Delete failed: ${err}`);
    }
  };

  const handleTest = async (id: CloudProviderId) => {
    const f = forms[id];
    if (!f.username) {
      toast('error', 'Enter username first');
      return;
    }
    if (!f.accessKey || (f.accessKey === KEY_SENTINEL && !isConfigured(id))) {
      toast('error', 'Enter access key first');
      return;
    }
    setTesting(prev => ({ ...prev, [id]: true }));
    setTestResults(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const res = await testCloudConnection({
        id,
        username: f.username,
        accessKey: f.accessKey,
        region: id === 'saucelabs' ? f.region : undefined,
      });
      setTestResults(prev => ({ ...prev, [id]: { ok: res.connected, msg: res.message + (res.details ? ` (${res.details})` : '') } }));
    } catch (err) {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, msg: String(err) } }));
    } finally {
      setTesting(prev => ({ ...prev, [id]: false }));
    }
  };

  const copyHubUrl = async (id: CloudProviderId) => {
    try {
      const data = await getCloudHubUrl(id);
      if (data.hubUrl) {
        await navigator.clipboard.writeText(data.hubUrl);
        toast('info', 'Hub URL copied (with credentials)');
      }
    } catch {
      toast('error', 'Failed to copy URL');
    }
  };

  const isConfigured = (id: CloudProviderId) => providers.some(p => p.id === id);

  // Tab definitions
  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode; description: string }[] = [
    { id: 'general', label: 'General', icon: <Palette size={16} />, description: 'Project info & appearance' },
    { id: 'llm', label: 'LLM', icon: <Brain size={16} className="text-brand-400" />, description: 'AI provider configuration' },
    { id: 'healing', label: 'Self-Healing', icon: <Heart size={16} className="text-pink-400" />, description: 'Selector healing engine' },
    { id: 'cloud', label: 'Cloud Providers', icon: <Cloud size={16} className="text-sky-400" />, description: 'Cloud testing grids' },
  ];

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-0 flex-shrink-0">
        <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-2.5">
          <Settings size={24} />
          Settings
        </h1>
      </div>

      {/* ── Tab Bar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-white/5 px-6 mt-4 flex-shrink-0">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setSettingsTab(tab.id)}
            className={`flex items-center gap-2.5 px-5 py-3 text-[15px] font-medium transition-colors relative rounded-t-lg ${
              settingsTab === tab.id
                ? 'text-brand-300 bg-surface-1/50'
                : 'text-gray-500 hover:text-gray-300 hover:bg-surface-1/30'
            }`}
          >
            {React.cloneElement(tab.icon as React.ReactElement, { size: 18 })}
            {tab.label}
            {settingsTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 rounded-t" />
            )}
          </button>
        ))}
      </div>

      {/* ── Tab Content ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-5xl mx-auto space-y-6">
          {settingsTab === 'general' && (
            <GeneralTab project={project} theme={theme} setTheme={setTheme} />
          )}
          {settingsTab === 'llm' && <LLMTab />}
          {settingsTab === 'healing' && (
            <HealingTab
              healingEnabled={healingEnabled}
              setHealingEnabled={setHealingEnabled}
              confidenceThreshold={confidenceThreshold}
              setConfidenceThreshold={setConfidenceThreshold}
              aiEnabled={aiEnabled}
              setAiEnabled={setAiEnabled}
              retentionDays={retentionDays}
              setRetentionDays={setRetentionDays}
              healingSaving={healingSaving}
              onSave={handleSaveHealing}
            />
          )}
          {settingsTab === 'cloud' && (
            <CloudTab
              providers={providers}
              activeCloudTab={activeCloudTab}
              setActiveCloudTab={setActiveCloudTab}
              forms={forms}
              updateForm={updateForm}
              showKeys={showKeys}
              setShowKeys={setShowKeys}
              testing={testing}
              testResults={testResults}
              saving={saving}
              isConfigured={isConfigured}
              onSave={handleSave}
              onDelete={handleDelete}
              onTest={handleTest}
              onCopyHubUrl={copyHubUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  GENERAL TAB
// ══════════════════════════════════════════════════════════════════════════════

function GeneralTab({ project, theme, setTheme }: {
  project: ProjectInfo;
  theme: string;
  setTheme: (t: string) => void;
}) {
  return (
    <>
      {/* Project info */}
      <div className="bg-surface-1 rounded-xl border border-white/5 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2.5">
          <Monitor size={18} />
          Project Information
        </h2>
        <div className="grid grid-cols-2 gap-y-3.5 gap-x-6 text-[15px]">
          <span className="text-gray-400">Framework</span>
          <span className="text-gray-200">{project.framework || 'Auto-detected'}</span>
          <span className="text-gray-400">Language</span>
          <span className="text-gray-200">{project.language || 'Multiple'}</span>
          <span className="text-gray-400">Path</span>
          <span className="text-gray-200 font-mono text-sm truncate" title={project.rootPath}>{project.rootPath}</span>
          <span className="text-gray-400">Modules</span>
          <span className="text-gray-200">{project.stats.totalModules}</span>
          <span className="text-gray-400">Total Files</span>
          <span className="text-gray-200">{project.stats.totalFiles}</span>
        </div>
      </div>

      {/* Appearance / Theme */}
      <div className="bg-surface-1 rounded-xl border border-white/5 p-6 space-y-4">
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2.5">
          <Palette size={18} />
          Appearance
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[15px] text-gray-300 block">Theme</span>
            <span className="text-sm text-gray-500">Choose between dark and light mode</span>
          </div>
          <button
            onClick={() => { toggleTheme(); setTheme(getTheme()); }}
            className="px-5 py-2.5 text-[15px] rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5 transition-colors"
          >
            {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
          </button>
        </div>
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  SELF-HEALING TAB
// ══════════════════════════════════════════════════════════════════════════════

function HealingTab({
  healingEnabled, setHealingEnabled,
  confidenceThreshold, setConfidenceThreshold,
  aiEnabled, setAiEnabled,
  retentionDays, setRetentionDays,
  healingSaving, onSave,
}: {
  healingEnabled: boolean;
  setHealingEnabled: (v: boolean) => void;
  confidenceThreshold: number;
  setConfidenceThreshold: (v: number) => void;
  aiEnabled: boolean;
  setAiEnabled: (v: boolean) => void;
  retentionDays: number;
  setRetentionDays: (v: number) => void;
  healingSaving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2.5">
          <Heart size={18} className="text-pink-400" />
          Self-Healing Configuration
        </h2>
        <p className="text-sm text-gray-500 mt-1.5">
          Configure the automatic selector healing engine. When enabled, broken selectors are automatically repaired using fingerprinting, similarity matching, and AI analysis.
        </p>
      </div>

      {/* Enable toggle */}
      <div className="bg-surface-2/30 rounded-lg p-4 border border-white/5">
        <label className="flex items-center gap-3 text-[15px] text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={healingEnabled}
            onChange={(e) => setHealingEnabled(e.target.checked)}
            className="rounded border-gray-600 bg-surface-2 text-brand-500 focus:ring-brand-500 w-4 h-4"
          />
          <div>
            <span className="block font-medium">Enable self-healing</span>
            <span className="text-sm text-gray-500">Automatically repair broken selectors during test execution</span>
          </div>
        </label>
      </div>

      {/* Confidence Threshold */}
      <div>
        <label className="text-sm text-gray-400 block mb-2">
          Confidence Threshold: <span className="text-gray-200 font-semibold text-base">{confidenceThreshold.toFixed(2)}</span>
        </label>
        <input
          type="range"
          min={0.1}
          max={1.0}
          step={0.05}
          value={confidenceThreshold}
          onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
          className="w-full accent-brand-500"
        />
        <div className="flex justify-between text-xs text-gray-600 mt-1">
          <span>0.10 (aggressive)</span>
          <span>1.00 (strict)</span>
        </div>
      </div>

      {/* AI Healing toggle */}
      <div className="bg-surface-2/30 rounded-lg p-4 border border-white/5">
        <label className="flex items-center gap-3 text-[15px] text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={(e) => setAiEnabled(e.target.checked)}
            className="rounded border-gray-600 bg-surface-2 text-brand-500 focus:ring-brand-500 w-4 h-4"
          />
          <div>
            <span className="block font-medium">AI-powered healing</span>
            <span className="text-sm text-gray-500">Use LLM for complex repairs when traditional strategies fail</span>
          </div>
        </label>
      </div>

      {/* Retention */}
      <div>
        <label className="text-sm text-gray-400 block mb-1.5">Data Retention</label>
        <select
          value={retentionDays}
          onChange={(e) => setRetentionDays(Number(e.target.value))}
          className="w-full bg-surface-2 border border-white/10 rounded-lg px-3 py-2.5 text-[15px] text-gray-200 outline-none focus:border-brand-500/50"
        >
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
          <option value={180}>180 days</option>
        </select>
        <p className="text-xs text-gray-600 mt-1">How long to keep healing events and fingerprint data</p>
      </div>

      {/* Save */}
      <div className="pt-1 border-t border-white/5">
        <button
          onClick={onSave}
          disabled={healingSaving}
          className="flex items-center gap-2 px-5 py-2.5 text-[15px] rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium disabled:opacity-40 transition-colors mt-3"
        >
          {healingSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
          Save Healing Settings
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  CLOUD PROVIDERS TAB
// ══════════════════════════════════════════════════════════════════════════════

function CloudTab({
  providers, activeCloudTab, setActiveCloudTab,
  forms, updateForm, showKeys, setShowKeys,
  testing, testResults, saving,
  isConfigured, onSave, onDelete, onTest, onCopyHubUrl,
}: {
  providers: CloudProviderInfo[];
  activeCloudTab: CloudProviderId;
  setActiveCloudTab: (id: CloudProviderId) => void;
  forms: Record<CloudProviderId, ProviderForm>;
  updateForm: (id: CloudProviderId, field: keyof ProviderForm, value: string | boolean) => void;
  showKeys: Record<string, boolean>;
  setShowKeys: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  testing: Record<string, boolean>;
  testResults: Record<string, { ok: boolean; msg: string }>;
  saving: boolean;
  isConfigured: (id: CloudProviderId) => boolean;
  onSave: (id: CloudProviderId) => void;
  onDelete: (id: CloudProviderId) => void;
  onTest: (id: CloudProviderId) => void;
  onCopyHubUrl: (id: CloudProviderId) => void;
}) {
  return (
    <div className="bg-surface-1 rounded-xl border border-white/5 p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2.5">
          <Cloud size={18} className="text-sky-400" />
          Cloud Grid Providers
        </h2>
        <p className="text-sm text-gray-500 mt-1.5">
          Configure cloud testing providers. Credentials are injected as environment variables when running tests on the cloud.
          Works with any test framework (Selenium, Playwright, Cypress, etc.) and any language.
        </p>
      </div>

      {/* Provider sub-tabs */}
      <div className="flex gap-1.5 border-b border-white/5 pb-0">
        {ALL_PROVIDERS.map(id => (
          <button
            key={id}
            onClick={() => setActiveCloudTab(id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeCloudTab === id
                ? 'border-brand-500 text-brand-400 bg-surface-2'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <span className="flex items-center gap-2">
              {isConfigured(id) && <CheckCircle size={14} className="text-emerald-400" />}
              {PROVIDER_META[id].label}
            </span>
          </button>
        ))}
      </div>

      {/* Active provider form */}
      {ALL_PROVIDERS.map(id => id === activeCloudTab && (
        <div key={id} className="space-y-4">
          {/* Enable toggle */}
          <label className="flex items-center gap-2.5 text-[15px] text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={forms[id].enabled}
              onChange={e => updateForm(id, 'enabled', e.target.checked)}
              className="rounded border-gray-600 bg-surface-2 text-brand-500 focus:ring-brand-500"
            />
            Enable {PROVIDER_META[id].label}
          </label>

          {/* Username */}
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Username</label>
            <input
              value={forms[id].username}
              onChange={e => updateForm(id, 'username', e.target.value)}
              placeholder={`${PROVIDER_META[id].label} username`}
              className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50"
            />
          </div>

          {/* Access Key */}
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">
              Access Key
              {isConfigured(id) && forms[id].accessKey === KEY_SENTINEL && (
                <span className="ml-2 text-gray-600 font-normal">(saved — click to change)</span>
              )}
            </label>
            <div className="relative">
              <input
                type={showKeys[id] ? 'text' : 'password'}
                value={forms[id].accessKey}
                onChange={e => updateForm(id, 'accessKey', e.target.value)}
                onFocus={() => {
                  if (forms[id].accessKey === KEY_SENTINEL) {
                    updateForm(id, 'accessKey', '');
                  }
                }}
                onBlur={() => {
                  if (!forms[id].accessKey && isConfigured(id)) {
                    updateForm(id, 'accessKey', KEY_SENTINEL);
                  }
                }}
                placeholder="Access key / API token"
                className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 pr-10 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 font-mono"
              />
              <button
                onClick={() => setShowKeys(prev => ({ ...prev, [id]: !prev[id] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showKeys[id] ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Region (Sauce Labs only) */}
          {id === 'saucelabs' && (
            <div>
              <label className="text-sm text-gray-400 block mb-1.5">Region</label>
              <select
                value={forms[id].region}
                onChange={e => updateForm(id, 'region', e.target.value)}
                className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none focus:border-brand-500/50"
              >
                <option value="us-west-1">US West</option>
                <option value="eu-central-1">EU Central</option>
              </select>
            </div>
          )}

          {/* Build Name */}
          <div>
            <label className="text-sm text-gray-400 block mb-1.5">Default Build Name (optional)</label>
            <input
              value={forms[id].defaultBuildName}
              onChange={e => updateForm(id, 'defaultBuildName', e.target.value)}
              placeholder="e.g., qabot-{date}"
              className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50"
            />
          </div>

          {/* Hub URL (display only if configured) */}
          {isConfigured(id) && (
            <div>
              <label className="text-sm text-gray-400 block mb-1.5">Remote WebDriver URL</label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={providers.find(p => p.id === id)?.hubUrl || ''}
                  className="flex-1 bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-gray-400 font-mono outline-none"
                />
                <button
                  onClick={() => onCopyHubUrl(id)}
                  className="px-3 py-2.5 bg-surface-2 border border-white/10 rounded-lg text-gray-400 hover:text-gray-200"
                  title="Copy URL"
                >
                  <Copy size={16} />
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-1">Copy button copies the URL with real credentials. Displayed URL is masked for security.</p>
            </div>
          )}

          {/* Test connection result */}
          {testResults[id] && (
            <div className={`flex items-center gap-2 text-[15px] px-4 py-2.5 rounded-lg ${
              testResults[id].ok
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {testResults[id].ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
              {testResults[id].msg}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2.5 pt-2">
            <button
              onClick={() => onTest(id)}
              disabled={testing[id] || !forms[id].username || (!forms[id].accessKey && !isConfigured(id))}
              className="flex items-center gap-2 px-4 py-2 text-[15px] rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5 disabled:opacity-40"
            >
              {testing[id] ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              Test Connection
            </button>
            <button
              onClick={() => onSave(id)}
              disabled={saving || !forms[id].username || (!forms[id].accessKey && !isConfigured(id))}
              className="flex items-center gap-2 px-5 py-2 text-[15px] rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium disabled:opacity-40"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              Save
            </button>
            {isConfigured(id) && (
              <button
                onClick={() => onDelete(id)}
                className="flex items-center gap-2 px-4 py-2 text-[15px] rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/20"
              >
                <Trash2 size={16} />
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  PROVIDER ICONS (Custom SVGs for each LLM provider)
// ══════════════════════════════════════════════════════════════════════════════

function ProviderIcon({ provider, size = 20 }: { provider: LLMProviderId; size?: number }) {
  switch (provider) {
    case 'openai':
      // Official OpenAI logo
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071.005l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071-.006l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.661zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
        </svg>
      );
    case 'anthropic':
      // Official Anthropic logo
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.257 0h3.603L16.744 20.48h-3.603L6.57 3.52zM0 20.48h3.603L7.173 9.14l-1.74-4.49L0 20.48z" />
        </svg>
      );
    case 'google':
      // Official Google Gemini sparkle logo (multi-color gradients)
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF" />
          <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-grad-0)" />
          <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-grad-1)" />
          <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-grad-2)" />
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id="gemini-grad-0" x1="7" x2="11" y1="15.5" y2="12"><stop stopColor="#08B962" /><stop offset="1" stopColor="#08B962" stopOpacity={0} /></linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" id="gemini-grad-1" x1="8" x2="11.5" y1="5.5" y2="11"><stop stopColor="#F94543" /><stop offset="1" stopColor="#F94543" stopOpacity={0} /></linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" id="gemini-grad-2" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stopColor="#FABC12" /><stop offset=".46" stopColor="#FABC12" stopOpacity={0} /></linearGradient>
          </defs>
        </svg>
      );
    case 'xai':
      // Official Grok/xAI logo
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z" />
        </svg>
      );
    case 'ollama':
      // Official Ollama logo
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg">
          <path d="M7.905 1.09c.216.085.411.225.588.41.295.306.544.744.734 1.263.191.522.315 1.1.362 1.68a5.054 5.054 0 012.049-.636l.051-.004c.87-.07 1.73.087 2.48.474.101.053.2.11.297.17.05-.569.172-1.134.36-1.644.19-.52.439-.957.733-1.264a1.67 1.67 0 01.589-.41c.257-.1.53-.118.796-.042.401.114.745.368 1.016.737.248.337.434.769.561 1.287.23.934.27 2.163.115 3.645l.053.04.026.019c.757.576 1.284 1.397 1.563 2.35.435 1.487.216 3.155-.534 4.088l-.018.021.002.003c.417.762.67 1.567.724 2.4l.002.03c.064 1.065-.2 2.137-.814 3.19l-.007.01.01.024c.472 1.157.62 2.322.438 3.486l-.006.039a.651.651 0 01-.747.536.648.648 0 01-.54-.742c.167-1.033.01-2.069-.48-3.123a.643.643 0 01.04-.617l.004-.006c.604-.924.854-1.83.8-2.72-.046-.779-.325-1.544-.8-2.273a.644.644 0 01.18-.886l.009-.006c.243-.159.467-.565.58-1.12a4.229 4.229 0 00-.095-1.974c-.205-.7-.58-1.284-1.105-1.683-.595-.454-1.383-.673-2.38-.61a.653.653 0 01-.632-.371c-.314-.665-.772-1.141-1.343-1.436a3.288 3.288 0 00-1.772-.332c-1.245.099-2.343.801-2.67 1.686a.652.652 0 01-.61.425c-1.067.002-1.893.252-2.497.703-.522.39-.878.935-1.066 1.588a4.07 4.07 0 00-.068 1.886c.112.558.331 1.02.582 1.269l.008.007c.212.207.257.53.109.785-.36.622-.629 1.549-.673 2.44-.05 1.018.186 1.902.719 2.536l.016.019a.643.643 0 01.095.69c-.576 1.236-.753 2.252-.562 3.052a.652.652 0 01-1.269.298c-.243-1.018-.078-2.184.473-3.498l.014-.035-.008-.012a4.339 4.339 0 01-.598-1.309l-.005-.019a5.764 5.764 0 01-.177-1.785c.044-.91.278-1.842.622-2.59l.012-.026-.002-.002c-.293-.418-.51-.953-.63-1.545l-.005-.024a5.352 5.352 0 01.093-2.49c.262-.915.777-1.701 1.536-2.269.06-.045.123-.09.186-.132-.159-1.493-.119-2.73.112-3.67.127-.518.314-.95.562-1.287.27-.368.614-.622 1.015-.737.266-.076.54-.059.797.042zm4.116 9.09c.936 0 1.8.313 2.446.855.63.527 1.005 1.235 1.005 1.94 0 .888-.406 1.58-1.133 2.022-.62.375-1.451.557-2.403.557-1.009 0-1.871-.259-2.493-.734-.617-.47-.963-1.13-.963-1.845 0-.707.398-1.417 1.056-1.946.668-.537 1.55-.849 2.485-.849zm0 .896a3.07 3.07 0 00-1.916.65c-.461.37-.722.835-.722 1.25 0 .428.21.829.61 1.134.455.347 1.124.548 1.943.548.799 0 1.473-.147 1.932-.426.463-.28.7-.686.7-1.257 0-.423-.246-.89-.683-1.256-.484-.405-1.14-.643-1.864-.643zm.662 1.21l.004.004c.12.151.095.37-.056.49l-.292.23v.446a.375.375 0 01-.376.373.375.375 0 01-.376-.373v-.46l-.271-.218a.347.347 0 01-.052-.49.353.353 0 01.494-.051l.215.172.22-.174a.353.353 0 01.49.051zm-5.04-1.919c.478 0 .867.39.867.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zm8.706 0c.48 0 .868.39.868.871a.87.87 0 01-.868.871.87.87 0 01-.867-.87.87.87 0 01.867-.872zM7.44 2.3l-.003.002a.659.659 0 00-.285.238l-.005.006c-.138.189-.258.467-.348.832-.17.692-.216 1.631-.124 2.782.43-.128.899-.208 1.404-.237l.01-.001.019-.034c.046-.082.095-.161.148-.239.123-.771.022-1.692-.253-2.444-.134-.364-.297-.65-.453-.813a.628.628 0 00-.107-.09L7.44 2.3zm9.174.04l-.002.001a.628.628 0 00-.107.09c-.156.163-.32.45-.453.814-.29.794-.387 1.776-.23 2.572l.058.097.008.014h.03a5.184 5.184 0 011.466.212c.086-1.124.038-2.043-.128-2.722-.09-.365-.21-.643-.349-.832l-.004-.006a.659.659 0 00-.285-.239h-.004z" />
        </svg>
      );
    case 'lmstudio':
      // Official LM Studio logo (layered stacked bars)
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg">
          <path d="M2.84 2a1.273 1.273 0 100 2.547h14.107a1.273 1.273 0 100-2.547H2.84zM7.935 5.33a1.273 1.273 0 000 2.548H22.04a1.274 1.274 0 000-2.547H7.935zM3.624 9.935c0-.704.57-1.274 1.274-1.274h14.106a1.274 1.274 0 010 2.547H4.898c-.703 0-1.274-.57-1.274-1.273zM1.273 12.188a1.273 1.273 0 100 2.547H15.38a1.274 1.274 0 000-2.547H1.273zM3.624 16.792c0-.704.57-1.274 1.274-1.274h14.106a1.273 1.273 0 110 2.547H4.898c-.703 0-1.274-.57-1.274-1.273zM13.029 18.849a1.273 1.273 0 100 2.547h9.698a1.273 1.273 0 100-2.547h-9.698z" fillOpacity="0.3" />
          <path d="M2.84 2a1.273 1.273 0 100 2.547h10.287a1.274 1.274 0 000-2.547H2.84zM7.935 5.33a1.273 1.273 0 000 2.548H18.22a1.274 1.274 0 000-2.547H7.935zM3.624 9.935c0-.704.57-1.274 1.274-1.274h10.286a1.273 1.273 0 010 2.547H4.898c-.703 0-1.274-.57-1.274-1.273zM1.273 12.188a1.273 1.273 0 100 2.547H11.56a1.274 1.274 0 000-2.547H1.273zM3.624 16.792c0-.704.57-1.274 1.274-1.274h10.286a1.273 1.273 0 110 2.547H4.898c-.703 0-1.274-.57-1.274-1.273zM13.029 18.849a1.273 1.273 0 100 2.547h5.78a1.273 1.273 0 100-2.547h-5.78z" />
        </svg>
      );
    default:
      return <Brain size={size} />;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  LLM TAB
// ══════════════════════════════════════════════════════════════════════════════

const LLM_PROVIDER_META: { id: LLMProviderId; label: string; color: string; description: string; requiresKey: boolean }[] = [
  { id: 'openai',    label: 'OpenAI',     color: 'text-green-400',  description: 'GPT-4o, GPT-4, GPT-3.5 Turbo',          requiresKey: true },
  { id: 'anthropic', label: 'Anthropic',  color: 'text-purple-400', description: 'Claude Sonnet, Claude Opus, Claude Haiku', requiresKey: true },
  { id: 'google',    label: 'Google AI',  color: 'text-blue-400',   description: 'Gemini 2.0 Flash, Gemini Pro',            requiresKey: true },
  { id: 'xai',       label: 'xAI',        color: 'text-orange-400', description: 'Grok-2, Grok-3',                          requiresKey: true },
  { id: 'ollama',    label: 'Ollama',     color: 'text-amber-400',  description: 'Local models — Llama, Mistral, Phi, etc.', requiresKey: false },
  { id: 'lmstudio',  label: 'LM Studio', color: 'text-cyan-400',   description: 'Local model server',                      requiresKey: false },
];

const LLM_KEY_SENTINEL = '••••••••';

interface LLMProviderForm {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeout: string;
}

const emptyLLMForm = (): LLMProviderForm => ({
  apiKey: '',
  model: '',
  baseUrl: '',
  timeout: '',
});

function LLMTab() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<LLMConfigResponse | null>(null);

  // Global settings
  const [defaultProvider, setDefaultProvider] = useState<string>('openai');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [maxIterations, setMaxIterations] = useState<number>(30);

  // Per-provider forms
  const [providerForms, setProviderForms] = useState<Record<LLMProviderId, LLMProviderForm>>({
    openai: emptyLLMForm(),
    anthropic: emptyLLMForm(),
    google: emptyLLMForm(),
    xai: emptyLLMForm(),
    ollama: emptyLLMForm(),
    lmstudio: emptyLLMForm(),
  });

  // UI state
  const [expandedProvider, setExpandedProvider] = useState<LLMProviderId | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string; latency?: number }>>({});
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingProvider, setSavingProvider] = useState<string | null>(null);

  // Load config on mount
  const loadConfig = useCallback(async () => {
    try {
      const data = await getLLMConfig();
      setConfig(data);
      setDefaultProvider(data.defaultProvider);
      setDefaultModel(data.defaultModel || '');
      setMaxIterations(data.maxToolIterations);

      // Populate forms
      const newForms: Record<string, LLMProviderForm> = {};
      for (const meta of LLM_PROVIDER_META) {
        const p = data.providers[meta.id];
        newForms[meta.id] = {
          apiKey: p?.hasApiKey ? LLM_KEY_SENTINEL : '',
          model: p?.model || '',
          baseUrl: p?.baseUrl || '',
          timeout: p?.timeout ? String(p.timeout) : '',
        };
      }
      setProviderForms(newForms as Record<LLMProviderId, LLMProviderForm>);
    } catch {
      toast('error', 'Failed to load LLM configuration');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const updateProviderForm = (id: LLMProviderId, field: keyof LLMProviderForm, value: string) => {
    setProviderForms(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  // Save global settings
  const handleSaveGlobal = async () => {
    setSavingGlobal(true);
    try {
      await saveLLMConfig({
        defaultProvider,
        defaultModel: defaultModel || null,
        maxToolIterations: maxIterations,
      });
      toast('success', 'Global LLM settings saved');
      await loadConfig();
    } catch (err) {
      toast('error', `Failed to save: ${err}`);
    } finally {
      setSavingGlobal(false);
    }
  };

  // Save a single provider
  const handleSaveProvider = async (id: LLMProviderId) => {
    setSavingProvider(id);
    try {
      const form = providerForms[id];
      const data: Record<string, { apiKey?: string; model?: string; baseUrl?: string; timeout?: number | null }> = {};
      data[id] = {
        model: form.model || undefined,
        baseUrl: form.baseUrl || undefined,
        timeout: form.timeout ? parseInt(form.timeout, 10) : null,
      };
      // Only send API key if user entered a new one (not sentinel)
      if (form.apiKey && form.apiKey !== LLM_KEY_SENTINEL) {
        data[id].apiKey = form.apiKey;
      }
      await saveLLMConfig({ providers: data });
      toast('success', `${LLM_PROVIDER_META.find(m => m.id === id)?.label} settings saved`);
      await loadConfig();
    } catch (err) {
      toast('error', `Failed to save: ${err}`);
    } finally {
      setSavingProvider(null);
    }
  };

  // Test connection
  const handleTestConnection = async (id: LLMProviderId) => {
    setTesting(prev => ({ ...prev, [id]: true }));
    setTestResults(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      const form = providerForms[id];
      const res = await testLLMConnection({
        provider: id,
        apiKey: (form.apiKey && form.apiKey !== LLM_KEY_SENTINEL) ? form.apiKey : undefined,
        baseUrl: form.baseUrl || undefined,
        model: form.model || undefined,
      });
      setTestResults(prev => ({
        ...prev,
        [id]: { ok: res.connected, msg: res.message, latency: res.latencyMs },
      }));
    } catch (err) {
      setTestResults(prev => ({ ...prev, [id]: { ok: false, msg: String(err) } }));
    } finally {
      setTesting(prev => ({ ...prev, [id]: false }));
    }
  };

  const getProviderStatus = (id: LLMProviderId): { label: string; color: string; dot: string } => {
    const p = config?.providers[id];
    if (!p) return { label: 'Not Configured', color: 'text-gray-500', dot: 'bg-gray-500' };
    if (p.isLocal) return { label: 'Local', color: 'text-amber-400', dot: 'bg-amber-400' };
    if (p.apiKeySource === 'env') return { label: 'Env Var', color: 'text-emerald-400', dot: 'bg-emerald-400' };
    if (p.apiKeySource === 'config') return { label: 'Configured', color: 'text-emerald-400', dot: 'bg-emerald-400' };
    return { label: 'Not Configured', color: 'text-gray-500', dot: 'bg-gray-500' };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-gray-500 text-sm">
        <Loader2 size={16} className="animate-spin" />
        Loading LLM configuration...
      </div>
    );
  }

  return (
    <>
      {/* ── Global LLM Settings ──────────────────────────────────── */}
      <div className="bg-surface-1 rounded-xl border border-white/5 p-6 space-y-5">
        <div>
          <h2 className="text-base font-semibold text-gray-200 flex items-center gap-2.5">
            <Brain size={18} className="text-brand-400" />
            LLM Configuration
          </h2>
          <p className="text-sm text-gray-500 mt-1.5">
            Configure AI language model providers. Settings here override environment variables.
          </p>
        </div>

        {/* Default Provider */}
        <div>
          <label className="text-sm text-gray-400 block mb-1.5">Default Provider</label>
          <select
            value={defaultProvider}
            onChange={e => setDefaultProvider(e.target.value)}
            className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none focus:border-brand-500/50"
          >
            {LLM_PROVIDER_META.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        {/* Default Model Override */}
        <div>
          <label className="text-sm text-gray-400 block mb-1.5">Default Model Override</label>
          <input
            value={defaultModel}
            onChange={e => setDefaultModel(e.target.value)}
            placeholder="Leave blank to use each provider's default"
            className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50"
          />
          <p className="text-xs text-gray-600 mt-1">Applies to all providers unless overridden per-provider</p>
        </div>

        {/* Max Tool Iterations */}
        <div>
          <label className="text-sm text-gray-400 block mb-1.5">Max Tool Iterations</label>
          <input
            type="number"
            min={1}
            max={100}
            value={maxIterations}
            onChange={e => setMaxIterations(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))}
            className="w-36 bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none focus:border-brand-500/50"
          />
          <p className="text-xs text-gray-600 mt-1">Maximum LLM orchestration rounds per request (1–100)</p>
        </div>

        {/* Save Global */}
        <div className="pt-1 border-t border-white/5">
          <button
            onClick={handleSaveGlobal}
            disabled={savingGlobal}
            className="flex items-center gap-2 px-5 py-2.5 text-[15px] rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium disabled:opacity-40 transition-colors mt-3"
          >
            {savingGlobal ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            Save Global Settings
          </button>
        </div>
      </div>

      {/* ── Provider Cards ───────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-gray-300 flex items-center gap-2.5 px-1">
          <Zap size={16} className="text-brand-400" />
          Providers
        </h3>

        {LLM_PROVIDER_META.map(meta => {
          const isExpanded = expandedProvider === meta.id;
          const status = getProviderStatus(meta.id);
          const form = providerForms[meta.id];
          const providerConfig = config?.providers[meta.id];

          return (
            <div key={meta.id} className="bg-surface-1 rounded-xl border border-white/5 overflow-hidden transition-all">
              {/* ── Collapsed Header ── */}
              <button
                onClick={() => setExpandedProvider(isExpanded ? null : meta.id)}
                className="w-full flex items-center gap-3.5 px-6 py-4 hover:bg-surface-2/30 transition-colors text-left"
              >
                <span className={`flex-shrink-0 ${meta.color}`}>
                  <ProviderIcon provider={meta.id} size={26} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[15px] font-semibold text-gray-200">{meta.label}</span>
                    {defaultProvider === meta.id && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-brand-500/15 text-brand-400 border border-brand-500/20">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-gray-500 block mt-0.5">{meta.description}</span>
                </div>
                <div className="flex items-center gap-2.5 flex-shrink-0">
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${status.color}`}>
                    <span className={`w-2 h-2 rounded-full ${status.dot}`} />
                    {status.label}
                  </span>
                  {isExpanded
                    ? <ChevronDown size={18} className="text-gray-500" />
                    : <ChevronRight size={18} className="text-gray-500" />
                  }
                </div>
              </button>

              {/* ── Expanded Form ── */}
              {isExpanded && (
                <div className="px-6 pb-6 pt-3 border-t border-white/5 space-y-4">
                  {/* API Key — only for cloud providers */}
                  {meta.requiresKey && (
                    <div>
                      <label className="text-sm text-gray-400 block mb-1.5">
                        API Key
                        {providerConfig?.apiKeySource === 'config' && form.apiKey === LLM_KEY_SENTINEL && (
                          <span className="ml-2 text-gray-600 font-normal">(saved — click to change)</span>
                        )}
                      </label>
                      <div className="relative">
                        <input
                          type={showKeys[meta.id] ? 'text' : 'password'}
                          value={form.apiKey}
                          onChange={e => updateProviderForm(meta.id, 'apiKey', e.target.value)}
                          onFocus={() => {
                            if (form.apiKey === LLM_KEY_SENTINEL) {
                              updateProviderForm(meta.id, 'apiKey', '');
                            }
                          }}
                          onBlur={() => {
                            if (!form.apiKey && providerConfig?.hasApiKey) {
                              updateProviderForm(meta.id, 'apiKey', LLM_KEY_SENTINEL);
                            }
                          }}
                          placeholder="Enter API key"
                          className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 pr-10 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 font-mono"
                        />
                        <button
                          onClick={() => setShowKeys(prev => ({ ...prev, [meta.id]: !prev[meta.id] }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                        >
                          {showKeys[meta.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {providerConfig?.apiKeySource === 'env' && providerConfig.envVarName && (
                        <p className="text-xs text-amber-500/80 mt-1 flex items-center gap-1">
                          <Zap size={12} />
                          Set via environment variable <span className="font-mono">{providerConfig.envVarName}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Model */}
                  <div>
                    <label className="text-sm text-gray-400 block mb-1.5">Model</label>
                    <input
                      value={form.model}
                      onChange={e => updateProviderForm(meta.id, 'model', e.target.value)}
                      placeholder={providerConfig?.defaultModel || 'default'}
                      className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 font-mono"
                    />
                    {providerConfig?.defaultModel && (
                      <p className="text-xs text-gray-600 mt-1">Default: {providerConfig.defaultModel}</p>
                    )}
                  </div>

                  {/* Base URL */}
                  <div>
                    <label className="text-sm text-gray-400 block mb-1.5">
                      Base URL {!meta.requiresKey && <span className="text-gray-600 font-normal">(required for local providers)</span>}
                    </label>
                    <input
                      value={form.baseUrl}
                      onChange={e => updateProviderForm(meta.id, 'baseUrl', e.target.value)}
                      placeholder={providerConfig?.defaultBaseUrl || 'Default (cloud endpoint)'}
                      className="w-full bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 font-mono"
                    />
                    {providerConfig?.defaultBaseUrl && (
                      <p className="text-xs text-gray-600 mt-1">Default: {providerConfig.defaultBaseUrl}</p>
                    )}
                  </div>

                  {/* Timeout */}
                  <div>
                    <label className="text-sm text-gray-400 block mb-1.5">Timeout (ms)</label>
                    <input
                      value={form.timeout}
                      onChange={e => updateProviderForm(meta.id, 'timeout', e.target.value.replace(/\D/g, ''))}
                      placeholder={meta.requiresKey ? '60000' : '300000'}
                      className="w-52 bg-surface-2 border border-white/10 rounded-lg px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50 font-mono"
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      Leave blank for default ({meta.requiresKey ? '60s' : '5 min'})
                    </p>
                  </div>

                  {/* Test Connection Result */}
                  {testResults[meta.id] && (
                    <div className={`flex items-center gap-2 text-[15px] px-4 py-2.5 rounded-lg ${
                      testResults[meta.id].ok
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {testResults[meta.id].ok ? <CheckCircle size={16} /> : <XCircle size={16} />}
                      <span className="flex-1">{testResults[meta.id].msg}</span>
                      {testResults[meta.id].latency && (
                        <span className="text-sm opacity-70">{testResults[meta.id].latency}ms</span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2.5 pt-2 border-t border-white/5">
                    <button
                      onClick={() => handleTestConnection(meta.id)}
                      disabled={testing[meta.id]}
                      className="flex items-center gap-2 px-4 py-2 text-[15px] rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5 disabled:opacity-40 transition-colors"
                    >
                      {testing[meta.id] ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                      Test Connection
                    </button>
                    <button
                      onClick={() => handleSaveProvider(meta.id)}
                      disabled={savingProvider === meta.id}
                      className="flex items-center gap-2 px-5 py-2 text-[15px] rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium disabled:opacity-40 transition-colors"
                    >
                      {savingProvider === meta.id ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                      Save {meta.label}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
