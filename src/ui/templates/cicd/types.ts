/**
 * Shared CI/CD template types used by all platform generators.
 */

export type CICDPlatform = 'github-actions' | 'gitlab-ci' | 'jenkins' | 'azure-pipelines' | 'bitbucket' | 'circleci';

export interface CICDOptions {
  // Runtime versions
  nodeVersion?: string;
  pythonVersion?: string;
  javaVersion?: string;
  dotnetVersion?: string;

  // Trigger configuration
  triggers?: Array<'push' | 'pull_request' | 'schedule' | 'manual'>;
  branches?: string[];
  cronSchedule?: string;

  // Execution options
  parallel?: boolean;
  shardCount?: number;
  timeout?: number;
  headless?: boolean;
  useDocker?: boolean;

  // Artifact options
  uploadArtifacts?: boolean;
  artifactRetention?: number;

  // Custom env vars
  envVars?: Record<string, string>;
}

export interface CICDDetectedConfig {
  platform: CICDPlatform;
  fileName: string;
  filePath: string;        // relative path from project root
  exists: boolean;
}

export interface CICDGenerateResult {
  content: string;
  fileName: string;
  filePath: string;        // relative path where it should be saved
  platform: CICDPlatform;
  framework: string | null;
}

export interface CICDPlatformInfo {
  id: CICDPlatform;
  name: string;
  icon: string;
  description: string;
  configFile: string;
  configPath: string;
}
