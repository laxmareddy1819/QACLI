import type { Express } from 'express';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { ProjectScanner } from '../scanner/project-scanner.js';
import type { UIServerOptions } from '../server.js';
import { audit } from './audit-helper.js';
import {
  PLATFORMS,
  generateCICDConfig,
  type CICDPlatform,
  type CICDOptions,
  type CICDDetectedConfig,
} from '../templates/cicd/index.js';

export function mountCICDRoutes(
  app: Express,
  scanner: ProjectScanner,
  options: UIServerOptions,
): void {
  const { projectPath } = options;

  /**
   * GET /api/cicd/platforms — List all supported CI/CD platforms with metadata.
   */
  app.get('/api/cicd/platforms', (_req, res) => {
    res.json({ platforms: PLATFORMS });
  });

  /**
   * GET /api/cicd/detect — Detect existing CI/CD configs in the project.
   */
  app.get('/api/cicd/detect', async (_req, res) => {
    try {
      const detected: CICDDetectedConfig[] = [];

      // Check each platform's config file location
      for (const platform of PLATFORMS) {
        // For GitHub Actions, check for any .yml files in .github/workflows/
        if (platform.id === 'github-actions') {
          const workflowDir = join(projectPath, '.github', 'workflows');
          if (existsSync(workflowDir)) {
            // List yml files in the workflows directory
            const { readdirSync } = await import('node:fs');
            const files = readdirSync(workflowDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
            for (const file of files) {
              detected.push({
                platform: 'github-actions',
                fileName: file,
                filePath: `.github/workflows/${file}`,
                exists: true,
              });
            }
          }
        } else if (platform.id === 'circleci') {
          const configPath = join(projectPath, '.circleci', 'config.yml');
          if (existsSync(configPath)) {
            detected.push({
              platform: 'circleci',
              fileName: 'config.yml',
              filePath: '.circleci/config.yml',
              exists: true,
            });
          }
        } else {
          const fullPath = join(projectPath, platform.configPath);
          if (existsSync(fullPath)) {
            detected.push({
              platform: platform.id,
              fileName: platform.configFile,
              filePath: platform.configPath,
              exists: true,
            });
          }
        }
      }

      // Also detect the project framework for auto-selection
      const info = await scanner.getInfo();

      res.json({
        configs: detected,
        projectFramework: info.framework,
        hasCI: detected.length > 0,
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/cicd/generate — Generate a CI/CD config for a platform+framework.
   *
   * Body: { platform: CICDPlatform, framework?: string, options?: CICDOptions }
   * Returns: { content, fileName, filePath, platform, framework }
   */
  app.post('/api/cicd/generate', async (req, res) => {
    try {
      const { platform, framework, options: cicdOptions } = req.body as {
        platform: CICDPlatform;
        framework?: string;
        options?: CICDOptions;
      };

      if (!platform) {
        res.status(400).json({ error: 'platform is required' });
        return;
      }

      // Auto-detect framework if not specified
      let fw = framework ?? null;
      if (!fw) {
        const info = await scanner.getInfo();
        fw = info.framework;
      }

      const result = generateCICDConfig(platform, fw, cicdOptions ?? {});

      audit(req, 'cicd.generate', { resourceType: 'cicd', details: { platform, framework: fw } });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * POST /api/cicd/save — Save a generated config file to the project.
   *
   * Body: { filePath: string (relative), content: string }
   * Returns: { saved: true, fullPath: string }
   */
  app.post('/api/cicd/save', (req, res) => {
    try {
      const { filePath, content } = req.body as { filePath: string; content: string };

      if (!filePath || !content) {
        res.status(400).json({ error: 'filePath and content are required' });
        return;
      }

      const fullPath = join(projectPath, filePath);

      // Security: ensure we're writing within the project
      if (!fullPath.startsWith(projectPath)) {
        res.status(403).json({ error: 'Invalid path: outside project directory' });
        return;
      }

      // Ensure parent directory exists
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(fullPath, content, 'utf-8');

      res.json({ saved: true, fullPath: filePath });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });
}
