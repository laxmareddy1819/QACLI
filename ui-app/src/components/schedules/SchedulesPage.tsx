import { useState, useEffect, useCallback } from 'react';
import { Calendar, Clock, Play, Trash2, Plus, Cloud, Monitor, Edit2, X, Loader2, CheckCircle, Pause } from 'lucide-react';
import { useToast } from '../shared/Toast';
import {
  getCloudSchedules,
  saveCloudSchedule,
  updateCloudSchedule,
  deleteCloudSchedule,
  runScheduleNow,
  getNextRuns,
  getCloudProviders,
  type CloudSchedule,
  type CloudProviderInfo,
} from '../../api/client';

const CRON_PRESETS = [
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every 30 minutes', cron: '*/30 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 2 hours', cron: '0 */2 * * *' },
  { label: 'Daily at 8 AM', cron: '0 8 * * *' },
  { label: 'Daily at 10 PM', cron: '0 22 * * *' },
  { label: 'Weekdays at 9 AM', cron: '0 9 * * 1-5' },
  { label: 'Weekly Sunday midnight', cron: '0 0 * * 0' },
  { label: 'Custom', cron: '' },
];

const PROVIDER_LABELS: Record<string, string> = {
  browserstack: 'BrowserStack',
  lambdatest: 'LambdaTest',
  saucelabs: 'Sauce Labs',
};

interface ScheduleForm {
  name: string;
  command: string;
  cron: string;
  cloudProvider: string;
  enabled: boolean;
}

const emptyForm = (): ScheduleForm => ({
  name: '',
  command: '',
  cron: '0 8 * * *',
  cloudProvider: '',
  enabled: true,
});

/** Approximate human-readable cron description */
function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [min, hour, dom, mon, dow] = parts;

  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute';
  if (min?.startsWith('*/') && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${min.slice(2)} min`;
  if (/^\d+$/.test(min!) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Hourly at :${min!.padStart(2, '0')}`;
  if (/^\d+$/.test(min!) && /^\d+$/.test(hour!) && dom === '*' && mon === '*' && dow === '*') return `Daily ${hour!.padStart(2, '0')}:${min!.padStart(2, '0')}`;
  if (/^\d+$/.test(min!) && /^\d+$/.test(hour!) && dom === '*' && mon === '*' && dow === '1-5') return `Weekdays ${hour!.padStart(2, '0')}:${min!.padStart(2, '0')}`;
  if (/^\d+$/.test(min!) && /^\d+$/.test(hour!) && dom === '*' && mon === '*' && dow === '0') return `Sundays ${hour!.padStart(2, '0')}:${min!.padStart(2, '0')}`;
  if (/^\d+$/.test(min!) && hour?.startsWith('*/') && dom === '*' && mon === '*' && dow === '*') return `Every ${hour.slice(2)}h at :${min!.padStart(2, '0')}`;

  return cron;
}

