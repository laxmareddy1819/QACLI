import type { ToolRegistration, ToolExecutionContext } from './registry.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// ── heal_project Tool ────────────────────────────────────────────────────────

export const healProjectTool: ToolRegistration = {
  category: 'healing',
  definition: {
    name: 'heal_project',
    description:
      'Inject self-healing capabilities into a test automation project. ' +
      'Detects the framework and language, generates healing library files, ' +
      'and writes them to the project. The generated code intercepts element-not-found ' +
      'errors, requests healed selectors from the qabot API, and retries automatically. ' +
      'Supported: Playwright (TS/JS), Selenium (Java, Python).',
    parameters: {
      type: 'object',
      properties: {
        project_path: {
          type: 'string',
          description: 'Absolute path to the test automation project root',
        },
        framework: {
          type: 'string',
          description:
            'Test framework (auto-detected if omitted): playwright, selenium, cypress, webdriverio',
        },
        language: {
          type: 'string',
          description:
            'Programming language (auto-detected if omitted): typescript, javascript, java, python, csharp',
        },
        healing_server_url: {
          type: 'string',
          description: 'qabot healing server URL (default: http://localhost:3700)',
        },
        confidence_threshold: {
          type: 'number',
          description: 'Minimum confidence threshold for healing (0-1, default: 0.7)',
        },
        ai_enabled: {
          type: 'boolean',
          description: 'Enable AI-powered healing fallback (default: true)',
        },
      },
      required: ['project_path'],
    },
  },
  handler: async (args, _context: ToolExecutionContext) => {
    const projectPath = resolve(args.project_path as string);
    let framework = args.framework as string | undefined;
    let language = args.language as string | undefined;
    const healingServerUrl = (args.healing_server_url as string) || 'http://localhost:3700';
    const confidenceThreshold = (args.confidence_threshold as number) ?? 0.7;
    const aiEnabled = (args.ai_enabled as boolean) ?? true;

    // Validate project path exists
    if (!existsSync(projectPath)) {
      return `Error: Project path does not exist: ${projectPath}`;
    }

    // Auto-detect framework and language if not provided
    if (!framework || !language) {
      const detected = await detectFramework(projectPath);
      if (!detected) {
        return `Error: Could not auto-detect test framework in ${projectPath}. Please specify --framework and --language explicitly.\n\nSupported combinations:\n- playwright + typescript/javascript\n- selenium + java\n- selenium + python`;
      }
      framework = framework || detected.framework;
      language = language || detected.language;
    }

    // Get the adapter
    const { getHealingAdapter, getSupportedAdapters } = await import('../../healing/adapters/index.js');
    const adapter = getHealingAdapter(framework, language);
    if (!adapter) {
      const supported = getSupportedAdapters()
        .map((a) => `  - ${a.framework} + ${a.language} (${a.displayName})`)
        .join('\n');
      return `Error: No healing adapter for ${framework} + ${language}.\n\nSupported combinations:\n${supported}`;
    }

    // Generate files
    const config = {
      healingServerUrl,
      confidenceThreshold,
      enableAIFallback: aiEnabled,
      snapshotScope: 'body' as const,
      projectPath,
    };
    const files = adapter.generate(config);

    // Write files to project
    const filesCreated: string[] = [];
    for (const [relativePath, content] of Object.entries(files)) {
      const fullPath = join(projectPath, relativePath);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(fullPath, content, 'utf-8');
      filesCreated.push(relativePath);
    }

    // Get integration instructions
    const instructions = adapter.getIntegrationInstructions(config);

    // Save injection record to database
    try {
      const { HealingStore } = await import('../../healing/store.js');
      const store = new HealingStore(projectPath);
      const existing = store.getInjectionByProject(projectPath);
      if (existing) {
        // Re-activate if previously removed
        if (existing.status === 'removed') {
          store.updateInjectionStatus(existing.id, 'active');
        }
      } else {
        store.saveInjection({
          projectPath,
          framework: framework!,
          language: language!,
          filesCreated,
          healingServerUrl,
          confidenceThreshold,
          aiEnabled,
          status: 'active',
        });
      }
      store.close();
    } catch (dbError) {
      // Non-critical — files are already written, but log for debugging
      console.error('[qabot-heal] Failed to save injection to DB:', dbError);
    }

    // Build result
    const result = [
      `Successfully injected ${adapter.displayName} self-healing into ${projectPath}`,
      '',
      `Files created (${filesCreated.length}):`,
      ...filesCreated.map((f) => `  - ${f}`),
      '',
      `Configuration:`,
      `  Server URL: ${healingServerUrl}`,
      `  Confidence: ${confidenceThreshold}`,
      `  AI Enabled: ${aiEnabled}`,
      '',
      instructions,
    ].join('\n');

    return result;
  },
};

// ── heal_status Tool ─────────────────────────────────────────────────────────

