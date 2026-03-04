export function cypressTemplate(language = 'typescript'): Record<string, string> {
  const ext = language === 'typescript' ? 'ts' : 'js';

  return {
    [`package.json`]: JSON.stringify(
      {
        name: 'my-cypress-tests',
        version: '1.0.0',
        scripts: {
          'cy:open': 'cypress open',
          'cy:run': 'cypress run',
          test: 'cypress run',
        },
        devDependencies: {
          cypress: '^13.0.0',
          ...(language === 'typescript' ? { typescript: '^5.5.0' } : {}),
        },
      },
      null,
      2,
    ),

    [`cypress.config.${ext}`]: `import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    supportFile: 'cypress/support/e2e.${ext}',
    specPattern: 'cypress/e2e/**/*.cy.${ext}',
  },
});
`,

    [`cypress/e2e/example.cy.${ext}`]: `describe('Example Tests', () => {
  it('visits the app', () => {
    cy.visit('/');
    cy.get('body').should('be.visible');
  });

  it('has a title', () => {
    cy.visit('/');
    cy.title().should('not.be.empty');
  });
});
`,

    [`cypress/support/e2e.${ext}`]: `// Custom commands and global configuration
// https://docs.cypress.io/api/cypress-api/custom-commands
`,

    ['.gitignore']: `node_modules/
cypress/screenshots/
cypress/videos/
cypress/downloads/
`,
  };
}
