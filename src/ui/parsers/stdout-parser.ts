import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredTestCase, TestStep } from '../types.js';
import { normalizeBrowserName } from './browser-detect.js';
import { stripAnsi } from './strip-ansi.js';

/**
 * Fallback parser that extracts test results from raw stdout/stderr
 * using common patterns from popular test frameworks.
 *
 * DESIGN PRINCIPLE: Count *tests/scenarios/specs* — NOT individual steps.
 * BDD frameworks (Cucumber, Playwright BDD, Mocha BDD) output checkmarks for
 * every step (Given/When/Then/And), but the user cares about scenario-level results.
 */
export function parseStdoutResults(
  stdout: string,
  stderr: string,
  projectPath?: string,
): StoredTestCase[] {
  // Strip ANSI color codes — frameworks heavily color their output
  const output = stripAnsi(stdout + '\n' + stderr);

  // 1. Try summary-line based parsing first (most reliable)
  const summaryTests = parseSummaryLines(output, projectPath);
  if (summaryTests.length > 0) return summaryTests;

  // 2. Try framework-specific patterns
  const pwTests = parsePlaywrightLines(output);
  if (pwTests.length > 0) return pwTests;

  const pytestTests = parsePytestLines(output);
  if (pytestTests.length > 0) return pytestTests;

  const mochaTests = parseMochaJestLines(output);
  if (mochaTests.length > 0) return mochaTests;

  // 3. Generic patterns (last resort)
  return parseGenericLines(output);
}

/**
 * Detect the framework from stdout content for intelligent parsing.
 */
