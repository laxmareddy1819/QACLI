import type { ApiRequest, ApiResponse } from '../types/api-testing.js';

export interface ApiTestPromptOptions {
  requests: ApiRequest[];
  responses?: ApiResponse[];
  projectPath: string;
  frameworkHint?: string;
  testName?: string;
}

/**
 * Build a rich LLM prompt for generating framework-native API test code
 * from ad-hoc API request/response data.
 *
 * Follows the same pattern as buildCodegenPrompt() in src/recorder/formatter.ts
 * and buildNewTestPrompt() in src/ui/routes/api-ai.ts — the LLM reads existing
 * project files, discovers patterns, and generates framework-native code.
 */
export function buildApiTestPrompt(opts: ApiTestPromptOptions): string {
  const { requests, responses, projectPath, frameworkHint, testName } = opts;
  const MAX_ATTEMPTS = 3;

  // Format request details for the prompt
  const requestDetails = requests.map((req, i) => {
    const resp = responses?.[i];
    const lines: string[] = [];
    lines.push(`### Request ${i + 1}: ${req.method} ${req.url}`);
    lines.push(`- **Name:** ${req.name}`);
    lines.push(`- **Method:** ${req.method}`);
    lines.push(`- **URL:** ${req.url}`);

    if (req.headers.length > 0) {
      lines.push(`- **Headers:**`);
      for (const h of req.headers.filter(h => h.enabled)) {
        lines.push(`  - \`${h.key}: ${h.value}\``);
      }
    }

    if (req.queryParams.length > 0) {
      lines.push(`- **Query Params:**`);
      for (const p of req.queryParams.filter(p => p.enabled)) {
        lines.push(`  - \`${p.key}=${p.value}\``);
      }
    }

    if (req.body.type !== 'none') {
      lines.push(`- **Body Type:** ${req.body.type}`);
      if (req.body.raw) {
        const truncated = req.body.raw.length > 2000 ? req.body.raw.slice(0, 2000) + '\n...(truncated)' : req.body.raw;
        lines.push(`- **Body Content:**\n\`\`\`\n${truncated}\n\`\`\``);
      }
      if (req.body.graphqlVariables) {
        lines.push(`- **GraphQL Variables:**\n\`\`\`json\n${req.body.graphqlVariables}\n\`\`\``);
      }
    }

    if (req.auth.type !== 'none') {
      lines.push(`- **Auth Type:** ${req.auth.type}`);
      if (req.auth.type === 'bearer') lines.push(`  - Token: \`{{token}}\` (use variable substitution)`);
      if (req.auth.type === 'basic') lines.push(`  - Username/Password (use environment variables)`);
      if (req.auth.type === 'api-key') lines.push(`  - Key: \`${req.auth.apiKeyName}\` in ${req.auth.apiKeyIn || 'header'}`);
    }

    if (req.validations.length > 0) {
      lines.push(`- **Expected Validations:**`);
      for (const v of req.validations.filter(v => v.enabled)) {
        lines.push(`  - ${v.type}${v.target ? ` (${v.target})` : ''} ${v.operator} \`${v.expected}\``);
      }
    }

    if (resp) {
      lines.push(`\n#### Sample Response (for assertion reference)`);
      lines.push(`- **Status:** ${resp.status} ${resp.statusText}`);
      lines.push(`- **Duration:** ${resp.duration}ms`);

      // Include response body (truncated for very large responses)
      const truncBody = resp.body.length > 3000 ? resp.body.slice(0, 3000) + '\n...(truncated)' : resp.body;
      lines.push(`- **Response Body:**\n\`\`\`\n${truncBody}\n\`\`\``);

      // Include response headers
      const headerEntries = Object.entries(resp.headers);
      if (headerEntries.length > 0) {
        lines.push(`- **Response Headers:**`);
        for (const [k, v] of headerEntries.slice(0, 15)) {
          lines.push(`  - \`${k}: ${v}\``);
        }
      }
    }

    return lines.join('\n');
  }).join('\n\n');

  return `You are a test automation expert. The user has designed API test scenarios using the qabot API Testing workspace and wants you to generate **framework-native API test source code** that integrates with their existing test project.

## CRITICAL RULES (MUST FOLLOW)
1. **Generate REAL framework-native test code** — NOT pseudocode, NOT Postman collections, NOT standalone scripts
2. **Reuse existing project patterns** — match the project's test framework, assertion library, helper utilities, and coding style exactly
3. **DO NOT create new helper/utility files** unless absolutely necessary — use existing HTTP client wrappers, auth helpers, etc.
4. **The generated test must be executable** with the project's existing test runner command
5. **Use the project's existing assertion patterns** — if they use \`expect().toBe()\`, use that; if they use \`assert\`, use that
6. **Store secrets in environment variables** — never hardcode tokens/passwords in test code
7. **Match naming conventions** — file names, test descriptions, folder structure must follow project conventions

## API Requests to Convert to Tests

${requestDetails}

${testName ? `## Suggested Test Name: ${testName}` : ''}
${frameworkHint ? `## Framework Hint: ${frameworkHint}` : ''}

## Project Path: ${projectPath}

## MANDATORY WORKFLOW — Follow These Steps In Order

### Phase 1: Project Discovery (DO NOT SKIP)

You MUST thoroughly scan the project before writing any code.

**Step 1.1: Scan project structure**
- Use \`list_directory\` on the project root
- Use \`glob_search\` to find existing test files (\`**/*.spec.ts\`, \`**/*.test.ts\`, \`**/*.spec.js\`, \`**/*.test.js\`, \`**/*.py\`, \`**/*.java\`, \`**/*.cs\`)
- Use \`glob_search\` to find API test files specifically (\`**/*api*\`, \`**/*request*\`, \`**/*endpoint*\`)
- Use \`glob_search\` to find utility/helper files (\`**/utils/**\`, \`**/helpers/**\`, \`**/support/**\`)
- Read \`package.json\`, \`pom.xml\`, \`requirements.txt\`, or equivalent to identify framework

**Step 1.2: Identify API testing patterns**
- Search for existing API/HTTP test files — \`grep\` for \`request.get\`, \`cy.request\`, \`fetch\`, \`supertest\`, \`requests.get\`, \`RestAssured\`, \`HttpClient\`
- Read existing API test files to understand patterns (assertions, setup, teardown)
- Look for HTTP client wrappers, base URLs, auth helpers
- Identify how environment variables are used for API keys, base URLs, etc.

**Step 1.3: Understand project conventions**
- Read config file (playwright.config, cypress.config, jest.config, vitest.config, etc.)
- Read tsconfig/eslint/prettier configs to understand style requirements
- Note the test runner command (\`npx playwright test\`, \`npx cypress run\`, \`pytest\`, \`mvn test\`, etc.)

### Phase 2: Plan the Code

Based on your discovery:
1. **What can be reused?** — existing HTTP clients, auth helpers, base URLs, assertion patterns
2. **What needs to be created?** — new test file, potentially new API helper if none exists
3. **Where should the test go?** — match existing folder structure
4. **What test runner command?** — how to run just this test

Write your plan as a summary.

### Phase 3: Generate the Code

Create the test file(s) using \`write_file\` or \`edit_file\`:

**Framework-specific API testing patterns to follow:**

- **Playwright:** \`const response = await request.get(url)\`, \`expect(response.status()).toBe(200)\`, \`expect(await response.json()).toHaveProperty('id')\`
- **Cypress:** \`cy.request('GET', url).then(response => { expect(response.status).to.eq(200) })\`
- **Jest/Vitest + supertest:** \`const res = await request(app).get(url).expect(200)\`
- **Jest/Vitest + fetch:** \`const res = await fetch(url); expect(res.status).toBe(200)\`
- **Python/pytest + requests:** \`response = requests.get(url); assert response.status_code == 200\`
- **Java/RestAssured:** \`given().when().get(url).then().statusCode(200).body("id", equalTo(1))\`
- **C#/NUnit + HttpClient:** \`var response = await _client.GetAsync(url); Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK))\`

Include appropriate assertions for:
- Status code
- Response body structure (JSON path validation)
- Response headers if relevant
- Response time if validation rules were specified
- Content type

### Phase 4: Run & Verify

- Determine the correct test runner command from package.json/config
- Run ONLY the new test using framework-specific grep/filter
- Check if it passes

### Phase 5: Self-Healing Loop (up to ${MAX_ATTEMPTS} total attempts)

If the test fails:
1. Read the error output carefully
2. Re-read the test file and any relevant helpers
3. Diagnose the issue (wrong import, wrong assertion, missing setup, auth issue)
4. Fix the test using \`edit_file\`
5. Re-run and verify

Each attempt must try something different from the previous one.

## OUTPUT FORMAT

\`\`\`
### Project Analysis
[Summary of discovered framework, API testing patterns, reusable code]

### Plan
[What to reuse vs. create]

### Implementation
[Tool calls to create/modify files]

### Attempt 1 of ${MAX_ATTEMPTS}
[Test execution and results]

### Final Result
**Status:** PASS / FAIL
**Files created/modified:** [list]
**Test command:** [command to run the test]
**Reused from project:** [what existing code was leveraged]
\`\`\``;
}
