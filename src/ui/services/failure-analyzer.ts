import type { StoredTestCase, FailureGroup } from '../types.js';
import type { TestResultsStore } from '../store/test-results-store.js';

/**
 * Intelligent failure analysis service.
 * Groups failures by error signature, then applies deep heuristic analysis
 * to extract actionable root causes and specific fix suggestions.
 */
export class FailureAnalyzer {
  constructor(private resultsStore: TestResultsStore) {}

  /**
   * Analyze failures for a given run.
   * Groups by normalized error signature, then categorizes with context-aware heuristics.
   */
  async analyze(runId: string): Promise<FailureGroup[]> {
    const run = this.resultsStore.getRun(runId);
    if (!run) return [];

    const failures = run.tests.filter(t => t.status === 'failed' || t.status === 'error');
    if (failures.length === 0) return [];

    // Group by normalized error signature
    const groups = this.groupByErrorSignature(failures);

    // Categorize each group using deep heuristics
    const analyzed = groups.map(group => this.categorize(group));

    // Sort: most impactful (most affected tests) first
    analyzed.sort((a, b) => b.count - a.count);

    // Save analysis
    this.resultsStore.saveFailureAnalysis(runId, analyzed);

    return analyzed;
  }

  private groupByErrorSignature(
    failures: StoredTestCase[],
  ): Array<{ signature: string; tests: StoredTestCase[]; rawErrors: string[] }> {
    const groups = new Map<string, { tests: StoredTestCase[]; rawErrors: string[] }>();

    for (const test of failures) {
      const rawError = test.errorMessage || 'No error message available';
      const sig = this.normalizeError(rawError);
      const existing = groups.get(sig) || { tests: [], rawErrors: [] };
      existing.tests.push(test);
      existing.rawErrors.push(rawError);
      groups.set(sig, existing);
    }

    return Array.from(groups.entries()).map(([signature, { tests, rawErrors }]) => ({
      signature,
      tests,
      rawErrors,
    }));
  }

