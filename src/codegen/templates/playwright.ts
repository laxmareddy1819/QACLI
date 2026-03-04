export function playwrightTemplate(language = 'typescript'): Record<string, string> {
  const ext = language === 'typescript' ? 'ts' : 'js';

  return {
    [`package.json`]: JSON.stringify(
      {
        name: 'my-playwright-tests',
        version: '1.0.0',
        scripts: {
          test: 'npx playwright test',
          'test:headed': 'npx playwright test --headed',
          'test:ui': 'npx playwright test --ui',
          report: 'npx playwright show-report',
        },
        devDependencies: {
          '@playwright/test': '^1.48.0',
          ...(language === 'typescript' ? { typescript: '^5.5.0' } : {}),
        },
      },
      null,
      2,
    ),

    [`playwright.config.${ext}`]: `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
`,

    [`tests/example.spec.${ext}`]: `import { test, expect } from '@playwright/test';

test.describe('Example Tests', () => {
  test('has title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.*$/);
  });

  test('navigation works', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });
});
`,

    [`tests/pages/BasePage.${ext}`]: `import { Page } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}

  async navigate(path: string) {
    await this.page.goto(path);
  }

  async getTitle() {
    return this.page.title();
  }
}
`,

    ['.gitignore']: `node_modules/
test-results/
playwright-report/
blob-report/
`,
  };
}
