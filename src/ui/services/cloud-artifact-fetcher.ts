import type { CloudConfigStore, CloudProviderId, CloudProviderConfig } from '../store/cloud-config-store.js';
import type { TestResultsStore } from '../store/test-results-store.js';
import type { CloudArtifacts, CloudSession } from '../types.js';

const FETCH_TIMEOUT = 15_000;

/**
 * Fetches test artifacts (video recordings, logs, screenshots, session URLs)
 * from cloud providers after a test run completes.
 *
 * Supports BrowserStack, LambdaTest, and SauceLabs.
 */
export class CloudArtifactFetcher {
  constructor(
    private cloudConfigStore: CloudConfigStore,
    private resultsStore: TestResultsStore,
  ) {}

  /**
   * Fetch artifacts for a completed cloud run and persist them.
   * Returns the artifacts or null on failure.
   */
  async fetchArtifacts(
    runId: string,
    provider: CloudProviderId,
    buildName: string,
  ): Promise<CloudArtifacts | null> {
    const config = this.cloudConfigStore.getProvider(provider);
    if (!config) {
      console.error(`[qabot] CloudArtifactFetcher: provider '${provider}' not configured`);
      return null;
    }

    try {
      let artifacts: CloudArtifacts | null = null;

      switch (provider) {
        case 'browserstack':
          artifacts = await this.fetchBrowserStackArtifacts(config, buildName);
          break;
        case 'lambdatest':
          artifacts = await this.fetchLambdaTestArtifacts(config, buildName);
          break;
        case 'saucelabs':
          artifacts = await this.fetchSauceLabsArtifacts(config, buildName);
          break;
      }

      if (artifacts) {
        this.resultsStore.updateRunArtifacts(runId, artifacts);
        console.log(`[qabot] Cloud artifacts fetched for run ${runId} (${provider}, ${artifacts.sessions?.length || 0} sessions)`);
      }

      return artifacts;
    } catch (err) {
      console.error(`[qabot] CloudArtifactFetcher error for ${provider}:`, err);
      return null;
    }
  }

  // ── BrowserStack ──────────────────────────────────────────────────────────

  private async fetchBrowserStackArtifacts(
    config: CloudProviderConfig,
    buildName: string,
  ): Promise<CloudArtifacts | null> {
    const auth = this.cloudConfigStore.getBasicAuthHeader(config);

    // Step 1: Find the build by name
    const buildsData = await this.apiGet(
      'https://api.browserstack.com/automate/builds.json?limit=10',
      auth,
    );

    if (!Array.isArray(buildsData)) return null;

    const build = buildsData.find((b: any) => {
      const name = b.automation_build?.name || b.name;
      return name === buildName;
    });

    if (!build) {
      console.log(`[qabot] BrowserStack build '${buildName}' not found`);
      return null;
    }

    const buildObj = build.automation_build || build;
    const buildId = buildObj.hashed_id || buildObj.id;
    const buildUrl = `https://automate.browserstack.com/builds/${buildId}`;

    // Step 2: Fetch sessions for this build
    const sessionsData = await this.apiGet(
      `https://api.browserstack.com/automate/builds/${buildId}/sessions.json`,
      auth,
    );

    const sessions: CloudSession[] = [];
    if (Array.isArray(sessionsData)) {
      const seen = new Set<string>();
      for (const s of sessionsData) {
        const session = s.automation_session || s;
        const sessionId = session.hashed_id || session.id || '';
        if (seen.has(sessionId)) continue;
        seen.add(sessionId);
        sessions.push({
          sessionId,
          sessionUrl: session.browser_url || session.public_url || '',
          videoUrl: session.video_url || undefined,
          logsUrl: session.logs || undefined,
          screenshots: [],
          browser: session.browser || undefined,
          os: session.os || undefined,
          osVersion: session.os_version || undefined,
          status: session.status || undefined,
          duration: session.duration || undefined,
        });
      }
    }

    return {
      provider: 'browserstack',
      buildId,
      buildUrl,
      sessions,
    };
  }

  // ── LambdaTest ────────────────────────────────────────────────────────────

