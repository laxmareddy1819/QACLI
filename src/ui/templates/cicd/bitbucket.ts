import type { CICDOptions } from './types.js';

/**
 * Generate Bitbucket Pipelines YAML for a given test framework.
 */
export function generateBitbucket(framework: string | null, options: CICDOptions): string {
  const fw = framework?.toLowerCase() ?? 'npm';
  const nodeVersion = options.nodeVersion ?? '20';

  const image = getImage(fw, nodeVersion, options);
  const pipeline = buildPipeline(fw, options);

  return `image: ${image}

pipelines:
  default:
    - step:
        name: Run Tests
${pipeline}`;
}

function getImage(fw: string, nodeVersion: string, options: CICDOptions): string {
  switch (fw) {
    case 'pytest':
    case 'robot':
      return `python:${options.pythonVersion ?? '3.11'}`;
    case 'maven':
      return `maven:3.9-eclipse-temurin-${options.javaVersion ?? '17'}`;
    case 'dotnet':
      return `mcr.microsoft.com/dotnet/sdk:${options.dotnetVersion ?? '8.0'}`;
    default:
      return `node:${nodeVersion}`;
  }
}

function buildPipeline(fw: string, options: CICDOptions): string {
  const caches = getCaches(fw);
  const script = getScript(fw, options);
  const artifacts = getArtifacts(fw, options);

  return `${caches}        script:
${script}${artifacts}`;
}

function getCaches(fw: string): string {
  switch (fw) {
    case 'pytest':
    case 'robot':
      return '        caches:\n          - pip\n';
    case 'maven':
      return '        caches:\n          - maven\n';
    case 'dotnet':
      return '';
    default:
      return '        caches:\n          - node\n';
  }
}

function getScript(fw: string, options: CICDOptions): string {
  switch (fw) {
    case 'playwright':
      return `          - npm ci
          - npx playwright install --with-deps chromium
          - npx playwright test`;
    case 'cypress':
      return `          - npm ci
          - npx cypress run --browser chrome`;
    case 'jest':
      return `          - npm ci
          - npx jest --ci --coverage`;
    case 'vitest':
      return `          - npm ci
          - npx vitest run --coverage`;
    case 'mocha':
      return `          - npm ci
          - npx mocha`;
    case 'pytest':
      return `          - pip install -r requirements.txt
          - pytest --junitxml=test-results.xml`;
    case 'robot':
      return `          - pip install -r requirements.txt
          - robot --outputdir results .`;
    case 'cucumber':
      return `          - npm ci
          - npx cucumber-js --format json:reports/cucumber-report.json`;
    case 'maven':
      return '          - mvn test -B';
    case 'dotnet':
      return `          - dotnet restore
          - dotnet test --logger trx`;
    default:
      return `          - npm ci
          - npm test`;
  }
}

function getArtifacts(fw: string, options: CICDOptions): string {
  if (!options.uploadArtifacts) return '';

  const paths: Record<string, string> = {
    playwright: '            - playwright-report/**',
    cypress: '            - cypress/videos/**\n            - cypress/screenshots/**',
    jest: '            - coverage/**',
    vitest: '            - coverage/**',
    pytest: '            - test-results.xml',
    robot: '            - results/**',
    cucumber: '            - reports/**',
    maven: '            - target/surefire-reports/**',
  };

  const pathLines = paths[fw];
  if (!pathLines) return '';

  return `\n        artifacts:\n${pathLines}`;
}
