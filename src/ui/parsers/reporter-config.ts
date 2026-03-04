import { join } from 'node:path';

/**
 * Returns additional CLI flags to inject structured output reporters
 * for known test frameworks.
 */
export function getReporterArgs(framework: string | null): string[] {
  switch (framework?.toLowerCase()) {
    case 'playwright':
      // Use list for human-readable streaming output + json for structured parsing.
      // PLAYWRIGHT_JSON_OUTPUT_NAME env var (set in api-runner.ts) redirects JSON
      // to a file so stdout stays clean — no raw JSON shown in the UI terminal.
      return ['--reporter=list,json'];
    case 'cypress':
      return ['--reporter', 'json'];
    case 'jest':
      return ['--json', '--outputFile=.qabot-results.json'];
    case 'vitest':
      return ['--reporter=json', '--outputFile=.qabot-results.json'];
    case 'mocha':
      return ['--reporter', 'json', '--reporter-option', 'output=.qabot-results.json'];
    case 'pytest':
      return ['--junit-xml=.qabot-results.xml'];
    case 'cucumber':
      // Use both progress formatter (for stdout parsing + human-readable output)
      // and JSON formatter (for structured result capture).
      // Multiple --format flags are supported by cucumber-js.
      return ['--format', 'progress', '--format', 'json:.qabot-results.json'];
    case 'robot':
      // Robot outputs output.xml by default
      return [];
    case 'maven':
      // Maven generates surefire XML by default
      return [];
    case 'dotnet':
      return ['--logger', 'trx;LogFileName=.qabot-results.trx'];
    default:
      return [];
  }
}

/**
 * Returns the path to the structured output file produced by getReporterArgs().
 */
export function getResultPath(framework: string | null, projectPath: string): string | null {
  switch (framework?.toLowerCase()) {
    case 'playwright':
      return join(projectPath, '.qabot-results.json');
    case 'jest':
    case 'vitest':
    case 'mocha':
    case 'cucumber':
      return join(projectPath, '.qabot-results.json');
    case 'pytest':
      return join(projectPath, '.qabot-results.xml');
    case 'robot':
      return join(projectPath, 'output.xml');
    case 'maven':
      return join(projectPath, 'target', 'surefire-reports');
    case 'dotnet':
      return join(projectPath, 'TestResults', '.qabot-results.trx');
    default:
      return null;
  }
}
