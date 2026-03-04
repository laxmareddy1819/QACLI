import { readFile, writeFile, mkdir, readdir, stat, unlink, rmdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { glob } from 'glob';
import type { ToolRegistration, ToolExecutionContext } from './registry.js';
import { decodeHtmlEntities } from '../../utils/index.js';

function resolvePath(filePath: string, ctx: ToolExecutionContext): string {
  if (filePath.startsWith('/') || filePath.match(/^[a-zA-Z]:\\/)) {
    return resolve(filePath);
  }
  return resolve(ctx.workingDirectory, filePath);
}

export const readFileTool: ToolRegistration = {
  category: 'filesystem',
  definition: {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content as text.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to read' },
        encoding: { type: 'string', description: 'File encoding (default: utf-8)' },
      },
      required: ['path'],
    },
  },
  handler: async (args, ctx) => {
    const filePath = resolvePath(args.path as string, ctx);
    const encoding = (args.encoding as BufferEncoding) || 'utf-8';
    const content = await readFile(filePath, encoding);
    return content;
  },
};

export const writeFileTool: ToolRegistration = {
  category: 'filesystem',
  definition: {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist, or overwrites it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  },
  handler: async (args, ctx) => {
    const filePath = resolvePath(args.path as string, ctx);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    // Decode HTML entities that LLMs sometimes emit (e.g. &quot; &lt; &gt;)
    const content = decodeHtmlEntities(args.content as string);
    await writeFile(filePath, content, 'utf-8');
    return `File written: ${filePath}`;
  },
};

export const editFileTool: ToolRegistration = {
  category: 'filesystem',
  definition: {
    name: 'edit_file',
    description:
      'Edit a file by replacing a specific string with another string. The old_string must be an exact match of existing content.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'The exact string to find and replace' },
        new_string: { type: 'string', description: 'The string to replace it with' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  handler: async (args, ctx) => {
    const filePath = resolvePath(args.path as string, ctx);
    const content = await readFile(filePath, 'utf-8');
    // Decode HTML entities that LLMs sometimes emit (e.g. &quot; &lt; &gt;)
    const oldStr = decodeHtmlEntities(args.old_string as string);
    const newStr = decodeHtmlEntities(args.new_string as string);

    if (!content.includes(oldStr)) {
      throw new Error(`String not found in file: "${oldStr.slice(0, 100)}..."`);
    }

    const updated = content.replace(oldStr, newStr);
    await writeFile(filePath, updated, 'utf-8');
    return `File edited: ${filePath}`;
  },
};

export const createDirectoryTool: ToolRegistration = {
  category: 'filesystem',
  definition: {
    name: 'create_directory',
    description: 'Create a directory (and parent directories if needed).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the directory to create' },
      },
      required: ['path'],
    },
  },
  handler: async (args, ctx) => {
    const dirPath = resolvePath(args.path as string, ctx);
    await mkdir(dirPath, { recursive: true });
    return `Directory created: ${dirPath}`;
  },
};

export const listDirectoryTool: ToolRegistration = {
  category: 'filesystem',
  definition: {
    name: 'list_directory',
    description: 'List files and directories in a given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list (default: current directory)' },
      },
    },
  },
  handler: async (args, ctx) => {
    const dirPath = resolvePath((args.path as string) || '.', ctx);
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    }));
    return items;
  },
};

export const globSearchTool: ToolRegistration = {
  category: 'filesystem',
  definition: {
    name: 'glob_search',
    description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.spec.js").',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern to match' },
        cwd: { type: 'string', description: 'Directory to search in (default: current directory)' },
      },
      required: ['pattern'],
    },
  },
  handler: async (args, ctx) => {
    const cwd = resolvePath((args.cwd as string) || '.', ctx);
    const files = await glob(args.pattern as string, {
      cwd,
      nodir: true,
      ignore: ['node_modules/**', 'dist/**', '.git/**'],
    });
    return files.map((f) => relative(cwd, join(cwd, f)));
  },
};

export const fileExistsTool: ToolRegistration = {
  category: 'filesystem',
  definition: {
    name: 'file_exists',
    description: 'Check if a file or directory exists at the given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to check' },
      },
      required: ['path'],
    },
  },
  handler: async (args, ctx) => {
    const filePath = resolvePath(args.path as string, ctx);
    const exists = existsSync(filePath);
    if (exists) {
      const s = await stat(filePath);
      return { exists: true, type: s.isDirectory() ? 'directory' : 'file', size: s.size };
    }
    return { exists: false };
  },
};

export const deleteFileTool: ToolRegistration = {
  category: 'filesystem',
  definition: {
    name: 'delete_file',
    description: 'Delete a file or empty directory.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
      },
      required: ['path'],
    },
  },
  handler: async (args, ctx) => {
    const filePath = resolvePath(args.path as string, ctx);
    const s = await stat(filePath);
    if (s.isDirectory()) {
      await rmdir(filePath);
    } else {
      await unlink(filePath);
    }
    return `Deleted: ${filePath}`;
  },
};

export const filesystemTools: ToolRegistration[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  createDirectoryTool,
  listDirectoryTool,
  globSearchTool,
  fileExistsTool,
  deleteFileTool,
];