export const healStatusTool: ToolRegistration = {
  category: 'healing',
  definition: {
    name: 'heal_status',
    description:
      'Show self-healing statistics and status. Returns healing success rate, ' +
      'strategy breakdown, injected projects, and recent healing events.',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Number of days to include in analytics (default: 30)',
        },
      },
    },
  },
  handler: async (args) => {
    const days = (args.days as number) || 30;

    try {
      const { HealingStore } = await import('../../healing/store.js');
      const store = new HealingStore(process.cwd());

      const stats = store.getStats();
      const eventStats = store.getEventStats();
      const analytics = store.getAnalytics(days);
      const injections = store.getInjections('active');

      const lines = [
        `Self-Healing Status (last ${days} days)`,
        '─'.repeat(50),
        '',
        `Fingerprints stored: ${stats.total}`,
        `Total healing events: ${eventStats.total}`,
        `  Healed: ${eventStats.healed}`,
        `  Failed: ${eventStats.failed}`,
        `  Success rate: ${analytics.overallSuccessRate}%`,
        `  Avg confidence: ${analytics.averageConfidence}`,
        `  Avg duration: ${analytics.averageDurationMs}ms`,
        '',
      ];

      if (analytics.strategyBreakdown.length > 0) {
        lines.push('Strategy breakdown:');
        for (const s of analytics.strategyBreakdown) {
          lines.push(`  ${s.strategy}: ${s.count} events (${s.successRate}% success)`);
        }
        lines.push('');
      }

      if (analytics.frameworkBreakdown.length > 0) {
        lines.push('Framework breakdown:');
        for (const f of analytics.frameworkBreakdown) {
          lines.push(`  ${f.framework}: ${f.count} events (${f.successRate}% success)`);
        }
        lines.push('');
      }

      if (injections.length > 0) {
        lines.push(`Injected projects (${injections.length}):`);
        for (const inj of injections) {
          lines.push(`  - ${inj.projectPath} (${inj.framework}/${inj.language}) — ${inj.status}`);
        }
      } else {
        lines.push('No projects with healing injected yet.');
        lines.push('Use heal_project to inject self-healing into a test project.');
      }

      store.close();
      return lines.join('\n');
    } catch (error) {
      return `Error getting healing status: ${error}`;
    }
  },
};

export const healingTools: ToolRegistration[] = [healProjectTool, healStatusTool];

// ── Framework Detection ──────────────────────────────────────────────────────

async function detectFramework(
  projectPath: string,
): Promise<{ framework: string; language: string } | null> {
  // Check for Cucumber + Playwright combo FIRST (before plain Playwright)
  // Cucumber projects often have playwright.config.ts too, so we must detect this early
  const hasCucumberConfig = existsSync(join(projectPath, 'cucumber.js')) ||
    existsSync(join(projectPath, 'cucumber.mjs')) ||
    existsSync(join(projectPath, 'cucumber.cjs')) ||
    existsSync(join(projectPath, 'cucumber.yaml')) ||
    existsSync(join(projectPath, 'cucumber.yml')) ||
    existsSync(join(projectPath, '.cucumber.js'));
  const hasPlaywrightConfig = existsSync(join(projectPath, 'playwright.config.ts')) ||
    existsSync(join(projectPath, 'playwright.config.js'));

  if (hasCucumberConfig && hasPlaywrightConfig) {
    return { framework: 'playwright-cucumber', language: 'typescript' };
  }

  // Check for common config files
  const checks: Array<{ files: string[]; framework: string; language: string }> = [
    { files: ['playwright.config.ts', 'playwright.config.js'], framework: 'playwright', language: 'typescript' },
    { files: ['cypress.config.ts', 'cypress.config.js', 'cypress.json'], framework: 'cypress', language: 'typescript' },
    { files: ['wdio.conf.ts', 'wdio.conf.js'], framework: 'webdriverio', language: 'typescript' },
    { files: ['pom.xml'], framework: 'selenium', language: 'java' },
    { files: ['build.gradle', 'build.gradle.kts'], framework: 'selenium', language: 'java' },
    { files: ['conftest.py', 'pytest.ini', 'setup.py', 'pyproject.toml'], framework: 'selenium', language: 'python' },
  ];

  for (const check of checks) {
    for (const file of check.files) {
      if (existsSync(join(projectPath, file))) {
        return { framework: check.framework, language: check.language };
      }
    }
  }

  // Check package.json for framework dependencies
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const { readFileSync } = await import('node:fs');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // Cucumber + Playwright (BDD projects using Playwright as browser engine)
      if (allDeps['@cucumber/cucumber'] && (allDeps['@playwright/test'] || allDeps['playwright'])) {
        return { framework: 'playwright-cucumber', language: 'typescript' };
      }
      if (allDeps['@playwright/test'] || allDeps['playwright']) {
        return { framework: 'playwright', language: 'typescript' };
      }
      if (allDeps['cypress']) {
        return { framework: 'cypress', language: 'typescript' };
      }
      if (allDeps['webdriverio'] || allDeps['@wdio/cli']) {
        return { framework: 'webdriverio', language: 'typescript' };
      }
      if (allDeps['selenium-webdriver']) {
        return { framework: 'selenium', language: 'typescript' };
      }
    } catch {
      // Invalid package.json
    }
  }

  return null;
}