export function detectFrameworkFromStdout(stdout: string): string | null {
  const clean = stripAnsi(stdout);

  // Cucumber indicators — check FIRST because Cucumber+Playwright projects
  // have both Playwright and Cucumber patterns in stdout
  if (/\d+\s+scenarios?\s*\(/i.test(clean)) return 'cucumber';
  if (/\d+\s+steps?\s*\(\d+\s+passed/i.test(clean)) return 'cucumber';

  // Playwright indicators
  if (/running \d+ tests? using \d+ workers?/i.test(clean)) return 'playwright';
  if (/\[chromium\]|browsers?:\s*chromium|\[firefox\]|\[webkit\]/i.test(clean)) return 'playwright';

  // Cypress indicators
  if (/cypress\s+run|Running:\s+\S+\.cy\./i.test(clean)) return 'cypress';

  // Jest/Vitest indicators
  if (/Test Suites:.*\d+\s+(passed|failed)/i.test(clean)) return 'jest';
  if (/PASS\s+\S+\.(test|spec)\.(ts|js|tsx|jsx)/i.test(clean)) return 'jest';
  if (/vitest/i.test(clean) && /tests?\s+\d+\s+(passed|failed)/i.test(clean)) return 'vitest';

  // Mocha indicators
  if (/\d+\s+passing\s+\(\d+[ms]+\)/i.test(clean)) return 'mocha';

  // pytest indicators
  if (/={3,}\s+test session starts\s+={3,}/i.test(clean)) return 'pytest';
  if (/collected \d+ items?/i.test(clean)) return 'pytest';

  // Robot Framework indicators
  if (/Output:\s+.*output\.xml/i.test(clean)) return 'robot';

  // Maven/JUnit indicators
  if (/Tests run:\s*\d+.*Failures:\s*\d+.*Errors:\s*\d+/i.test(clean)) return 'maven';

  // .NET indicators
  if (/Passed!\s+-\s+Failed:/i.test(clean) || /Total tests:\s*\d+/i.test(clean)) return 'dotnet';

  return null;
}

// ── Summary-line parsing (framework-agnostic) ──────────────────────────────
// Many frameworks output a summary line. These are the most reliable source.

function parseSummaryLines(output: string, projectPath?: string): StoredTestCase[] {
  // ── Cucumber: "N scenarios (X passed, Y failed)" ──
  // Cucumber also prints "M steps (...)" — we must use SCENARIOS, not steps
  const cucumberSummary = output.match(
    /(\d+)\s+scenarios?\s*\(([^)]+)\)/i,
  );
  if (cucumberSummary) {
    return parseCucumberFromStdout(output, cucumberSummary, projectPath);
  }

  // ── .NET: "Total tests: N  Passed: X  Failed: Y" ──
  const dotnetSummary = output.match(
    /Total tests:\s*(\d+)\s+Passed:\s*(\d+)\s+Failed:\s*(\d+)/i,
  );
  if (dotnetSummary) {
    return buildFromCounts(
      parseInt(dotnetSummary[2]!, 10),
      parseInt(dotnetSummary[3]!, 10),
      parseInt(dotnetSummary[1]!, 10) - parseInt(dotnetSummary[2]!, 10) - parseInt(dotnetSummary[3]!, 10),
      'Test',
    );
  }

  // ── Maven: "Tests run: N, Failures: X, Errors: Y, Skipped: Z" ──
  const mavenSummary = output.match(
    /Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i,
  );
  if (mavenSummary) {
    const total = parseInt(mavenSummary[1]!, 10);
    const failed = parseInt(mavenSummary[2]!, 10) + parseInt(mavenSummary[3]!, 10);
    const skipped = parseInt(mavenSummary[4]!, 10);
    const passed = total - failed - skipped;
    return buildFromCounts(passed, failed, skipped, 'Test');
  }

  // ── Mocha: "N passing (Xs)"  /  "M failing" ──
  const mochaPassSummary = output.match(/(\d+)\s+passing\s+\(\d+[ms]+\)/i);
  if (mochaPassSummary) {
    // Mocha detected via summary — but we should use line-level parsing if possible
    // Only use summary as fallback if line parsing produced steps instead of tests
    return [];
  }

  return [];
}

// ── Cucumber stdout ────────────────────────────────────────────────────────
//
// Cucumber "progress" formatter output has this structure:
//
// 1. Progress dots/markers: .F-.F- (no scenario names, just step results)
// 2. A "Failures:" section listing ONLY failed scenarios with their steps
// 3. Summary: "5 scenarios (3 failed, 2 passed)" / "21 steps (...)"
//
// Key insight: Passed scenarios DON'T appear with names anywhere except
// in the summary count. We parse the Failures section for failed scenarios
// (with step-level detail), then create passed entries from the count delta.
//
// Failure scenario format:
//   1) Scenario: User can search for a product # features/demo.feature:7
//      √ Before # src/hooks/hooks.ts:26
//      √ Given I am on Flipkart homepage # src/step-definitions/home.steps.ts:10
//      × When I search for "iPhone 15" # src/step-definitions/home.steps.ts:17
//          Error: safeType failed after 3 retries...
//          <multi-line error detail>
//      - Then I should see the search results page # src/step-definitions/home.steps.ts:37
//      √ After # src/hooks/hooks.ts:35

function parseCucumberFromStdout(output: string, summaryMatch: RegExpMatchArray, projectPath?: string): StoredTestCase[] {
  const tests: StoredTestCase[] = [];
  const lines = output.split('\n');

  // --- Phase 1: Parse the "Failures:" section for failed scenarios ---
  let inFailures = false;
  let currentScenario: {
    name: string;
    file?: string;
    steps: TestStep[];
    errorLines: string[];
    collectingError: boolean;
  } | null = null;

  const flushScenario = () => {
    if (!currentScenario) return;

    // Apply collected error lines to the last failed step
    if (currentScenario.collectingError && currentScenario.steps.length > 0) {
      applyErrorToLastFailedStep(currentScenario.steps, currentScenario.errorLines);
      currentScenario.errorLines = [];
    }

    const steps = currentScenario.steps;
    const hasFailed = steps.some(s => s.status === 'failed');
    const allSkipped = steps.length > 0 && steps.every(s => s.status === 'skipped');
    const failedStep = steps.find(s => s.status === 'failed');

    // Build scenario error from the first failed step's error
    let scenarioError: string | undefined;
    if (failedStep?.errorMessage) {
      scenarioError = failedStep.errorMessage;
    }

    tests.push({
      name: currentScenario.name,
      file: currentScenario.file,
      status: hasFailed ? 'failed' : allSkipped ? 'skipped' : 'passed',
      errorMessage: scenarioError,
      steps: steps.length > 0 ? steps : undefined,
    });
    currentScenario = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Detect start of Failures section
    if (/^\s*Failures:\s*$/.test(line)) {
      inFailures = true;
      continue;
    }

    // Detect end of Failures section (summary line)
    if (inFailures && /^\d+\s+scenarios?\s*\(/.test(line)) {
      flushScenario();
      inFailures = false;
      continue;
    }

    if (!inFailures) continue;

    // Numbered scenario line: "1) Scenario: Name # features/file.feature:7"
    // Also handles "Scenario Outline:"
    const scenarioLine = line.match(
      /^\s*\d+\)\s+Scenario(?:\s+Outline)?:\s*(.+?)(?:\s+#\s+(\S+))?$/,
    );
    if (scenarioLine) {
      flushScenario();
      currentScenario = {
        name: scenarioLine[1]!.trim(),
        file: scenarioLine[2] || undefined,
        steps: [],
        errorLines: [],
        collectingError: false,
      };
      continue;
    }

    if (!currentScenario) continue;

    // Step line with marker: "   √ Given I am on Flipkart homepage # src/steps.ts:10"
    // Markers: √ ✓ ✔ (passed), × ✗ ✘ (failed), - (skipped), ? (undefined/pending)
    // Also handles Before/After hooks — we skip those
    const stepLine = line.match(
      /^\s{3,}([√✓✔×✗✘?-])\s+(Given|When|Then|And|But|Before|After)\s+(.*?)(?:\s+#\s+(\S+))?$/i,
    );
    if (stepLine) {
      // If we were collecting error lines, apply them first
      if (currentScenario.collectingError) {
        applyErrorToLastFailedStep(currentScenario.steps, currentScenario.errorLines);
        currentScenario.errorLines = [];
        currentScenario.collectingError = false;
      }

      const [, marker, keyword, stepName] = stepLine;

      // Skip Before/After hooks — they're not real scenario steps
      if (/^(Before|After)$/i.test(keyword!)) continue;

      let status: TestStep['status'];
      if (marker === '√' || marker === '✓' || marker === '✔') status = 'passed';
      else if (marker === '×' || marker === '✗' || marker === '✘') status = 'failed';
      else if (marker === '-') status = 'skipped';
      else if (marker === '?') status = 'undefined';
      else status = 'passed';

      currentScenario.steps.push({
        keyword: keyword!,
        name: stepName!.trim(),
        status,
      });

      // If this step failed, start collecting error lines
      if (status === 'failed') {
        currentScenario.collectingError = true;
      }
      continue;
    }

    // Error lines: indented text after a failed step (6+ spaces indentation)
    // These are multi-line error messages, stack traces, call logs etc.
    if (currentScenario.collectingError && line.trim().length > 0) {
      // Check it's indented enough (error detail) and not a new step/scenario
      if (/^\s{6,}/.test(line)) {
        currentScenario.errorLines.push(line.trim());
        continue;
      }
      // If we hit a non-indented, non-empty line that's not a step,
      // it might be something else — stop collecting errors
      if (!/^\s{3,}[√✓✔×✗✘?-]\s/.test(line)) {
        // Check if it's not empty or blank — might be error continuation
        // Some error messages have varied indentation
        if (/^\s{4,}/.test(line)) {
          currentScenario.errorLines.push(line.trim());
          continue;
        }
      }
    }
  }

  // Flush last scenario in failures section
  flushScenario();

  // --- Phase 2: Figure out passed/skipped scenarios ---
  // The summary tells us total counts, and we have the failed ones with detail.
  // Passed scenarios don't appear in the Failures section, so we get their
  // names + steps from .feature files.
  const countsStr = summaryMatch[2]!;
  let totalPassed = 0;
  let totalSkipped = 0;
  const pm = countsStr.match(/(\d+)\s+passed/);
  const sm = countsStr.match(/(\d+)\s+skipped/);
  const pendm = countsStr.match(/(\d+)\s+pending/);
  const undefm = countsStr.match(/(\d+)\s+undefined/);
  if (pm) totalPassed = parseInt(pm[1]!, 10);
  if (sm) totalSkipped = parseInt(sm[1]!, 10);
  if (pendm) totalSkipped += parseInt(pendm[1]!, 10);
  if (undefm) totalSkipped += parseInt(undefm[1]!, 10);

  const parsedPassed = tests.filter(t => t.status === 'passed').length;
  const parsedSkipped = tests.filter(t => t.status === 'skipped').length;

  // Get scenario data (name + steps) from .feature files
  const featureScenarios = projectPath ? scanFeatureFiles(projectPath) : [];
  const parsedNames = new Set(tests.map(t => t.name));
  let addedPassed = 0;

  for (const scenario of featureScenarios) {
    if (addedPassed >= totalPassed - parsedPassed) break;
    if (parsedNames.has(scenario.name)) continue;

    // This scenario passed — add it with all steps marked as passed
    const passedSteps: TestStep[] = scenario.steps.map(s => ({
      keyword: s.keyword,
      name: s.name,
      status: 'passed' as const,
    }));

    tests.push({
      name: scenario.name,
      suite: scenario.feature || undefined,
      file: scenario.file || undefined,
      status: 'passed',
      steps: passedSteps.length > 0 ? passedSteps : undefined,
    });
    parsedNames.add(scenario.name);
    addedPassed++;
  }

  // Fill remaining passed/skipped with generic names if we couldn't find real names
  const remainPassed = totalPassed - parsedPassed - addedPassed;
  for (let i = 0; i < remainPassed; i++) {
    tests.push({ name: `Passed Scenario ${parsedPassed + addedPassed + i + 1}`, status: 'passed' });
  }
  const remainSkipped = totalSkipped - parsedSkipped;
  for (let i = 0; i < remainSkipped; i++) {
    tests.push({ name: `Skipped Scenario ${parsedSkipped + i + 1}`, status: 'skipped' });
  }

  return tests;
}

/**
 * Apply collected error lines to the most recent failed step.
 */
function applyErrorToLastFailedStep(steps: TestStep[], errorLines: string[]): void {
  if (errorLines.length === 0) return;
  // Find the last failed step
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i]!.status === 'failed') {
      steps[i]!.errorMessage = errorLines.join('\n');
      return;
    }
  }
}

