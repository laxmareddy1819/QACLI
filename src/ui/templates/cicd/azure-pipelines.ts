import type { CICDOptions } from './types.js';

/**
 * Generate Azure Pipelines YAML for a given test framework.
 */
export function generateAzurePipelines(framework: string | null, options: CICDOptions): string {
  const fw = framework?.toLowerCase() ?? 'npm';
  const nodeVersion = options.nodeVersion ?? '20';

  const trigger = buildTrigger(options);
  const pool = '  vmImage: ubuntu-latest';
  const steps = buildSteps(fw, nodeVersion, options);

  return `trigger:
${trigger}

pool:
${pool}

${steps}`;
}

function buildTrigger(options: CICDOptions): string {
  const branches = options.branches ?? ['main'];
  return `  branches:\n    include:\n${branches.map(b => `      - ${b}`).join('\n')}`;
}

function buildSteps(fw: string, nodeVersion: string, options: CICDOptions): string {
  const setup = buildSetup(fw, nodeVersion, options);
  const test = buildTestStep(fw, options);
  const publish = buildPublishStep(fw, options);

  return `steps:
${setup}
${test}
${publish}`;
}

function buildSetup(fw: string, nodeVersion: string, options: CICDOptions): string {
  switch (fw) {
    case 'pytest':
    case 'robot':
      return `  - task: UsePythonVersion@0
    inputs:
      versionSpec: '${options.pythonVersion ?? '3.11'}'

  - script: |
      python -m pip install --upgrade pip
      pip install -r requirements.txt
    displayName: 'Install dependencies'`;

    case 'maven':
      return `  - task: JavaToolInstaller@0
    inputs:
      versionSpec: '${options.javaVersion ?? '17'}'
      jdkArchitectureOption: 'x64'
      jdkSourceOption: 'PreInstalled'`;

    case 'dotnet':
      return `  - task: UseDotNet@2
    inputs:
      packageType: 'sdk'
      version: '${options.dotnetVersion ?? '8.0.x'}'

  - script: dotnet restore
    displayName: 'Restore dependencies'`;

    case 'playwright':
      return `  - task: NodeTool@0
    inputs:
      versionSpec: '${nodeVersion}'

  - script: npm ci
    displayName: 'Install dependencies'

  - script: npx playwright install --with-deps
    displayName: 'Install Playwright browsers'`;

    default:
      return `  - task: NodeTool@0
    inputs:
      versionSpec: '${nodeVersion}'

  - script: npm ci
    displayName: 'Install dependencies'`;
  }
}

function buildTestStep(fw: string, options: CICDOptions): string {
  const cmd = getTestCommand(fw);
  const displayName = getDisplayName(fw);

  return `
  - script: ${cmd}
    displayName: '${displayName}'`;
}

function getTestCommand(fw: string): string {
  switch (fw) {
    case 'playwright': return 'npx playwright test';
    case 'cypress': return 'npx cypress run --browser chrome';
    case 'jest': return 'npx jest --ci --coverage';
    case 'vitest': return 'npx vitest run --coverage';
    case 'mocha': return 'npx mocha --reporter json';
    case 'pytest': return 'pytest --junitxml=test-results.xml';
    case 'robot': return 'robot --outputdir results .';
    case 'cucumber': return 'npx cucumber-js --format json:reports/cucumber-report.json';
    case 'maven': return 'mvn test -B';
    case 'dotnet': return 'dotnet test --logger trx';
    case 'webdriverio': return 'npx wdio run wdio.conf.js';
    case 'puppeteer': return 'npx jest --ci';
    default: return 'npm test';
  }
}

function getDisplayName(fw: string): string {
  const names: Record<string, string> = {
    playwright: 'Run Playwright tests',
    cypress: 'Run Cypress tests',
    jest: 'Run Jest tests',
    vitest: 'Run Vitest tests',
    mocha: 'Run Mocha tests',
    pytest: 'Run pytest',
    robot: 'Run Robot Framework tests',
    cucumber: 'Run Cucumber tests',
    maven: 'Run Maven tests',
    dotnet: 'Run .NET tests',
    webdriverio: 'Run WebdriverIO tests',
    puppeteer: 'Run Puppeteer tests',
  };
  return names[fw] ?? 'Run tests';
}

function buildPublishStep(fw: string, options: CICDOptions): string {
  if (!options.uploadArtifacts) return '';

  const junitStep = getJunitPublish(fw);
  const artifactStep = getArtifactPublish(fw, options);

  return `${junitStep}${artifactStep}`;
}

function getJunitPublish(fw: string): string {
  const paths: Record<string, string> = {
    pytest: 'test-results.xml',
    maven: '**/target/surefire-reports/TEST-*.xml',
    dotnet: '**/*.trx',
  };
  const path = paths[fw];
  if (!path) return '';

  const format = fw === 'dotnet' ? 'VSTest' : 'JUnit';
  return `
  - task: PublishTestResults@2
    condition: always()
    inputs:
      testResultsFormat: '${format}'
      testResultsFiles: '${path}'`;
}

function getArtifactPublish(fw: string, options: CICDOptions): string {
  const pathMap: Record<string, string> = {
    playwright: 'playwright-report',
    cypress: 'cypress/videos',
    cucumber: 'reports',
    robot: 'results',
  };
  const path = pathMap[fw];
  if (!path) return '';

  return `

  - task: PublishBuildArtifacts@1
    condition: always()
    inputs:
      PathtoPublish: '${path}'
      ArtifactName: 'test-artifacts'`;
}
