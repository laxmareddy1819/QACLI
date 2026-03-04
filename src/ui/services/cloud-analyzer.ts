/**
 * Cloud Readiness Analyzer & Auto-Patcher
 *
 * Analyzes a test project to determine if it's ready to run on cloud grids
 * (BrowserStack, LambdaTest, SauceLabs). If not, generates patches that
 * add cloud-aware browser lifecycle management to the project's hooks/setup.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import type { CloudProviderId } from '../store/cloud-config-store.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CloudAnalysis {
  cloudReady: boolean;
  hasCloudConnect: boolean;
  hasSessionStatus: boolean;
  framework: string;
  language: string;
  hookFile: string | null;        // relative path
  hookFileAbsolute: string | null;
  patches: CloudPatch[];
  alreadyPatched: boolean;
}

export interface CloudPatch {
  type: 'cloud-connect' | 'session-status' | 'full';
  description: string;
  file: string;       // relative path
  fileAbsolute: string;
  preview: string;    // new content
  original: string;   // original content
}

// ── Cloud Indicators ─────────────────────────────────────────────────────────

const CLOUD_CONNECT_KEYWORDS = [
  'BROWSERSTACK_USERNAME', 'LT_USERNAME', 'SAUCE_USERNAME',
  'chromium.connect', 'RemoteWebDriver', 'webdriver.Remote',
  'SELENIUM_REMOTE_URL', 'CLOUD_HUB_URL', 'CLOUD_CDP_URL',
  'cdp.browserstack.com', 'cdp.lambdatest.com',
];

const SESSION_STATUS_KEYWORDS = [
  'setSessionStatus', 'browserstack_executor', 'lambdatest_action',
  'saucelabs_executor', 'sauce:options',
];

// ── Hook File Patterns ───────────────────────────────────────────────────────

interface HookPattern {
  framework: string;
  language: string;
  globs: string[];
  contentIndicators: string[];
}

const HOOK_PATTERNS: HookPattern[] = [
  // Playwright + Cucumber (TypeScript/JavaScript)
  {
    framework: 'playwright-cucumber',
    language: 'typescript',
    globs: ['src/hooks/**/*.ts', 'features/support/**/*.ts', 'support/**/*.ts', 'hooks/**/*.ts'],
    contentIndicators: ['BeforeAll', 'chromium.launch', '@playwright/test'],
  },
  {
    framework: 'playwright-cucumber',
    language: 'javascript',
    globs: ['src/hooks/**/*.js', 'features/support/**/*.js', 'support/**/*.js', 'hooks/**/*.js'],
    contentIndicators: ['BeforeAll', 'chromium.launch', 'playwright'],
  },
  // Playwright native
  {
    framework: 'playwright',
    language: 'typescript',
    globs: ['playwright.config.ts', 'playwright.config.js'],
    contentIndicators: ['defineConfig', 'playwright/test'],
  },
  // Selenium Java
  {
    framework: 'selenium-java',
    language: 'java',
    globs: ['src/**/Base*.java', 'src/**/Setup*.java', 'src/**/Hook*.java', 'src/**/Driver*.java', 'src/**/Browser*.java'],
    contentIndicators: ['ChromeDriver', 'WebDriver', 'selenium'],
  },
  // Selenium Python
  {
    framework: 'selenium-python',
    language: 'python',
    globs: ['conftest.py', '**/conftest.py', '**/fixtures.py', '**/base_test.py', '**/setup.py'],
    contentIndicators: ['webdriver', 'Chrome()', 'selenium'],
  },
  // Selenium C#
  {
    framework: 'selenium-csharp',
    language: 'csharp',
    globs: ['**/*Base*.cs', '**/*Setup*.cs', '**/*Hook*.cs', '**/*Driver*.cs'],
    contentIndicators: ['ChromeDriver', 'IWebDriver', 'OpenQA.Selenium'],
  },
  // Cypress (CLI wrapper handles it — always cloud-ready)
  {
    framework: 'cypress',
    language: 'javascript',
    globs: ['cypress.config.ts', 'cypress.config.js'],
    contentIndicators: ['defineConfig', 'cypress'],
  },
  // WebdriverIO
  {
    framework: 'webdriverio',
    language: 'javascript',
    globs: ['wdio.conf.ts', 'wdio.conf.js'],
    contentIndicators: ['config', 'capabilities', 'webdriverio'],
  },
];

