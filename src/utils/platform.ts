import { platform, homedir, arch, release, tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PlatformInfo {
  os: 'windows' | 'macos' | 'linux';
  arch: string;
  release: string;
  shell: string;
  home: string;
  tempDir: string;
  qabotDir: string;
}

export function isWindows(): boolean {
  return platform() === 'win32';
}

export function isMacOS(): boolean {
  return platform() === 'darwin';
}

export function isLinux(): boolean {
  return platform() === 'linux';
}

export function getShell(): string {
  if (isWindows()) {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/sh';
}

export function getQabotDir(projectPath?: string): string {
  if (projectPath) {
    return join(projectPath, '.qabot');
  }
  return join(homedir(), '.qabot');
}

export function getPlatformInfo(): PlatformInfo {
  const os = isWindows() ? 'windows' : isMacOS() ? 'macos' : 'linux';
  return {
    os,
    arch: arch(),
    release: release(),
    shell: getShell(),
    home: homedir(),
    tempDir: tmpdir(),
    qabotDir: getQabotDir(),
  };
}

export function getOsName(): string {
  const p = platform();
  if (p === 'win32') return 'Windows';
  if (p === 'darwin') return 'macOS';
  return 'Linux';
}
