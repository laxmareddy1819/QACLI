import type { Express } from 'express';
import { CloudConfigStore, type CloudProviderId, type CloudProviderConfig, type ScheduleConfig } from '../store/cloud-config-store.js';
import { generateId } from '../../utils/index.js';
import { analyzeCloudReadiness, applyPatch, computeFileHash, type CloudPatch } from '../services/cloud-analyzer.js';
import type { ProjectScanner } from '../scanner/project-scanner.js';
import { getNextRunTime, type SchedulerService } from '../services/scheduler-service.js';
import { audit } from './audit-helper.js';

export function mountCloudRoutes(
  app: Express,
  cloudConfigStore: CloudConfigStore,
  scanner?: ProjectScanner,
  projectPath?: string,
  scheduler?: SchedulerService,
): void {

  // ── Provider CRUD ──────────────────────────────────────────────────────────

  // GET /api/cloud/providers — List all configured providers
  app.get('/api/cloud/providers', (_req, res) => {
    const providers = cloudConfigStore.getProviders().map(p => ({
      ...p,
      accessKey: MASKED_SENTINEL,
      hubUrl: maskHubUrl(cloudConfigStore.computeHubUrl(p)),
    }));
    const defaultProvider = cloudConfigStore.getDefaultProvider();
    res.json({ providers, defaultProvider });
  });

  // GET /api/cloud/providers/:id — Get a single provider config
  app.get('/api/cloud/providers/:id', (req, res) => {
    const provider = cloudConfigStore.getProvider(req.params.id as CloudProviderId);
    if (!provider) {
      res.status(404).json({ error: `Provider '${req.params.id}' not configured` });
      return;
    }
    res.json({
      ...provider,
      accessKey: MASKED_SENTINEL,
      hubUrl: maskHubUrl(cloudConfigStore.computeHubUrl(provider)),
    });
  });

  // POST /api/cloud/providers — Add or update a provider
  app.post('/api/cloud/providers', (req, res) => {
    try {
      const { id, enabled, username, accessKey, hubUrl, region, tunnelEnabled, tunnelName, defaultBuildName, customEnvVars } = req.body;

      if (!id || !['browserstack', 'lambdatest', 'saucelabs'].includes(id)) {
        res.status(400).json({ error: 'Invalid provider id. Must be browserstack, lambdatest, or saucelabs.' });
        return;
      }
      if (!username) {
        res.status(400).json({ error: 'Username is required.' });
        return;
      }

      // Resolve access key: if sentinel, preserve the stored key
      let resolvedKey: string;
      if (accessKey === MASKED_SENTINEL) {
        const existing = cloudConfigStore.getProvider(id as CloudProviderId);
        if (!existing) {
          res.status(400).json({ error: 'Access key is required for new provider configuration.' });
          return;
        }
        resolvedKey = existing.accessKey;
      } else if (!accessKey) {
        res.status(400).json({ error: 'Access key is required.' });
        return;
      } else {
        resolvedKey = accessKey.trim();
      }

      const config: CloudProviderConfig = {
        id: id as CloudProviderId,
        enabled: enabled !== false,
        username: username.trim(),
        accessKey: resolvedKey,
        hubUrl: hubUrl?.trim() || undefined,
        region: region?.trim() || undefined,
        tunnelEnabled: tunnelEnabled || false,
        tunnelName: tunnelName?.trim() || undefined,
        defaultBuildName: defaultBuildName?.trim() || undefined,
        customEnvVars: customEnvVars || undefined,
      };

      cloudConfigStore.saveProvider(config);
      audit(req, 'settings.cloud_save', { resourceType: 'cloud-provider', resourceId: id });

      res.json({
        message: `Provider '${id}' saved successfully`,
        provider: {
          ...config,
          accessKey: MASKED_SENTINEL,
          hubUrl: maskHubUrl(cloudConfigStore.computeHubUrl(config)),
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // DELETE /api/cloud/providers/:id — Remove a provider
  app.delete('/api/cloud/providers/:id', (req, res) => {
    const removed = cloudConfigStore.removeProvider(req.params.id as CloudProviderId);
    if (removed) {
      audit(req, 'settings.cloud_delete', { resourceType: 'cloud-provider', resourceId: req.params.id });
      res.json({ message: `Provider '${req.params.id}' removed` });
    } else {
      res.status(404).json({ error: `Provider '${req.params.id}' not found` });
    }
  });

  // PUT /api/cloud/default-provider — Set default provider
  app.put('/api/cloud/default-provider', (req, res) => {
    const { provider } = req.body;
    cloudConfigStore.setDefaultProvider(provider || undefined);
    res.json({ defaultProvider: provider || null });
  });

  // ── Test Connection ────────────────────────────────────────────────────────

  // POST /api/cloud/test-connection — Verify credentials
  app.post('/api/cloud/test-connection', async (req, res) => {
    try {
      const { id, username, accessKey, region } = req.body;

      if (!id || !username) {
        res.status(400).json({ error: 'Provider id and username are required.' });
        return;
      }

      // Resolve access key: if sentinel, use the stored key
      let resolvedKey: string;
      if (accessKey === MASKED_SENTINEL) {
        const existing = cloudConfigStore.getProvider(id as CloudProviderId);
        if (!existing) {
          res.status(400).json({ error: 'No saved credentials found. Please enter the access key.' });
          return;
        }
        resolvedKey = existing.accessKey;
      } else if (!accessKey) {
        res.status(400).json({ error: 'Access key is required.' });
        return;
      } else {
        resolvedKey = accessKey.trim();
      }

      const config: CloudProviderConfig = {
        id: id as CloudProviderId,
        enabled: true,
        username: username.trim(),
        accessKey: resolvedKey,
        region: region?.trim() || undefined,
      };

      const testUrl = cloudConfigStore.getTestConnectionUrl(config);
      const authHeader = cloudConfigStore.getBasicAuthHeader(config);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(testUrl, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          res.json({
            connected: true,
            message: `Successfully connected to ${id}`,
            details: summarizeConnectionResponse(id as CloudProviderId, data),
          });
        } else {
          const errText = await response.text().catch(() => '');
          res.json({
            connected: false,
            message: `Connection failed: HTTP ${response.status}`,
            details: errText.slice(0, 200),
          });
        }
      } catch (fetchError: any) {
        clearTimeout(timeout);
        res.json({
          connected: false,
          message: fetchError.name === 'AbortError'
            ? 'Connection timed out (10s)'
            : `Connection failed: ${fetchError.message}`,
        });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── Cloud Builds (fetch from provider API) ─────────────────────────────────

  // GET /api/cloud/providers/:id/builds — List recent builds from cloud
  app.get('/api/cloud/providers/:id/builds', async (req, res) => {
    try {
      const config = cloudConfigStore.getProvider(req.params.id as CloudProviderId);
      if (!config) {
        res.status(404).json({ error: `Provider '${req.params.id}' not configured` });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 10;
      const authHeader = cloudConfigStore.getBasicAuthHeader(config);
      const builds = await fetchCloudBuilds(config, authHeader, limit);

      res.json({ builds });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ── Schedule CRUD ──────────────────────────────────────────────────────────

  // GET /api/cloud/schedules — List all schedules
  app.get('/api/cloud/schedules', (_req, res) => {
    res.json({ schedules: cloudConfigStore.getSchedules() });
  });

  // POST /api/cloud/schedules — Create or update a schedule
  app.post('/api/cloud/schedules', (req, res) => {
    try {
      const { id, name, command, cloudProvider, cron, enabled } = req.body;

      if (!name || !command || !cron) {
        res.status(400).json({ error: 'name, command, and cron are required.' });
        return;
      }

      const isEnabled = enabled !== false;
      const schedule: ScheduleConfig = {
        id: id || generateId('sched'),
        name: name.trim(),
        command: command.trim(),
        cloudProvider: cloudProvider || undefined,
        cron: cron.trim(),
        enabled: isEnabled,
        nextRunTime: isEnabled ? getNextRunTime(cron.trim())?.toISOString() : undefined,
      };

      cloudConfigStore.saveSchedule(schedule);
      audit(req, 'settings.schedule_create', { resourceType: 'schedule', resourceId: schedule.id, details: { name: schedule.name } });
      res.json({ message: 'Schedule saved', schedule });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/cloud/schedules/:id — Update a schedule
  app.put('/api/cloud/schedules/:id', (req, res) => {
    const existing = cloudConfigStore.getSchedule(req.params.id!);
    if (!existing) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    const updated: ScheduleConfig = {
      ...existing,
      ...req.body,
      id: existing.id, // prevent ID change
    };
    cloudConfigStore.saveSchedule(updated);
    audit(req, 'settings.schedule_update', { resourceType: 'schedule', resourceId: existing.id });
    res.json({ message: 'Schedule updated', schedule: updated });
  });

  // DELETE /api/cloud/schedules/:id — Remove a schedule
  app.delete('/api/cloud/schedules/:id', (req, res) => {
    const removed = cloudConfigStore.removeSchedule(req.params.id!);
    if (removed) {
      audit(req, 'settings.schedule_delete', { resourceType: 'schedule', resourceId: req.params.id! });
      res.json({ message: 'Schedule removed' });
    } else {
      res.status(404).json({ error: 'Schedule not found' });
    }
  });

  // POST /api/cloud/schedules/:id/run-now — Immediately trigger a scheduled run
  app.post('/api/cloud/schedules/:id/run-now', async (req, res) => {
    if (!scheduler) {
      res.status(503).json({ error: 'Scheduler service not available' });
      return;
    }

    try {
      const result = await scheduler.runNow(req.params.id!);
      if (result.error) {
        res.status(400).json({ error: result.error });
      } else {
        res.json({ message: 'Schedule triggered', runId: result.runId });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/cloud/schedules/next-runs — All schedules with computed next run times
  app.get('/api/cloud/schedules/next-runs', (_req, res) => {
    if (!scheduler) {
      // Fallback: return schedules without computed next run times
      res.json({ schedules: cloudConfigStore.getSchedules() });
      return;
    }

    res.json({ schedules: scheduler.getSchedulesWithNextRun() });
  });

  // ── Env vars preview ───────────────────────────────────────────────────────

  // GET /api/cloud/providers/:id/env-vars — Preview what env vars will be injected
  app.get('/api/cloud/providers/:id/env-vars', (req, res) => {
    const config = cloudConfigStore.getProvider(req.params.id as CloudProviderId);
    if (!config) {
      res.status(404).json({ error: `Provider '${req.params.id}' not configured` });
      return;
    }

    const envVars = cloudConfigStore.getCloudEnvVars(config.id, req.query.buildName as string);
    // Mask sensitive values (keys, secrets, and URLs containing credentials)
    const masked = Object.fromEntries(
      Object.entries(envVars).map(([k, v]) => {
        const kl = k.toLowerCase();
        if (kl.includes('key') || kl.includes('secret')) return [k, MASKED_SENTINEL];
        if (kl.includes('hub_url') || kl.includes('remote_url') || kl.includes('webdriver_url')) return [k, maskHubUrl(v)];
        return [k, v];
      }),
    );
    res.json({ envVars: masked });
  });

  // GET /api/cloud/providers/:id/hub-url — Get the real (unmasked) hub URL for clipboard copy
  app.get('/api/cloud/providers/:id/hub-url', (req, res) => {
    const config = cloudConfigStore.getProvider(req.params.id as CloudProviderId);
    if (!config) {
      res.status(404).json({ error: `Provider '${req.params.id}' not configured` });
      return;
    }
    res.json({ hubUrl: cloudConfigStore.computeHubUrl(config) });
  });

  // ── Cloud Readiness Analyzer ───────────────────────────────────────────────

  // POST /api/cloud/analyze — Analyze project for cloud readiness
  app.post('/api/cloud/analyze', async (req, res) => {
    try {
      const { provider } = req.body;

      if (!provider || !['browserstack', 'lambdatest', 'saucelabs'].includes(provider)) {
        res.status(400).json({ error: 'Valid provider id is required (browserstack, lambdatest, saucelabs).' });
        return;
      }

      if (!projectPath) {
        res.status(500).json({ error: 'Project path not available' });
        return;
      }

      // Get detected framework from scanner
      let detectedFramework: string | null = null;
      if (scanner) {
        try {
          const info = await scanner.getInfo();
          detectedFramework = info.framework;
        } catch {
          // Scanner not available — analyzer will try all patterns
        }
      }

      const analysis = analyzeCloudReadiness(projectPath, detectedFramework, provider as CloudProviderId);

      // Check if we've already patched this file
      if (analysis.hookFile && cloudConfigStore.isFilePatched(analysis.hookFile)) {
        analysis.alreadyPatched = true;
      }

      res.json(analysis);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/cloud/patch — Apply cloud readiness patches
  app.post('/api/cloud/patch', (req, res) => {
    try {
      const { patches } = req.body as { patches: CloudPatch[] };

      if (!patches || !Array.isArray(patches) || patches.length === 0) {
        res.status(400).json({ error: 'patches array is required and must not be empty.' });
        return;
      }

      const applied: string[] = [];
      const errors: string[] = [];

      for (const patch of patches) {
        try {
          // Write the patched content
          applyPatch(patch);

          // Record in store that we patched this file
          const hash = computeFileHash(patch.preview);
          cloudConfigStore.markFilePatched(
            patch.file,
            'all', // applies to all cloud providers
            patch.type,
            hash,
          );

          applied.push(patch.file);
        } catch (err) {
          errors.push(`${patch.file}: ${String(err)}`);
        }
      }

      if (applied.length > 0) {
        res.json({
          message: `Successfully patched ${applied.length} file(s) for cloud readiness`,
          applied,
          errors: errors.length > 0 ? errors : undefined,
        });
      } else {
        res.status(500).json({
          error: 'Failed to apply patches',
          details: errors,
        });
      }
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fixed sentinel — never derived from the real key (no partial chars leaked) */
const MASKED_SENTINEL = '••••••••';

function maskHubUrl(url: string): string {
  if (!url) return '';
  // Replace password portion in URLs like https://user:SECRET@host/path
  return url.replace(
    /(:\/\/[^:]+:)([^@]+)(@)/,
    `$1${MASKED_SENTINEL}$3`,
  );
}

function summarizeConnectionResponse(provider: CloudProviderId, data: any): string {
  switch (provider) {
    case 'browserstack':
      if (data.automate_plan) return `Plan: ${data.automate_plan}, Parallel: ${data.parallel_sessions_max_allowed || 'N/A'}`;
      if (data.plan) return `Plan: ${data.plan}`;
      return 'Connected';
    case 'lambdatest':
      if (data.Meta?.total) return `${data.Meta.total} total builds`;
      return 'Connected';
    case 'saucelabs':
      if (data.subaccounts) return `${Object.keys(data.subaccounts).length} sub-accounts`;
      return 'Connected';
    default:
      return 'Connected';
  }
}

async function fetchCloudBuilds(
  config: CloudProviderConfig,
  authHeader: string,
  limit: number,
): Promise<Array<{ id: string; name: string; status: string; duration?: number; timestamp?: string }>> {
  let url: string;

  switch (config.id) {
    case 'browserstack':
      url = `https://api.browserstack.com/automate/builds.json?limit=${limit}`;
      break;
    case 'lambdatest':
      url = `https://api.lambdatest.com/automation/api/v1/builds?limit=${limit}`;
      break;
    case 'saucelabs': {
      const region = config.region || 'us-west-1';
      url = `https://api.${region}.saucelabs.com/rest/v1/${encodeURIComponent(config.username)}/jobs?limit=${limit}`;
      break;
    }
    default:
      return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = await response.json();
    return normalizeBuilds(config.id, data);
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

function normalizeBuilds(
  provider: CloudProviderId,
  data: any,
): Array<{ id: string; name: string; status: string; duration?: number; timestamp?: string }> {
  try {
    switch (provider) {
      case 'browserstack':
        if (Array.isArray(data)) {
          return data.map((b: any) => {
            const build = b.automation_build || b;
            return {
              id: build.hashed_id || build.id || '',
              name: build.name || 'Unnamed',
              status: build.status || 'unknown',
              duration: build.duration,
              timestamp: build.updated_at || build.created_at,
            };
          });
        }
        return [];
      case 'lambdatest':
        if (data?.data && Array.isArray(data.data)) {
          return data.data.map((b: any) => ({
            id: String(b.build_id || b.id || ''),
            name: b.name || 'Unnamed',
            status: b.status_ind || b.status || 'unknown',
            duration: b.duration,
            timestamp: b.create_timestamp || b.end_timestamp,
          }));
        }
        return [];
      case 'saucelabs':
        if (Array.isArray(data)) {
          return data.map((j: any) => ({
            id: j.id || '',
            name: j.name || 'Unnamed',
            status: j.passed ? 'passed' : j.error ? 'error' : 'failed',
            duration: j.end_time && j.start_time
              ? Math.round((new Date(j.end_time).getTime() - new Date(j.start_time).getTime()) / 1000)
              : undefined,
            timestamp: j.end_time || j.start_time,
          }));
        }
        return [];
      default:
        return [];
    }
  } catch {
    return [];
  }
}