/** Scenario data extracted from a .feature file */
export interface FeatureScenario {
  name: string;
  feature?: string;
  file?: string;
  steps: Array<{ keyword: string; name: string }>;
}

/**
 * Recursively scan project for .feature files and extract all scenarios
 * with their steps (keyword + name). This gives us full step detail for
 * passed scenarios that don't appear in Cucumber's Failures section.
 */
export function scanFeatureFiles(dir: string, depth = 0): FeatureScenario[] {
  if (depth > 5) return []; // Safety limit
  const scenarios: FeatureScenario[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      // Skip common non-test directories
      if (/^(node_modules|\.git|dist|build|coverage|__pycache__)$/.test(entry)) continue;
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          scenarios.push(...scanFeatureFiles(fullPath, depth + 1));
        } else if (entry.endsWith('.feature')) {
          scenarios.push(...parseFeatureFile(fullPath));
        }
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* skip unreadable dirs */ }
  return scenarios;
}

/**
 * Parse a single .feature file and extract scenarios with their steps.
 * Handles Feature, Background, Scenario, Scenario Outline, and step lines.
 */
export function parseFeatureFile(filePath: string): FeatureScenario[] {
  const scenarios: FeatureScenario[] = [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let currentFeature = '';
    let backgroundSteps: Array<{ keyword: string; name: string }> = [];
    let inBackground = false;
    let currentScenario: FeatureScenario | null = null;

    const flush = () => {
      if (currentScenario) {
        // Prepend background steps to scenario steps
        currentScenario.steps = [...backgroundSteps, ...currentScenario.steps];
        scenarios.push(currentScenario);
        currentScenario = null;
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines, comments, tags, doc strings, data tables
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')
        || trimmed.startsWith('|') || trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        continue;
      }

      // Feature line
      const featureM = trimmed.match(/^Feature:\s*(.+)/);
      if (featureM) {
        flush();
        currentFeature = featureM[1]!.trim();
        backgroundSteps = [];
        inBackground = false;
        continue;
      }

      // Background
      if (/^Background:/.test(trimmed)) {
        flush();
        inBackground = true;
        backgroundSteps = [];
        continue;
      }

      // Scenario or Scenario Outline
      const scenarioM = trimmed.match(/^Scenario(?:\s+Outline)?:\s*(.+)/);
      if (scenarioM) {
        flush();
        inBackground = false;
        currentScenario = {
          name: scenarioM[1]!.trim(),
          feature: currentFeature || undefined,
          file: filePath,
          steps: [],
        };
        continue;
      }

      // Step line (Given/When/Then/And/But)
      const stepM = trimmed.match(/^(Given|When|Then|And|But)\s+(.+)/i);
      if (stepM) {
        const step = { keyword: stepM[1]!, name: stepM[2]!.trim() };
        if (inBackground) {
          backgroundSteps.push(step);
        } else if (currentScenario) {
          currentScenario.steps.push(step);
        }
        continue;
      }
    }

    flush();
  } catch { /* skip unreadable files */ }
  return scenarios;
}