export function SchedulesPage() {
  const { toast } = useToast();
  const [schedules, setSchedules] = useState<Array<CloudSchedule & { nextRunTime?: string }>>([]);
  const [providers, setProviders] = useState<CloudProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduleForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    try {
      const [schedData, provData] = await Promise.all([
        getNextRuns().catch(() => getCloudSchedules()),
        getCloudProviders().catch(() => ({ providers: [] })),
      ]);
      setSchedules(schedData.schedules || []);
      setProviders(provData.providers?.filter((p: any) => p.enabled) || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleNew = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowDialog(true);
  };

  const handleEdit = (schedule: CloudSchedule) => {
    setEditingId(schedule.id);
    setForm({
      name: schedule.name,
      command: schedule.command,
      cron: schedule.cron,
      cloudProvider: schedule.cloudProvider || '',
      enabled: schedule.enabled,
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast('error', 'Name is required'); return; }
    if (!form.command.trim()) { toast('error', 'Command is required'); return; }
    if (!form.cron.trim()) { toast('error', 'Cron expression is required'); return; }

    setSaving(true);
    try {
      if (editingId) {
        await updateCloudSchedule(editingId, {
          name: form.name.trim(),
          command: form.command.trim(),
          cron: form.cron.trim(),
          cloudProvider: form.cloudProvider || undefined,
          enabled: form.enabled,
        });
        toast('success', 'Schedule updated');
      } else {
        await saveCloudSchedule({
          id: '',
          name: form.name.trim(),
          command: form.command.trim(),
          cron: form.cron.trim(),
          cloudProvider: form.cloudProvider || undefined,
          enabled: form.enabled,
        });
        toast('success', 'Schedule created');
      }
      setShowDialog(false);
      await loadData();
    } catch (err) {
      toast('error', `Save failed: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteCloudSchedule(id);
      toast('info', `Schedule '${name}' deleted`);
      await loadData();
    } catch (err) {
      toast('error', `Delete failed: ${err}`);
    }
  };

  const handleToggle = async (schedule: CloudSchedule) => {
    try {
      await updateCloudSchedule(schedule.id, { enabled: !schedule.enabled });
      await loadData();
    } catch (err) {
      toast('error', `Toggle failed: ${err}`);
    }
  };

  const handleRunNow = async (id: string, name: string) => {
    setRunningNow(prev => ({ ...prev, [id]: true }));
    try {
      const result = await runScheduleNow(id);
      if (result.runId) {
        toast('success', `'${name}' triggered (run: ${result.runId.slice(0, 8)}...)`);
      } else {
        toast('info', result.message);
      }
      await loadData();
    } catch (err) {
      toast('error', `Run failed: ${err}`);
    } finally {
      setRunningNow(prev => ({ ...prev, [id]: false }));
    }
  };

  const selectedPreset = CRON_PRESETS.find(p => p.cron === form.cron);
  const isCustomCron = !selectedPreset || selectedPreset.label === 'Custom';

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="px-6 py-4 border-b border-white/5 bg-surface-1 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar size={22} className="text-brand-400" />
            <h1 className="text-2xl font-bold text-gray-100">Schedules</h1>
            <span className="text-sm text-gray-500">{schedules.length} schedule{schedules.length !== 1 ? 's' : ''}</span>
          </div>
          <button
            onClick={handleNew}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium"
          >
            <Plus size={14} />
            New Schedule
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          Schedule automated test runs with cron expressions. Runs execute on the server and results appear in the Results page.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-gray-500" />
          </div>
        ) : schedules.length === 0 ? (
          <div className="text-center py-16">
            <Calendar size={40} className="text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 text-[15px]">No schedules configured yet.</p>
            <p className="text-gray-600 text-sm mt-1">Create a schedule to automatically run tests on a recurring basis.</p>
            <button
              onClick={handleNew}
              className="mt-4 flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-[15px] font-medium mx-auto"
            >
              <Plus size={14} />
              Create Schedule
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map(schedule => (
              <div
                key={schedule.id}
                className={`bg-surface-1 rounded-xl border border-white/5 p-4 transition-opacity ${
                  !schedule.enabled ? 'opacity-50' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-gray-200 truncate">{schedule.name}</p>
                      {schedule.enabled ? (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
                          <CheckCircle size={8} /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/15 text-gray-500">
                          <Pause size={8} /> Paused
                        </span>
                      )}
                      {schedule.cloudProvider ? (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/15 text-blue-400">
                          <Cloud size={8} /> {PROVIDER_LABELS[schedule.cloudProvider] || schedule.cloudProvider}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/15 text-gray-400">
                          <Monitor size={8} /> Local
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-400 font-mono truncate mb-1">{schedule.command}</p>

                    <div className="flex items-center gap-4 text-[11px] text-gray-500">
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        {cronToHuman(schedule.cron)}
                        <span className="text-gray-600">({schedule.cron})</span>
                      </span>
                      {schedule.lastRunTime && (
                        <span>Last: {new Date(schedule.lastRunTime).toLocaleString()}</span>
                      )}
                      {schedule.nextRunTime && (
                        <span className="text-brand-400">Next: {new Date(schedule.nextRunTime).toLocaleString()}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => handleRunNow(schedule.id, schedule.name)}
                      disabled={runningNow[schedule.id]}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand-600/20 hover:bg-brand-600/30 text-brand-400 text-xs border border-brand-500/20 disabled:opacity-50"
                      title="Run Now"
                    >
                      {runningNow[schedule.id] ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                      Run
                    </button>
                    <button
                      onClick={() => handleToggle(schedule)}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-400 text-xs border border-white/5"
                      title={schedule.enabled ? 'Pause' : 'Enable'}
                    >
                      {schedule.enabled ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <button
                      onClick={() => handleEdit(schedule)}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-surface-3 text-gray-400 text-xs border border-white/5"
                      title="Edit"
                    >
                      <Edit2 size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(schedule.id, schedule.name)}
                      className="px-2.5 py-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs border border-red-500/20"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedule Dialog */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
          <div className="bg-surface-1 rounded-xl border border-white/10 w-full max-w-lg mx-4">
            {/* Dialog header */}
            <div className="flex items-center justify-between p-4 border-b border-white/5">
              <h2 className="text-base font-semibold text-gray-200">
                {editingId ? 'Edit Schedule' : 'New Schedule'}
              </h2>
              <button onClick={() => setShowDialog(false)} className="text-gray-500 hover:text-gray-300">
                <X size={16} />
              </button>
            </div>

            {/* Dialog body */}
            <div className="p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="text-sm font-medium text-gray-400 block mb-1">Schedule Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Nightly Regression"
                  className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-200 outline-none placeholder-gray-600 focus:border-brand-500/50"
                />
              </div>

              {/* Command */}
              <div>
                <label className="text-sm font-medium text-gray-400 block mb-1">Run Command</label>
                <input
                  value={form.command}
                  onChange={e => setForm(prev => ({ ...prev, command: e.target.value }))}
                  placeholder="e.g., npx playwright test --headed"
                  className="w-full bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-200 font-mono outline-none placeholder-gray-600 focus:border-brand-500/50"
                />
              </div>

              {/* Cron */}
              <div>
                <label className="text-sm font-medium text-gray-400 block mb-1">Schedule (Cron)</label>
                <div className="flex gap-2">
                  <select
                    value={isCustomCron ? '' : form.cron}
                    onChange={e => {
                      const val = e.target.value;
                      if (val) setForm(prev => ({ ...prev, cron: val }));
                    }}
                    className="flex-1 bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-200 outline-none focus:border-brand-500/50"
                  >
                    {CRON_PRESETS.map(p => (
                      <option key={p.label} value={p.cron}>{p.label}</option>
                    ))}
                  </select>
                </div>
                <input
                  value={form.cron}
                  onChange={e => setForm(prev => ({ ...prev, cron: e.target.value }))}
                  placeholder="*/5 * * * * (min hour dom mon dow)"
                  className="w-full mt-2 bg-surface-2 border border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-gray-200 font-mono outline-none placeholder-gray-600 focus:border-brand-500/50"
                />
                {form.cron && (
                  <p className="text-[10px] text-gray-500 mt-1">{cronToHuman(form.cron)}</p>
                )}
              </div>

              {/* Cloud provider */}
              <div>
                <label className="text-sm font-medium text-gray-400 block mb-1">Run On</label>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setForm(prev => ({ ...prev, cloudProvider: '' }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                      !form.cloudProvider
                        ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                        : 'border-white/5 bg-surface-2 text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    <Monitor size={12} /> Local
                  </button>
                  {providers.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setForm(prev => ({ ...prev, cloudProvider: p.id }))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                        form.cloudProvider === p.id
                          ? 'border-brand-500/50 bg-brand-500/10 text-brand-400'
                          : 'border-white/5 bg-surface-2 text-gray-400 hover:text-gray-300'
                      }`}
                    >
                      <Cloud size={12} /> {PROVIDER_LABELS[p.id] || p.id}
                    </button>
                  ))}
                </div>
              </div>

              {/* Enabled */}
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={e => setForm(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="rounded border-gray-600 bg-surface-2 text-brand-500 focus:ring-brand-500"
                />
                Enable schedule immediately
              </label>
            </div>

            {/* Dialog footer */}
            <div className="flex justify-end gap-2 p-4 border-t border-white/5">
              <button
                onClick={() => setShowDialog(false)}
                className="px-5 py-2.5 text-[15px] rounded-xl bg-surface-2 hover:bg-surface-3 text-gray-300 border border-white/5"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-5 py-2.5 text-[15px] rounded-xl bg-brand-600 hover:bg-brand-500 text-white font-medium disabled:opacity-50"
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {editingId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
