import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getQabotDir } from '../../utils/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type CloudProviderId = 'browserstack' | 'lambdatest' | 'saucelabs';

export interface CloudProviderConfig {
  id: CloudProviderId;
  enabled: boolean;
  username: string;
  accessKey: string;
  hubUrl?: string;                      // auto-computed or custom override
  region?: string;                      // saucelabs: us-west-1 | eu-central-1
  tunnelEnabled?: boolean;
  tunnelName?: string;
  defaultBuildName?: string;            // pattern: 'qabot-{date}-{framework}'
  customEnvVars?: Record<string, string>;
}

export interface ScheduleConfig {
  id: string;
  name: string;
  command: string;
  cloudProvider?: string;
  cron: string;
  enabled: boolean;
  lastRunId?: string;
  lastRunTime?: string;
  nextRunTime?: string;
}

export interface PatchedFileRecord {
  patchedAt: string;
  provider: string;
  framework: string;
  hash: string;
}

export interface CloudConfig {
  providers: CloudProviderConfig[];
  defaultProvider?: string;
  schedules: ScheduleConfig[];
  patchedFiles?: Record<string, PatchedFileRecord>;
}

// ── Hub URL Templates ────────────────────────────────────────────────────────

const HUB_URLS: Record<CloudProviderId, string> = {
  browserstack: 'https://{username}:{accessKey}@hub-cloud.browserstack.com/wd/hub',
  lambdatest:   'https://{username}:{accessKey}@hub.lambdatest.com/wd/hub',
  saucelabs:    'https://{username}:{accessKey}@ondemand.{region}.saucelabs.com:443/wd/hub',
};

// ── Test Connection URLs ────────────────────────────────────────────────────

const TEST_URLS: Record<CloudProviderId, string> = {
  browserstack: 'https://api.browserstack.com/automate/plan.json',
  lambdatest:   'https://api.lambdatest.com/automation/api/v1/builds?limit=1',
  saucelabs:    'https://api.{region}.saucelabs.com/rest/v1/{username}/activity',
};

// ── Simple obfuscation (not encryption — just prevents casual reading) ──────

function obfuscate(val: string): string {
  return Buffer.from(val).toString('base64');
}

function deobfuscate(val: string): string {
  try {
    return Buffer.from(val, 'base64').toString('utf-8');
  } catch {
    return val; // Already plain text (migration)
  }
}

/** Unique build name with second-level precision so each run gets its own cloud build. */
function defaultBuildName(): string {
  return `qabot-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}`;
}

// ── Store ────────────────────────────────────────────────────────────────────

export class CloudConfigStore {
  private data: CloudConfig = { providers: [], schedules: [] };
  private filePath: string;

  constructor(projectPath?: string) {
    const dir = getQabotDir(projectPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'cloud-config.json');
    this.load();
  }

  // ── Provider Management ──────────────────────────────────────────────────

  getProviders(): CloudProviderConfig[] {
    return this.data.providers.map(p => ({
      ...p,
      accessKey: deobfuscate(p.accessKey),
    }));
  }

  getProvider(id: CloudProviderId): CloudProviderConfig | undefined {
    const p = this.data.providers.find(p => p.id === id);
    if (!p) return undefined;
    return { ...p, accessKey: deobfuscate(p.accessKey) };
  }

  getEnabledProviders(): CloudProviderConfig[] {
    return this.getProviders().filter(p => p.enabled);
  }

  saveProvider(config: CloudProviderConfig): void {
    const stored = {
      ...config,
      accessKey: obfuscate(config.accessKey),
    };
    const idx = this.data.providers.findIndex(p => p.id === config.id);
    if (idx >= 0) {
      this.data.providers[idx] = stored;
    } else {
      this.data.providers.push(stored);
    }
    this.save();
  }

  removeProvider(id: CloudProviderId): boolean {
    const len = this.data.providers.length;
    this.data.providers = this.data.providers.filter(p => p.id !== id);
    if (this.data.providers.length !== len) {
      this.save();
      return true;
    }
    return false;
  }

  getDefaultProvider(): string | undefined {
    return this.data.defaultProvider;
  }