// ── Playwright stdout patterns ──────────────────────────────────────────────

function parsePlaywrightLines(output: string): StoredTestCase[] {
  const tests: StoredTestCase[] = [];

  // Playwright format: ✓  1 [chromium] › test.spec.ts:5:1 › should work (1.5s)
  // The "›" separator with file:line pattern is unique to Playwright
  const pattern = /([✓✗✘×·])\s+\d+\s+(?:\[([\w-]+)\]\s+)?›\s+([\w./-]+(?::\d+:\d+)?)\s+›\s+(.+?)(?:\s+\((\d+(?:\.\d+)?[ms]+)\))?$/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const [, statusChar, browserProject, file, name, duration] = match;
    tests.push({
      name: name!.trim(),
      file: file || undefined,
      status: statusChar === '✓' ? 'passed' : statusChar === '·' ? 'skipped' : 'failed',
      duration: parseDuration(duration),
      browser: normalizeBrowserName(browserProject),
    });
  }

  return tests;
}

// ── Mocha/Jest stdout patterns ─────────────────────────────────────────────
// KEY FIX: Skip BDD step lines (Given/When/Then/And/But)

function parseMochaJestLines(output: string): StoredTestCase[] {
  const tests: StoredTestCase[] = [];

  const passPattern = /^\s+[✓✔]\s+(.+?)(?:\s+\((\d+)ms\))?$/gm;
  const failPattern = /^\s+[✗✘×]\s+(.+?)$/gm;
  const pendPattern = /^\s+-\s+(.+?)$/gm;

  let match: RegExpExecArray | null;
  while ((match = passPattern.exec(output)) !== null) {
    const text = match[1]!.trim();
    if (isBddStep(text)) continue;
    tests.push({ name: text, status: 'passed', duration: match[2] ? parseInt(match[2], 10) : undefined });
  }
  while ((match = failPattern.exec(output)) !== null) {
    const text = match[1]!.trim();
    if (isBddStep(text)) continue;
    tests.push({ name: text, status: 'failed' });
  }
  while ((match = pendPattern.exec(output)) !== null) {
    const text = match[1]!.trim();
    if (isBddStep(text)) continue;
    tests.push({ name: text, status: 'skipped' });
  }

  return tests;
}

