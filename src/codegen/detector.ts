import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { glob } from 'glob';
import type { DetectedFramework, FrameworkName, ProgrammingLanguage } from '../types/index.js';

interface DetectionRule {
  framework: FrameworkName;
  language: ProgrammingLanguage;
  deps?: string[];
  configs?: string[];
  dirs?: string[];
  filePatterns?: string[];
  contentMatch?: string;
}

const RULES: DetectionRule[] = [
  {
    framework: 'playwright',
    language: 'typescript',
    deps: ['@playwright/test', 'playwright'],
    configs: ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'],
  },
  {
    framework: 'cypress',
    language: 'javascript',
    deps: ['cypress'],
    configs: ['cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs'],
    dirs: ['cypress'],
  },
  {
    framework: 'puppeteer',
    language: 'javascript',
    deps: ['puppeteer', 'puppeteer-core'],
  },
  {
    framework: 'webdriverio',
    language: 'typescript',
    deps: ['webdriverio', '@wdio/cli'],
    configs: ['wdio.conf.ts', 'wdio.conf.js'],
  },
  {
    framework: 'selenium',
    language: 'python',
    deps: ['selenium'],
    filePatterns: ['requirements.txt', 'setup.py', 'pyproject.toml'],
    contentMatch: 'selenium',
  },
  {
    framework: 'selenium',
    language: 'java',
    filePatterns: ['pom.xml'],
    contentMatch: 'selenium',
  },
  {
    framework: 'selenium',
    language: 'csharp',
    filePatterns: ['*.csproj'],
    contentMatch: 'Selenium',
  },
  {
    framework: 'selenium',
    language: 'javascript',
    deps: ['selenium-webdriver'],
  },
  {
    framework: 'appium',
    language: 'javascript',
    deps: ['appium', 'webdriverio'],
    configs: ['wdio.conf.ts', 'wdio.conf.js'],
  },
  {
    framework: 'jest',
    language: 'typescript',
    deps: ['jest', '@jest/core'],
    configs: ['jest.config.ts', 'jest.config.js', 'jest.config.mjs'],
  },
  {
    framework: 'vitest',
    language: 'typescript',
    deps: ['vitest'],
    configs: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'],
  },
  {
    framework: 'mocha',
    language: 'javascript',
    deps: ['mocha'],
    configs: ['.mocharc.yml', '.mocharc.json', '.mocharc.yaml'],
  },
  {
    framework: 'pytest',
    language: 'python',
    filePatterns: ['pytest.ini', 'setup.cfg', 'pyproject.toml'],
    contentMatch: 'pytest',
  },
  {
    framework: 'cucumber',
    language: 'javascript',
    deps: ['@cucumber/cucumber'],
    dirs: ['features'],
  },
  {
    framework: 'robot',
    language: 'python',
    filePatterns: ['*.robot'],
  },
];

export class FrameworkDetector {
  async detect(projectPath: string): Promise<DetectedFramework[]> {
    const detected: DetectedFramework[] = [];

    for (const rule of RULES) {
      const result = await this.checkRule(rule, projectPath);
      if (result) {
        detected.push(result);
      }
    }

    // Sort by confidence
    detected.sort((a, b) => b.confidence - a.confidence);

    // Deduplicate by framework
    const seen = new Set<string>();
    return detected.filter((d) => {
      const key = `${d.framework}-${d.language}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private async checkRule(
    rule: DetectionRule,
    projectPath: string,
  ): Promise<DetectedFramework | null> {
    let confidence = 0;
    let configFile: string | undefined;
    let testDirectory: string | undefined;

    // Check npm dependencies
    if (rule.deps) {
      const pkgPath = join(projectPath, 'package.json');
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
          };
          for (const dep of rule.deps) {
            if (allDeps[dep]) {
              confidence += 0.5;
              break;
            }
          }
        } catch {
          // Skip malformed package.json
        }
      }
    }

    // Check config files
    if (rule.configs) {
      for (const config of rule.configs) {
        if (existsSync(join(projectPath, config))) {
          confidence += 0.4;
          configFile = config;
          break;
        }
      }
    }

    // Check directories
    if (rule.dirs) {
      for (const dir of rule.dirs) {
        if (existsSync(join(projectPath, dir))) {
          confidence += 0.1;
          testDirectory = dir;
          break;
        }
      }
    }

    // Check file patterns with content matching
    if (rule.filePatterns && rule.contentMatch) {
      for (const pattern of rule.filePatterns) {
        const files = await glob(pattern, { cwd: projectPath, nodir: true });
        for (const file of files) {
          try {
            const content = readFileSync(join(projectPath, file), 'utf-8');
            if (content.includes(rule.contentMatch)) {
              confidence += 0.5;
              break;
            }
          } catch {
            // Skip unreadable files
          }
        }
      }
    } else if (rule.filePatterns) {
      const files = await glob(rule.filePatterns[0] || '', { cwd: projectPath, nodir: true });
      if (files.length > 0) {
        confidence += 0.3;
      }
    }

    if (confidence <= 0) return null;

    // Detect language more precisely
    const language = await this.detectLanguage(rule, projectPath);

    return {
      framework: rule.framework,
      language: language || rule.language,
      confidence: Math.min(confidence, 1.0),
      configFile,
      testDirectory,
    };
  }

  private async detectLanguage(
    rule: DetectionRule,
    projectPath: string,
  ): Promise<ProgrammingLanguage | null> {
    // Check for TypeScript config
    if (existsSync(join(projectPath, 'tsconfig.json'))) {
      if (rule.language === 'javascript') return 'typescript';
    }

    return null;
  }
}