// ── Main Analyzer ────────────────────────────────────────────────────────────

export function analyzeCloudReadiness(
  projectPath: string,
  detectedFramework: string | null,
  _provider: CloudProviderId,
): CloudAnalysis {
  const result: CloudAnalysis = {
    cloudReady: false,
    hasCloudConnect: false,
    hasSessionStatus: false,
    framework: detectedFramework || 'unknown',
    language: 'unknown',
    hookFile: null,
    hookFileAbsolute: null,
    patches: [],
    alreadyPatched: false,
  };

  // Cypress is always cloud-ready (handled by CLI wrapper)
  if (detectedFramework === 'cypress') {
    result.cloudReady = true;
    result.framework = 'cypress';
    result.language = 'javascript';
    return result;
  }

  // Find the hooks/setup file
  const hookInfo = findHookFile(projectPath, detectedFramework);
  if (!hookInfo) {
    // Can't find hooks — not cloud-ready but can't patch either
    return result;
  }

  result.framework = hookInfo.framework;
  result.language = hookInfo.language;
  result.hookFile = relative(projectPath, hookInfo.filePath);
  result.hookFileAbsolute = hookInfo.filePath;

  // Read file content and check for cloud indicators
  let content: string;
  try {
    content = readFileSync(hookInfo.filePath, 'utf-8');
  } catch {
    return result;
  }

  result.hasCloudConnect = CLOUD_CONNECT_KEYWORDS.some(kw => content.includes(kw));
  result.hasSessionStatus = SESSION_STATUS_KEYWORDS.some(kw => content.includes(kw));
  result.cloudReady = result.hasCloudConnect && result.hasSessionStatus;

  if (result.cloudReady) {
    return result;
  }

  // Generate patches
  const patched = generatePatchedContent(hookInfo.framework, hookInfo.language, content);
  if (patched) {
    const patchType: CloudPatch['type'] = (!result.hasCloudConnect && !result.hasSessionStatus) ? 'full' :
      !result.hasCloudConnect ? 'cloud-connect' : 'session-status';

    const descriptions: string[] = [];
    if (!result.hasCloudConnect) descriptions.push('Add cloud grid detection (auto-connect to BrowserStack/LambdaTest/SauceLabs when env vars present)');
    if (!result.hasSessionStatus) descriptions.push('Add session status reporting (mark build as passed/failed in cloud dashboard)');

    result.patches.push({
      type: patchType,
      description: descriptions.join('; '),
      file: result.hookFile!,
      fileAbsolute: hookInfo.filePath,
      preview: patched,
      original: content,
    });
  }

  return result;
}

// ── Hook File Finder ─────────────────────────────────────────────────────────

interface HookFileInfo {
  filePath: string;
  framework: string;
  language: string;
}

function findHookFile(projectPath: string, detectedFramework: string | null): HookFileInfo | null {
  // Determine which patterns to try based on detected framework
  const patterns = detectedFramework
    ? HOOK_PATTERNS.filter(p => p.framework.includes(detectedFramework.toLowerCase()) ||
        detectedFramework.toLowerCase().includes(p.framework.split('-')[0]!))
    : HOOK_PATTERNS;

  // If no match from detected framework, try all patterns
  const patternsToTry = patterns.length > 0 ? patterns : HOOK_PATTERNS;

  for (const pattern of patternsToTry) {
    for (const glob of pattern.globs) {
      const files = resolveGlob(projectPath, glob);
      for (const filePath of files) {
        try {
          const content = readFileSync(filePath, 'utf-8');
          const matchCount = pattern.contentIndicators.filter(ind => content.includes(ind)).length;
          if (matchCount >= 1) {
            return { filePath, framework: pattern.framework, language: pattern.language };
          }
        } catch {
          continue;
        }
      }
    }
  }

  return null;
}

/**
 * Simple glob resolver — supports `**` for recursive and `*` for wildcards.
 */
