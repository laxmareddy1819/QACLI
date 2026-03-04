import { existsSync, readFileSync } from 'node:fs';
import type { StoredTestCase } from '../types.js';
import { stripAnsi } from './strip-ansi.js';

interface JestResult {
  numPassedTests?: number;
  numFailedTests?: number;
  numPendingTests?: number;
  testResults?: JestTestFile[];
}

interface JestTestFile {
  testFilePath?: string;
  testResults?: JestAssertion[];
}

interface JestAssertion {
  ancestorTitles?: string[];
  title?: string;
  fullName?: string;
  status: string;
  duration?: number;
  failureMessages?: string[];
  failureDetails?: Array<{ message?: string; stack?: string }>;
}

/**
 * Parse Jest/Vitest JSON output.
 * Works with both stdout JSON (--json) and output file (--outputFile).
 */
export function parseJestResults(
  resultPath: string | null,
  stdout: string,
): StoredTestCase[] {
  let data: JestResult | null = null;

  // Try output file first
  if (resultPath && existsSync(resultPath)) {
    try {
      data = JSON.parse(readFileSync(resultPath, 'utf-8')) as JestResult;
    } catch { /* fall through */ }
  }

  // Try parsing from stdout
  if (!data) {
    try {
      const jsonStart = stdout.indexOf('{');
      if (jsonStart >= 0) {
        data = JSON.parse(stdout.slice(jsonStart)) as JestResult;
      }
    } catch { /* fall through */ }
  }

  if (!data?.testResults) return [];

  const tests: StoredTestCase[] = [];

  for (const file of data.testResults) {
    if (!file.testResults) continue;

    for (const assertion of file.testResults) {
      const name = assertion.fullName || assertion.title || 'Unknown';
      const suite = assertion.ancestorTitles?.join(' > ') || undefined;

      const status = mapJestStatus(assertion.status);
      const rawError = assertion.failureMessages?.join('\n') || undefined;
      const rawStack = assertion.failureDetails?.[0]?.stack || undefined;
      const errorMessage = rawError ? stripAnsi(rawError) : undefined;
      const stackTrace = rawStack ? stripAnsi(rawStack) : undefined;

      tests.push({
        name,
        suite,
        file: file.testFilePath || undefined,
        status,
        duration: assertion.duration,
        errorMessage,
        stackTrace,
      });
    }
  }

  return tests;
}

function mapJestStatus(status: string): StoredTestCase['status'] {
  switch (status) {
    case 'passed': return 'passed';
    case 'failed': return 'failed';
    case 'pending':
    case 'skipped':
    case 'disabled':
    case 'todo': return 'skipped';
    default: return 'error';
  }
}
