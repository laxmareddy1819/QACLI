import { readFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { glob } from 'glob';
import type { ToolRegistration } from './registry.js';
import { decodeHtmlEntities } from '../../utils/index.js';

export const grepTool: ToolRegistration = {
  category: 'search',
  definition: {
    name: 'grep',
    description:
      'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: {
          type: 'string',
          description: 'File or directory to search in (default: current directory)',
        },
        file_pattern: {
          type: 'string',
          description: 'Glob pattern to filter files (e.g., "**/*.ts")',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
        },
      },
      required: ['pattern'],
    },
  },
  handler: async (args, ctx) => {
    // Decode HTML entities that LLMs sometimes emit (e.g. &quot; &lt; &gt;)
    const decodedPattern = decodeHtmlEntities(args.pattern as string);
    const pattern = new RegExp(decodedPattern, 'gi');
    const searchPath = resolve(ctx.workingDirectory, (args.path as string) || '.');
    const filePattern = (args.file_pattern as string) || '**/*';
    const maxResults = (args.max_results as number) || 50;

    const files = await glob(filePattern, {
      cwd: searchPath,
      nodir: true,
      ignore: ['node_modules/**', 'dist/**', '.git/**', '*.min.*'],
    });

    const results: Array<{ file: string; line: number; content: string }> = [];

    for (const file of files) {
      if (results.length >= maxResults) break;

      try {
        const fullPath = join(searchPath, file);
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (pattern.test(lines[i]!)) {
            results.push({
              file: relative(ctx.workingDirectory, fullPath),
              line: i + 1,
              content: lines[i]!.trim(),
            });
          }
          pattern.lastIndex = 0;
        }
      } catch {
        // Skip binary or unreadable files
      }
    }

    if (results.length === 0) {
      return `No matches found for pattern: ${args.pattern}`;
    }

    return results
      .map((r) => `${r.file}:${r.line}: ${r.content}`)
      .join('\n');
  },
};

export const findReplaceTool: ToolRegistration = {
  category: 'search',
  definition: {
    name: 'find_replace',
    description:
      'Find and replace text across multiple files. Shows which files will be modified before applying changes.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to find' },
        replacement: { type: 'string', description: 'Replacement string' },
        file_pattern: {
          type: 'string',
          description: 'Glob pattern for files to process (e.g., "**/*.ts")',
        },
        path: { type: 'string', description: 'Directory to search in (default: current directory)' },
        dry_run: {
          type: 'boolean',
          description: 'If true, only show matches without modifying (default: false)',
        },
      },
      required: ['pattern', 'replacement', 'file_pattern'],
    },
  },
  handler: async (args, ctx) => {
    // Decode HTML entities that LLMs sometimes emit (e.g. &quot; &lt; &gt;)
    const decodedPattern = decodeHtmlEntities(args.pattern as string);
    const regex = new RegExp(decodedPattern, 'g');
    const replacement = decodeHtmlEntities(args.replacement as string);
    const searchPath = resolve(ctx.workingDirectory, (args.path as string) || '.');
    const dryRun = (args.dry_run as boolean) ?? false;

    const files = await glob(args.file_pattern as string, {
      cwd: searchPath,
      nodir: true,
      ignore: ['node_modules/**', 'dist/**', '.git/**'],
    });

    const modified: string[] = [];

    for (const file of files) {
      const fullPath = join(searchPath, file);
      try {
        const content = await readFile(fullPath, 'utf-8');
        if (regex.test(content)) {
          regex.lastIndex = 0;
          modified.push(file);
          if (!dryRun) {
            const updated = content.replace(regex, replacement);
            const { writeFile: wf } = await import('node:fs/promises');
            await wf(fullPath, updated, 'utf-8');
          }
          regex.lastIndex = 0;
        }
      } catch {
        // Skip unreadable files
      }
    }

    if (modified.length === 0) {
      return `No files matched the pattern: ${args.pattern}`;
    }

    const action = dryRun ? 'Would modify' : 'Modified';
    return `${action} ${modified.length} file(s):\n${modified.map((f) => `  - ${f}`).join('\n')}`;
  },
};

export const searchTools: ToolRegistration[] = [grepTool, findReplaceTool];
