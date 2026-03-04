/**
 * CI/CD template registry — central generator that dispatches to platform-specific templates.
 */

import { generateGitHubActions } from './github-actions.js';
import { generateGitLabCI } from './gitlab-ci.js';
import { generateJenkinsfile } from './jenkins.js';
import { generateAzurePipelines } from './azure-pipelines.js';
import { generateBitbucket } from './bitbucket.js';
import { generateCircleCI } from './circleci.js';
import type { CICDPlatform, CICDOptions, CICDGenerateResult, CICDPlatformInfo } from './types.js';

export type { CICDPlatform, CICDOptions, CICDGenerateResult, CICDPlatformInfo };
export type { CICDDetectedConfig } from './types.js';

/**
 * All supported CI/CD platforms with metadata.
 */
export const PLATFORMS: CICDPlatformInfo[] = [
  {
    id: 'github-actions',
    name: 'GitHub Actions',
    icon: 'github',
    description: 'Automate workflows directly in your GitHub repository',
    configFile: 'tests.yml',
    configPath: '.github/workflows/tests.yml',
  },
  {
    id: 'gitlab-ci',
    name: 'GitLab CI',
    icon: 'gitlab',
    description: 'Built-in CI/CD for GitLab repositories',
    configFile: '.gitlab-ci.yml',
    configPath: '.gitlab-ci.yml',
  },
  {
    id: 'jenkins',
    name: 'Jenkins',
    icon: 'server',
    description: 'Open-source automation server with pipeline support',
    configFile: 'Jenkinsfile',
    configPath: 'Jenkinsfile',
  },
  {
    id: 'azure-pipelines',
    name: 'Azure Pipelines',
    icon: 'cloud',
    description: 'CI/CD service for Azure DevOps',
    configFile: 'azure-pipelines.yml',
    configPath: 'azure-pipelines.yml',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket Pipelines',
    icon: 'git-branch',
    description: 'Integrated CI/CD for Bitbucket Cloud',
    configFile: 'bitbucket-pipelines.yml',
    configPath: 'bitbucket-pipelines.yml',
  },
  {
    id: 'circleci',
    name: 'CircleCI',
    icon: 'circle',
    description: 'Continuous integration and delivery platform',
    configFile: 'config.yml',
    configPath: '.circleci/config.yml',
  },
];

/**
 * Generate CI/CD configuration for a specific platform and framework.
 */
export function generateCICDConfig(
  platform: CICDPlatform,
  framework: string | null,
  options: CICDOptions = {},
): CICDGenerateResult {
  // Apply defaults
  const opts: CICDOptions = {
    triggers: ['push', 'pull_request'],
    branches: ['main'],
    uploadArtifacts: true,
    timeout: 30,
    artifactRetention: 30,
    ...options,
  };

  const platformInfo = PLATFORMS.find(p => p.id === platform);
  if (!platformInfo) {
    throw new Error(`Unknown CI/CD platform: ${platform}`);
  }

  let content: string;

  switch (platform) {
    case 'github-actions':
      content = generateGitHubActions(framework, opts);
      break;
    case 'gitlab-ci':
      content = generateGitLabCI(framework, opts);
      break;
    case 'jenkins':
      content = generateJenkinsfile(framework, opts);
      break;
    case 'azure-pipelines':
      content = generateAzurePipelines(framework, opts);
      break;
    case 'bitbucket':
      content = generateBitbucket(framework, opts);
      break;
    case 'circleci':
      content = generateCircleCI(framework, opts);
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  return {
    content,
    fileName: platformInfo.configFile,
    filePath: platformInfo.configPath,
    platform,
    framework,
  };
}
