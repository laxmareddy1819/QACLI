import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ToolRegistration } from './registry.js';
import { isWindows, getShell } from '../../utils/index.js';

function runCmd(command: string, cwd: string, timeout: number): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const shell = getShell();
    const shellArgs = isWindows() ? ['/c', command] : ['-c', command];

    const proc = spawn(shell, shellArgs, {
      cwd,
      timeout,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
  });
}

export const runTestsTool: ToolRegistration = {
  category: 'testing',
  definition: {
    name: 'run_tests',
    description:
      'Run test files using the appropriate test framework. Auto-detects the framework or you can specify it.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'string',
          description: 'Test file(s) to run (space-separated, or glob pattern)',
        },
        framework: {
          type: 'string',
          description:
            'Test framework: playwright, cypress, jest, vitest, pytest, maven, dotnet (auto-detected if omitted)',
        },
        args: {
          type: 'string',
          description: 'Additional arguments to pass to the test runner',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (default: current directory)',
        },
      },
    },
  },
  handler: async (args, ctx) => {
    const cwd = resolve(ctx.workingDirectory, (args.cwd as string) || '.');
    const files = (args.files as string) || '';
    const framework = (args.framework as string) || '';
    const extraArgs = (args.args as string) || '';

    let command: string;

    switch (framework.toLowerCase()) {
      case 'playwright':
        command = `npx playwright test ${files} ${extraArgs}`.trim();
        break;
      case 'cypress':
        command = files
          ? `npx cypress run --spec "${files}" ${extraArgs}`.trim()
          : `npx cypress run ${extraArgs}`.trim();
        break;
      case 'jest':
        command = `npx jest ${files} ${extraArgs}`.trim();
        break;
      case 'vitest':
        command = `npx vitest run ${files} ${extraArgs}`.trim();
        break;
      case 'pytest':
        command = `pytest ${files} ${extraArgs}`.trim();
        break;
      case 'maven':
        command = files
          ? `mvn test -Dtest="${files}" ${extraArgs}`.trim()
          : `mvn test ${extraArgs}`.trim();
        break;
      case 'dotnet':
        command = `dotnet test ${files} ${extraArgs}`.trim();
        break;
      default:
        // Auto-detect from files or try npx playwright test
        if (files.includes('.spec.') || files.includes('.test.')) {
          command = `npx playwright test ${files} ${extraArgs}`.trim();
        } else {
          command = `npm test ${extraArgs}`.trim();
        }
    }

    const result = await runCmd(command, cwd, 300000);
    const output = [
      `Command: ${command}`,
      result.stdout ? `\nOutput:\n${result.stdout.trim()}` : '',
      result.stderr ? `\nErrors:\n${result.stderr.trim()}` : '',
      `\nExit code: ${result.exitCode}`,
    ]
      .filter(Boolean)
      .join('');

    return output;
  },
};

export const getTestResultsTool: ToolRegistration = {
  category: 'testing',
  definition: {
    name: 'get_test_results',
    description: 'Parse test results from a recent test run output or report file.',
    parameters: {
      type: 'object',
      properties: {
        report_file: {
          type: 'string',
          description: 'Path to test report file (JSON, JUnit XML)',
        },
        format: {
          type: 'string',
          description: 'Report format: json, junit, text (default: text)',
        },
      },
    },
  },
  handler: async (args, ctx) => {
    const reportFile = args.report_file as string;
    if (!reportFile) {
      return 'No report file specified. Run tests first with run_tests tool.';
    }

    const { readFile } = await import('node:fs/promises');
    const fullPath = resolve(ctx.workingDirectory, reportFile);

    try {
      const content = await readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      return `Could not read report file: ${error}`;
    }
  },
};

export const testRunnerTools: ToolRegistration[] = [runTestsTool, getTestResultsTool];
