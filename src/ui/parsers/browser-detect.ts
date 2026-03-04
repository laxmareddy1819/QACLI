/**
 * Shared browser detection utilities.
 * Used by multiple parsers to normalize browser names and detect browsers from stdout.
 */

const BROWSER_MAP: Record<string, string> = {
  // Chromium-based
  chromium: 'Chrome',
  chrome: 'Chrome',
  'google-chrome': 'Chrome',
  'google chrome': 'Chrome',
  chromedriver: 'Chrome',

  // Firefox/Gecko
  firefox: 'Firefox',
  gecko: 'Firefox',
  geckodriver: 'Firefox',
  ff: 'Firefox',

  // WebKit/Safari
  webkit: 'Safari',
  safari: 'Safari',

  // Edge
  msedge: 'Edge',
  edge: 'Edge',
  'microsoft edge': 'Edge',
  msedgedriver: 'Edge',
  'ms-edge': 'Edge',

  // IE (legacy)
  ie: 'IE',
  'internet explorer': 'IE',
};

/**
 * Normalize various browser identifiers to a display-friendly name.
 * E.g. "chromium" → "Chrome", "webkit" → "Safari", "gecko" → "Firefox"
 */
export function normalizeBrowserName(raw?: string): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase().trim();
  if (BROWSER_MAP[lower]) return BROWSER_MAP[lower];

  // Check partial matches (e.g. "chromium-headless" → Chrome)
  for (const [key, value] of Object.entries(BROWSER_MAP)) {
    if (lower.includes(key)) return value;
  }

  // Return the raw value capitalized if no match
  if (lower.length > 0) {
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }
  return undefined;
}

/**
 * Detect browser from test runner stdout/stderr output.
 * Recognizes patterns from Playwright, Cypress, Selenium/WebDriver,
 * Robot Framework, pytest-selenium, and generic CLI flags.
 */
export function detectBrowserFromOutput(output: string): string | undefined {
  // 1. Playwright: [chromium], [firefox], [webkit]
  const pwMatch = output.match(/\[(chromium|firefox|webkit|chrome|msedge)\]/i);
  if (pwMatch) return normalizeBrowserName(pwMatch[1]);

  // 2. Cypress: "Browser:  Chrome 120" or "Running:  chrome"
  const cypressMatch = output.match(/Browser:\s+(Chrome|Firefox|Edge|Electron|Safari)\b/i);
  if (cypressMatch) return normalizeBrowserName(cypressMatch[1]);

  // 3. Selenium/WebDriver driver startup messages
  const seleniumMatch = output.match(/Starting\s+(ChromeDriver|geckodriver|MSEdgeDriver|SafariDriver|IEDriverServer)/i);
  if (seleniumMatch) return normalizeBrowserName(seleniumMatch[1]);

  // 4. WebDriver capabilities — "browserName": "chrome"
  const capsMatch = output.match(/["']?browserName["']?\s*[:=]\s*["']?(chrome|firefox|safari|edge|msedge|ie)["']?/i);
  if (capsMatch) return normalizeBrowserName(capsMatch[1]);

  // 5. Robot Framework: Opening browser 'chrome'
  const robotMatch = output.match(/Opening\s+browser\s+['"]?(chrome|firefox|safari|edge|ie)['"]?/i);
  if (robotMatch) return normalizeBrowserName(robotMatch[1]);

  // 6. pytest-selenium / generic: browser: chrome
  const genericBrowserMatch = output.match(/browser\s*[:=]\s*['"]?(chrome|chromium|firefox|safari|edge|webkit|msedge)['"]?/i);
  if (genericBrowserMatch) return normalizeBrowserName(genericBrowserMatch[1]);

  // 7. CLI flags: --browser chrome, --browser=firefox
  const flagMatch = output.match(/--browser[= ]+['"]?(chrome|chromium|firefox|safari|edge|webkit|msedge|ie)['"]?/i);
  if (flagMatch) return normalizeBrowserName(flagMatch[1]);

  // 8. Playwright project specification: --project=chromium
  const projectMatch = output.match(/--project[= ]+['"]?(chromium|firefox|webkit|chrome|msedge)['"]?/i);
  if (projectMatch) return normalizeBrowserName(projectMatch[1]);

  return undefined;
}