function resolveGlob(basePath: string, pattern: string): string[] {
  const results: string[] = [];
  const parts = pattern.split('/');

  function walk(currentPath: string, partIndex: number): void {
    if (partIndex >= parts.length) return;

    const part = parts[partIndex]!;

    if (part === '**') {
      // Recursive: try current dir and all subdirs
      walk(currentPath, partIndex + 1);
      try {
        const entries = readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
            walk(join(currentPath, entry.name), partIndex);
          }
        }
      } catch { /* skip */ }
    } else if (part.includes('*')) {
      // Wildcard match
      const regex = new RegExp('^' + part.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      try {
        const entries = readdirSync(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (regex.test(entry.name)) {
            const fullPath = join(currentPath, entry.name);
            if (partIndex === parts.length - 1) {
              if (entry.isFile()) results.push(fullPath);
            } else if (entry.isDirectory()) {
              walk(fullPath, partIndex + 1);
            }
          }
        }
      } catch { /* skip */ }
    } else {
      // Exact name
      const fullPath = join(currentPath, part);
      if (existsSync(fullPath)) {
        if (partIndex === parts.length - 1) {
          try {
            if (statSync(fullPath).isFile()) results.push(fullPath);
          } catch { /* skip */ }
        } else {
          walk(fullPath, partIndex + 1);
        }
      }
    }
  }

  walk(basePath, 0);
  return results;
}

// ── Patch Generator ──────────────────────────────────────────────────────────

function generatePatchedContent(framework: string, language: string, original: string): string | null {
  switch (framework) {
    case 'playwright-cucumber':
      return patchPlaywrightCucumber(original, language);
    case 'selenium-java':
      return patchSeleniumJava(original);
    case 'selenium-python':
      return patchSeleniumPython(original);
    case 'selenium-csharp':
      return patchSeleniumCSharp(original);
    case 'playwright':
      // Native Playwright uses SELENIUM_REMOTE_URL env var automatically
      // Just need to add session status if missing
      return patchPlaywrightNative(original);
    case 'webdriverio':
      return patchWebdriverIO(original);
    default:
      return null;
  }
}

// ── Playwright + Cucumber Patch ──────────────────────────────────────────────

