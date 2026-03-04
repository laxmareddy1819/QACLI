import type { Express } from 'express';
import type { WebSocketServer, WebSocket } from 'ws';
import { readFileSync, existsSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { join, isAbsolute, relative, resolve } from 'node:path';
import type { UIServerOptions } from '../server.js';
import { audit } from './audit-helper.js';
import type { Orchestrator, PermissionCallback, ToolExecutionCallback } from '../../core/orchestrator.js';
import {
  pendingPermissions,
  setupPermissionHandler,
  broadcast,
  formatToolArgs,
  truncateResult,
  computeUnifiedDiff,
  diffLines,
  simpleDiff,
  streamScopedWithToolEvents,
  streamTextOnlyScoped,
} from './shared-streaming.js';

export function mountAIRoutes(
  app: Express,
  wss: WebSocketServer,
  options: UIServerOptions,
): void {
  const orchestrator = options.orchestrator;

  // POST /api/ai/generate — Generate test/page/step/api test
  app.post('/api/ai/generate', async (req, res) => {
    try {
      const { type, description, targetPath } = req.body;
      if (!description) {
        res.status(400).json({ error: 'description required' });
        return;
      }

      const prompts: Record<string, string> = {
        test: `Generate a test file for: ${description}${targetPath ? ` Save it to ${targetPath}` : ''}`,
        page: `Generate a page object class for: ${description}${targetPath ? ` Save it to ${targetPath}` : ''}`,
        step: `Generate Cucumber step definitions for: ${description}${targetPath ? ` Save it to ${targetPath}` : ''}`,
        api: `Generate an API test for: ${description}${targetPath ? ` Save it to ${targetPath}` : ''}`,
        data: `Generate test data for: ${description}${targetPath ? ` Save it to ${targetPath}` : ''}`,
      };

      const prompt = prompts[type] || prompts.test!;

      // Stream response through WebSocket
      streamAIResponse(orchestrator, wss, prompt);

      audit(req, 'ai.generate', { resourceType: 'ai', details: { type: type || 'test', description: description?.slice(0, 100) } });
      res.json({ status: 'streaming', type, description });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/fix — Fix a failing test
  app.post('/api/ai/fix', async (req, res) => {
    try {
      const { testPath, errorOutput } = req.body;
      if (!testPath || !errorOutput) {
        res.status(400).json({ error: 'testPath and errorOutput required' });
        return;
      }

      const prompt = `Analyze the failing test in "${testPath}" with this error output:\n\n\`\`\`\n${errorOutput}\n\`\`\`\n\nIdentify the root cause and fix the test.`;

      streamAIResponse(orchestrator, wss, prompt);

      audit(req, 'ai.fix', { resourceType: 'ai', details: { testPath } });
      res.json({ status: 'streaming', testPath });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/fix-failure — AI-powered fix for analyzed failure groups
  // Reads the actual test files, builds a rich prompt, and streams the response
  // scoped to a requestId so only the requesting panel receives chunks.
  // Tool execution events and permission prompts are routed through WebSocket.
  app.post('/api/ai/fix-failure', async (req, res) => {
    try {
      const { requestId, errorSignature, category, rootCause, suggestedFix, affectedTests, errorMessage } = req.body;
      if (!requestId || !errorSignature) {
        res.status(400).json({ error: 'requestId and errorSignature required' });
        return;
      }

      const testFiles: string[] = affectedTests || [];

      const prompt = buildFixFailurePrompt({
        errorSignature,
        category,
        rootCause,
        suggestedFix,
        affectedTests: testFiles,
        errorMessage: errorMessage || errorSignature,
        projectPath: options.projectPath,
      });

      // Stream with tool events and permission handling through WebSocket
      streamScopedWithToolEvents(orchestrator, wss, prompt, requestId);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/apply-fix — Implement the AI-suggested fix and re-run the affected test
  // Takes the AI fix content (markdown with code blocks) and tells the orchestrator
  // to apply the code changes using write_file/edit_file, then run the affected test.
  app.post('/api/ai/apply-fix', async (req, res) => {
    try {
      const { requestId, aiFixContent, affectedTests, errorSignature, originalCommand } = req.body;
      if (!requestId || !aiFixContent) {
        res.status(400).json({ error: 'requestId and aiFixContent required' });
        return;
      }

      const prompt = buildApplyFixPrompt({
        aiFixContent,
        affectedTests: affectedTests || [],
        errorSignature: errorSignature || '',
        projectPath: options.projectPath,
        originalCommand: originalCommand || '',
      });

      // Stream with full tool events & permissions so user sees file writes + test run in UI
      streamScopedWithToolEvents(orchestrator, wss, prompt, requestId);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/new-test — AI-powered new test creation with project analysis
  // Scans the existing project, reuses code, creates only what's new, runs & self-heals.
  app.post('/api/ai/new-test', async (req, res) => {
    try {
      const { requestId, prompt, context } = req.body;
      if (!requestId || !prompt) {
        res.status(400).json({ error: 'requestId and prompt required' });
        return;
      }

      const fullPrompt = buildNewTestPrompt({
        userPrompt: prompt,
        projectPath: options.projectPath,
        targetUrl: context?.targetUrl,
        frameworkHint: context?.frameworkHint,
        moduleHint: context?.moduleHint,
      });

      // Stream with full tool events & permissions so user sees project scanning, file writes, test runs
      streamScopedWithToolEvents(orchestrator, wss, fullPrompt, requestId);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/generate-api-test — Generate framework-native API test code from request/response data
  app.post('/api/ai/generate-api-test', async (req, res) => {
    try {
      const { requestId, apiRequests, responses, testName, frameworkHint } = req.body;
      if (!requestId || !apiRequests || !Array.isArray(apiRequests) || apiRequests.length === 0) {
        res.status(400).json({ error: 'requestId and apiRequests[] required' });
        return;
      }

      const { buildApiTestPrompt } = await import('../services/api-test-prompt-builder.js');
      const fullPrompt = buildApiTestPrompt({
        requests: apiRequests,
        responses: responses || undefined,
        projectPath: options.projectPath,
        frameworkHint: frameworkHint || undefined,
        testName: testName || undefined,
      });

      streamScopedWithToolEvents(orchestrator, wss, fullPrompt, requestId);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/generate-api-scenarios — AI-powered scenario generation from API spec/endpoints
  app.post('/api/ai/generate-api-scenarios', async (req, res) => {
    try {
      const { requestId, endpoints, specSummary, selectedEndpoints, existingCollections } = req.body;
      if (!requestId || !endpoints || !Array.isArray(endpoints) || endpoints.length === 0) {
        res.status(400).json({ error: 'requestId and endpoints[] required' });
        return;
      }

      const selected = selectedEndpoints || endpoints;
      const existingInfo = existingCollections && Array.isArray(existingCollections)
        ? existingCollections.map((c: any) => `- ${c.name} (${c.requestCount} requests)`).join('\n')
        : 'None';

      // Extract base URL context for the AI prompt
      const specBaseUrl = req.body.baseUrl || '';

      const prompt = `You are an API testing expert. Analyze the following API endpoints and generate meaningful, complete test scenarios with realistic data.

## API Endpoints
${selected.map((ep: any, i: number) => `${i + 1}. ${ep.method} ${ep.path} — ${ep.summary || ep.name || 'No description'}`).join('\n')}

${specBaseUrl ? `## API Base URL\nThe API server base URL is: ${specBaseUrl}\nA \`{{baseUrl}}\` environment variable has been configured with this value.\n` : ''}

## Existing Collections
${existingInfo}

## Your Task
Generate 3-5 test scenarios (flows) that cover real-world use cases. Each scenario is a folder of ordered API requests forming a logical flow.

Scenario types to consider:
1. **CRUD flows** — create → read → update → delete
2. **Authentication flows** — login → use token → protected resource → logout
3. **Error handling** — invalid input, missing fields, 404, 401
4. **Business workflows** — multi-step processes (e.g., place order → check status → cancel)
5. **Data dependency chains** — create parent → create child → verify relationships

## CRITICAL: URL Format
**ALL request URLs MUST be prefixed with \`{{baseUrl}}\`**. This is an environment variable that resolves to the API server address.
- Example: \`"url": "{{baseUrl}}/api/users"\` — CORRECT
- Example: \`"url": "/api/users"\` — WRONG (missing {{baseUrl}} prefix)
- Example: \`"url": "{{baseUrl}}/api/users/{{userId}}"\` — CORRECT (with path parameters)

## CRITICAL: Request Data Requirements
For EVERY request, you MUST generate:

### Bodies (for POST/PUT/PATCH)
- Generate **realistic sample data** with meaningful values (not empty or placeholder)
- Use the field name \`raw\` (NOT \`content\`) for the body string
- Example: \`"body": {"type": "json", "raw": "{\\"name\\": \\"John Doe\\", \\"email\\": \\"john@example.com\\", \\"role\\": \\"admin\\"}"}\`

### Validations (2-4 per request)
- Always validate status code
- Validate key response fields using \`body-json-path\` type
- Use operators: \`equals\`, \`exists\`, \`contains\`, \`greater-than\`
- Each validation needs a unique \`id\` like \`"v1"\`, \`"v2"\`

### Variable Extraction (postResponseScript)
- Extract IDs, tokens, and keys from responses to use in subsequent requests
- DSL: \`set("varName", jsonpath(response.body, "$.path.to.value"))\`
- Multiple extractions can be separated by newlines

### Variable Usage (preRequestScript)
- Use extracted variables in subsequent requests
- DSL: \`setHeader("Authorization", "Bearer " + get("token"))\`

## Output Format
Output ONLY a JSON object between <SCENARIOS_JSON> and </SCENARIOS_JSON> markers. No other text before or after the markers.

<SCENARIOS_JSON>
{
  "scenarios": [
    {
      "name": "User CRUD Flow",
      "description": "Create, read, update, and delete a user",
      "requests": [
        {
          "name": "Create User",
          "method": "POST",
          "url": "{{baseUrl}}/api/users",
          "headers": [{"key": "Content-Type", "value": "application/json", "enabled": true}],
          "queryParams": [],
          "body": {"type": "json", "raw": "{\\"name\\": \\"Jane Smith\\", \\"email\\": \\"jane@example.com\\", \\"password\\": \\"SecurePass123\\"}"},
          "auth": {"type": "none"},
          "validations": [
            {"id": "v1", "type": "status", "operator": "equals", "expected": "201", "enabled": true},
            {"id": "v2", "type": "body-json-path", "target": "$.id", "operator": "exists", "expected": "", "enabled": true},
            {"id": "v3", "type": "body-json-path", "target": "$.name", "operator": "equals", "expected": "Jane Smith", "enabled": true}
          ],
          "postResponseScript": "set(\\"userId\\", jsonpath(response.body, \\"$.id\\"))\\nset(\\"userEmail\\", jsonpath(response.body, \\"$.email\\"))",
          "followRedirects": true
        },
        {
          "name": "Get Created User",
          "method": "GET",
          "url": "{{baseUrl}}/api/users/{{userId}}",
          "headers": [{"key": "Accept", "value": "application/json", "enabled": true}],
          "queryParams": [],
          "body": {"type": "none"},
          "auth": {"type": "none"},
          "validations": [
            {"id": "v1", "type": "status", "operator": "equals", "expected": "200", "enabled": true},
            {"id": "v2", "type": "body-json-path", "target": "$.email", "operator": "equals", "expected": "jane@example.com", "enabled": true}
          ],
          "followRedirects": true
        }
      ]
    }
  ],
  "insights": [
    "This API follows REST conventions with standard CRUD operations",
    "Authentication appears to use Bearer tokens based on /auth endpoints"
  ]
}
</SCENARIOS_JSON>

Replace the example above with real scenarios based on the actual endpoints provided. Generate realistic data, proper variable chaining between steps, and comprehensive validations. REMEMBER: All URLs MUST start with {{baseUrl}}.`;

      // Use text-only streaming (no tools) — the LLM should just output JSON,
      // not try to read files or execute commands.
      streamTextOnlyScoped(orchestrator, wss, prompt, requestId);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/code-review — AI-powered code review for test code
  // Reads files, analyzes against best practices, and provides actionable feedback.
  app.post('/api/ai/code-review', async (req, res) => {
    try {
      const { requestId, filePaths, focus, context, depth } = req.body;
      if (!requestId || !filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
        res.status(400).json({ error: 'requestId and filePaths[] required' });
        return;
      }

      const prompt = buildCodeReviewPrompt({
        filePaths,
        focus: focus || [],
        context: context || '',
        depth: depth || 'deep',
        projectPath: options.projectPath,
      });

      streamScopedWithToolEvents(orchestrator, wss, prompt, requestId);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/apply-review-fixes — Apply selected code review fixes
  // Takes the review content and selected issues, builds a prompt for the LLM
  // to implement the fixes using edit_file/write_file, run tests, and self-heal.
  app.post('/api/ai/apply-review-fixes', async (req, res) => {
    try {
      const { requestId, reviewContent, selectedIssues } = req.body;
      if (!requestId || !selectedIssues || !Array.isArray(selectedIssues) || selectedIssues.length === 0) {
        res.status(400).json({ error: 'requestId and selectedIssues[] required' });
        return;
      }

      const prompt = buildApplyReviewFixesPrompt({
        reviewContent: reviewContent || '',
        selectedIssues,
        projectPath: options.projectPath,
      });

      streamScopedWithToolEvents(orchestrator, wss, prompt, requestId);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/explain — Explain a file
  app.post('/api/ai/explain', async (req, res) => {
    try {
      const { filePath } = req.body;
      if (!filePath) {
        res.status(400).json({ error: 'filePath required' });
        return;
      }

      const prompt = `Read the file "${filePath}" and provide a detailed explanation of what it does, its structure, patterns used, and any issues or improvements you'd suggest.`;

      streamAIResponse(orchestrator, wss, prompt);

      res.json({ status: 'streaming', filePath });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/chat — Free-form AI chat (legacy, simple broadcast)
  app.post('/api/ai/chat', async (req, res) => {
    try {
      const { message, context } = req.body;
      if (!message) {
        res.status(400).json({ error: 'message required' });
        return;
      }

      const prompt = context
        ? `Context: ${context}\n\nUser question: ${message}`
        : message;

      streamAIResponse(orchestrator, wss, prompt);

      audit(req, 'ai.chat', { resourceType: 'ai' });
      res.json({ status: 'streaming' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/chat-stream — Full-featured AI chat with tool events, permissions, file diffs
  // This is the new chat endpoint that supports conversation history and all tool capabilities.
  app.post('/api/ai/chat-stream', async (req, res) => {
    try {
      const { requestId, message, history, fileContext, uploadedFileIds } = req.body;
      if (!requestId || !message) {
        res.status(400).json({ error: 'requestId and message required' });
        return;
      }

      // Resolve uploaded files by ID
      let resolvedUploads: Array<{ name: string; type: string; content: string; isImage: boolean }> = [];
      if (uploadedFileIds && Array.isArray(uploadedFileIds)) {
        const { getUploadedFile } = await import('./api-upload.js');
        for (const id of uploadedFileIds) {
          const file = getUploadedFile(id);
          if (file) {
            resolvedUploads.push({
              name: file.originalName,
              type: file.type,
              content: file.isImage ? `[Image: ${file.originalName} (${file.mimeType}, ${Math.round(file.size / 1024)}KB) — base64 data available but omitted for brevity]` : file.content,
              isImage: file.isImage,
            });
          }
        }
      }

      const prompt = buildChatStreamPrompt({
        message,
        history: history || [],
        fileContext: fileContext || [],
        uploadedFiles: resolvedUploads,
        projectPath: options.projectPath,
      });

      // Stream with full tool events & permissions
      streamScopedWithToolEvents(orchestrator, wss, prompt, requestId);

      res.json({ status: 'streaming', requestId });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // POST /api/ai/chat-reset — Reset orchestrator conversation context.
  // Called when the user starts a new chat or switches to a different session
  // so that the LLM does not carry over context from the previous chat.
  app.post('/api/ai/chat-reset', (_req, res) => {
    try {
      orchestrator.resetConversation();
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Handle WebSocket AI messages (including permission responses)
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'ai-chat') {
          const prompt = msg.context
            ? `Context: ${msg.context}\n\nUser question: ${msg.message}`
            : msg.message;

          await streamAIToClient(orchestrator, ws, prompt);
        }

        // Handle permission response from UI
        if (msg.type === 'ai-fix-permission-response') {
          const permId = msg.permissionId as string;
          const pending = pendingPermissions.get(permId);
          if (pending) {
            pendingPermissions.delete(permId);
            pending.resolve({
              granted: msg.granted === true,
              remember: msg.remember === true,
            });
          }
        }
      } catch { /* ignore malformed messages */ }
    });
  });
}

/**
 * Stream AI response to all WebSocket clients (broadcast).
 */
async function streamAIResponse(
  orchestrator: any, // Orchestrator type
  wss: WebSocketServer,
  prompt: string,
): Promise<void> {
  try {
    for await (const chunk of orchestrator.processStream(prompt)) {
      if (chunk.type === 'text') {
        broadcast(wss, { type: 'ai-stream', content: chunk.content });
      } else if (chunk.type === 'done') {
        broadcast(wss, { type: 'ai-done' });
      } else if (chunk.type === 'error') {
        broadcast(wss, { type: 'error', message: chunk.error });
      }
    }
  } catch (error) {
    broadcast(wss, { type: 'error', message: String(error) });
  }
}

/**
 * Stream AI response to a single WebSocket client.
 */
async function streamAIToClient(
  orchestrator: any,
  ws: WebSocket,
  prompt: string,
): Promise<void> {
  try {
    for await (const chunk of orchestrator.processStream(prompt)) {
      if (ws.readyState !== 1 /* OPEN */) break;

      if (chunk.type === 'text') {
        ws.send(JSON.stringify({ type: 'ai-stream', content: chunk.content }));
      } else if (chunk.type === 'done') {
        ws.send(JSON.stringify({ type: 'ai-done' }));
      } else if (chunk.type === 'error') {
        ws.send(JSON.stringify({ type: 'error', message: chunk.error }));
      }
    }
  } catch (error) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'error', message: String(error) }));
    }
  }
}



/**
 * Build a detailed prompt for the LLM to fix a test failure.
 * Includes the analysis context so the LLM doesn't start from scratch.
 */
function buildFixFailurePrompt(ctx: {
  errorSignature: string;
  category: string;
  rootCause: string;
  suggestedFix: string;
  affectedTests: string[];
  errorMessage: string;
  projectPath: string;
}): string {
  const testList = ctx.affectedTests.map(t => `  - ${t}`).join('\n');

  return `You are a test automation expert. A test failure analysis has been performed and I need you to provide a concrete fix.

## Failure Context

**Category:** ${ctx.category}
**Error:**
\`\`\`
${ctx.errorMessage}
\`\`\`

**Preliminary Root Cause:** ${ctx.rootCause}

**Affected Tests:**
${testList}

**Project Path:** ${ctx.projectPath}

## Your Task

1. First, use the read_file tool to read the affected test files to understand the test code. Search for the test files in the project — they may be in features/, tests/, src/step-definitions/, src/steps/, or similar directories.
2. If the failure involves browser interactions (element not found, click failed, timeout, etc.), also use the browser tools to investigate:
   - Use \`browser_launch\` + \`browser_navigate\` to open the target page
   - Use \`browser_inspect\` to discover the ACTUAL selectors of elements on the page
   - Use \`browser_get_text\` to read the page content
   - This gives you REAL data about what selectors work, rather than guessing
3. Analyze the actual test code against the error message.
4. Provide a **concrete fix** — show the exact code changes needed with before/after code blocks.
5. When fixing selectors/locators, follow this priority:
   - data-testid (most stable)
   - ARIA role + name (accessibility-friendly)
   - aria-label or placeholder (good for inputs)
   - Visible text content (for buttons, links)
   - CSS class or id (less stable but common)
   - XPath (last resort)
6. When fixing timing issues:
   - Use explicit waits (waitForSelector, waitForLoadState, expect().toBeVisible()) — NOT arbitrary timeouts
   - Add waitForLoadState('networkidle') or waitForLoadState('domcontentloaded') after navigation
7. NEVER suggest \`page.evaluate()\` for clicking, typing, or other user interactions — use native methods (\`page.click()\`, \`page.fill()\`, \`page.locator().click()\`)
8. If the issue is environmental (server not running, config missing), provide the exact setup commands needed.

## Response Format

Structure your response as:

### Analysis
Brief explanation of what's going wrong in the actual code.

### Fix
Show the exact code changes with file paths. Use before/after format:

**File:** \`path/to/file.ts\`
\`\`\`typescript
// Before (problematic code)
...

// After (fixed code)
...
\`\`\`

### Prevention
One or two sentences on how to prevent this in the future.

IMPORTANT: Be specific and actionable. Reference actual code from the files you read. Do not give generic advice.`;
}

/**
 * Build a prompt for the LLM to APPLY the suggested fix, run the test,
 * and SELF-HEAL in a loop until the test passes (max 5 attempts).
 *
 * The LLM will:
 *  1. Apply the initial fix
 *  2. Run the test
 *  3. If the test fails → analyze the NEW error, fix it, run again
 *  4. Repeat until the test passes or max attempts reached
 */
function buildApplyFixPrompt(ctx: {
  aiFixContent: string;
  affectedTests: string[];
  errorSignature: string;
  projectPath: string;
  originalCommand: string;
}): string {
  const MAX_ATTEMPTS = 5;

  // Pick ONE representative scenario to fix and verify.
  // All scenarios in this group share the same root cause, so fixing one proves the fix works.
  const representativeTest = ctx.affectedTests[0] || '';
  const otherTests = ctx.affectedTests.slice(1);
  const hasMultiple = otherTests.length > 0;

  return `You are a test automation expert with SELF-HEALING capabilities. Your ONLY goal is to make the test PASS — a GREEN test. You will apply fixes, run the test, and if it still fails, you will analyze the new failure, apply another fix, and try again — up to ${MAX_ATTEMPTS} attempts. You MUST NOT stop until the test passes or you have exhausted all ${MAX_ATTEMPTS} attempts.

## Previously Suggested Fix

${ctx.aiFixContent}

## IMPORTANT: Single Scenario Strategy
${hasMultiple
    ? `This error group contains ${ctx.affectedTests.length} affected scenarios that all share the same root cause.
**You MUST only fix and run ONE scenario** — the representative scenario below.
Do NOT run all scenarios. The same fix applies to all of them since they share the same error.

**Representative scenario (fix and run THIS ONE ONLY):**
  - ${representativeTest}

**Other affected scenarios (same fix applies — do NOT run these):**
${otherTests.map(t => `  - ${t}`).join('\n')}`
    : `**Scenario to fix and run:**
  - ${representativeTest || '(see the fix content above for file references)'}`}

## Original Error
\`\`\`
${ctx.errorSignature}
\`\`\`

## Project Path: ${ctx.projectPath}

## BROWSER TOOL RULES (CRITICAL — if the test involves browser automation)

If you need to fix test code that uses browser automation (Playwright, Cypress, Selenium, etc.), follow these rules:
- **Click**: Use \`browser_click\` — NEVER \`browser_evaluate\` to click
- **Type/Fill**: Use \`browser_type\` — NEVER \`browser_evaluate\` to set input values
- **Press keys**: Use \`browser_press_key\` — NEVER \`browser_evaluate\` with dispatchEvent/KeyboardEvent
- **Hover**: Use \`browser_hover\` — NEVER \`browser_evaluate\` with mouseover
- **Read text**: Use \`browser_get_text\` — NEVER \`browser_evaluate\` with innerText
- **Select dropdown**: Use \`browser_select\`
- **Inspect elements**: Use \`browser_inspect\` to discover selectors
- **browser_evaluate is LAST RESORT** — only for computed styles, complex calculations, or operations NO other tool can handle

When writing the TEST CODE itself (not when using browser tools directly), ensure:
- Use the framework's native methods (e.g., \`page.click()\`, \`page.fill()\`, \`page.locator().click()\`) — NOT \`page.evaluate()\` for user interactions
- Prefer \`page.locator()\` over \`page.$()\` for Playwright tests
- Use \`await page.waitForSelector()\` or \`expect(locator).toBeVisible()\` for proper waits
- Avoid \`page.evaluate(() => document.querySelector(...).click())\` — use \`page.click(selector)\` or \`page.locator(selector).click()\` instead

## TOOL FAILURE RECOVERY (CRITICAL — read this carefully)

When ANY browser tool (browser_click, browser_type, browser_hover, browser_select, browser_wait_for) fails, the error message will include **Recovery hints**. You MUST follow those hints to recover WITHIN the same attempt — do NOT count a tool failure as a full attempt failure. Instead:

1. **Read the error carefully** — the hint tells you exactly what to try
2. **Use browser_inspect** to discover what elements actually exist on the page
3. **Use browser_wait_for** to wait for the element before retrying the interaction
4. **Try alternative selectors/strategies** (text, testId, role, label, placeholder, XPath)
5. **Check for iframes** — use browser_list_frames if elements can't be found on the main page
6. **Use browser_get_text** to read the page and understand the current state
7. **Only count it as an attempt failure** if the TEST RUN (run_command) fails — individual tool failures should be recovered inline

Example: If browser_click fails because the element is not found:
- WRONG: Give up and count this as attempt failure ✗
- RIGHT: Use browser_inspect to find the correct selector, try browser_wait_for, then retry browser_click with the new selector ✓

Example: If browser_type fails because the input is not visible:
- WRONG: Move to next attempt ✗
- RIGHT: Use browser_wait_for with state="visible", check for overlays, then retry browser_type ✓

## SELF-HEALING LOOP — MANDATORY WORKFLOW

You MUST follow this exact loop. This is not optional.

### Attempt 1 of ${MAX_ATTEMPTS}

**Step 1: Read** — Use \`read_file\` to read the test files that need to be modified. Understand the current code.

**Step 2: Fix** — Apply the code changes described in the fix above using \`edit_file\` (preferred for surgical changes) or \`write_file\` (for complete rewrites).

**Step 3: Run** — Execute ONLY the representative scenario (NOT all scenarios):
${ctx.originalCommand ? `   - Original command was: \`${ctx.originalCommand}\`\n   - You MUST narrow this down to run ONLY the single representative scenario` : '   - Determine the test run command from the project structure'}
${representativeTest ? `   - Representative scenario: \`${representativeTest}\`` : ''}
   - For Cucumber/BDD: use \`--name "scenario name"\` filter to run ONLY the specific scenario
   - For Playwright: use \`--grep "test name"\` or specify the exact test file + line
   - For Jest: use \`--testPathPattern\` + \`--testNamePattern\` for the exact test
   - **CRITICAL: Run ONLY ONE scenario. Do NOT run the entire test suite or all affected tests.**
   - IMPORTANT: Always run the test — NEVER skip this step

**Step 4: Check** — Examine the test output:
   - **PASS** → Immediately write the "### Final Result" section and stop
   - **FAIL** → Print "**Test Result:** FAIL" with the error, then proceed to the NEXT attempt

### Attempts 2 through ${MAX_ATTEMPTS} (if previous attempt FAILED)

After a failed attempt, you MUST NOT stop. DO NOT write a Final Result section after a failure unless you are on attempt ${MAX_ATTEMPTS}. Instead:

1. **Analyze the NEW error** — Read the test output carefully. The error may be completely DIFFERENT from before.
2. **Re-read files** — Use \`read_file\` to see the current state of the code (your previous edit is there).
3. **Diagnose** — What went wrong?
   - Wrong selector? → Try data-testid, role, aria-label, text content, or XPath
   - Wrong element? → Use \`browser_inspect\` or \`glob_search\` to find the right element
   - Timing issue? → Add explicit waits (\`waitForSelector\`, \`waitForTimeout\`, \`waitForLoadState\`)
   - Wrong API/method? → Check framework docs, use the correct method signature
   - Import/module issue? → Check paths, module names, exports
   - Application behavior differs? → Launch browser, navigate to the page, and inspect the actual UI
   - Same error as before? → Try a COMPLETELY DIFFERENT approach (different locator strategy, restructure the test flow, add setup/teardown steps)
4. **Apply NEW fix** — Make different changes than before
5. **Run test again** — Always verify
6. **Check result** — PASS → Final Result, FAIL → next attempt (if attempts remain)

## Output Format (MANDATORY — follow this EXACTLY)

Start EVERY attempt with this exact heading format (the UI tracks progress using this):

### Attempt N of ${MAX_ATTEMPTS}

**Action:** [What you're changing and why — be specific]

[Your tool calls for read, edit, run go here]

**Files Modified:**
- \`path/to/file.ext\` — [what changed]

**Test Result:** PASS or FAIL
**Error (if FAIL):** [Brief error from test output]

---

After the test PASSES or after attempt ${MAX_ATTEMPTS}, output:

### Final Result

**Status:** PASS or FAIL
**Total Attempts:** N of ${MAX_ATTEMPTS}
**Verified Scenario:** [The scenario name you ran]
**Changes Applied:**
- [list ALL files modified across ALL attempts]
**Summary:** [Root cause and how it was fixed, or what failed if all attempts exhausted]
${hasMultiple ? `**Other Scenarios:** The same fix applies to ${otherTests.length} other scenario(s) in this error group since they share the same root cause. No separate execution needed.` : ''}

## CRITICAL RULES — VIOLATION OF THESE IS NOT ACCEPTABLE

1. **NEVER stop after a failed attempt** unless you are on attempt ${MAX_ATTEMPTS}. If attempt 1 fails, you MUST proceed to attempt 2. If attempt 2 fails, you MUST proceed to attempt 3. And so on.
2. **NEVER skip running the test** — you MUST run the test after EVERY fix. No exceptions.
3. **NEVER output "### Final Result" after a FAIL** unless it is attempt ${MAX_ATTEMPTS}. The only time Final Result appears after a failure is when all ${MAX_ATTEMPTS} attempts are exhausted.
4. **NEVER use \`browser_evaluate\` for clicking, typing, hovering, or selecting** — use the proper browser tools or framework methods. Similarly, test code should NOT use \`page.evaluate()\` for user interactions.
5. **Each attempt MUST try something DIFFERENT** — if the same fix fails twice, the 3rd attempt must use a fundamentally different approach.
6. **Use \`edit_file\` for precise changes** — don't rewrite entire files unless necessary.
7. **Read the ACTUAL error output** — don't assume the error is the same as last time.
8. **Your heading format MUST be "### Attempt N of ${MAX_ATTEMPTS}"** — the UI parses this to show progress. Do not vary this format.
9. **Run ONLY ONE scenario per attempt** — the representative scenario. NEVER run the full test suite or all affected scenarios. This is a single-scenario strategy.
10. **Goal: GREEN TEST** — do whatever it takes within ${MAX_ATTEMPTS} attempts.`;
}

/**
 * Build a detailed prompt for the LLM to create a NEW test from a user's scenario description.
 *
 * The prompt enforces:
 *  1. Thorough project discovery before writing code
 *  2. Maximum reuse of existing code (page objects, step defs, utils)
 *  3. Only create genuinely new code — never duplicate
 *  4. Match existing coding style exactly
 *  5. Run and self-heal up to 3 attempts
 */
function buildNewTestPrompt(ctx: {
  userPrompt: string;
  projectPath: string;
  targetUrl?: string;
  frameworkHint?: string;
  moduleHint?: string;
}): string {
  const MAX_ATTEMPTS = 3;

  return `You are a test automation expert. The user wants you to create a NEW test scenario. You must analyze the existing project thoroughly, reuse everything possible, and only add what is genuinely new. The new code must be reusable, modular, and follow the project's existing patterns exactly.

## User's Test Scenario Request

${ctx.userPrompt}

${ctx.targetUrl ? `**Target URL:** ${ctx.targetUrl}` : ''}
${ctx.frameworkHint ? `**Framework hint:** ${ctx.frameworkHint}` : ''}
${ctx.moduleHint ? `**Module hint:** ${ctx.moduleHint}` : ''}

## Project Path: ${ctx.projectPath}

## MANDATORY WORKFLOW — Follow These Steps In Order

### Phase 1: Project Discovery (DO NOT SKIP)

You MUST thoroughly scan the project before writing any code. Do NOT assume anything — read the actual files.

**Step 1.1: Scan project structure**
- Use \`list_directory\` on the project root to see the top-level structure
- Use \`glob_search\` with patterns like \`**/*.feature\`, \`**/*.spec.ts\`, \`**/*.test.ts\`, \`**/*.spec.js\`, \`**/*.test.js\`, \`**/*.py\`, \`**/*.java\` to discover test files
- Use \`glob_search\` with \`**/step*.ts\`, \`**/step*.js\`, \`**/steps/**\`, \`**/step_definitions/**\` to find step definitions
- Use \`glob_search\` with \`**/page*.ts\`, \`**/page*.js\`, \`**/pages/**\` to find page objects
- Use \`glob_search\` with \`**/utils/**\`, \`**/helpers/**\`, \`**/support/**\` to find utility files
- Use \`glob_search\` with \`**/config*\`, \`**/playwright.config*\`, \`**/cypress.config*\`, \`**/wdio.conf*\`, \`**/cucumber*\`, \`**/tsconfig*\`, \`**/package.json\`, \`**/pom.xml\`, \`**/requirements.txt\` to find config files

**Step 1.2: Identify framework, language, and patterns**
- Read \`package.json\` (or \`pom.xml\`, \`requirements.txt\`, etc.) to identify the test framework, language, and dependencies
- Read the framework config file to understand how tests are configured
- Read \`tsconfig.json\` or similar to understand compiler settings, path aliases, base URLs

**Step 1.3: Read existing test files (at least 2-3 representative tests)**
- Read 2-3 existing test files to learn the EXACT patterns:
  - Import style (named imports, default imports, require, path aliases)
  - Test structure (describe/it, Scenario/Given/When/Then, test blocks, @Test annotations)
  - Assertion patterns (expect, assert, should)
  - Hook patterns (beforeEach, beforeAll, Before, After, setup/teardown)
  - How tests reference page objects, helpers, and data
  - Naming conventions (file names, function names, variable names, class names)
  - Comment style and documentation patterns

**Step 1.4: Read existing page objects and utilities**
- Read ALL page object files relevant to the new test scenario
- Read ALL step definition files (for BDD) that might be related
- Read ALL utility/helper files (BrowserActions, FallbackLocator, WindowManager, FrameHandler, etc.)
- Read any test data files or fixture files that might be relevant

**Step 1.5: Search for reusable code**
- Use \`grep\` to search for existing methods, functions, or steps that relate to the user's scenario
  - Search by keywords from the user's prompt (e.g., if user says "login", search for "login", "signIn", "authenticate")
  - Search for existing selectors, element identifiers related to the scenario
  - Search for existing step definitions that match parts of the scenario
- Document what already exists and what is MISSING

### Phase 2: Plan the New Code

Before writing any code, plan what needs to be created:

1. **List what already exists and CAN be reused:**
   - Existing page objects with methods that cover parts of the scenario
   - Existing step definitions that match scenario steps
   - Existing utility functions (waits, assertions, data setup, etc.)
   - Existing test data or fixtures

2. **List what is MISSING and needs to be created:**
   - New page object methods (NOT entire new page objects if the page already has one)
   - New step definitions (only for steps not already defined)
   - New test file / feature file / spec file
   - New utility methods (only if nothing existing covers the need)
   - New test data (only if needed)

3. **CRITICAL RULE — Minimum New Code Principle:**
   - If a page object already exists for a page, ADD methods to it — do NOT create a duplicate
   - If step definitions exist for similar actions, REUSE them — do NOT create duplicates
   - If a utility/helper already handles a pattern, IMPORT and USE it — do NOT recreate
   - Only create a NEW page object class if no page object exists for that page
   - Only create NEW step definitions if no existing step matches the action
   - Every new method, function, or class must be designed for REUSABILITY (parameterized, modular, well-named)

### Phase 3: Create the New Code

**Write code following these rules:**

1. **Match existing style EXACTLY:**
   - Same import style, same indentation, same naming conventions
   - Same file organization (if tests go in \`tests/\`, put new test there; if features go in \`features/\`, put new feature there)
   - Same assertion library and patterns
   - Same locator strategy (if project uses data-testid, use data-testid; if project uses Page Object Model, follow POM)

2. **Make new code reusable:**
   - New page object methods should be generic enough for other tests to use
   - New step definitions should be parameterized (use {string}, {int}, etc. in Cucumber; use variables in other frameworks)
   - New utility functions should handle edge cases and be well-documented
   - Avoid hardcoded values — use parameters, constants, or config

3. **Use proper file operations:**
   - For adding methods to EXISTING files: use \`edit_file\` to surgically add the new methods
   - For creating NEW files: use \`write_file\` with complete, runnable content
   - NEVER overwrite an existing file completely with \`write_file\` — use \`edit_file\` to add to it

4. **When the scenario involves browser interactions:**
   - If the project has BrowserActions utility: use it for all interactions
   - If the project has FallbackLocator: use it for element definitions
   - If the project uses Page Object Model: add new selectors and methods to the appropriate page object
   - Check for multi-window/iframe behavior and handle appropriately
   - Use stable selectors (data-testid > id > aria-label > role > placeholder > CSS > XPath)

### Phase 4: Run and Verify

After writing the code, you MUST run the test to verify it works.

**Step 4.1: Determine the run command**
- Look at existing scripts in package.json or project config
- For Cucumber/BDD: use \`--name "scenario name"\` filter to run ONLY the specific scenario
- For Playwright: use \`--grep "test name"\` or specify the exact test file + line
- For Jest: use \`--testPathPattern\` + \`--testNamePattern\` for the exact test
- For pytest: use \`-k "test_name"\` filter
- For TestNG/JUnit: use appropriate test selection flags
- Run ONLY the new test — do NOT run the entire test suite

**Step 4.2: Run the test**
- Use \`run_command\` to execute the test
- Read the output carefully

**Step 4.3: Check result**
- **PASS** → Proceed to the Final Result
- **FAIL** → Enter the self-healing loop (Phase 5)

### Phase 5: Self-Healing Loop (If Test Fails) — Up to ${MAX_ATTEMPTS} Total Attempts

If the test fails after creation, you MUST try to fix it. You have ${MAX_ATTEMPTS} total attempts (including the first run).

For each retry attempt:

1. **Analyze the error** — Read the full error output carefully
2. **Re-read the affected files** to understand current state
3. **Diagnose the issue:**
   - Wrong selector? → Use \`browser_launch\` + \`browser_navigate\` + \`browser_inspect\` to discover the real selectors
   - Missing import? → Check paths and module names
   - Wrong API/method? → Read the framework docs in the project
   - Timing issue? → Add explicit waits
   - Missing step definition? → Create it
   - Wrong page object method? → Fix or add the correct one
4. **Apply the fix** using \`edit_file\` (preferred) or \`write_file\`
5. **Re-run the test** — ALWAYS re-run, never skip
6. **Check result** — PASS → Final Result, FAIL → next attempt

**Each attempt MUST try something different.** If the same approach fails twice, use a fundamentally different strategy on the third attempt.

## BROWSER TOOL RULES (CRITICAL — if investigating selectors or browser behavior)

- **Click**: Use \`browser_click\` — NEVER \`browser_evaluate\` to click
- **Type/Fill**: Use \`browser_type\` — NEVER \`browser_evaluate\` to set input values
- **Press keys**: Use \`browser_press_key\` — NEVER \`browser_evaluate\` with dispatchEvent
- **Hover**: Use \`browser_hover\` — NEVER \`browser_evaluate\` with mouseover
- **Read text**: Use \`browser_get_text\` — NEVER \`browser_evaluate\` with innerText
- **Inspect elements**: Use \`browser_inspect\` to discover selectors
- **browser_evaluate is LAST RESORT** — only for computed styles or operations no other tool handles

## TOOL FAILURE RECOVERY

When ANY browser tool fails, the error message will include **Recovery hints**. Follow those hints to recover WITHIN the same step:
1. Read the error carefully — the hint tells you what to try
2. Use \`browser_inspect\` to discover what elements actually exist
3. Use \`browser_wait_for\` to wait for the element before retrying
4. Try alternative selectors (text, testId, role, label, placeholder, XPath)
5. Check for iframes — use \`browser_list_frames\` if elements can't be found

## Output Format (MANDATORY — the UI parses these headings)

### Project Analysis
[Brief summary: framework, language, existing page objects, step defs, utilities, what can be reused]

### Plan
**Reusing:**
- [list existing files/methods being reused]

**Creating:**
- [list new files/methods being created, with brief purpose]

### Implementation
[Your tool calls for creating code go here. Explain each file change before making it.]

### Attempt 1 of ${MAX_ATTEMPTS}

**Action:** Running the new test to verify it works.

[run_command tool call]

**Test Result:** PASS or FAIL
**Error (if FAIL):** [brief error]

---

[If FAIL, continue with Attempt 2, etc. Each attempt heading: "### Attempt N of ${MAX_ATTEMPTS}"]

### Final Result

**Status:** PASS or FAIL
**Total Attempts:** N of ${MAX_ATTEMPTS}
**Files Created:**
- [new files created with \`write_file\`]
**Files Modified:**
- [existing files modified with \`edit_file\` to add new methods/steps]
**Reused From Existing Code:**
- [list of existing code that was reused, with file paths]
**Summary:** [Brief description of what was created and how it integrates with the existing project]

## CRITICAL RULES — VIOLATION OF THESE IS NOT ACCEPTABLE

1. **NEVER skip the project discovery phase** — you MUST read existing files before writing any code
2. **NEVER duplicate existing code** — search thoroughly and REUSE what exists
3. **NEVER create a new page object if one already exists for that page** — ADD methods to the existing one using \`edit_file\`
4. **NEVER create a new step definition if one already exists** — REUSE the existing step
5. **NEVER skip running the test** — you MUST verify the code works
6. **NEVER stop after a failure** unless all ${MAX_ATTEMPTS} attempts are exhausted
7. **ALWAYS match the project's existing style** — imports, naming, structure, assertions, locator strategies
8. **ALWAYS make new code reusable** — parameterized, modular, well-documented
9. **Use \`edit_file\` for surgical additions to existing files** — do NOT rewrite entire files with \`write_file\`
10. **Your heading format MUST include "### Attempt N of ${MAX_ATTEMPTS}"** — the UI parses this for progress tracking
11. **NEVER use \`browser_evaluate\` for clicking, typing, hovering, or selecting** — use the proper browser tools
12. **Goal: GREEN TEST** — do whatever it takes within ${MAX_ATTEMPTS} attempts`;
}

/**
 * Build a detailed prompt for the LLM to perform an AI Code Review.
 *
 * The prompt enforces:
 *  1. Thorough reading of the target files and related project context
 *  2. Analysis across multiple quality dimensions (flakiness, best practices, etc.)
 *  3. Structured output with severity-rated issues and concrete fix examples
 *  4. A summary score card for quick assessment
 */
function buildCodeReviewPrompt(ctx: {
  filePaths: string[];
  focus: string[];
  context: string;
  depth: 'quick' | 'deep';
  projectPath: string;
}): string {
  const isFullFramework = ctx.filePaths.length === 1 && ctx.filePaths[0] === '__FULL_FRAMEWORK__';
  const fileList = isFullFramework ? '  (Complete framework review — discover all files)' : ctx.filePaths.map(f => `  - ${f}`).join('\n');
  const isDeep = ctx.depth === 'deep';

  // Map focus IDs to readable labels
  const focusMap: Record<string, string> = {
    'flakiness': 'Flakiness Risks — hardcoded waits, race conditions, non-deterministic selectors, timing dependencies',
    'best-practices': 'Best Practices — Page Object pattern adherence, DRY violations, assertion quality, test isolation',
    'selectors': 'Selector Quality — fragile CSS/XPath selectors, missing data-testid, over-specific locators, selector maintainability',
    'performance': 'Performance — unnecessary browser launches, redundant page loads, slow locator strategies, parallelization opportunities',
    'maintainability': 'Maintainability — code duplication, magic strings/numbers, poor naming, missing abstractions, readability',
    'error-handling': 'Error Handling — missing try-catch, uncaught promise rejections, poor error messages, missing assertions',
    'test-structure': 'Test Structure — missing setup/teardown, test interdependency, improper scoping, missing hooks',
  };

  const focusSection = ctx.focus.length > 0
    ? `## Review Focus Areas (Prioritize These)\n\n${ctx.focus.map(f => `- **${focusMap[f] || f}**`).join('\n')}\n\nFocus your analysis primarily on these areas, but also note any critical issues outside these categories.`
    : `## Review Focus Areas\n\nPerform a comprehensive review covering ALL of the following areas:\n${Object.values(focusMap).map(f => `- **${f}**`).join('\n')}`;

  const contextSection = ctx.context
    ? `## Additional Context from User\n\n${ctx.context}\n`
    : '';

  return `You are a senior test automation engineer performing an expert-level code review. Your goal is to analyze test code and provide actionable, severity-rated feedback that helps improve quality, reliability, and maintainability.

## Files to Review

${fileList}

## Project Path: ${ctx.projectPath}

${focusSection}

${contextSection}

## MANDATORY WORKFLOW — Follow These Steps

### Phase 1: Read and Understand the Code

${isFullFramework ? `**Step 1.1: Discover and read ALL project test files (Complete Framework Review)**
- Use \`list_directory\` on the project root to see the top-level structure
- Use \`glob_search\` extensively to discover ALL test-related files:
  - Test files: \`**/*.spec.ts\`, \`**/*.test.ts\`, \`**/*.spec.js\`, \`**/*.test.js\`, \`**/*.feature\`, \`**/*.py\`, \`**/*.java\`, \`**/*.rb\`
  - Page objects: \`**/pages/**\`, \`**/page*.ts\`, \`**/page*.js\`
  - Step definitions: \`**/steps/**\`, \`**/step_definitions/**\`, \`**/step*.ts\`
  - Utilities/helpers: \`**/utils/**\`, \`**/helpers/**\`, \`**/support/**\`, \`**/common/**\`
  - Fixtures/data: \`**/fixtures/**\`, \`**/data/**\`, \`**/testdata/**\`
  - Configuration: \`**/playwright.config*\`, \`**/cypress.config*\`, \`**/wdio.conf*\`, \`**/cucumber*\`, \`**/jest.config*\`, \`**/package.json\`
- Use \`read_file\` to read EVERY discovered file — do NOT skip any file
- For large projects, prioritize: config → pages/POM → utils → step definitions → test files` : `**Step 1.1: Read the target files**
- Use \`read_file\` to read EVERY file listed above
- If a path is a directory or glob pattern, use \`glob_search\` first to discover the actual files, then read them
- Read each file completely — do NOT skip any file`}

${isDeep ? `**Step 1.2: Understand project context (Deep Review)**
- Use \`glob_search\` to discover the project structure:
  - \`**/package.json\` or \`**/pom.xml\` or \`**/requirements.txt\` — dependencies and framework
  - \`**/playwright.config*\`, \`**/cypress.config*\`, \`**/wdio.conf*\`, \`**/cucumber*\` — framework config
  - \`**/tsconfig.json\`, \`**/jest.config*\` — compiler/test runner settings
- Read the framework config to understand test setup, timeouts, retries, reporters
- Use \`glob_search\` to find related files:
  - Page objects (\`**/pages/**\`, \`**/page*.ts\`)
  - Step definitions (\`**/steps/**\`, \`**/step*.ts\`)
  - Utilities/helpers (\`**/utils/**\`, \`**/helpers/**\`, \`**/support/**\`)
  - Fixtures and test data (\`**/fixtures/**\`, \`**/data/**\`)
- Read 1-2 related page objects or helpers to understand the project's patterns
- Use \`grep\` to search for patterns:
  - \`waitForTimeout|sleep|delay|setTimeout\` — hardcoded waits
  - \`page.\\$|querySelector\` — fragile selectors
  - \`test.only|describe.only|it.only|fdescribe|fit\` — debug-only markers left in
  - \`.skip|xdescribe|xit|pending\` — skipped tests
  - \`TODO|FIXME|HACK|XXX\` — technical debt markers` : `**Step 1.2: Quick context scan**
- Use \`glob_search\` to find \`**/package.json\` — read it to identify the framework
- Scan the directory containing the target files for related page objects or helpers`}

### Phase 2: Analyze the Code

For each file reviewed, systematically check:

**🔴 Critical Issues** (Must fix — tests are unreliable or broken):
- Hardcoded \`waitForTimeout()\` or \`sleep()\` — always a flakiness risk
- Race conditions (no wait before assertion, assuming element exists)
- Tests that depend on other tests' state or execution order
- Shared mutable state between tests without proper isolation
- Missing error handling that causes silent failures
- Security issues (hardcoded credentials, tokens, API keys in test code)
- Tests that always pass (no meaningful assertions)

**🟡 Warnings** (Should fix — affects maintainability or reliability):
- Fragile selectors (nth-child, deep CSS paths, auto-generated IDs)
- Missing \`data-testid\` where it would improve stability
- Code duplication across test files (DRY violations)
- Magic strings and numbers without constants
- Missing or inadequate setup/teardown hooks
- Overly broad selectors that may match unintended elements
- Implicit waits mixed with explicit waits
- Tests doing too many things (violating single responsibility)
- Missing retry configuration for known flaky operations
- Poor error messages in custom assertions

**🟢 Suggestions** (Nice to have — improves quality and readability):
- Naming improvements (files, functions, variables, test descriptions)
- Better abstractions (extract page objects, create helper methods)
- Documentation gaps (missing JSDoc, unclear test descriptions)
- Performance optimizations (reuse browser context, parallel execution)
- Better assertion messages for debugging
- Code organization improvements
- Modernization opportunities (newer API methods, better patterns)

### Phase 3: Generate the Review Report

## Output Format (MANDATORY — follow this EXACTLY)

### Code Review Summary

**Score:** N/10
**Files Reviewed:** N
**Issues Found:** X Critical, Y Warnings, Z Suggestions

---

### 🔴 Critical Issues

#### 1. [Issue title — clear, specific]
**File:** \`path/to/file.ext\` (Line N)
**Category:** [Flakiness / Best Practices / Selectors / Performance / Maintainability / Error Handling / Test Structure]

**Problem:**
[Clear explanation of what's wrong and WHY it's a problem]

**Current code:**
\`\`\`
[The problematic code snippet]
\`\`\`

**Recommended fix:**
\`\`\`
[The improved code snippet]
\`\`\`

**Impact:** [What happens if this isn't fixed — e.g., "Tests will fail intermittently in CI"]

---

[Repeat for each critical issue]

### 🟡 Warnings

[Same structure as critical issues]

### 🟢 Suggestions

[Same structure but Impact field is optional]

### Metrics

**Flakiness Risk:** Low / Medium / High
**Maintainability:** Low / Medium / High
**Selector Stability:** Low / Medium / High
**Test Isolation:** Good / Fair / Poor
**Code Reusability:** Low / Medium / High

### Recommendations Summary

[Prioritized list of top 3-5 actions the developer should take, ordered by impact]

## CRITICAL RULES — FOLLOW THESE EXACTLY

1. **Read EVERY file** — do NOT skip files. Each file must be analyzed.
2. **Be specific** — reference actual code with file paths and line numbers. No generic advice.
3. **Provide before/after code** for every issue — the developer should be able to copy-paste your fix.
4. **Rate severity accurately** — Critical means the test is unreliable or broken. Warning means it should be improved. Suggestion means it's a nice-to-have.
5. **Explain WHY** — don't just say "this is bad." Explain the consequence (flakiness, maintenance burden, false positives, etc.).
6. **Be framework-aware** — detect the test framework from the code and apply framework-specific best practices:
   - Playwright: \`locator()\` over \`$()\`, auto-waiting, web-first assertions
   - Cypress: \`cy.get()\` chaining, no \`async/await\`, custom commands
   - Selenium: explicit waits, Page Object Model, WebDriverWait
   - Jest/Mocha: proper mocking, test isolation, describe/it structure
   - Cucumber/BDD: step reuse, parameterized steps, scenario independence
   - pytest: fixtures, markers, parametrize
7. **Score honestly** — 10/10 means perfect code with no issues. Most real code scores 5-8.
8. **Include the Score heading** — the UI parses \`**Score:** N/10\` for the score card.
9. **Group issues by severity** — all Critical first, then all Warnings, then all Suggestions.
10. **Don't pad the review** — if the code is good, say so. Don't invent issues to seem thorough.
11. **NEVER use \`browser_evaluate\`** to interact with elements — use proper browser tools if you need to inspect the live page.
12. **If the file doesn't exist**, report it clearly and move on to the next file.`;
}

/**
 * Build a prompt for the LLM to APPLY selected code review fixes.
 *
 * The LLM will:
 *  1. Read the affected files to understand current code
 *  2. Apply the review fixes using edit_file (surgical) or write_file
 *  3. Run the tests to verify nothing is broken
 *  4. Self-heal up to 3 attempts if the tests fail
 */
function buildApplyReviewFixesPrompt(ctx: {
  reviewContent: string;
  selectedIssues: Array<{ severity: string; title: string; content: string }>;
  projectPath: string;
}): string {
  const MAX_ATTEMPTS = 3;

  // Build a formatted list of selected issues for the prompt
  const issuesList = ctx.selectedIssues.map((issue, idx) => {
    const severityLabel = issue.severity === 'critical' ? '🔴 Critical'
      : issue.severity === 'warning' ? '🟡 Warning'
      : '🟢 Suggestion';
    return `#### ${idx + 1}. [${severityLabel}] ${issue.title}\n\n${issue.content}`;
  }).join('\n\n---\n\n');

  return `You are a test automation expert. A code review has been performed and the user has selected specific issues to fix. Your ONLY goal is to implement ALL the selected fixes correctly, run the tests, and ensure they PASS — a GREEN test suite. You will apply fixes, run tests, and if they fail, you will analyze the new failure, apply another fix, and try again — up to ${MAX_ATTEMPTS} attempts. You MUST NOT stop until tests pass or you have exhausted all ${MAX_ATTEMPTS} attempts.

## Selected Issues to Fix

The following issues were identified in the code review and selected by the user for implementation:

${issuesList}

## Full Review Context

The complete code review (for reference — you only need to fix the SELECTED issues above):

${ctx.reviewContent}

## Project Path: ${ctx.projectPath}

## MANDATORY WORKFLOW — Follow These Steps In Order

### Phase 1: Read and Understand (DO NOT SKIP)

**Step 1.1: Read the affected files**
- For each selected issue, identify the file(s) mentioned
- Use \`read_file\` to read EVERY affected file completely
- Understand the current code structure, imports, and patterns

**Step 1.2: Understand the project context**
- Use \`glob_search\` to find the test framework config (\`**/package.json\`, \`**/playwright.config*\`, \`**/cucumber*\`, etc.)
- Read the config to understand how tests are run
- Identify the test run command

### Phase 2: Apply the Fixes

For each selected issue, apply the recommended fix:

1. **Use \`edit_file\` for surgical changes** (preferred) — add, modify, or replace specific code sections
2. **Use \`write_file\` only for new files** or when the entire file needs restructuring
3. **Follow the review's recommended fix** code exactly when provided
4. **Maintain code style** — match the project's existing indentation, naming, import patterns
5. **Apply fixes in dependency order** — if issue B depends on changes from issue A, apply A first

**Important rules for applying fixes:**
- When replacing hardcoded waits with explicit waits, use the framework's native waiting methods
- When improving selectors, prefer: data-testid > aria role/label > text content > CSS class > XPath
- When extracting page object methods, add them to the EXISTING page object file using \`edit_file\`
- When adding constants/config, place them in the project's existing config/constants location
- When fixing imports, verify the import path exists before writing
- NEVER break existing functionality while fixing an issue

### Phase 3: Run and Verify — Self-Healing Loop

After applying ALL fixes, run the test suite to verify nothing is broken.

### Attempt 1 of ${MAX_ATTEMPTS}

**Step 3.1: Determine the test run command**
- Look at package.json scripts, framework config, or existing test commands
- For Cucumber/BDD: run the specific feature file(s) affected
- For Playwright: run the specific test file(s) affected
- For Jest: run the specific test file(s) affected
- Narrow the scope to ONLY the affected files — do NOT run the entire test suite

**Step 3.2: Run the tests**
- Use \`run_command\` to execute the tests
- Read the output carefully

**Step 3.3: Check result**
- **PASS** → Proceed to the Final Result
- **FAIL** → Analyze the error and proceed to the next attempt

### Attempts 2 through ${MAX_ATTEMPTS} (if previous attempt FAILED)

After a failed attempt, you MUST NOT stop. Instead:

1. **Analyze the error** — Read the test output carefully. The error may be caused by your fix.
2. **Re-read files** — Use \`read_file\` to see the current state of the code
3. **Diagnose** — What went wrong?
   - Did a fix introduce a new issue? → Adjust the fix
   - Wrong import path? → Check and correct
   - Missing method or variable? → Add it
   - Timing issue? → Add explicit waits
   - Wrong selector? → Use \`browser_inspect\` or search for the correct one
4. **Apply correction** — Fix the issue using \`edit_file\`
5. **Run tests again** — ALWAYS verify
6. **Check result** — PASS → Final Result, FAIL → next attempt

**Each attempt MUST try something different.** If the same fix fails twice, try a fundamentally different approach.

## BROWSER TOOL RULES (CRITICAL — if investigating selectors)

- **Click**: Use \`browser_click\` — NEVER \`browser_evaluate\` to click
- **Type/Fill**: Use \`browser_type\` — NEVER \`browser_evaluate\` to set input values
- **Press keys**: Use \`browser_press_key\` — NEVER \`browser_evaluate\` with dispatchEvent
- **Inspect elements**: Use \`browser_inspect\` to discover selectors
- **browser_evaluate is LAST RESORT** — only for computed styles or operations no other tool handles

## Output Format (MANDATORY — the UI parses these headings)

### Applying Fixes

**Issues being fixed:** ${ctx.selectedIssues.length}
${ctx.selectedIssues.map((iss, i) => `${i + 1}. [${iss.severity}] ${iss.title}`).join('\n')}

[Your tool calls for reading and applying fixes go here]

**Files Modified:**
- \`path/to/file.ext\` — [what changed]

### Attempt 1 of ${MAX_ATTEMPTS}

**Action:** Running tests to verify the fixes work correctly.

[run_command tool call]

**Test Result:** PASS or FAIL
**Error (if FAIL):** [brief error]

---

[If FAIL, continue with "### Attempt 2 of ${MAX_ATTEMPTS}", etc.]

### Final Result

**Status:** PASS or FAIL
**Total Attempts:** N of ${MAX_ATTEMPTS}
**Issues Fixed:** ${ctx.selectedIssues.length}
**Files Modified:**
- [list ALL files modified across ALL attempts]
**Summary:** [Brief description of changes made and verification result]

## CRITICAL RULES — VIOLATION OF THESE IS NOT ACCEPTABLE

1. **Fix ALL selected issues** — do not skip any issue the user selected
2. **NEVER stop after a failed attempt** unless you are on attempt ${MAX_ATTEMPTS}
3. **NEVER skip running the tests** — you MUST verify after EVERY fix
4. **NEVER output "### Final Result" after a FAIL** unless it is attempt ${MAX_ATTEMPTS}
5. **Use \`edit_file\` for precise changes** — don't rewrite entire files unless necessary
6. **Read the ACTUAL error output** — don't assume the error is the same as before
7. **Each attempt MUST try something DIFFERENT** — if the same fix fails twice, use a different approach
8. **Your heading format MUST be "### Attempt N of ${MAX_ATTEMPTS}"** — the UI parses this for progress tracking
9. **NEVER break existing functionality** — your fixes should improve the code, not break it
10. **NEVER use \`browser_evaluate\` for clicking, typing, hovering, or selecting** — use proper tools
11. **Goal: GREEN TESTS** — do whatever it takes within ${MAX_ATTEMPTS} attempts`;
}


/**
 * Build the prompt for the full-featured AI chat.
 *
 * Includes conversation history, optional file context, and a project-aware
 * system prompt that enables all tool capabilities.
 */
function buildChatStreamPrompt(ctx: {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  fileContext: Array<{ path: string; snippet?: string }>;
  uploadedFiles?: Array<{ name: string; type: string; content: string; isImage: boolean }>;
  projectPath: string;
}): string {
  const parts: string[] = [];

  parts.push(`You are an expert AI assistant for a test automation project located at: ${ctx.projectPath}

You have full access to all tools including:
- **File operations**: read_file, write_file, edit_file, file_exists, list_directory, create_directory, glob_search, grep
- **System**: run_command, system_info
- **Browser**: browser_launch, browser_navigate, browser_click, browser_type, browser_screenshot, browser_inspect, browser_get_text, etc.
- **Testing**: run_tests, get_test_results

You can read files, write code, run commands, launch browsers, and interact with web pages. Use these tools proactively when they help answer the user's question or complete their task.

## Guidelines
- When asked about code or files, use \`read_file\` or \`grep\` to look at the actual code rather than guessing
- When asked to make changes, use \`edit_file\` for surgical edits or \`write_file\` for new files
- When asked to run something, use \`run_command\` and report the actual output
- When asked about the project structure, use \`list_directory\` and \`glob_search\` to explore
- When investigating browser-related issues, launch a browser and inspect the actual page
- Format your responses with markdown — use headings, code blocks, bold, and lists for clarity
- Be concise but thorough — give actionable answers with real file paths and code

## BROWSER TOOL RULES
- **Click**: Use \`browser_click\` — NEVER \`browser_evaluate\` to click
- **Type/Fill**: Use \`browser_type\` — NEVER \`browser_evaluate\` to set input values
- **Inspect elements**: Use \`browser_inspect\` to discover selectors
- **browser_evaluate is LAST RESORT** — only for computed styles or complex DOM calculations

## Writing Large Files
When writing very long files (documentation, large test suites, large config files):
- **Split into multiple write_file calls** — write the file in logical sections, then append/edit to add more
- For documents longer than ~4000 words, ALWAYS split across multiple tool calls to avoid truncation
- Write the structure first, then fill in each section separately`);

  // File context (if user attached files)
  if (ctx.fileContext.length > 0) {
    parts.push('\n## Referenced Files\n');
    for (const f of ctx.fileContext) {
      if (f.snippet) {
        parts.push(`**${f.path}:**\n\`\`\`\n${f.snippet}\n\`\`\`\n`);
      } else {
        parts.push(`- ${f.path} (use read_file to see contents)`);
      }
    }
  }

  // Uploaded files (parsed content)
  if (ctx.uploadedFiles && ctx.uploadedFiles.length > 0) {
    parts.push('\n## Uploaded Files\n');
    parts.push('The user has uploaded the following files for analysis. Use this content to answer their question.\n');
    for (const f of ctx.uploadedFiles) {
      if (f.isImage) {
        parts.push(`**${f.name}** (image): ${f.content}\n`);
      } else {
        // Truncate very large files to keep prompt manageable
        const maxLen = 15000;
        const content = f.content.length > maxLen
          ? f.content.slice(0, maxLen) + `\n\n... [truncated — file is ${Math.round(f.content.length / 1024)}KB total]`
          : f.content;
        const fileType = f.type === 'excel' ? 'csv' : f.type === 'code' ? f.name.split('.').pop() || 'text' : f.type;
        parts.push(`**${f.name}** (${f.type}):\n\`\`\`${fileType}\n${content}\n\`\`\`\n`);
      }
    }
  }

  // Conversation history
  if (ctx.history.length > 0) {
    parts.push('\n## Conversation History\n');
    for (const msg of ctx.history) {
      const label = msg.role === 'user' ? 'User' : 'Assistant';
      // Truncate long history entries to keep context manageable
      const content = msg.content.length > 2000
        ? msg.content.slice(0, 1997) + '...'
        : msg.content;
      parts.push(`**${label}:** ${content}\n`);
    }
  }

  // Current user message
  parts.push(`\n## Current User Message\n\n${ctx.message}`);

  return parts.join('\n');
}

// broadcast, formatToolArgs, truncateResult, computeUnifiedDiff, diffLines,
// simpleDiff, streamScopedWithToolEvents — imported from ./shared-streaming.js
