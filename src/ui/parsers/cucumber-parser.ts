import { existsSync, readFileSync } from 'node:fs';
import type { StoredTestCase, TestStep } from '../types.js';
import { stripAnsi } from './strip-ansi.js';

interface CucumberFeature {
  name?: string;
  uri?: string;
  elements?: CucumberScenario[];
}

interface CucumberScenario {
  name?: string;
  type?: string;
  keyword?: string;
  steps?: CucumberStep[];
}

interface CucumberStep {
  keyword?: string;
  name?: string;
  result?: {
    status: string;
    duration?: number;
    error_message?: string;
  };
}

/**
 * Parse Cucumber JSON output format.
 * Returns scenarios (NOT individual steps) as test cases,
 * with steps embedded inside each scenario for drill-down.
 */
export function parseCucumberResults(
  resultPath: string | null,
  stdout: string,
): StoredTestCase[] {
  let data: CucumberFeature[] | null = null;

  // Try output file first
  if (resultPath && existsSync(resultPath)) {
    try {
      data = JSON.parse(readFileSync(resultPath, 'utf-8')) as CucumberFeature[];
    } catch { /* fall through */ }
  }

  // Try parsing from stdout
  if (!data) {
    try {
      const jsonStart = stdout.indexOf('[');
      if (jsonStart >= 0) {
        data = JSON.parse(stdout.slice(jsonStart)) as CucumberFeature[];
      }
    } catch { /* fall through */ }
  }

  if (!data || !Array.isArray(data)) return [];

  const tests: StoredTestCase[] = [];

  for (const feature of data) {
    if (!feature.elements) continue;

    for (const scenario of feature.elements) {
      if (scenario.type === 'background') continue;

      const rawSteps = scenario.steps || [];
      let totalDuration = 0;
      let scenarioStatus: StoredTestCase['status'] = 'passed';
      let errorMessage: string | undefined;
      const testSteps: TestStep[] = [];

      for (const step of rawSteps) {
        const stepDurationMs = step.result?.duration
          ? step.result.duration / 1_000_000  // Cucumber duration is in nanoseconds
          : undefined;

        if (stepDurationMs) totalDuration += stepDurationMs;

        const rawStatus = step.result?.status || 'undefined';
        let stepStatus: TestStep['status'];
        if (rawStatus === 'passed') stepStatus = 'passed';
        else if (rawStatus === 'failed') stepStatus = 'failed';
        else if (rawStatus === 'skipped') stepStatus = 'skipped';
        else if (rawStatus === 'pending') stepStatus = 'pending';
        else stepStatus = 'undefined';

        // Roll up to scenario status
        if (stepStatus === 'failed') {
          scenarioStatus = 'failed';
          if (!errorMessage) errorMessage = step.result?.error_message;
        } else if ((stepStatus === 'undefined' || stepStatus === 'pending' || stepStatus === 'skipped') && scenarioStatus !== 'failed') {
          scenarioStatus = 'skipped';
        }

        // Strip ANSI codes and extract stack trace from error message
        const rawStepError = step.result?.error_message;
        const { message: cleanStepError, stack: stepStack } = splitErrorAndStack(rawStepError);

        testSteps.push({
          keyword: (step.keyword || 'Step').trim(),
          name: step.name || '',
          status: stepStatus,
          duration: stepDurationMs != null ? Math.round(stepDurationMs) : undefined,
          errorMessage: cleanStepError,
        });
      }

      // Extract stack trace from the scenario-level error
      const { message: cleanError, stack: scenarioStack } = splitErrorAndStack(errorMessage);

      tests.push({
        name: scenario.name || 'Unknown Scenario',
        suite: feature.name || undefined,
        file: feature.uri || undefined,
        status: scenarioStatus,
        duration: Math.round(totalDuration),
        errorMessage: cleanError,
        stackTrace: scenarioStack,
        steps: testSteps.length > 0 ? testSteps : undefined,
      });
    }
  }

  return tests;
}

/**
 * Split a Cucumber error_message into a clean error message and a stack trace.
 * Cucumber's error_message field typically contains both the error text and the
 * full stack trace. We split at the first "    at " line (standard JS/TS stack).
 * Also strips ANSI codes from both parts.
 */
function splitErrorAndStack(raw: string | undefined): { message: string | undefined; stack: string | undefined } {
  if (!raw) return { message: undefined, stack: undefined };

  const cleaned = stripAnsi(raw);

  // Look for stack trace start: line beginning with "    at " (JS/TS)
  // or "  File " (Python), or "    at " after a blank line
  const stackPatterns = [
    /^(\s+at\s+)/m,         // JS/TS: "    at Object.<anonymous> (...)"
    /^(Traceback\s)/m,      // Python: "Traceback (most recent call last):"
    /^\s+(File\s+")/m,      // Python: '  File "/path/file.py"'
  ];

  for (const pattern of stackPatterns) {
    const match = cleaned.match(pattern);
    if (match?.index != null && match.index > 0) {
      const message = cleaned.slice(0, match.index).trim();
      const stack = cleaned.slice(match.index).trim();
      return {
        message: message || undefined,
        stack: stack || undefined,
      };
    }
  }

  // No stack trace found — return the whole thing as message
  return { message: cleaned, stack: undefined };
}