  setDefaultProvider(id: string | undefined): void {
    this.data.defaultProvider = id;
    this.save();
  }

  // ── Hub URL Computation ──────────────────────────────────────────────────

  computeHubUrl(config: CloudProviderConfig): string {
    if (config.hubUrl) return config.hubUrl;

    const template = HUB_URLS[config.id];
    if (!template) return '';

    return template
      .replace('{username}', encodeURIComponent(config.username))
      .replace('{accessKey}', encodeURIComponent(config.accessKey))
      .replace('{region}', config.region || 'us-west-1');
  }

  // ── Environment Variables for a Provider ─────────────────────────────────

  getCloudEnvVars(providerId: CloudProviderId, buildName?: string): Record<string, string> {
    const config = this.getProvider(providerId);
    if (!config) return {};

    const env: Record<string, string> = {};
    const build = buildName || config.defaultBuildName || defaultBuildName();

    const hubUrl = this.computeHubUrl(config);

    switch (config.id) {
      case 'browserstack':
        env.BROWSERSTACK_USERNAME = config.username;
        env.BROWSERSTACK_ACCESS_KEY = config.accessKey;
        env.BROWSERSTACK_BUILD_NAME = build;
        // CDP endpoint for Playwright connect()
        env.BROWSERSTACK_CDP_URL = 'wss://cdp.browserstack.com/playwright';
        break;
      case 'lambdatest':
        env.LT_USERNAME = config.username;
        env.LT_ACCESS_KEY = config.accessKey;
        env.LT_BUILD_NAME = build;
        // CDP endpoint for Playwright connect()
        env.LT_CDP_URL = 'wss://cdp.lambdatest.com/playwright';
        break;
      case 'saucelabs':
        env.SAUCE_USERNAME = config.username;
        env.SAUCE_ACCESS_KEY = config.accessKey;
        env.SAUCE_BUILD_NAME = build;
        env.SAUCE_REGION = config.region || 'us-west-1';
        break;
    }

    // Universal env vars for test code that checks generically
    env.CLOUD_PROVIDER = config.id;
    env.CLOUD_HUB_URL = hubUrl;
    env.REMOTE_WEBDRIVER_URL = hubUrl;

    // Playwright built-in: SELENIUM_REMOTE_URL makes chromium.launch()
    // automatically redirect to the remote Selenium Grid endpoint.
    // This works transparently — no test code changes needed.
    env.SELENIUM_REMOTE_URL = hubUrl;

    // Custom env vars from user config
    if (config.customEnvVars) {
      Object.assign(env, config.customEnvVars);
    }

    return env;
  }

  // ── Config File Generation (for SDK wrappers) ─────────────────────────────