function patchPlaywrightCucumber(original: string, _language: string): string {
  const hasCloudConnect = CLOUD_CONNECT_KEYWORDS.some(kw => original.includes(kw));
  const hasSessionStatus = SESSION_STATUS_KEYWORDS.some(kw => original.includes(kw));

  if (hasCloudConnect && hasSessionStatus) return original;

  let patched = original;

  // Add cloud helper + tracking variables after imports (before first class/let/const)
  if (!hasCloudConnect) {
    const cloudHelper = `
// ── Cloud Grid Support (auto-generated by qabot) ────────────────────────────
let _isCloudRun = false;
let _scenariosPassed = 0;
let _scenariosFailed = 0;

function getCloudCdpUrl(): string | null {
  const bsUser = process.env.BROWSERSTACK_USERNAME;
  const bsKey = process.env.BROWSERSTACK_ACCESS_KEY;
  if (bsUser && bsKey) {
    const caps = JSON.stringify({
      'browser': 'chrome', 'browser_version': 'latest',
      'os': 'Windows', 'os_version': '11',
      'name': process.env.BROWSERSTACK_BUILD_NAME || 'cloud-run',
      'build': process.env.BROWSERSTACK_BUILD_NAME || 'cloud-run',
      'browserstack.username': bsUser, 'browserstack.accessKey': bsKey,
    });
    return \`wss://cdp.browserstack.com/playwright?caps=\${encodeURIComponent(caps)}\`;
  }
  const ltUser = process.env.LT_USERNAME;
  const ltKey = process.env.LT_ACCESS_KEY;
  if (ltUser && ltKey) {
    const caps = JSON.stringify({
      'browserName': 'chrome', 'browserVersion': 'latest',
      'LT:Options': { 'platform': 'Windows 11',
        'build': process.env.LT_BUILD_NAME || 'cloud-run',
        'name': process.env.LT_BUILD_NAME || 'cloud-run',
        'user': ltUser, 'accessKey': ltKey },
    });
    return \`wss://cdp.lambdatest.com/playwright?capabilities=\${encodeURIComponent(caps)}\`;
  }
  return null;
}
// ── End Cloud Grid Support ──────────────────────────────────────────────────
`;

    // Insert before the first BeforeAll/Before/let/const that defines browser
    const insertPoint = patched.search(/^(let\s+\w*[Bb]rowser|BeforeAll)/m);
    if (insertPoint >= 0) {
      patched = patched.slice(0, insertPoint) + cloudHelper + '\n' + patched.slice(insertPoint);
    } else {
      // Fallback: insert after last import
      const lastImport = patched.lastIndexOf('import ');
      const afterImport = patched.indexOf('\n', lastImport);
      if (afterImport >= 0) {
        patched = patched.slice(0, afterImport + 1) + cloudHelper + patched.slice(afterImport + 1);
      }
    }

    // Replace chromium.launch() with cloud-aware version
    patched = patched.replace(
      /(browserInstance|browser)\s*=\s*await\s+chromium\.launch\(\{([^}]*)\}\);/,
      `const cloudCdpUrl = getCloudCdpUrl();
  if (cloudCdpUrl) {
    const provider = process.env.CLOUD_PROVIDER || 'cloud';
    console.log(\`\\u2601 Connecting to \${provider} cloud grid...\`);
    $1 = await chromium.connect(cloudCdpUrl);
    _isCloudRun = true;
    console.log(\`\\u2601 Connected to \${provider} successfully\`);
  } else {
    $1 = await chromium.launch({$2});
  }`,
    );
  }

  // Add session status tracking to After hook
  if (!hasSessionStatus) {
    // Add scenario counting to After hook
    patched = patched.replace(
      /(After\(async\s+function\s*\([^)]*\)\s*\{)/,
      `$1\n  // Track scenario results for cloud session status\n  if (scenarioResult?.result?.status === Status.PASSED) _scenariosPassed++;\n  else if (scenarioResult?.result?.status === Status.FAILED) _scenariosFailed++;`,
    );

    // Add session status to AfterAll hook (before browser.close)
    patched = patched.replace(
      /(AfterAll\(async\s+function\s*\([^)]*\)\s*\{[\s\S]*?)(if\s*\(\s*(?:browserInstance|browser)\s*\)\s*\{[\s\S]*?(?:\.close\(\)))/,
      `$1// Set cloud session status before closing
  if (_isCloudRun && browserInstance) {
    try {
      const ctx = await browserInstance.newContext();
      const statusPage = await ctx.newPage();
      const status = _scenariosFailed > 0 ? 'failed' : 'passed';
      const reason = \`\${_scenariosPassed} passed, \${_scenariosFailed} failed\`;
      if (process.env.BROWSERSTACK_USERNAME) {
        await statusPage.evaluate(_ => {}, \`browserstack_executor: \${JSON.stringify({ action: 'setSessionStatus', arguments: { status, reason } })}\`);
      }
      if (process.env.LT_USERNAME) {
        await statusPage.evaluate(_ => {}, \`lambdatest_action: \${JSON.stringify({ action: 'setSessionStatus', arguments: { status, remark: reason } })}\`);
      }
      await statusPage.close();
      await ctx.close();
      console.log(\`\\u2601 Cloud session marked as \${status}: \${reason}\`);
    } catch (e) { console.warn('Failed to set cloud session status:', e); }
  }
  $2`,
    );
  }

  return patched;
}

// ── Playwright Native Patch ──────────────────────────────────────────────────

function patchPlaywrightNative(original: string): string {
  // For native Playwright, SELENIUM_REMOTE_URL env var handles cloud connection.
  // We only need to worry about session status — but Playwright's native runner
  // with BrowserStack SDK handles this automatically. So mark as cloud-ready.
  return original;
}

// ── Selenium Java Patch ──────────────────────────────────────────────────────

function patchSeleniumJava(original: string): string {
  const hasCloudConnect = original.includes('RemoteWebDriver') || original.includes('SELENIUM_REMOTE_URL');
  if (hasCloudConnect) return original;

  // Add import for RemoteWebDriver if not present
  let patched = original;
  if (!patched.includes('RemoteWebDriver')) {
    patched = patched.replace(
      /(import\s+org\.openqa\.selenium\.\w+;)/,
      `$1\nimport org.openqa.selenium.remote.RemoteWebDriver;\nimport java.net.URL;\nimport java.net.MalformedURLException;`,
    );
  }

  // Replace new ChromeDriver() with cloud-aware version
  patched = patched.replace(
    /(driver\s*=\s*new\s+ChromeDriver\([^)]*\);)/,
    `String remoteUrl = System.getenv("SELENIUM_REMOTE_URL");
        if (remoteUrl != null && !remoteUrl.isEmpty()) {
            // Cloud grid: connect to remote WebDriver
            try {
                ${'driver = new RemoteWebDriver(new URL(remoteUrl), options);'}
                System.out.println("\\u2601 Connected to cloud grid: " + System.getenv("CLOUD_PROVIDER"));
            } catch (MalformedURLException e) {
                throw new RuntimeException("Invalid SELENIUM_REMOTE_URL: " + remoteUrl, e);
            }
        } else {
            // Local execution
            $1
        }`,
    );

  return patched;
}

// ── Selenium Python Patch ────────────────────────────────────────────────────

function patchSeleniumPython(original: string): string {
  const hasCloudConnect = original.includes('webdriver.Remote') || original.includes('SELENIUM_REMOTE_URL');
  if (hasCloudConnect) return original;

  let patched = original;

  // Add import for os if not present
  if (!patched.includes('import os')) {
    patched = `import os\n` + patched;
  }

  // Replace webdriver.Chrome() with cloud-aware version
  patched = patched.replace(
    /(driver\s*=\s*webdriver\.Chrome\([^)]*\))/,
    `remote_url = os.getenv("SELENIUM_REMOTE_URL")
    if remote_url:
        # Cloud grid: connect to remote WebDriver
        driver = webdriver.Remote(command_executor=remote_url, options=options)
        print(f"\\u2601 Connected to cloud grid: {os.getenv('CLOUD_PROVIDER', 'cloud')}")
    else:
        # Local execution
        $1`,
  );

  return patched;
}

