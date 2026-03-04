import type { CICDOptions } from './types.js';

/**
 * Generate GitLab CI YAML for a given test framework.
 */
export function generateGitLabCI(framework: string | null, options: CICDOptions): string {
  const fw = framework?.toLowerCase() ?? 'npm';
  const nodeVersion = options.nodeVersion ?? '20';

  const image = getImage(fw, nodeVersion, options);
  const stages = getStages(fw);
  const beforeScript = getBeforeScript(fw, options);
  const testJob = getTestJob(fw, options);
  const artifacts = getArtifacts(fw, options);

  return `image: ${image}

stages:
${stages}
${beforeScript}
test:
  stage: test
${testJob}
${artifacts}
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == "${options.branches?.[0] ?? 'main'}"
`;
}

function getImage(fw: string, nodeVersion: string, options: CICDOptions): string {
  switch (fw) {
    case 'playwright':
      return `mcr.microsoft.com/playwright:v1.48.0-jammy`;
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

function getStages(fw: string): string {
  return '  - test';
}

function getBeforeScript(fw: string, options: CICDOptions): string {
  switch (fw) {
    case 'pytest':
    case 'robot':
      return `\nbefore_script:
  - pip install -r requirements.txt
`;
    case 'maven':
    case 'dotnet':
      return '';
    case 'cypress':
      return `\nbefore_script:
  - npm ci
  - npx cypress install
`;
    default:
      return `\nbefore_script:
  - npm ci
`;
  }
}

function getTestJob(fw: string, options: CICDOptions): string {
  switch (fw) {
    case 'playwright':
      return `  script:
    - npx playwright test`;
    case 'cypress':
      return `  script:
    - npx cypress run --browser chrome`;
    case 'jest':
      return `  script:
    - npx jest --ci --coverage`;
    case 'vitest':
      return `  script:
    - npx vitest run --coverage`;
    case 'mocha':
      return `  script:
    - npx mocha --reporter json --reporter-option output=test-results.json`;
    case 'pytest':
      return `  script:
    - pytest --junitxml=test-results.xml`;
    case 'robot':
      return `  script:
    - robot --outputdir results .`;
    case 'cucumber':
      return `  script:
    - npx cucumber-js --format json:reports/cucumber-report.json`;
    case 'maven':
      return `  script:
    - mvn test -B`;
    case 'dotnet':
      return `  script:
    - dotnet restore
    - dotnet test --logger "trx;LogFileName=test-results.trx"`;
    default:
      return `  script:
    - npm test`;
  }
}

function getArtifacts(fw: string, options: CICDOptions): string {
  if (!options.uploadArtifacts) return '';

  const pathMap: Record<string, string> = {
    playwright: '    paths:\n      - playwright-report/\n      - test-results/',
    cypress: '    paths:\n      - cypress/videos/\n      - cypress/screenshots/',
    jest: '    paths:\n      - coverage/',
    vitest: '    paths:\n      - coverage/',
    pytest: '    paths:\n      - test-results.xml\n    reports:\n      junit: test-results.xml',
    robot: '    paths:\n      - results/',
    cucumber: '    paths:\n      - reports/',
    maven: '    paths:\n      - target/surefire-reports/\n    reports:\n      junit: target/surefire-reports/*.xml',
    dotnet: '    paths:\n      - TestResults/',
  };

  const paths = pathMap[fw] ?? '';
  if (!paths) return '';

  return `  artifacts:
    when: always
${paths}
    expire_in: ${options.artifactRetention ?? 30} days
`;
}
