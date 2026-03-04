import type { CICDOptions } from './types.js';

/**
 * Generate Jenkinsfile (Declarative Pipeline) for a given test framework.
 */
export function generateJenkinsfile(framework: string | null, options: CICDOptions): string {
  const fw = framework?.toLowerCase() ?? 'npm';
  const nodeVersion = options.nodeVersion ?? '20';

  const agent = getAgent(fw, nodeVersion, options);
  const tools = getTools(fw, nodeVersion, options);
  const environment = getEnvironment(fw, options);
  const stages = getStages(fw, options);
  const post = getPost(fw, options);

  return `pipeline {
${agent}
${tools}${environment}
    stages {
${stages}
    }
${post}
}
`;
}

function getAgent(fw: string, nodeVersion: string, options: CICDOptions): string {
  if (options.useDocker) {
    const image = getDockerImage(fw, nodeVersion, options);
    return `    agent {
        docker {
            image '${image}'
            args '--user root'
        }
    }`;
  }
  return '    agent any';
}

function getDockerImage(fw: string, nodeVersion: string, options: CICDOptions): string {
  switch (fw) {
    case 'playwright': return 'mcr.microsoft.com/playwright:v1.48.0-jammy';
    case 'pytest':
    case 'robot': return `python:${options.pythonVersion ?? '3.11'}`;
    case 'maven': return `maven:3.9-eclipse-temurin-${options.javaVersion ?? '17'}`;
    case 'dotnet': return `mcr.microsoft.com/dotnet/sdk:${options.dotnetVersion ?? '8.0'}`;
    default: return `node:${nodeVersion}`;
  }
}

function getTools(fw: string, nodeVersion: string, options: CICDOptions): string {
  if (options.useDocker) return '';
  switch (fw) {
    case 'maven':
      return `\n    tools {
        maven 'Maven-3.9'
        jdk 'JDK-${options.javaVersion ?? '17'}'
    }\n`;
    case 'pytest':
    case 'robot':
      return '';
    case 'dotnet':
      return '';
    default:
      return `\n    tools {
        nodejs 'Node-${nodeVersion}'
    }\n`;
  }
}

function getEnvironment(fw: string, options: CICDOptions): string {
  const vars: string[] = [];
  if (fw === 'playwright' || fw === 'cypress' || fw === 'puppeteer') {
    vars.push("        CI = 'true'");
  }
  if (options.envVars) {
    for (const [k, v] of Object.entries(options.envVars)) {
      vars.push(`        ${k} = '${v}'`);
    }
  }
  if (vars.length === 0) return '\n';
  return `
    environment {
${vars.join('\n')}
    }
`;
}

function getStages(fw: string, options: CICDOptions): string {
  const installStage = getInstallStage(fw, options);
  const testStage = getTestStage(fw, options);

  return `${installStage}

${testStage}`;
}

function getInstallStage(fw: string, options: CICDOptions): string {
  switch (fw) {
    case 'pytest':
    case 'robot':
      return `        stage('Install Dependencies') {
            steps {
                sh 'pip install -r requirements.txt'
            }
        }`;
    case 'maven':
      return `        stage('Build') {
            steps {
                sh 'mvn clean compile -B'
            }
        }`;
    case 'dotnet':
      return `        stage('Restore') {
            steps {
                sh 'dotnet restore'
            }
        }`;
    case 'playwright':
      return `        stage('Install') {
            steps {
                sh 'npm ci'
                sh 'npx playwright install --with-deps'
            }
        }`;
    default:
      return `        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }`;
  }
}

function getTestStage(fw: string, options: CICDOptions): string {
  const cmd = getTestCommand(fw);
  return `        stage('Test') {
            steps {
                sh '${cmd}'
            }
        }`;
}

function getTestCommand(fw: string): string {
  switch (fw) {
    case 'playwright': return 'npx playwright test';
    case 'cypress': return 'npx cypress run --browser chrome';
    case 'jest': return 'npx jest --ci --coverage';
    case 'vitest': return 'npx vitest run --coverage';
    case 'mocha': return 'npx mocha';
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

function getPost(fw: string, options: CICDOptions): string {
  if (!options.uploadArtifacts) return '';

  const junitPath = getJunitPath(fw);
  const archivePaths = getArchivePaths(fw);

  let post = '\n    post {\n        always {\n';
  if (junitPath) post += `            junit '${junitPath}'\n`;
  if (archivePaths) post += `            archiveArtifacts artifacts: '${archivePaths}', allowEmptyArchive: true\n`;
  post += '        }\n    }';
  return post;
}

function getJunitPath(fw: string): string | null {
  switch (fw) {
    case 'jest': return 'test-results.xml';
    case 'pytest': return 'test-results.xml';
    case 'maven': return 'target/surefire-reports/*.xml';
    case 'dotnet': return 'TestResults/*.trx';
    case 'robot': return 'results/output.xml';
    default: return null;
  }
}

function getArchivePaths(fw: string): string | null {
  switch (fw) {
    case 'playwright': return 'playwright-report/**';
    case 'cypress': return 'cypress/videos/**,cypress/screenshots/**';
    case 'cucumber': return 'reports/**';
    case 'robot': return 'results/**';
    default: return null;
  }
}