  /**
   * Generate a cloud provider config file in the project root.
   * This enables SDK wrappers (browserstack-node-sdk, saucectl, etc.)
   * to work transparently without test code changes.
   * Returns the generated file path, or null if provider not configured.
   */
  generateConfigFile(providerId: CloudProviderId, projectPath: string, buildName?: string): string | null {
    const config = this.getProvider(providerId);
    if (!config) return null;

    const build = buildName || config.defaultBuildName || defaultBuildName();

    switch (config.id) {
      case 'browserstack': {
        const filePath = join(projectPath, 'browserstack.yml');
        const content = [
          `userName: "${config.username}"`,
          `accessKey: "${config.accessKey}"`,
          `framework: "playwright"`,
          `buildName: "${build}"`,
          `projectName: "qabot-cloud-run"`,
          `platforms:`,
          `  - os: Windows`,
          `    osVersion: 11`,
          `    browserName: chrome`,
          `    browserVersion: latest`,
          `browserstackLocal: ${config.tunnelEnabled ? 'true' : 'false'}`,
          `debug: true`,
          `networkLogs: true`,
          `consoleLogs: info`,
        ].join('\n');
        writeFileSync(filePath, content, 'utf-8');
        return filePath;
      }

      case 'lambdatest': {
        const filePath = join(projectPath, 'lambdatest-config.json');
        const content = JSON.stringify({
          lambdatest_auth: {
            username: config.username,
            access_key: config.accessKey,
          },
          browsers: [
            { browser: 'Chrome', platform: 'Windows 11', versions: ['latest'] },
          ],
          run_settings: {
            build_name: build,
            parallels: 1,
            npm_dependencies: {},
          },
          tunnel_settings: {
            tunnel: config.tunnelEnabled || false,
            tunnel_name: config.tunnelName || undefined,
          },
        }, null, 2);
        writeFileSync(filePath, content, 'utf-8');
        return filePath;
      }

      case 'saucelabs': {
        const region = config.region || 'us-west-1';
        const sauceDir = join(projectPath, '.sauce');
        if (!existsSync(sauceDir)) mkdirSync(sauceDir, { recursive: true });
        const filePath = join(sauceDir, 'config.yml');
        const content = [
          `apiVersion: v1alpha`,
          `kind: playwright`,
          `sauce:`,
          `  region: ${region}`,
          `  concurrency: 1`,
          `  metadata:`,
          `    build: "${build}"`,
          `defaults:`,
          `  timeout: 30m`,
          `playwright:`,
          `  version: "latest"`,
          `suites:`,
          `  - name: "default"`,
          `    platformName: "Windows 11"`,
          `    testMatch:`,
          `      - "**/*.spec.ts"`,
          `      - "**/*.test.ts"`,
        ].join('\n');
        writeFileSync(filePath, content, 'utf-8');
        return filePath;
      }

      default:
        return null;
    }
  }

  // ── Test Connection ──────────────────────────────────────────────────────

  getTestConnectionUrl(config: CloudProviderConfig): string {
    const template = TEST_URLS[config.id];
    if (!template) return '';
    return template
      .replace('{username}', encodeURIComponent(config.username))
      .replace('{region}', config.region || 'us-west-1');
  }

  getBasicAuthHeader(config: CloudProviderConfig): string {
    return 'Basic ' + Buffer.from(`${config.username}:${config.accessKey}`).toString('base64');
  }

  // ── Schedule Management ──────────────────────────────────────────────────

  getSchedules(): ScheduleConfig[] {
    return this.data.schedules;
  }

  getSchedule(id: string): ScheduleConfig | undefined {
    return this.data.schedules.find(s => s.id === id);
  }

  saveSchedule(schedule: ScheduleConfig): void {
    const idx = this.data.schedules.findIndex(s => s.id === schedule.id);
    if (idx >= 0) {
      this.data.schedules[idx] = schedule;
    } else {
      this.data.schedules.push(schedule);
    }
    this.save();
  }

  removeSchedule(id: string): boolean {
    const len = this.data.schedules.length;
    this.data.schedules = this.data.schedules.filter(s => s.id !== id);
    if (this.data.schedules.length !== len) {
      this.save();
      return true;
    }
    return false;
  }

  // ── Patch Tracking ─────────────────────────────────────────────────────────

  markFilePatched(relativePath: string, provider: string, framework: string, hash: string): void {
    if (!this.data.patchedFiles) this.data.patchedFiles = {};
    this.data.patchedFiles[relativePath] = {
      patchedAt: new Date().toISOString(),
      provider,
      framework,
      hash,
    };
    this.save();
  }

  isFilePatched(relativePath: string): boolean {
    return !!this.data.patchedFiles?.[relativePath];
  }

  getPatchedFileRecord(relativePath: string): PatchedFileRecord | undefined {
    return this.data.patchedFiles?.[relativePath];
  }

  clearPatchRecord(relativePath: string): boolean {
    if (this.data.patchedFiles?.[relativePath]) {
      delete this.data.patchedFiles[relativePath];
      this.save();
      return true;
    }
    return false;
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          providers: Array.isArray(parsed.providers) ? parsed.providers : [],
          defaultProvider: parsed.defaultProvider,
          schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
          patchedFiles: parsed.patchedFiles || undefined,
        };
      }
    } catch {
      this.data = { providers: [], schedules: [] };
    }
  }

  private save(): void {
    try {
      const dir = getQabotDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {
      // Silently ignore write failures
    }
  }
}
