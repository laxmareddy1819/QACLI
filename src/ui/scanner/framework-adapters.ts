import { isWindows, getShell } from '../../utils/index.js';

/**
 * Build the test run command for a detected framework.
 * Extends the same pattern used in src/core/tools/test-runner.ts.
 */
export function buildRunCommand(
  framework: string | null,
  files?: string,
  extraArgs?: string,
): { command: string; shell: string; shellArgs: string[] } {
  const f = files || '';
  const args = extraArgs || '';
  let command: string;

  switch (framework?.toLowerCase()) {
    case 'playwright':
      command = `npx playwright test ${f} ${args}`.trim();
      break;
    case 'cypress':
      command = f
        ? `npx cypress run --spec "${f}" ${args}`.trim()
        : `npx cypress run ${args}`.trim();
      break;
    case 'jest':
      command = `npx jest ${f} ${args}`.trim();
      break;
    case 'vitest':
      command = `npx vitest run ${f} ${args}`.trim();
      break;
    case 'mocha':
      command = `npx mocha ${f} ${args}`.trim();
      break;
    case 'pytest':
      command = `pytest ${f} ${args}`.trim();
      break;
    case 'robot':
      command = `robot ${f || '.'}  ${args}`.trim();
      break;
    case 'cucumber':
      command = `npx cucumber-js ${f} ${args}`.trim();
      break;
    case 'maven':
      command = f
        ? `mvn test -Dtest="${f}" ${args}`.trim()
        : `mvn test ${args}`.trim();
      break;
    case 'dotnet':
      command = `dotnet test ${f} ${args}`.trim();
      break;
    case 'webdriverio':
      command = f
        ? `npx wdio run wdio.conf.js --spec ${f} ${args}`.trim()
        : `npx wdio run wdio.conf.js ${args}`.trim();
      break;
    case 'selenium':
      // Selenium doesn't have a standard runner; delegate to language-specific
      command = `npm test ${args}`.trim();
      break;
    case 'puppeteer':
      command = `npx jest ${f} ${args}`.trim();
      break;
    default:
      // Auto-detect: try npm test
      command = `npm test ${args}`.trim();
  }

  const shell = getShell();
  const shellArgs = isWindows() ? ['/c', command] : ['-c', command];

  return { command, shell, shellArgs };
}

/**
 * Map framework name to human-readable display name.
 */
export function getFrameworkDisplayName(framework: string | null): string {
  if (!framework) return 'Unknown';

  const names: Record<string, string> = {
    playwright: 'Playwright',
    cypress: 'Cypress',
    jest: 'Jest',
    vitest: 'Vitest',
    mocha: 'Mocha',
    pytest: 'pytest',
    robot: 'Robot Framework',
    cucumber: 'Cucumber',
    selenium: 'Selenium',
    webdriverio: 'WebdriverIO',
    puppeteer: 'Puppeteer',
    appium: 'Appium',
    maven: 'Maven (JUnit/TestNG)',
    dotnet: '.NET (NUnit/xUnit)',
  };

  return names[framework.toLowerCase()] || framework;
}
