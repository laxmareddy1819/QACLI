export function appiumTemplate(language = 'typescript'): Record<string, string> {
  const ext = language === 'typescript' ? 'ts' : 'js';

  return {
    [`package.json`]: JSON.stringify(
      {
        name: 'my-appium-tests',
        version: '1.0.0',
        scripts: {
          test: 'npx wdio run wdio.conf.ts',
        },
        devDependencies: {
          '@wdio/cli': '^8.0.0',
          '@wdio/local-runner': '^8.0.0',
          '@wdio/mocha-framework': '^8.0.0',
          '@wdio/spec-reporter': '^8.0.0',
          '@wdio/appium-service': '^8.0.0',
          appium: '^2.0.0',
          ...(language === 'typescript' ? { typescript: '^5.5.0', 'ts-node': '^10.0.0' } : {}),
        },
      },
      null,
      2,
    ),

    [`wdio.conf.${ext}`]: `export const config = {
  runner: 'local',
  port: 4723,
  specs: ['./tests/**/*.spec.${ext}'],
  capabilities: [{
    platformName: 'Android',
    'appium:deviceName': 'emulator',
    'appium:app': './app.apk',
    'appium:automationName': 'UiAutomator2',
  }],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    timeout: 60000,
  },
  services: ['appium'],
};
`,

    [`tests/example.spec.${ext}`]: `describe('Example Mobile Test', () => {
  it('app launches', async () => {
    const element = await $('~app-root');
    await expect(element).toBeDisplayed();
  });
});
`,

    ['.gitignore']: `node_modules/
allure-results/
`,
  };
}
