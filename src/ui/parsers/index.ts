import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { StoredTestCase } from '../types.js';
import { getResultPath } from './reporter-config.js';
import { parsePlaywrightResults } from './playwright-parser.js';
import { parseJUnitXML } from './junit-xml-parser.js';
import { parseJestResults } from './jest-parser.js';
import { parseCucumberResults } from './cucumber-parser.js';
import { parseStdoutResults, detectFrameworkFromStdout } from './stdout-parser.js';
import { detectBrowserFromOutput } from './browser-detect.js';

export interface ParsedTestRun {
  tests: StoredTestCase[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    passRate: number;
  };
}

/**
 * Parse test results from a completed test run.
 * Dispatches to framework-specific parsers, falling back to stdout parsing.
 *
 * Smart detection: If the declared framework parser returns nothing,
 * re-detect from stdout and try the correct parser before falling back.
 */
export function parseTestResults(
  framework: string | null,
  projectPath: string,
  stdout: string,
  stderr: string,
): ParsedTestRun {
  let tests: StoredTestCase[] = [];

  const resultPath = getResultPath(framework, projectPath);

  tests = parseWithFramework(framework, resultPath, projectPath, stdout);

  // If the declared framework returned nothing, try detecting from stdout
  // This handles Playwright+Cucumber projects where scanner says "playwright"
  // but the output is actually Cucumber format
  if (tests.length === 0 && framework) {
    const detectedFw = detectFrameworkFromStdout(stdout);
    if (detectedFw && detectedFw !== framework?.toLowerCase()) {
      const detectedResultPath = getResultPath(detectedFw, projectPath);
      tests = parseWithFramework(detectedFw, detectedResultPath, projectPath, stdout);
    }
  }

  // Fallback to stdout parsing if no structured results found
  if (tests.length === 0) {
    tests = parseStdoutResults(stdout, stderr, projectPath);
  }

  // Post-process: detect browser from stdout for tests missing browser info.
  // This covers ALL frameworks (Cucumber+Selenium, Cypress, Robot, pytest-selenium, etc.)
  const detectedBrowser = detectBrowserFromOutput(stdout + '\n' + stderr);
  if (detectedBrowser) {
    for (const test of tests) {
      if (!test.browser) {
        test.browser = detectedBrowser;
      }
    }
  }

  // Post-process: discover screenshots for tests that don't have one yet.
  // Playwright parser has its own enrichment; this catches all other frameworks.
  enrichWithScreenshots(tests, projectPath);

  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = tests.filter(t => t.status === 'failed' || t.status === 'error').length;
  const skipped = tests.filter(t => t.status === 'skipped').length;
  const total = tests.length;

  return {
    tests,
    summary: {
      total,
      passed,
      failed,
      skipped,
      passRate: total > 0 ? Math.round((passed / total) * 10000) / 100 : 0,
    },
  };
}

/**
 * Try a specific framework parser.
 */
function parseWithFramework(
  framework: string | null,
  resultPath: string | null,
  projectPath: string,
  stdout: string,
): StoredTestCase[] {
  switch (framework?.toLowerCase()) {
    case 'playwright':
      return parsePlaywrightResults(projectPath, stdout);

    case 'jest':
    case 'vitest':
      return parseJestResults(resultPath, stdout);

    case 'pytest':
    case 'robot':
    case 'maven':
    case 'dotnet':
      if (resultPath) {
        return parseJUnitXML(resultPath);
      }
      return [];

    case 'cucumber':
      return parseCucumberResults(resultPath, stdout);

    default:
      return [];
  }
}

// ── Generic Screenshot Discovery ────────────────────────────────────────────
//
// Scans common artifact directories across all frameworks for screenshot files
// and matches them to test cases by name. Only fills in screenshotPath for
// tests that don't already have one (so Playwright's own enrichment wins).
//
// Common directories across frameworks:
//   - screenshots/          (Cucumber hooks, Selenium, custom)
//   - test-results/         (Playwright — already handled, but covers others too)
//   - reports/screenshots/  (Cucumber HTML reporter)
//   - cypress/screenshots/  (Cypress)
//   - target/screenshots/   (Maven/Java projects)
//   - allure-results/       (Allure reporter — pytest, Java, etc.)
//   - output/               (Robot Framework)
//   - TestResults/          (.NET)

const SCREENSHOT_DIRS = [
  'screenshots',
  'test-results',
  'reports/screenshots',
  'reports',
  'cypress/screenshots',
  'target/screenshots',
  'target/surefire-reports',
  'allure-results',
  'output',
  'TestResults',
  'build/reports',
];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/**
 * Scan common artifact directories for screenshot files and match them
 * to test cases by name. Only assigns screenshots to tests that don't
 * already have a screenshotPath.
 */
function enrichWithScreenshots(tests: StoredTestCase[], projectPath: string): void {
  // Skip if all tests already have screenshots
  const testsNeedingScreenshots = tests.filter(t => !t.screenshotPath);
  if (testsNeedingScreenshots.length === 0) return;

  // Collect all screenshot files from known directories
  const screenshotFiles: Array<{ relPath: string; filename: string }> = [];

  for (const dir of SCREENSHOT_DIRS) {
    const fullDir = join(projectPath, dir);
    if (!existsSync(fullDir)) continue;

    try {
      collectScreenshots(fullDir, projectPath, screenshotFiles, 0);
    } catch { /* skip unreadable dirs */ }
  }

  if (screenshotFiles.length === 0) return;

  console.log(`[qabot-parser] Found ${screenshotFiles.length} screenshot(s) in artifact directories`);

  // Match screenshots to tests by name similarity
  for (const test of testsNeedingScreenshots) {
    const testSlug = test.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const testWords = testSlug.split('-').filter(w => w.length > 2);

    let bestMatch: string | undefined;
    let bestScore = 0;

    for (const file of screenshotFiles) {
      const fileSlug = file.filename.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-');

      // Exact slug match
      if (fileSlug.includes(testSlug) || testSlug.includes(fileSlug)) {
        bestMatch = file.relPath;
        break;
      }

      // Partial word match — count how many test name words appear in filename
      const matchedWords = testWords.filter(w => fileSlug.includes(w)).length;
      const score = testWords.length > 0 ? matchedWords / testWords.length : 0;

      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = file.relPath;
      }
    }

    if (bestMatch) {
      test.screenshotPath = bestMatch;
    }
  }

  const matched = testsNeedingScreenshots.filter(t => t.screenshotPath).length;
  if (matched > 0) {
    console.log(`[qabot-parser] Matched ${matched} screenshot(s) to tests`);
  }
}

/**
 * Recursively collect image files from a directory (max depth 3).
 */
function collectScreenshots(
  dir: string,
  projectPath: string,
  results: Array<{ relPath: string; filename: string }>,
  depth: number,
): void {
  if (depth > 3) return;

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          // Skip common non-artifact directories
          if (/^(node_modules|\.git|dist|build|\.next)$/.test(entry)) continue;
          collectScreenshots(fullPath, projectPath, results, depth + 1);
        } else if (stat.isFile()) {
          const ext = entry.substring(entry.lastIndexOf('.')).toLowerCase();
          if (IMAGE_EXTENSIONS.has(ext)) {
            results.push({
              relPath: relative(projectPath, fullPath),
              filename: entry,
            });
          }
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* skip unreadable dirs */ }
}
