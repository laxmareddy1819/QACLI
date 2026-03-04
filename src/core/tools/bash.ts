import { spawn } from 'node:child_process';
import { platform, arch, release, cpus, totalmem, freemem } from 'node:os';
import type { ToolRegistration } from './registry.js';
import { isWindows, getShell } from '../../utils/index.js';

export const runCommandTool: ToolRegistration = {
  category: 'system',
  definition: {
    name: 'run_command',
    description:
      'Execute a shell command and return its output. Use for running tests, installing packages, git operations, etc.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        cwd: { type: 'string', description: 'Working directory (default: current directory)' },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 120000)',
        },
      },
      required: ['command'],
    },
  },
  handler: async (args, ctx) => {
    const command = args.command as string;
    const cwd = (args.cwd as string) || ctx.workingDirectory;
    const timeout = (args.timeout as number) || 120000;

    return new Promise((resolve, reject) => {
      const shell = getShell();
      const shellArgs = isWindows() ? ['/c', command] : ['-c', command];

      const proc = spawn(shell, shellArgs, {
        cwd,
        timeout,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        reject(new Error(`Command failed to start: ${error.message}`));
      });

      proc.on('close', (code) => {
        const output = [
          stdout ? `STDOUT:\n${stdout.trim()}` : '',
          stderr ? `STDERR:\n${stderr.trim()}` : '',
          `Exit code: ${code}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        if (code !== 0) {
          // Throw so executeToolCall marks isError: true — the LLM will see
          // the full output and know it must fix the errors before proceeding.
          reject(new Error(`Command failed (exit code ${code}):\n${output}`));
        } else {
          resolve(output);
        }
      });
    });
  },
};

export const systemInfoTool: ToolRegistration = {
  category: 'system',
  definition: {
    name: 'system_info',
    description: 'Get information about the current system (OS, CPU, memory, etc.).',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  handler: async (_args, ctx) => {
    return {
      platform: platform(),
      arch: arch(),
      release: release(),
      cpus: cpus().length,
      totalMemory: `${Math.round(totalmem() / 1024 / 1024 / 1024)}GB`,
      freeMemory: `${Math.round(freemem() / 1024 / 1024 / 1024)}GB`,
      nodeVersion: process.version,
      workingDirectory: ctx.workingDirectory,
    };
  },
};

export const bashTools: ToolRegistration[] = [runCommandTool, systemInfoTool];