  private async fetchLambdaTestArtifacts(
    config: CloudProviderConfig,
    buildName: string,
  ): Promise<CloudArtifacts | null> {
    const auth = this.cloudConfigStore.getBasicAuthHeader(config);

    // Step 1: Find build by name
    const buildsData = await this.apiGet(
      `https://api.lambdatest.com/automation/api/v1/builds?limit=10`,
      auth,
    );

    const builds = buildsData?.data || (Array.isArray(buildsData) ? buildsData : []);
    const build = builds.find((b: any) => b.name === buildName);

    if (!build) {
      console.log(`[qabot] LambdaTest build '${buildName}' not found`);
      return null;
    }

    const buildId = String(build.build_id || build.id);
    const buildUrl = `https://automation.lambdatest.com/test?build=${buildId}`;

    // Step 2: Fetch sessions (LambdaTest uses /sessions?build_id= not /builds/{id}/sessions)
    const sessionsData = await this.apiGet(
      `https://api.lambdatest.com/automation/api/v1/sessions?build_id=${buildId}&limit=50`,
      auth,
    );

    const sessionsArray = sessionsData?.data || (Array.isArray(sessionsData) ? sessionsData : []);
    const sessions: CloudSession[] = [];
    const seen = new Set<string>();

    for (const s of sessionsArray) {
      const sessionId = String(s.test_id || s.session_id || s.id || '');
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      sessions.push({
        sessionId,
        sessionUrl: `https://automation.lambdatest.com/test?build=${buildId}&testID=${sessionId}`,
        videoUrl: s.video_url || s.video || undefined,
        logsUrl: s.console_logs_url || s.logs || s.log_url || undefined,
        screenshots: s.screenshot_url ? [s.screenshot_url] : [],
        browser: s.browser || undefined,
        os: s.os || undefined,
        osVersion: s.os_version || s.version || undefined,
        status: s.status_ind || s.status || undefined,
        duration: s.duration || undefined,
      });
    }

    return {
      provider: 'lambdatest',
      buildId,
      buildUrl,
      sessions,
    };
  }

  // ── Sauce Labs ────────────────────────────────────────────────────────────

  private async fetchSauceLabsArtifacts(
    config: CloudProviderConfig,
    buildName: string,
  ): Promise<CloudArtifacts | null> {
    const auth = this.cloudConfigStore.getBasicAuthHeader(config);
    const region = config.region || 'us-west-1';
    const baseUrl = `https://api.${region}.saucelabs.com`;
    const appUrl = region.startsWith('eu') ? 'https://app.eu-central-1.saucelabs.com' : 'https://app.saucelabs.com';

    // Fetch jobs and filter by build name
    const jobsData = await this.apiGet(
      `${baseUrl}/rest/v1/${encodeURIComponent(config.username)}/jobs?limit=30`,
      auth,
    );

    if (!Array.isArray(jobsData)) return null;

    const matchingJobs = jobsData.filter((j: any) => j.build === buildName);
    if (matchingJobs.length === 0) {
      console.log(`[qabot] SauceLabs build '${buildName}' not found`);
      return null;
    }

    const sessions: CloudSession[] = [];
    const seen = new Set<string>();
    for (const j of matchingJobs) {
      const jobId = j.id || '';
      if (seen.has(jobId)) continue;
      seen.add(jobId);
      const sessionUrl = `${appUrl}/tests/${jobId}`;
      sessions.push({
        sessionId: jobId,
        sessionUrl,
        // SauceLabs API asset URLs require auth headers — link to dashboard instead
        videoUrl: sessionUrl,
        logsUrl: sessionUrl,
        screenshots: [],
        browser: j.browser || undefined,
        os: j.os || undefined,
        osVersion: j.os_version || undefined,
        status: j.passed ? 'passed' : j.error ? 'error' : 'failed',
        duration: j.end_time && j.start_time
          ? Math.round((new Date(j.end_time).getTime() - new Date(j.start_time).getTime()) / 1000)
          : undefined,
      });
    }

    // SauceLabs uses job-level IDs; builds page is under /dashboard/builds/vdc
    const buildId = matchingJobs[0]?.id || buildName;
    const buildUrl = `${appUrl}/dashboard/builds/vdc`;

    return {
      provider: 'saucelabs',
      buildId,
      buildUrl,
      sessions,
    };
  }

  // ── Cloud Build Completion ─────────────────────────────────────────────────

  /**
   * Mark a cloud build as complete on the provider's side.
   * Called after test process exits to prevent builds staying in "running" state.
   * Fire-and-forget — logs errors but doesn't throw.
   */
  async markBuildComplete(
    provider: CloudProviderId,
    buildName: string,
    exitCode: number,
  ): Promise<void> {
    const config = this.cloudConfigStore.getProvider(provider);
    if (!config) return;

    try {
      switch (provider) {
        case 'browserstack':
          await this.markBrowserStackComplete(config, buildName, exitCode);
          break;
        case 'lambdatest':
          await this.markLambdaTestComplete(config, buildName, exitCode);
          break;
        case 'saucelabs':
          await this.markSauceLabsComplete(config, buildName, exitCode);
          break;
      }
      console.log(`[qabot] Cloud build marked complete (${provider}, ${buildName})`);
    } catch (err) {
      console.error(`[qabot] Failed to mark cloud build complete (${provider}):`, err);
    }
  }

