import type { CICDOptions } from './types.js';

/**
 * Generate GitHub Actions workflow YAML for a given test framework.
 */
export function generateGitHubActions(framework: string | null, options: CICDOptions): string {
  const fw = framework?.toLowerCase() ?? 'npm';
  const nodeVersion = options.nodeVersion ?? '20';
  const branches = options.branches ?? ['main'];
  const branchList = branches.map(b => `      - ${b}`).join('\n');

  const triggers = buildTriggers(options, branchList);
  const setup = buildSetupSteps(fw, nodeVersion, options);
  const testStep = buildTestStep(fw, options);
  const artifacts = buildArtifacts(fw, options);

  return `name: ${getWorkflowName(fw)}

on:
${triggers}

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: ${options.timeout ?? 30}
${buildStrategy(fw, options)}
    steps:
      - uses: actions/checkout@v4

${setup}
${testStep}
${artifacts}`;
}

function getWorkflowName(fw: string): string {
  const names: Record<string, string> = {
    playwright: 'Playwright Tests',
    cypress: 'Cypress Tests',
    jest: 'Jest Tests',
    vitest: 'Vitest Tests',
    mocha: 'Mocha Tests',
    pytest: 'Python Tests (pytest)',
    robot: 'Robot Framework Tests',
    cucumber: 'Cucumber BDD Tests',
    maven: 'Maven Tests',
    dotnet: '.NET Tests',
    webdriverio: 'WebdriverIO Tests',
    puppeteer: 'Puppeteer Tests',
  };
  return names[fw] ?? 'Test Suite';
}

function buildTriggers(options: CICDOptions, branchList: string): string {
  const triggers = options.triggers ?? ['push', 'pull_request'];
  const parts: string[] = [];

  if (triggers.includes('push')) {
    parts.push(`  push:\n    branches:\n${branchList}`);
  }
  if (triggers.includes('pull_request')) {
    parts.push(`  pull_request:\n    branches:\n${branchList}`);
  }
  if (triggers.includes('schedule')) {
    parts.push(`  schedule:\n    - cron: '${options.cronSchedule ?? '0 6 * * *'}'`);
  }
  if (triggers.includes('manual')) {
    parts.push('  workflow_dispatch:');
  }
  return parts.join('\n');
}

function buildStrategy(fw: string, options: CICDOptions): string {
  if (fw === 'playwright' && options.parallel && (options.shardCount ?? 1) > 1) {
    return `    strategy:
      fail-fast: false
      matrix:
        shard: [${Array.from({ length: options.shardCount ?? 4 }, (_, i) => i + 1).join(', ')}]
`;
  }
  return '';
}

function buildSetupSteps(fw: string, nodeVersion: string, options: CICDOptions): string {
  // Python-based frameworks
  if (fw === 'pytest' || fw === 'robot') {
    const pyVer = options.pythonVersion ?? '3.11';
    return `      - uses: actions/setup-python@v5
        with:
          python-version: '${pyVer}'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt`;
  }

  // Java-based
  if (fw === 'maven') {
    const javaVer = options.javaVersion ?? '17';
    return `      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '${javaVer}'
          cache: 'maven'`;
  }

  // .NET
  if (fw === 'dotnet') {
    const dotnetVer = options.dotnetVersion ?? '8.0';
    return `      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '${dotnetVer}'

      - name: Restore dependencies
        run: dotnet restore`;
  }

  // Node.js-based frameworks
  let steps = `      - uses: actions/setup-node@v4
        with:
          node-version: ${nodeVersion}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci`;

  // Browser install steps
  if (fw === 'playwright') {
    steps += `

      - name: Install Playwright Browsers
        run: npx playwright install --with-deps`;
  } else if (fw === 'cypress') {
    // cypress-io/github-action handles install
    steps = `      - uses: actions/setup-node@v4
        with:
          node-version: ${nodeVersion}
          cache: 'npm'`;
  }

  return steps;
}

function buildTestStep(fw: string, options: CICDOptions): string {
  const envVars = buildEnvBlock(fw, options);

  switch (fw) {
    case 'playwright': {
      const shard = options.parallel && (options.shardCount ?? 1) > 1
        ? ` --shard=\${{ matrix.shard }}/${options.shardCount}`
        : '';
      return `
      - name: Run Playwright tests
        run: npx playwright test${shard}${envVars}`;
    }
    case 'cypress':
      return `
      - name: Run Cypress tests
        uses: cypress-io/github-action@v6
        with:
          install: true
          browser: chrome
          headed: false${envVars}`;
    case 'jest':
      return `
      - name: Run Jest tests
        run: npx jest --ci --coverage${envVars}`;
    case 'vitest':
      return `
      - name: Run Vitest tests
        run: npx vitest run --coverage${envVars}`;
    case 'mocha':
      return `
      - name: Run Mocha tests
        run: npx mocha --reporter json --reporter-option output=test-results.json${envVars}`;
    case 'pytest':
      return `
      - name: Run pytest
        run: pytest --junitxml=test-results.xml --html=report.html --self-contained-html${envVars}`;
    case 'robot':
      return `
      - name: Run Robot Framework tests
        run: robot --outputdir results .${envVars}`;
    case 'cucumber':
      return `
      - name: Run Cucumber tests
        run: npx cucumber-js --format json:reports/cucumber-report.json --format html:reports/cucumber-report.html${envVars}`;
    case 'maven':
      return `
      - name: Run Maven tests
        run: mvn test -B${envVars}`;
    case 'dotnet':
      return `
      - name: Run .NET tests
        run: dotnet test --logger "trx;LogFileName=test-results.trx" --collect:"XPlat Code Coverage"${envVars}`;
    case 'webdriverio':
      return `
      - name: Run WebdriverIO tests
        run: npx wdio run wdio.conf.js${envVars}`;
    case 'puppeteer':
      return `
      - name: Run Puppeteer tests
        run: npx jest --ci${envVars}`;
    default:
      return `
      - name: Run tests
        run: npm test${envVars}`;
  }
}

function buildEnvBlock(fw: string, options: CICDOptions): string {
  const envLines: string[] = [];
  if (fw === 'playwright' || fw === 'cypress' || fw === 'puppeteer' || fw === 'webdriverio') {
    envLines.push('          CI: true');
  }
  if (options.envVars) {
    for (const [k, v] of Object.entries(options.envVars)) {
      envLines.push(`          ${k}: ${v}`);
    }
  }
  if (envLines.length === 0) return '';
  return `\n        env:\n${envLines.join('\n')}`;
}

function buildArtifacts(fw: string, options: CICDOptions): string {
  if (!options.uploadArtifacts) return '';

  const artifactMap: Record<string, { name: string; path: string }> = {
    playwright: { name: 'playwright-report', path: 'playwright-report/\n            test-results/' },
    cypress: { name: 'cypress-artifacts', path: 'cypress/videos/\n            cypress/screenshots/' },
    jest: { name: 'test-results', path: 'coverage/' },
    vitest: { name: 'test-results', path: 'coverage/' },
    pytest: { name: 'test-results', path: 'test-results.xml\n            report.html' },
    robot: { name: 'robot-results', path: 'results/' },
    cucumber: { name: 'cucumber-reports', path: 'reports/' },
    maven: { name: 'surefire-reports', path: 'target/surefire-reports/' },
    dotnet: { name: 'test-results', path: 'TestResults/' },
  };

  const artifact = artifactMap[fw];
  if (!artifact) return '';

  return `
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: ${artifact.name}
          path: |
            ${artifact.path}
          retention-days: ${options.artifactRetention ?? 30}`;
}
