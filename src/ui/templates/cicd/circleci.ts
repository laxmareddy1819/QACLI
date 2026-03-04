import type { CICDOptions } from './types.js';

/**
 * Generate CircleCI config YAML for a given test framework.
 */
export function generateCircleCI(framework: string | null, options: CICDOptions): string {
  const fw = framework?.toLowerCase() ?? 'npm';
  const nodeVersion = options.nodeVersion ?? '20';

  const executor = getExecutor(fw, nodeVersion, options);
  const jobs = buildJobs(fw, options, executor);
  const workflows = buildWorkflows(options);

  return `version: 2.1

${executor}

jobs:
${jobs}

workflows:
${workflows}`;
}

function getExecutor(fw: string, nodeVersion: string, options: CICDOptions): string {
  switch (fw) {
    case 'playwright':
      return `executors:
  test-executor:
    docker:
      - image: mcr.microsoft.com/playwright:v1.48.0-jammy`;
    case 'pytest':
    case 'robot':
      return `executors:
  test-executor:
    docker:
      - image: cimg/python:${options.pythonVersion ?? '3.11'}`;
    case 'maven':
      return `executors:
  test-executor:
    docker:
      - image: cimg/openjdk:${options.javaVersion ?? '17'}.0`;
    case 'dotnet':
      return `executors:
  test-executor:
    docker:
      - image: mcr.microsoft.com/dotnet/sdk:${options.dotnetVersion ?? '8.0'}`;
    default:
      return `executors:
  test-executor:
    docker:
      - image: cimg/node:${nodeVersion}`;
  }
}

function buildJobs(fw: string, options: CICDOptions, executor: string): string {
  const steps = getSteps(fw, options);
  const storeArtifacts = getStoreArtifacts(fw, options);
  const storeTests = getStoreTestResults(fw);

  return `  test:
    executor: test-executor
    steps:
      - checkout
${steps}${storeTests}${storeArtifacts}`;
}

function getSteps(fw: string, options: CICDOptions): string {
  switch (fw) {
    case 'playwright':
      return `      - run:
          name: Install dependencies
          command: npm ci
      - run:
          name: Install Playwright browsers
          command: npx playwright install --with-deps
      - run:
          name: Run tests
          command: npx playwright test`;
    case 'cypress':
      return `      - restore_cache:
          keys:
            - npm-deps-{{ checksum "package-lock.json" }}
      - run:
          name: Install dependencies
          command: npm ci
      - save_cache:
          key: npm-deps-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
      - run:
          name: Run Cypress tests
          command: npx cypress run --browser chrome`;
    case 'jest':
      return `      - restore_cache:
          keys:
            - npm-deps-{{ checksum "package-lock.json" }}
      - run:
          name: Install dependencies
          command: npm ci
      - save_cache:
          key: npm-deps-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
      - run:
          name: Run Jest tests
          command: npx jest --ci --coverage`;
    case 'vitest':
      return `      - restore_cache:
          keys:
            - npm-deps-{{ checksum "package-lock.json" }}
      - run:
          name: Install dependencies
          command: npm ci
      - save_cache:
          key: npm-deps-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
      - run:
          name: Run Vitest tests
          command: npx vitest run --coverage`;
    case 'pytest':
      return `      - run:
          name: Install dependencies
          command: pip install -r requirements.txt
      - run:
          name: Run pytest
          command: pytest --junitxml=test-results.xml`;
    case 'robot':
      return `      - run:
          name: Install dependencies
          command: pip install -r requirements.txt
      - run:
          name: Run Robot Framework tests
          command: robot --outputdir results .`;
    case 'cucumber':
      return `      - restore_cache:
          keys:
            - npm-deps-{{ checksum "package-lock.json" }}
      - run:
          name: Install dependencies
          command: npm ci
      - save_cache:
          key: npm-deps-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
      - run:
          name: Run Cucumber tests
          command: npx cucumber-js --format json:reports/cucumber-report.json`;
    case 'maven':
      return `      - restore_cache:
          keys:
            - maven-deps-{{ checksum "pom.xml" }}
      - run:
          name: Run Maven tests
          command: mvn test -B
      - save_cache:
          key: maven-deps-{{ checksum "pom.xml" }}
          paths:
            - ~/.m2`;
    case 'dotnet':
      return `      - run:
          name: Restore dependencies
          command: dotnet restore
      - run:
          name: Run tests
          command: dotnet test --logger trx`;
    default:
      return `      - restore_cache:
          keys:
            - npm-deps-{{ checksum "package-lock.json" }}
      - run:
          name: Install dependencies
          command: npm ci
      - save_cache:
          key: npm-deps-{{ checksum "package-lock.json" }}
          paths:
            - ~/.npm
      - run:
          name: Run tests
          command: npm test`;
  }
}

function getStoreTestResults(fw: string): string {
  const pathMap: Record<string, string> = {
    pytest: 'test-results.xml',
    maven: 'target/surefire-reports',
    jest: 'test-results.xml',
  };
  const path = pathMap[fw];
  if (!path) return '';
  return `
      - store_test_results:
          path: ${path}`;
}

function getStoreArtifacts(fw: string, options: CICDOptions): string {
  if (!options.uploadArtifacts) return '';

  const pathMap: Record<string, string> = {
    playwright: 'playwright-report',
    cypress: 'cypress/videos',
    cucumber: 'reports',
    robot: 'results',
    jest: 'coverage',
    vitest: 'coverage',
  };
  const path = pathMap[fw];
  if (!path) return '';

  return `
      - store_artifacts:
          path: ${path}`;
}

function buildWorkflows(options: CICDOptions): string {
  return `  test-workflow:
    jobs:
      - test`;
}