  private normalizeError(error: string): string {
    return error
      // Remove ANSI color codes
      // eslint-disable-next-line no-control-regex
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      // Remove stack trace lines
      .replace(/\n\s+at .*$/gm, '')
      // Remove absolute file paths but keep relative ones
      .replace(/[A-Z]:\\[\w\\/.]+\.(ts|js|py|java|cs)/g, '<file>')
      .replace(/\/(?:home|usr|var|tmp)[\w/.]+\.(ts|js|py|java|cs)/g, '<file>')
      // Remove line:col numbers in paths
      .replace(/:(\d+):(\d+)/g, ':<line>:<col>')
      // Remove timestamps
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, '<timestamp>')
      // Remove large numeric IDs (5+ digits)
      .replace(/\b\d{5,}\b/g, '<id>')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  }

  private categorize(
    group: { signature: string; tests: StoredTestCase[]; rawErrors: string[] },
  ): FailureGroup {
    const { signature, tests, rawErrors } = group;
    // Use the FIRST raw error for detailed analysis (most representative)
    const rawError = rawErrors[0] || signature;
    const errorLower = rawError.toLowerCase();

    // Try each pattern matcher in priority order — first match wins
    const result =
      this.matchStrictModeViolation(rawError, errorLower) ||
      this.matchLocatorNotFound(rawError, errorLower) ||
      this.matchTimeoutError(rawError, errorLower) ||
      this.matchNavigationError(rawError, errorLower) ||
      this.matchRetryExhausted(rawError, errorLower) ||
      this.matchAssertionError(rawError, errorLower) ||
      this.matchNetworkError(rawError, errorLower) ||
      this.matchAuthenticationError(rawError, errorLower) ||
      this.matchPermissionError(rawError, errorLower) ||
      this.matchBrowserCrash(rawError, errorLower) ||
      this.matchElementInteraction(rawError, errorLower) ||
      this.matchFrameDetached(rawError, errorLower) ||
      this.matchJavaScriptError(rawError, errorLower) ||
      this.matchApiError(rawError, errorLower) ||
      this.matchDatabaseError(rawError, errorLower) ||
      this.matchFileSystemError(rawError, errorLower) ||
      this.matchConfigurationError(rawError, errorLower) ||
      this.matchDependencyError(rawError, errorLower) ||
      this.matchGenericPatterns(rawError, errorLower) ||
      this.fallbackAnalysis(rawError, errorLower);

    return {
      errorSignature: signature,
      category: result.category,
      affectedTests: tests.map(t => t.name),
      rootCause: result.rootCause,
      suggestedFix: result.suggestedFix,
      count: tests.length,
    };
  }

  // ── Pattern Matchers ──────────────────────────────────────────────────────

  private matchStrictModeViolation(raw: string, lower: string): AnalysisResult | null {
    if (!lower.includes('strict mode violation')) return null;

    // Extract the selector and element count
    const selectorMatch = raw.match(/locator\(['"]?([^'")\]]+)['"]?\)/i) ||
      raw.match(/selector\s*['"]([^'"]+)['"]/i);
    const countMatch = raw.match(/resolved to (\d+) elements/i);
    const selector = selectorMatch?.[1] || 'the selector';
    const count = countMatch?.[1] || 'multiple';

    return {
      category: 'test-issue',
      rootCause: `Locator '${selector}' matches ${count} elements on the page. Playwright's strict mode requires exactly one matching element. The page likely has duplicate elements matching this selector (e.g., multiple input fields with the same name attribute).`,
      suggestedFix: `Make the selector more specific to match exactly one element:\n• Use a more specific CSS selector: e.g., 'input[name="q"][type="search"]' or '#searchInput'\n• Use Playwright's built-in locators: page.getByRole('searchbox') or page.getByPlaceholder('Search')\n• Narrow scope with .first(), .nth(0), or chain with parent: page.locator('.search-form').locator('${selector}')\n• Check if the page has a mobile/desktop duplicate of this element`,
    };
  }

  private matchLocatorNotFound(raw: string, lower: string): AnalysisResult | null {
    const patterns = [
      /no such element/i, /element not found/i, /unable to locate/i,
      /could not find/i, /element is not (?:visible|attached|present)/i,
      /locator resolved to (?:hidden|0|no) element/i,
      /waiting for (?:selector|locator)/i,
      /element not interactable/i,
    ];
    if (!patterns.some(p => p.test(lower))) return null;

    const selectorMatch = raw.match(/locator\(['"]?([^'")\]]+)['"]?\)/i) ||
      raw.match(/selector\s*['"]([^'"]+)['"]/i) ||
      raw.match(/waiting for\s+['"]([^'"]+)['"]/i);
    const selector = selectorMatch?.[1] || 'the target element';

    return {
      category: 'test-issue',
      rootCause: `Element '${selector}' could not be found on the page. This typically happens when the page structure has changed, the element hasn't loaded yet, or the selector is incorrect.`,
      suggestedFix: `• Verify the selector '${selector}' still matches an element in the current page\n• Add explicit waits: await page.waitForSelector('${selector}')\n• Use more resilient selectors: data-testid, aria roles, or text content\n• Check if the element is inside an iframe or shadow DOM\n• Ensure previous navigation/action completed before looking for this element`,
    };
  }

  private matchTimeoutError(raw: string, lower: string): AnalysisResult | null {
    const patterns = [
      /timeout\s*(?:of\s+)?\d+\s*ms\s+exceeded/i,
      /timed?\s*out/i,
      /exceeded\s+timeout/i,
      /navigation timeout/i,
      /waiting for.*timed?\s*out/i,
      /page\.goto.*timeout/i,
    ];
    if (!patterns.some(p => p.test(raw))) return null;

    // Extract timeout value if available
    const timeoutMatch = raw.match(/timeout\s*(?:of\s+)?(\d+)\s*ms/i);
    const timeoutMs = timeoutMatch?.[1];

    // Check what was timing out
    const isNavigation = /navigation|goto|page\.goto|page load/i.test(lower);
    const isWaitFor = /waitfor|waiting for|locator\.wait/i.test(lower);
    const isAction = /click|fill|type|press|select/i.test(lower);

    let rootCause: string;
    let suggestedFix: string;

    if (isNavigation) {
      rootCause = `Page navigation timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}. The page took too long to load, possibly due to slow server response, heavy JavaScript, or network issues.`;
      suggestedFix = `• Increase navigation timeout: page.goto(url, { timeout: 60000 })\n• Check if the application server is responding\n• Verify the URL is correct and accessible\n• Add waitUntil option: page.goto(url, { waitUntil: 'domcontentloaded' })`;
    } else if (isWaitFor) {
      rootCause = `Waiting for an element timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}. The element either never appeared, was removed from the DOM, or was hidden.`;
      suggestedFix = `• Increase element timeout: locator.waitFor({ timeout: 30000 })\n• Verify the element selector is correct for the current page state\n• Add state option: locator.waitFor({ state: 'visible' })\n• Check if the element appears after an async action completes`;
    } else if (isAction) {
      rootCause = `An action (click/type/fill) timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}. The target element may be covered by an overlay, disabled, or not yet actionable.`;
      suggestedFix = `• Wait for overlays/modals to dismiss: await page.locator('.overlay').waitFor({ state: 'hidden' })\n• Force the action if appropriate: await locator.click({ force: true })\n• Scroll the element into view first: await locator.scrollIntoViewIfNeeded()\n• Check for cookie banners or popups blocking the element`;
    } else {
      rootCause = `Operation timed out${timeoutMs ? ` after ${timeoutMs}ms` : ''}. The system was unable to complete the requested operation within the allowed time.`;
      suggestedFix = `• Increase the timeout value for the failing operation\n• Check application server response time\n• Verify network connectivity and stability\n• Review test preconditions to ensure the app is in the expected state`;
    }

    return { category: 'timeout', rootCause, suggestedFix };
  }

  private matchNavigationError(raw: string, lower: string): AnalysisResult | null {
    if (!/net::err_|page\.goto|navigation.*failed|page crashed|target (page|context|browser) (closed|crashed)/i.test(lower)) return null;

    const netErrMatch = raw.match(/net::(ERR_\w+)/i);
    const netErr = netErrMatch?.[1];

    if (netErr === 'ERR_NAME_NOT_RESOLVED') {
      return {
        category: 'environment',
        rootCause: 'DNS resolution failed — the hostname could not be resolved. The application URL may be incorrect or the DNS server is unreachable.',
        suggestedFix: `• Verify the application URL is correct\n• Check DNS settings and network connectivity\n• If using a local hostname, verify it's in /etc/hosts or DNS is configured\n• Try using the IP address directly`,
      };
    }

    if (netErr === 'ERR_CONNECTION_REFUSED') {
      return {
        category: 'environment',
        rootCause: 'Connection refused — the application server is not running or not listening on the expected port.',
        suggestedFix: `• Start the application server before running tests\n• Verify the port number in the test configuration\n• Check if another process is using the port\n• Ensure firewall rules allow the connection`,
      };
    }

    if (/target (page|context|browser) (closed|crashed)/i.test(lower)) {
      return {
        category: 'environment',
        rootCause: 'The browser page or context was closed or crashed during the test. This can happen due to out-of-memory conditions, unhandled page errors, or browser instability.',
        suggestedFix: `• Run tests with more memory: --max-old-space-size=4096\n• Check for memory leaks in the application under test\n• Use a fresh browser context per test\n• Check for unhandled JavaScript errors on the page`,
      };
    }

    return {
      category: 'environment',
      rootCause: `Navigation failed${netErr ? ` (${netErr})` : ''}. The browser could not reach or load the target page.`,
      suggestedFix: `• Verify the application URL and server status\n• Check network connectivity\n• Look for SSL/TLS certificate issues\n• Ensure the page doesn't redirect to an error page`,
    };
  }

  private matchRetryExhausted(raw: string, lower: string): AnalysisResult | null {
    if (!/failed after \d+ retr(y|ies)/i.test(lower) &&
        !/retry.*exhausted/i.test(lower) &&
        !/max.*retries.*exceeded/i.test(lower)) return null;

    const retriesMatch = raw.match(/(\d+)\s+retr(?:y|ies)/i);
    const retries = retriesMatch?.[1] || 'multiple';

    // Extract what action was being retried
    const actionMatch = raw.match(/(safeType|safeClick|safeFill|click|type|fill|scroll|navigate)\s/i);
    const action = actionMatch?.[1] || 'action';

    // Look for the underlying error after "retries:"
    const underlyingMatch = raw.match(/retr(?:y|ies):?\s*(.+)/i);
    const underlying = underlyingMatch?.[1]?.trim().slice(0, 150) || '';

    return {
      category: 'test-issue',
      rootCause: `The '${action}' operation failed after ${retries} retries. The underlying issue persisted across all attempts: ${underlying || 'see error details'}. This suggests a systematic problem rather than a transient failure.`,
      suggestedFix: `• Fix the underlying error first (see root cause above)\n• Check if the element selector is still valid\n• Verify the page is in the expected state before the action\n• Add explicit waits before retrying: await page.waitForLoadState('networkidle')\n• Consider increasing retry delay or using a different interaction strategy`,
    };
  }

  private matchAssertionError(raw: string, lower: string): AnalysisResult | null {
    const patterns = [
      /expect\(.*\)\.(to|not)/i, /assert/i, /should\s/i,
      /to (equal|be|match|contain|have|include)/i,
      /expected.*but (got|received|was)/i,
      /comparison failure/i,
    ];
    if (!patterns.some(p => p.test(raw))) return null;

    // Try to extract expected vs actual
    const expectMatch = raw.match(/expected\s+['"]*(.+?)['"]*\s+(?:to (?:equal|be|match|contain)\s+|but (?:got|received)\s+)['"]*(.+?)['"]*(?:\s|$)/i);
    const toBeMatch = raw.match(/expect\(.*\)\.to(?:Be|Equal|Match|Contain|Have)\((.+?)\)/i);

    let detail = '';
    if (expectMatch) {
      detail = ` Expected: "${expectMatch[1]?.trim()}", Got: "${expectMatch[2]?.trim()}"`;
    }

    return {
      category: 'bug',
      rootCause: `Assertion failed — the application produced a different result than expected.${detail} This indicates either a genuine application bug where behavior has changed, or test expectations that need updating.`,
      suggestedFix: `• Verify if this is a genuine application bug by manually checking the behavior\n• If the application behavior is correct, update the expected value in the test\n• Check if recent code changes affected this functionality\n• Review the test data — it may depend on specific state that has changed`,
    };
  }

  private matchNetworkError(raw: string, lower: string): AnalysisResult | null {
    const patterns = [
      /econnrefused/i, /enotfound/i, /econnreset/i, /econnaborted/i,
      /epipe/i, /ehostunreach/i, /enetunreach/i,
      /socket hang up/i, /fetch failed/i,
      /status code (?:4\d{2}|5\d{2})/i,
      /(?:api|server)\s+(?:error|unavailable|down)/i,
    ];
    if (!patterns.some(p => p.test(raw))) return null;

    // Extract status code if available
    const statusMatch = raw.match(/status\s*(?:code)?\s*(\d{3})/i);
    const statusCode = statusMatch?.[1];

    if (statusCode) {
      const code = parseInt(statusCode, 10);
      if (code >= 500) {
        return {
          category: 'environment',
          rootCause: `Server returned HTTP ${statusCode} error. The application backend encountered an internal error and could not process the request.`,
          suggestedFix: `• Check application server logs for the error details\n• Verify the backend service is running and healthy\n• Check database connectivity from the server\n• Review recent backend deployments for breaking changes`,
        };
      }
      if (code === 401 || code === 403) {
        return {
          category: 'environment',
          rootCause: `HTTP ${statusCode} — ${code === 401 ? 'Authentication required' : 'Access forbidden'}. The request was rejected due to missing or invalid credentials.`,
          suggestedFix: `• Check if test authentication tokens/cookies are valid and not expired\n• Verify the test user account exists and has proper permissions\n• Ensure the auth setup step ran successfully before this test\n• Check if API keys or secrets are properly configured in the test environment`,
        };
      }
      if (code === 404) {
        return {
          category: 'test-issue',
          rootCause: `HTTP 404 — the requested resource was not found. The API endpoint or page URL may have changed.`,
          suggestedFix: `• Verify the URL/endpoint path is correct\n• Check if the API version has changed\n• Ensure the test data (IDs, slugs) still exists in the test database\n• Review recent API changes for route modifications`,
        };
      }
    }

    return {
      category: 'environment',
      rootCause: 'Network connectivity error — the test could not connect to the application or an external service.',
      suggestedFix: `• Verify the application server is running and accessible\n• Check network connectivity between the test runner and the application\n• Review firewall rules and proxy settings\n• Ensure all required services (database, cache, message queue) are running`,
    };
  }

  private matchAuthenticationError(raw: string, lower: string): AnalysisResult | null {
    if (!/(?:auth|login|session|token).*(?:fail|error|invalid|expired|denied)/i.test(lower) &&
        !/(?:fail|error|invalid|expired|denied).*(?:auth|login|session|token)/i.test(lower) &&
        !/unauthorized|unauthenticated|401/i.test(lower)) return null;

    return {
      category: 'environment',
      rootCause: 'Authentication or session failure. The test user login failed, the session expired, or the authentication token is invalid.',
      suggestedFix: `• Check test user credentials are correct and the account exists\n• Verify the login page/API hasn't changed\n• Ensure previous test cleanup didn't invalidate the session\n• Check if 2FA or CAPTCHA is blocking the login\n• Verify auth token expiration settings in the test environment`,
    };
  }

  private matchPermissionError(raw: string, lower: string): AnalysisResult | null {
    if (!/permission denied|access denied|forbidden|not authorized|insufficient privilege/i.test(lower)) return null;

    return {
      category: 'environment',
      rootCause: 'Permission denied — the test user does not have sufficient privileges to perform the requested action.',
      suggestedFix: `• Check if the test user role has the required permissions\n• Verify role-based access control (RBAC) configuration\n• Ensure the test environment has the same permissions as expected\n• Check if admin setup steps need to run before this test`,
    };
  }

  private matchBrowserCrash(raw: string, lower: string): AnalysisResult | null {
    if (!/browser.*(?:crash|disconnect|closed unexpectedly)|process exited|out of memory|oom/i.test(lower) &&
        !/session.*(?:deleted|not created)|webdriver.*error/i.test(lower)) return null;

    return {
      category: 'environment',
      rootCause: 'Browser crashed or disconnected unexpectedly. This is typically caused by insufficient system resources, memory leaks, or browser compatibility issues.',
      suggestedFix: `• Increase available system memory\n• Close unnecessary browser tabs/windows in test setup\n• Use headless mode to reduce resource usage\n• Check for memory leaks in the application\n• Update browser and driver versions\n• Reduce test parallelism to lower resource pressure`,
    };
  }

  private matchElementInteraction(raw: string, lower: string): AnalysisResult | null {
    const patterns = [
      /element.*(click|type|fill).*intercepted/i,
      /another element.*receive.*click/i,
      /element.*covered/i,
      /element.*not.*clickable/i,
      /element.*obscured/i,
      /element.*disabled/i,
      /detached from dom/i,
    ];
    if (!patterns.some(p => p.test(raw))) return null;

    if (/intercepted|covered|obscured|another element/i.test(lower)) {
      return {
        category: 'test-issue',
        rootCause: 'Click was intercepted by another element. A modal, overlay, cookie banner, tooltip, or another element is covering the target element.',
        suggestedFix: `• Dismiss any overlays, modals, or cookie banners before clicking\n• Wait for animations to complete: await page.waitForTimeout(500)\n• Scroll the element into view: await locator.scrollIntoViewIfNeeded()\n• Use force click if appropriate: await locator.click({ force: true })\n• Check for sticky headers/footers that might overlap`,
      };
    }

    if (/detached from dom/i.test(lower)) {
      return {
        category: 'test-issue',
        rootCause: 'Element was detached from the DOM between finding it and interacting with it. This happens when the page re-renders or navigates during the test.',
        suggestedFix: `• Re-locate the element after any action that triggers a re-render\n• Use Playwright auto-waiting locators instead of element handles\n• Wait for the page to stabilize: await page.waitForLoadState('networkidle')\n• Avoid storing element references across navigation boundaries`,
      };
    }

    return {
      category: 'test-issue',
      rootCause: 'Element interaction failed — the element is not in an interactable state (disabled, hidden, or covered).',
      suggestedFix: `• Wait for the element to be enabled: await locator.waitFor({ state: 'visible' })\n• Check if the element is disabled and needs a precondition\n• Ensure the page is fully loaded before interacting\n• Verify no overlays or modals are blocking the element`,
    };
  }

  private matchFrameDetached(raw: string, lower: string): AnalysisResult | null {
    if (!/frame.*detached|frame.*navigated|execution context.*destroyed/i.test(lower)) return null;

    return {
      category: 'test-issue',
      rootCause: 'Frame was detached or the execution context was destroyed during the test. This happens when the page navigates, an iframe is removed, or the page reloads during an operation.',
      suggestedFix: `• Wait for navigation to complete before interacting with elements\n• Use page.waitForURL() after actions that trigger navigation\n• If working with iframes, re-locate the frame after navigation\n• Check for unexpected page redirects or reloads`,
    };
  }

  private matchJavaScriptError(raw: string, lower: string): AnalysisResult | null {
    if (!/(?:uncaught|unhandled).*(?:error|exception|rejection)/i.test(lower) &&
        !/reference error|type error|syntax error|range error/i.test(lower) &&
        !/javascript error|js error|page error/i.test(lower)) return null;

    // Extract the JS error type
    const errTypeMatch = raw.match(/(ReferenceError|TypeError|SyntaxError|RangeError|EvalError)/i);
    const errType = errTypeMatch?.[1] || 'JavaScript error';

    return {
      category: 'bug',
      rootCause: `${errType} detected on the page. The application has a JavaScript error that may be causing the test failure.`,
      suggestedFix: `• Check the browser console for the full error and stack trace\n• This is likely an application bug — report it to the development team\n• Verify the error occurs consistently (not just in tests)\n• Check if a recent deployment introduced this error\n• The test may need to handle the error gracefully or skip until the bug is fixed`,
    };
  }

  private matchApiError(raw: string, lower: string): AnalysisResult | null {
    if (!/api.*(?:error|fail)|(?:request|response).*(?:fail|error|invalid)/i.test(lower) &&
        !/graphql.*error|rest.*error|endpoint.*(?:fail|error)/i.test(lower)) return null;

    return {
      category: 'environment',
      rootCause: 'API request failed or returned an unexpected response. The backend service may be misconfigured, overloaded, or returning unexpected data.',
      suggestedFix: `• Check the API server logs for error details\n• Verify the API endpoint URL and request parameters\n• Check if the API contract has changed (breaking change)\n• Verify test data is in the expected state in the database\n• Check API rate limits and authentication`,
    };
  }

  private matchDatabaseError(raw: string, lower: string): AnalysisResult | null {
    if (!/database|db.*error|sql.*error|query.*fail|connection.*pool|deadlock|foreign key/i.test(lower) &&
        !/mongo.*error|redis.*error|postgres.*error|mysql.*error/i.test(lower)) return null;

    return {
      category: 'environment',
      rootCause: 'Database error — the application could not connect to or query the database. This may be caused by connection pool exhaustion, schema changes, or database downtime.',
      suggestedFix: `• Verify the database is running and accessible\n• Check database connection pool settings\n• Ensure test database migrations are up to date\n• Check for data state issues (missing seed data, stale fixtures)\n• Review recent schema changes that might affect queries`,
    };
  }

  private matchFileSystemError(raw: string, lower: string): AnalysisResult | null {
    if (!/enoent|eacces|no such file|file not found|path.*not.*exist|cannot find/i.test(lower)) return null;

    const fileMatch = raw.match(/(?:ENOENT|EACCES|not found|cannot find)[^'"]*['"]([^'"]+)['"]/i);
    const file = fileMatch?.[1] || 'the required file';

    return {
      category: 'environment',
      rootCause: `File system error — '${file}' does not exist or is not accessible. This may indicate a missing configuration file, test fixture, or build artifact.`,
      suggestedFix: `• Verify the file path is correct\n• Ensure build/compile steps ran before tests\n• Check if test fixtures are properly set up\n• Verify file permissions allow read access\n• If this is a generated file, ensure the generation step completed`,
    };
  }

  private matchConfigurationError(raw: string, lower: string): AnalysisResult | null {
    if (!/missing.*config|invalid.*config|configuration.*error|env.*(?:not set|missing|undefined)|process\.env/i.test(lower) &&
        !/invalid option|unknown option|unrecognized|cannot read.*(?:config|properties|settings)/i.test(lower)) return null;

    return {
      category: 'environment',
      rootCause: 'Configuration error — a required configuration value is missing, invalid, or the configuration file cannot be read.',
      suggestedFix: `• Check environment variables are set correctly for the test environment\n• Verify config files (.env, config.json, etc.) exist and are valid\n• Ensure test-specific configuration overrides are applied\n• Check if the CI/CD pipeline provides all required environment variables`,
    };
  }

  private matchDependencyError(raw: string, lower: string): AnalysisResult | null {
    if (!/cannot find module|module not found|import.*error|require.*error|package.*not installed/i.test(lower)) return null;

    const moduleMatch = raw.match(/(?:Cannot find module|Module not found)[^'"]*['"]([^'"]+)['"]/i);
    const moduleName = moduleMatch?.[1] || 'the required module';

    return {
      category: 'environment',
      rootCause: `Dependency error — module '${moduleName}' could not be found. It may not be installed, or the import path may be incorrect.`,
      suggestedFix: `• Run 'npm install' or 'pnpm install' to install dependencies\n• Check if the package is listed in package.json\n• Verify the import path is correct (case-sensitive on Linux/macOS)\n• Check if TypeScript path aliases are configured correctly\n• Ensure build step completed if importing from compiled output`,
    };
  }

  private matchGenericPatterns(raw: string, lower: string): AnalysisResult | null {
    // Flaky indicators
    if (/intermittent|flaky|race condition|timing issue|eventually/i.test(lower)) {
      return {
        category: 'flaky',
        rootCause: 'Test has intermittent failures suggesting race conditions, timing issues, or non-deterministic behavior.',
        suggestedFix: `• Add explicit waits instead of fixed timeouts\n• Use stable selectors (data-testid, aria roles)\n• Ensure test isolation — avoid shared state between tests\n• Wait for network requests to complete: await page.waitForLoadState('networkidle')\n• Consider adding retry logic for inherently non-deterministic operations`,
      };
    }

    // Stale element
    if (/stale element|element reference.*not valid|stale.*reference/i.test(lower)) {
      return {
        category: 'test-issue',
        rootCause: 'Stale element reference — the DOM element was modified or removed after it was located but before it was interacted with.',
        suggestedFix: `• Re-locate elements immediately before interacting with them\n• Use Playwright locators (auto-retrying) instead of element handles\n• Wait for page stability before interactions\n• Avoid storing element references across async operations`,
      };
    }

    // Screenshot/visual comparison
    if (/screenshot.*differ|visual.*regression|pixel.*mismatch|image.*comparison/i.test(lower)) {
      return {
        category: 'bug',
        rootCause: 'Visual regression detected — the page appearance has changed from the baseline screenshot.',
        suggestedFix: `• Review the screenshot diff to determine if the change is intentional\n• If intentional, update the baseline screenshots\n• If unintentional, investigate the CSS/layout change that caused the regression\n• Check for responsive design issues at the test viewport size`,
      };
    }

    return null;
  }

  private fallbackAnalysis(raw: string, lower: string): AnalysisResult {
    // Try to extract a meaningful message from the error even when no pattern matches
    // Extract the first sentence or meaningful phrase
    const firstSentence = raw
      .replace(/Error:\s*/i, '')
      .split(/[.\n]/)
      .filter(s => s.trim().length > 10)
      [0]?.trim() || raw.slice(0, 150);

    // Try to guess category from context clues
    let category: FailureGroup['category'] = 'unknown';
    if (/locator|selector|element|page\.|browser|click|fill|type|navigate/i.test(lower)) {
      category = 'test-issue';
    } else if (/server|service|api|endpoint|database|connect|port/i.test(lower)) {
      category = 'environment';
    } else if (/expect|assert|should|must|verify|check|compare/i.test(lower)) {
      category = 'bug';
    }

    return {
      category,
      rootCause: `Error: ${firstSentence}`,
      suggestedFix: `• Review the full error message and stack trace in the test output\n• Check if this error started after recent code changes\n• Try reproducing the failure locally for easier debugging\n• Check the test logs and screenshots for more context`,
    };
  }
}

// ── Internal Types ──────────────────────────────────────────────────────────

interface AnalysisResult {
  category: FailureGroup['category'];
  rootCause: string;
  suggestedFix: string;
}
