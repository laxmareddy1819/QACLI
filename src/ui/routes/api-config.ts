import type { Express } from 'express';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { UIServerOptions } from '../server.js';

export function mountConfigRoutes(
  app: Express,
  options: UIServerOptions,
): void {
  const projectPath = options.projectPath;

  function safePath(relPath: string): string | null {
    const full = resolve(projectPath, relPath);
    if (!full.startsWith(projectPath)) return null;
    return full;
  }

  // GET /api/config/files — List detected config files
  app.get('/api/config/files', async (_req, res) => {
    try {
      const configs: Array<{ name: string; path: string; size: number }> = [];
      const configPatterns = [
        'playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs',
        'cypress.config.ts', 'cypress.config.js',
        'wdio.conf.ts', 'wdio.conf.js',
        'jest.config.ts', 'jest.config.js',
        'vitest.config.ts', 'vitest.config.js',
        'tsconfig.json', 'package.json',
        'pytest.ini', 'conftest.py', 'pyproject.toml',
        'pom.xml', 'build.gradle',
        '.mocharc.yml', '.mocharc.json',
        'codecept.conf.ts', 'codecept.conf.js',
        '.eslintrc.js', '.eslintrc.json', '.prettierrc',
      ];

      for (const name of configPatterns) {
        const fullPath = join(projectPath, name);
        if (existsSync(fullPath)) {
          const { stat } = await import('node:fs/promises');
          const s = await stat(fullPath);
          configs.push({ name, path: name, size: s.size });
        }
      }

      res.json({ configs });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/config/:filename — Read a config file
  app.get('/api/config/:filename', async (req, res) => {
    try {
      const fullPath = safePath(req.params.filename!);
      if (!fullPath) { res.status(403).json({ error: 'Invalid path' }); return; }

      if (!existsSync(fullPath)) {
        res.status(404).json({ error: 'Config file not found' });
        return;
      }

      const content = await readFile(fullPath, 'utf-8');
      res.json({ name: req.params.filename, content });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // PUT /api/config/:filename — Update a config file
  app.put('/api/config/:filename', async (req, res) => {
    try {
      const { content } = req.body;
      if (content === undefined) {
        res.status(400).json({ error: 'content required' });
        return;
      }

      const fullPath = safePath(req.params.filename!);
      if (!fullPath) { res.status(403).json({ error: 'Invalid path' }); return; }

      if (!existsSync(fullPath)) {
        res.status(404).json({ error: 'Config file not found' });
        return;
      }

      await writeFile(fullPath, content, 'utf-8');
      res.json({ name: req.params.filename, message: 'Config updated' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // GET /api/env — List environment files
  app.get('/api/env', async (_req, res) => {
    try {
      const envFiles: Array<{ name: string; path: string }> = [];

      // Root-level .env files
      const entries = await readdir(projectPath);
      for (const entry of entries) {
        if (entry === '.env' || entry.startsWith('.env.')) {
          envFiles.push({ name: entry, path: entry });
        }
      }

      // environments/ directory
      const envDir = join(projectPath, 'environments');
      if (existsSync(envDir)) {
        const envEntries = await readdir(envDir);
        for (const entry of envEntries) {
          envFiles.push({ name: entry, path: `environments/${entry}` });
        }
      }

      res.json({ envFiles });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/env/compare — Compare two environment files
  app.post('/api/env/compare', async (req, res) => {
    try {
      const { file1, file2 } = req.body;
      if (!file1 || !file2) {
        res.status(400).json({ error: 'file1 and file2 required' });
        return;
      }

      const path1 = safePath(file1);
      const path2 = safePath(file2);
      if (!path1 || !path2) { res.status(403).json({ error: 'Invalid path' }); return; }

      const content1 = existsSync(path1) ? await readFile(path1, 'utf-8') : '';
      const content2 = existsSync(path2) ? await readFile(path2, 'utf-8') : '';

      const vars1 = parseEnvFile(content1);
      const vars2 = parseEnvFile(content2);

      // Build comparison
      const allKeys = [...new Set([...Object.keys(vars1), ...Object.keys(vars2)])].sort();
      const comparison = allKeys.map(key => ({
        key,
        value1: maskSensitive(key, vars1[key]),
        value2: maskSensitive(key, vars2[key]),
        match: vars1[key] === vars2[key],
        onlyIn: vars1[key] !== undefined && vars2[key] === undefined ? 'file1'
          : vars1[key] === undefined && vars2[key] !== undefined ? 'file2'
          : 'both',
      }));

      res.json({ file1, file2, comparison });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}

function parseEnvFile(content: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      vars[key] = value;
    }
  }
  return vars;
}

function maskSensitive(key: string, value?: string): string | undefined {
  if (value === undefined) return undefined;
  const sensitivePatterns = /(?:password|secret|token|key|api_key|auth|credential)/i;
  if (sensitivePatterns.test(key) && value.length > 4) {
    return value.slice(0, 2) + '*'.repeat(value.length - 4) + value.slice(-2);
  }
  return value;
}