// ── pytest stdout patterns ──────────────────────────────────────────────────

function parsePytestLines(output: string): StoredTestCase[] {
  const tests: StoredTestCase[] = [];
  const pattern = /^([\w/.]+\.py)::(\S+)\s+(PASSED|FAILED|SKIPPED|ERROR)/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const [, file, name, result] = match;
    tests.push({
      name: name!,
      file: file || undefined,
      status: result === 'PASSED' ? 'passed' : result === 'FAILED' ? 'failed' : result === 'SKIPPED' ? 'skipped' : 'error',
    });
  }

  return tests;
}

// ── Generic patterns ────────────────────────────────────────────────────────

function parseGenericLines(output: string): StoredTestCase[] {
  const tests: StoredTestCase[] = [];
  const pattern = /^\s*(PASS|FAIL|OK|ERROR|SKIP)\S*[\s:]+(.+?)$/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const [, result, name] = match;
    if (isBddStep(name!)) continue;
    const status = result === 'PASS' || result === 'OK' ? 'passed'
      : result === 'FAIL' ? 'failed'
        : result === 'SKIP' ? 'skipped' : 'error';
    tests.push({ name: name!.trim(), status });
  }

  return tests;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if text looks like a BDD step (Given/When/Then/And/But).
 * These are sub-steps of a scenario, not individual tests.
 */
function isBddStep(text: string): boolean {
  return /^(Given|When|Then|And|But|After|Before)\s/i.test(text);
}

/**
 * Build test case array from simple pass/fail/skip counts.
 */
function buildFromCounts(passed: number, failed: number, skipped: number, label: string): StoredTestCase[] {
  const tests: StoredTestCase[] = [];
  for (let i = 0; i < passed; i++) tests.push({ name: `${label} ${i + 1}`, status: 'passed' });
  for (let i = 0; i < failed; i++) tests.push({ name: `Failed ${label} ${i + 1}`, status: 'failed' });
  for (let i = 0; i < skipped; i++) tests.push({ name: `Skipped ${label} ${i + 1}`, status: 'skipped' });
  return tests;
}

function parseDuration(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  const num = parseFloat(duration);
  if (duration.includes('ms')) return Math.round(num);
  if (duration.includes('s')) return Math.round(num * 1000);
  if (duration.includes('m')) return Math.round(num * 60000);
  return Math.round(num);
}
