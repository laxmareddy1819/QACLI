import type { ToolRegistration, ToolExecutionContext } from './registry.js';

// ── Tool Definitions ──────────────────────────────────────────────────────────

export const generateTestCodeTool: ToolRegistration = {
  category: 'codegen',
  definition: {
    name: 'generate_test_code',
    description:
      'Get context and guidelines for generating test code. Returns framework-specific guidelines. After calling this, use write_file to create the actual test file with the code you compose.',
    parameters: {
      type: 'object',
      properties: {
        framework: {
          type: 'string',
          description:
            'Test framework: playwright, cypress, selenium, puppeteer, jest, pytest',
        },
        language: {
          type: 'string',
          description: 'Programming language: typescript, javascript, python, java, csharp',
        },
        scenario: {
          type: 'string',
          description: 'Description of the test scenario',
        },
        base_url: {
          type: 'string',
          description: 'Base URL of the application under test',
        },
      },
      required: ['framework', 'scenario'],
    },
  },
  handler: async (args) => {
    const framework = args.framework as string;
    const language = (args.language as string) || 'typescript';
    const scenario = args.scenario as string;
    const baseUrl = (args.base_url as string) || 'http://localhost:3000';

    return `Ready to generate ${framework} test code in ${language}.
Scenario: ${scenario}
Base URL: ${baseUrl}

Guidelines:
- Use page object pattern when appropriate
- Add meaningful assertions with descriptive messages
- Use descriptive test names
- Handle async operations properly
- Follow ${framework} best practices
- Use data-testid, role, or label selectors over fragile CSS selectors

Next step: Compose the complete test code and use write_file to save it to the project.`;
  },
};

export const codegenTools: ToolRegistration[] = [generateTestCodeTool];
