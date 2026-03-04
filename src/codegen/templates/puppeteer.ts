export function puppeteerTemplate(language = 'typescript'): Record<string, string> {
  const ext = language === 'typescript' ? 'ts' : 'js';

  return {
    [`package.json`]: JSON.stringify(
      {
        name: 'my-puppeteer-tests',
        version: '1.0.0',
        scripts: {
          test: 'jest',
        },
        devDependencies: {
          puppeteer: '^22.0.0',
          jest: '^29.0.0',
          ...(language === 'typescript'
            ? { typescript: '^5.5.0', 'ts-jest': '^29.0.0', '@types/jest': '^29.0.0' }
            : {}),
        },
      },
      null,
      2,
    ),

    [`tests/example.test.${ext}`]: `const puppeteer = require('puppeteer');

describe('Example Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: false });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  test('page loads', async () => {
    await page.goto('http://localhost:3000');
    const title = await page.title();
    expect(title).toBeDefined();
  });

  test('body is visible', async () => {
    await page.goto('http://localhost:3000');
    const body = await page.$('body');
    expect(body).not.toBeNull();
  });
});
`,

    ['.gitignore']: `node_modules/
coverage/
`,
  };
}
