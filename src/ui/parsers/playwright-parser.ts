import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { StoredTestCase } from '../types.js';
import { normalizeBrowserName } from './browser-detect.js';
import { stripAnsi } from './strip-ansi.js';

interface PlaywrightSuite {
  title?: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

interface PlaywrightSpec {
  title: string;
  file?: string;
  tests: PlaywrightTest[];
}

interface PlaywrightTest {
  projectName?: string;
  results: PlaywrightResult[];
}

interface PlaywrightResult {
  status: string;
  duration: number;
  error?: { message?: string; stack?: string };
  attachments?: Array<{ name: string; path?: string; contentType?: string; body?: string }>;
  retry?: number;
}

interface PlaywrightReport {
  suites: PlaywrightSuite[];
  stats?: {
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
    duration?: number;
  };
}

export function parsePlaywrightResults(
  projectPath: string,
  stdout: string,
): StoredTestCase[] {
  const tests: StoredTestCase[] = [];

  // Try to parse JSON from file first (PLAYWRIGHT_JSON_OUTPUT_NAME), then stdout fallback
  let report: PlaywrightReport | null = null;
  const candidates = [
    join(projectPath, '.qabot-results.json'),
    join(projectPath, 'test-results.json'),
    join(projectPath, 'playwright-report', 'results.json'),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        console.log(`[qabot-parser] Reading Playwright JSON: ${candidate}`);
        report = JSON.parse(readFileSync(candidate, 'utf-8')) as PlaywrightReport;
        console.log(`[qabot-parser] Parsed: ${report.suites?.length || 0} top-level suites`);
        break;
      }
    } catch (err) {
      console.error(`[qabot-parser] Failed to parse ${candidate}:`, err);
    }
  }

  // Fallback: try parsing JSON from stdout (legacy --reporter=json to stdout)
  if (!report) {
    try {
      const jsonStart = stdout.indexOf('{');
      if (jsonStart >= 0) {
        report = JSON.parse(stdout.slice(jsonStart)) as PlaywrightReport;
      }
    } catch { /* not JSON stdout */ }
  }

  if (report) {
    extractFromSuites(report.suites, tests, projectPath);
    console.log(`[qabot-parser] Extracted ${tests.length} tests from JSON report`);
  } else {
    console.warn(`[qabot-parser] No Playwright JSON report found! Checked: ${candidates.join(', ')}`);
    console.warn(`[qabot-parser] Results page will be empty. Ensure --reporter=list,json + PLAYWRIGHT_JSON_OUTPUT_NAME env var are set.`);
  }

  // Scan for screenshots, videos, and traces in test-results directory
  enrichWithArtifacts(tests, projectPath);

  return tests;
}

function extractFromSuites(suites: PlaywrightSuite[], tests: StoredTestCase[], projectPath: string): void {
  for (const suite of suites) {
    // Process nested suites
    if (suite.suites) {
      extractFromSuites(suite.suites, tests, projectPath);
    }

    // Process specs
    if (suite.specs) {
      for (const spec of suite.specs) {
        for (const test of spec.tests) {
          const lastResult = test.results[test.results.length - 1];
          if (!lastResult) continue;

          const status = mapPlaywrightStatus(lastResult.status);

          // Extract attachments by type
          const screenshotAttachment = lastResult.attachments?.find(
            a => a.contentType?.startsWith('image/') && a.path,
          );
          const videoAttachment = lastResult.attachments?.find(
            a => (a.contentType?.startsWith('video/') || a.name === 'video') && a.path,
          );
          const traceAttachment = lastResult.attachments?.find(
            a => a.name === 'trace' && a.path,
          );

          // Strip ANSI codes from error messages for clean display
          const rawError = lastResult.error?.message;
          const rawStack = lastResult.error?.stack;

          tests.push({
            name: spec.title,
            suite: suite.title,
            file: spec.file ? relative(projectPath, spec.file) : suite.file,
            status,
            duration: lastResult.duration,
            errorMessage: rawError ? stripAnsi(rawError) : undefined,
            stackTrace: rawStack ? stripAnsi(rawStack) : undefined,
            screenshotPath: screenshotAttachment?.path
              ? relative(projectPath, screenshotAttachment.path)
              : undefined,
            videoPath: videoAttachment?.path
              ? relative(projectPath, videoAttachment.path)
              : undefined,
            tracePath: traceAttachment?.path
              ? relative(projectPath, traceAttachment.path)
              : undefined,
            retryCount: lastResult.retry,
            browser: normalizeBrowserName(test.projectName),
          });
        }
      }
    }
  }
}

function mapPlaywrightStatus(status: string): StoredTestCase['status'] {
  switch (status) {
    case 'passed':
    case 'expected': return 'passed';
    case 'failed':
    case 'unexpected': return 'failed';
    case 'skipped': return 'skipped';
    case 'timedOut': return 'failed';
    default: return 'error';
  }
}

function enrichWithArtifacts(tests: StoredTestCase[], projectPath: string): void {
  const resultsDir = join(projectPath, 'test-results');
  if (!existsSync(resultsDir)) return;

  try {
    const entries = readdirSync(resultsDir);
    for (const entry of entries) {
      const entryPath = join(resultsDir, entry);
      if (!statSync(entryPath).isDirectory()) continue;

      // Match test directories to test names
      // Playwright truncates long directory names, so we also try matching
      // the last 3 words of the slug (handles cases like "should-display-product-price"
      // being truncated to "hould-display-product-price" in the dir name)
      const entryLower = entry.toLowerCase();
      const matchingTest = tests.find(t => {
        const slug = t.name.toLowerCase().replace(/\s+/g, '-');
        // Primary: full slug match
        if (entryLower.includes(slug)) return true;
        // Fuzzy: last 3+ words of slug (handles Playwright truncation)
        const words = slug.split('-');
        if (words.length >= 3) {
          const tailSlug = words.slice(-3).join('-');
          if (tailSlug.length >= 8 && entryLower.includes(tailSlug)) {
            // Also verify browser matches if available (avoid cross-browser false matches)
            if (t.browser && !entryLower.includes(t.browser.toLowerCase())) return false;
            return true;
          }
        }
        return false;
      });

      if (!matchingTest) continue;

      // Scan directory for artifact files
      try {
        const files = readdirSync(entryPath);

        // Screenshots
        const screenshot = files.find(f => f.endsWith('.png') || f.endsWith('.jpg'));
        if (screenshot && !matchingTest.screenshotPath) {
          matchingTest.screenshotPath = relative(projectPath, join(entryPath, screenshot));
        }

        // Videos
        const video = files.find(f => f.endsWith('.webm') || f.endsWith('.mp4'));
        if (video && !matchingTest.videoPath) {
          matchingTest.videoPath = relative(projectPath, join(entryPath, video));
        }

        // Traces
        const trace = files.find(f => f.endsWith('.zip'));
        if (trace && !matchingTest.tracePath) {
          matchingTest.tracePath = relative(projectPath, join(entryPath, trace));
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}