// ── Selenium C# Patch ────────────────────────────────────────────────────────

function patchSeleniumCSharp(original: string): string {
  const hasCloudConnect = original.includes('RemoteWebDriver') || original.includes('SELENIUM_REMOTE_URL');
  if (hasCloudConnect) return original;

  let patched = original;

  // Add using for RemoteWebDriver if not present
  if (!patched.includes('OpenQA.Selenium.Remote')) {
    patched = patched.replace(
      /(using OpenQA\.Selenium[^;]*;)/,
      `$1\nusing OpenQA.Selenium.Remote;`,
    );
  }

  // Replace new ChromeDriver() with cloud-aware version
  patched = patched.replace(
    /(driver\s*=\s*new\s+ChromeDriver\([^)]*\);)/,
    `var remoteUrl = Environment.GetEnvironmentVariable("SELENIUM_REMOTE_URL");
            if (!string.IsNullOrEmpty(remoteUrl))
            {
                // Cloud grid: connect to remote WebDriver
                driver = new RemoteWebDriver(new Uri(remoteUrl), options.ToCapabilities());
                Console.WriteLine($"\\u2601 Connected to cloud grid: {Environment.GetEnvironmentVariable("CLOUD_PROVIDER")}");
            }
            else
            {
                // Local execution
                $1
            }`,
  );

  return patched;
}

// ── WebdriverIO Patch ────────────────────────────────────────────────────────

function patchWebdriverIO(original: string): string {
  const hasCloudConnect = original.includes('SELENIUM_REMOTE_URL') || original.includes('@wdio/browserstack-service');
  if (hasCloudConnect) return original;

  // For WebdriverIO, add remote hostname/protocol detection based on env vars
  let patched = original;

  // Add cloud detection before exports.config or module.exports
  const cloudBlock = `
// Cloud grid support (auto-generated by qabot)
const remoteUrl = process.env.SELENIUM_REMOTE_URL;
if (remoteUrl) {
  const url = new URL(remoteUrl);
  config.hostname = url.hostname;
  config.port = parseInt(url.port) || 443;
  config.protocol = url.protocol.replace(':', '');
  config.path = url.pathname;
  if (url.username && url.password) {
    config.user = decodeURIComponent(url.username);
    config.key = decodeURIComponent(url.password);
  }
  console.log(\`\\u2601 Connected to cloud grid: \${process.env.CLOUD_PROVIDER || 'remote'}\`);
}
`;

  // Insert before module.exports or export default
  patched = patched.replace(
    /((?:module\.exports|export\s+default)\s*=\s*)/,
    `${cloudBlock}\n$1`,
  );

  return patched;
}

// ── Utility ──────────────────────────────────────────────────────────────────

export function applyPatch(patch: CloudPatch): void {
  writeFileSync(patch.fileAbsolute, patch.preview, 'utf-8');
}

export function computeFileHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}
