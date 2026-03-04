import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { ScaffoldOptions, ScaffoldResult } from '../types/index.js';
import {
  playwrightTemplate,
  cypressTemplate,
  seleniumPythonTemplate,
  seleniumJavaTemplate,
  puppeteerTemplate,
  appiumTemplate,
} from './templates/index.js';

export class FrameworkScaffolder {
  async scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
    const { framework, language, projectPath, packageManager } = options;
    const filesCreated: string[] = [];

    try {
      // Create project directory
      if (!existsSync(projectPath)) {
        await mkdir(projectPath, { recursive: true });
      }

      let template: Record<string, string>;

      switch (framework) {
        case 'playwright':
          template = playwrightTemplate(language);
          break;
        case 'cypress':
          template = cypressTemplate(language);
          break;
        case 'selenium':
          template =
            language === 'java'
              ? seleniumJavaTemplate()
              : seleniumPythonTemplate();
          break;
        case 'puppeteer':
          template = puppeteerTemplate(language);
          break;
        case 'appium':
          template = appiumTemplate(language);
          break;
        default:
          template = playwrightTemplate(language);
      }

      // Write all template files
      for (const [filePath, content] of Object.entries(template)) {
        const fullPath = join(projectPath, filePath);
        const dir = join(projectPath, filePath.split('/').slice(0, -1).join('/'));
        if (dir && !existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }
        await writeFile(fullPath, content, 'utf-8');
        filesCreated.push(filePath);
      }

      const installCmd =
        packageManager === 'npm'
          ? 'npm install'
          : packageManager === 'yarn'
            ? 'yarn install'
            : 'pnpm install';

      return {
        success: true,
        filesCreated,
        instructions: `Project scaffolded! Next steps:\n  cd ${projectPath}\n  ${installCmd}\n  Then run your tests.`,
      };
    } catch (error) {
      return {
        success: false,
        filesCreated,
        instructions: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