  private async markBrowserStackComplete(
    config: CloudProviderConfig,
    buildName: string,
    exitCode: number,
  ): Promise<void> {
    const auth = this.cloudConfigStore.getBasicAuthHeader(config);
    const status = exitCode === 0 ? 'passed' : 'failed';

    // Find the build
    const buildsData = await this.apiGet(
      'https://api.browserstack.com/automate/builds.json?limit=10',
      auth,
    );
    if (!Array.isArray(buildsData)) return;

    const build = buildsData.find((b: any) => {
      const name = b.automation_build?.name || b.name;
      return name === buildName;
    });
    if (!build) return;

    const buildObj = build.automation_build || build;
    const buildId = buildObj.hashed_id || buildObj.id;

    // Update each session's status
    const sessionsData = await this.apiGet(
      `https://api.browserstack.com/automate/builds/${buildId}/sessions.json`,
      auth,
    );
    if (Array.isArray(sessionsData)) {
      for (const s of sessionsData) {
        const session = s.automation_session || s;
        const sessionId = session.hashed_id || session.id;
        if (sessionId && session.status === 'running') {
          await this.apiPut(
            `https://api.browserstack.com/automate/sessions/${sessionId}.json`,
            auth,
            { status },
          );
        }
      }
    }
  }

  private async markLambdaTestComplete(
    config: CloudProviderConfig,
    buildName: string,
    exitCode: number,
  ): Promise<void> {
    const auth = this.cloudConfigStore.getBasicAuthHeader(config);
    const statusInd = exitCode === 0 ? 'passed' : 'failed';

    // Find build
    const buildsData = await this.apiGet(
      'https://api.lambdatest.com/automation/api/v1/builds?limit=10',
      auth,
    );
    const builds = buildsData?.data || (Array.isArray(buildsData) ? buildsData : []);
    const build = builds.find((b: any) => b.name === buildName);
    if (!build) return;

    const buildId = String(build.build_id || build.id);

    // Fetch sessions and update running ones (LambdaTest uses /sessions?build_id=)
    const sessionsData = await this.apiGet(
      `https://api.lambdatest.com/automation/api/v1/sessions?build_id=${buildId}&limit=50`,
      auth,
    );
    const sessionsArray = sessionsData?.data || (Array.isArray(sessionsData) ? sessionsData : []);
    for (const s of sessionsArray) {
      const sessionId = s.test_id || s.session_id || s.id;
      if (sessionId && (s.status_ind === 'running' || s.status === 'running')) {
        await this.apiPut(
          `https://api.lambdatest.com/automation/api/v1/sessions/${sessionId}`,
          auth,
          { status_ind: statusInd },
          'PATCH',
        );
      }
    }
  }

  private async markSauceLabsComplete(
    config: CloudProviderConfig,
    buildName: string,
    exitCode: number,
  ): Promise<void> {
    const auth = this.cloudConfigStore.getBasicAuthHeader(config);
    const region = config.region || 'us-west-1';
    const baseUrl = `https://api.${region}.saucelabs.com`;

    // Fetch jobs for this build
    const jobsData = await this.apiGet(
      `${baseUrl}/rest/v1/${encodeURIComponent(config.username)}/jobs?limit=30`,
      auth,
    );
    if (!Array.isArray(jobsData)) return;

    const matchingJobs = jobsData.filter((j: any) => j.build === buildName);
    for (const j of matchingJobs) {
      if (j.id && j.status === 'in progress') {
        await this.apiPut(
          `${baseUrl}/rest/v1/${encodeURIComponent(config.username)}/jobs/${j.id}`,
          auth,
          { passed: exitCode === 0 },
        );
      }
    }
  }

  // ── HTTP Helpers ──────────────────────────────────────────────────────────

  private async apiGet(url: string, authHeader: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[qabot] Cloud API ${response.status}: ${url}`);
        return null;
      }

      return await response.json();
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.error(`[qabot] Cloud API timeout: ${url}`);
      } else {
        console.error(`[qabot] Cloud API error: ${url}`, err.message);
      }
      return null;
    }
  }

  private async apiPut(url: string, authHeader: string, body: object, method: 'PUT' | 'PATCH' = 'PUT'): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        console.error(`[qabot] Cloud API ${method} ${response.status}: ${url}`);
        return null;
      }

      return await response.json().catch(() => ({}));
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        console.error(`[qabot] Cloud API ${method} timeout: ${url}`);
      } else {
        console.error(`[qabot] Cloud API ${method} error: ${url}`, err.message);
      }
      return null;
    }
  }
}
