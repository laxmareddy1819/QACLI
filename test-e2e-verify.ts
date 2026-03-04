/**
 * qabot End-to-End Verification Test
 *
 * Tests all core components programmatically:
 * 1. generate_test_code returns actionable guidelines
 * 2. System prompt includes agentic loop instructions
 * 3. Tool registry registers all expected tools
 * 4. Conversation manager smart truncation preserves critical turns
 * 5. Browser tool definitions are correct
 * 6. Conversation builds interleaved messages correctly
 * 7. LLM integration with real API call
 * 8. Orchestrator tool execution with permission
 */

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { configDotenv } from 'dotenv';

// Load .env so API keys are available
configDotenv({ path: resolve(process.cwd(), '.env'), quiet: true });

import { ToolRegistry } from './src/core/tools/registry.js';
import { registerCoreTools } from './src/core/tools/index.js';
import { buildSystemPrompt } from './src/core/system-prompt.js';
import { ConversationManager } from './src/core/conversation.js';
import { generateTestCodeTool } from './src/core/tools/codegen.js';
import type { ToolExecutionContext } from './src/core/tools/registry.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
let errors: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${message}`);
  } else {
    failed++;
    errors.push(message);
    console.log(`  \x1b[31m✗\x1b[0m ${message}`);
  }
}

function assertIncludes(text: string, substring: string, message: string) {
  assert(text.includes(substring), message);
}

function section(title: string) {
  console.log(`\n\x1b[1m\x1b[36m── ${title} ──\x1b[0m`);
}

// ── Test 1: generate_test_code tool ──────────────────────────────────────────

async function testGenerateTestCode() {
  section('Test 1: generate_test_code returns actionable guidelines');

  const ctx: ToolExecutionContext = { workingDirectory: process.cwd() };

  const result = await generateTestCodeTool.handler(
    {
      framework: 'playwright',
      scenario: 'Login page validation',
      language: 'typescript',
      base_url: 'http://example.com',
    },
    ctx,
  );

  const resultStr = String(result);
  assertIncludes(resultStr, 'playwright', 'Returns framework name');
  assertIncludes(resultStr, 'typescript', 'Returns language');
  assertIncludes(resultStr, 'Login page validation', 'Returns scenario');
  assertIncludes(resultStr, 'Guidelines', 'Includes guidelines');
  assertIncludes(resultStr, 'page object pattern', 'Mentions page object pattern');
  assertIncludes(resultStr, 'write_file', 'Tells LLM to use write_file');
}

// ── Test 3: System Prompt includes agentic loop ──────────────────────────────

async function testSystemPrompt() {
  section('Test 2: System prompt includes agentic loop instructions');

  const registry = new ToolRegistry();
  registerCoreTools(registry);

  const prompt = buildSystemPrompt({
    workingDirectory: '/test/dir',
    tools: registry.getDefinitions(),
  });

  // Check core structure
  assert(prompt.includes('qabot'), 'Prompt identifies as qabot');
  assertIncludes(prompt, 'agentic loop', 'Mentions agentic loop');
  assertIncludes(prompt, 'ONE tool call per iteration', 'Has one-tool-per-iteration rule');
  assertIncludes(prompt, 'Always examine tool results', 'Has examine-results rule');
  assertIncludes(prompt, 'Maintain state awareness', 'Has state awareness rule');
  assertIncludes(prompt, 'sequential for browser automation', 'Has browser sequential rule');
  assertIncludes(prompt, 'Verify before proceeding', 'Has verify-before-proceed rule');

  // Check step-by-step workflows
  assertIncludes(prompt, 'browser_launch', 'Mentions browser_launch in workflow');
  assertIncludes(prompt, 'browser_navigate', 'Mentions browser_navigate in workflow');
  assertIncludes(prompt, 'browser_get_text', 'Mentions browser_get_text for verification');
  assertIncludes(prompt, 'browser_screenshot', 'Mentions browser_screenshot for verification');
  assertIncludes(prompt, 'browser_close', 'Mentions browser_close');

  // Check test creation workflow
  assertIncludes(prompt, 'read_file', 'Mentions read_file in workflow');
  assertIncludes(prompt, 'write_file', 'Mentions write_file in workflow');
  assertIncludes(prompt, 'run_command', 'Mentions run_command in workflow');

  // Check environment info
  assertIncludes(prompt, 'Working Directory: /test/dir', 'Includes working directory');
  assertIncludes(prompt, 'Available Tools', 'Lists available tools');

  // Check tool count
  const toolLines = prompt.split('\n').filter(l => l.startsWith('- ') && l.includes(': '));
  assert(toolLines.length >= 15, `Lists ${toolLines.length} tools (expected >= 15)`);

  // Check permission denial handling
  assertIncludes(prompt, 'Permission denied', 'Handles permission denial');

  // Check NEW Browser Tool Selection Rules
  assertIncludes(prompt, 'Browser Tool Selection Rules', 'Has browser tool selection rules section');
  assertIncludes(prompt, 'ALWAYS use `browser_click`', 'Click rule: use browser_click');
  assertIncludes(prompt, 'ALWAYS use `browser_type`', 'Type rule: use browser_type');
  assertIncludes(prompt, 'ALWAYS use `browser_press_key`', 'Key press rule: use browser_press_key');
  assertIncludes(prompt, 'ALWAYS use `browser_hover`', 'Hover rule: use browser_hover');
  assertIncludes(prompt, 'ALWAYS use `browser_get_text`', 'Read text rule: use browser_get_text');
  assertIncludes(prompt, 'LAST RESORT', 'Evaluate marked as last resort');
  assertIncludes(prompt, 'ALWAYS use `browser_inspect`', 'Inspect rule: use browser_inspect for discovery');
  assertIncludes(prompt, 'browser_press_key', 'Mentions browser_press_key in workflow');
  assertIncludes(prompt, 'browser_hover', 'Mentions browser_hover in workflow');
  assertIncludes(prompt, 'Building Page Object Models', 'Has POM building workflow');
  assertIncludes(prompt, 'browser_inspect', 'Mentions browser_inspect in POM workflow');
}

// ── Test 4: Tool Registry ────────────────────────────────────────────────────

async function testToolRegistry() {
  section('Test 3: Tool registry has all expected tools');

  const registry = new ToolRegistry();
  registerCoreTools(registry);

  const tools = registry.listTools();

  // Expected tool categories (actual names from source code)
  const expectedTools: Record<string, string[]> = {
    filesystem: ['read_file', 'write_file', 'edit_file', 'list_directory', 'create_directory', 'glob_search'],
    system: ['run_command'],
    search: ['grep', 'find_replace'],
    browser: [
      'browser_launch', 'browser_navigate', 'browser_click', 'browser_type',
      'browser_press_key', 'browser_hover',
      'browser_screenshot', 'browser_inspect', 'browser_evaluate', 'browser_wait_for',
      'browser_get_text', 'browser_get_url', 'browser_select',
      'browser_close', 'browser_get_title',
    ],
    testing: ['run_tests', 'get_test_results'],
    codegen: ['generate_test_code'],
  };

  for (const [category, toolNames] of Object.entries(expectedTools)) {
    for (const name of toolNames) {
      assert(registry.has(name), `Tool registered: ${name} [${category}]`);
    }
  }

  const totalExpected = Object.values(expectedTools).flat().length;
  assert(
    registry.getToolCount() >= totalExpected,
    `Total tool count: ${registry.getToolCount()} (expected >= ${totalExpected})`,
  );

  // Check categories
  const categories = registry.getCategories();
  for (const cat of Object.keys(expectedTools)) {
    assert(categories.includes(cat), `Category exists: ${cat}`);
  }
}

// ── Test 5: Conversation Manager Smart Truncation ────────────────────────────

async function testConversationTruncation() {
  section('Test 4: Conversation manager smart truncation');

  const cm = new ConversationManager('You are a test assistant.');

  // Add a regular turn
  cm.addUserMessage('Hello');
  cm.addAssistantMessage('Hi there! How can I help?');

  // Add a turn with browser_launch (critical)
  cm.addUserMessage('Launch browser');
  cm.addToolStep(
    'I will launch the browser.',
    [{ id: 'tc1', name: 'browser_launch', arguments: { browser: 'chromium' } }],
    [{ toolCallId: 'tc1', name: 'browser_launch', result: 'Browser launched (session: abc123)', isError: false }],
  );
  cm.addAssistantMessage('Browser launched successfully.');

  // Add a turn with write_file (critical)
  cm.addUserMessage('Create a test file');
  cm.addToolStep(
    'I will create the file.',
    [{ id: 'tc2', name: 'write_file', arguments: { path: 'test.ts', content: 'test' } }],
    [{ toolCallId: 'tc2', name: 'write_file', result: 'File written', isError: false }],
  );
  cm.addAssistantMessage('File created.');

  // Add several regular turns to inflate token count
  for (let i = 0; i < 20; i++) {
    cm.addUserMessage(`Regular message ${i} - `.padEnd(500, 'x'));
    cm.addAssistantMessage(`Response ${i} - `.padEnd(500, 'x'));
  }

  const turnsBefore = cm.getTurnCount();
  assert(turnsBefore >= 22, `Has ${turnsBefore} turns before truncation`);

  // Truncate to a small limit
  const removed = cm.truncateToFit(5000);
  assert(removed > 0, `Removed ${removed} turns`);

  const turnsAfter = cm.getTurnCount();
  assert(turnsAfter < turnsBefore, `Turns reduced from ${turnsBefore} to ${turnsAfter}`);

  // Check that critical turns are preserved
  const messages = cm.buildMessages();
  const allContent = messages.map(m => m.content || '').join(' ');

  // The browser_launch and write_file turns should still be present (or summarized)
  const hasBrowserRef = allContent.includes('browser_launch') || allContent.includes('Browser launched');
  const hasWriteRef = allContent.includes('write_file') || allContent.includes('File');
  assert(hasBrowserRef, 'Browser launch context preserved after truncation');
  assert(hasWriteRef, 'Write file context preserved after truncation');

  // Regular "Hello" turn should be removed first
  const hasHello = allContent.includes('Hi there! How can I help?');
  assert(!hasHello, 'Non-critical turn removed during truncation');
}

// ── Test 6: Browser Tool Enhanced Feedback ───────────────────────────────────

async function testBrowserToolFeedback() {
  section('Test 5: Browser tools return enhanced feedback');

  // We can't test actual browser actions without Playwright running,
  // but we can verify the tool definitions are correct
  const registry = new ToolRegistry();
  registerCoreTools(registry);

  const navigateTool = registry.get('browser_navigate');
  assert(!!navigateTool, 'browser_navigate tool exists');
  assert(navigateTool!.definition.description.includes('Navigate'), 'Navigate has correct description');

  const clickTool = registry.get('browser_click');
  assert(!!clickTool, 'browser_click tool exists');
  assert(clickTool!.definition.parameters?.required?.includes('selector'), 'Click requires selector');

  const typeTool = registry.get('browser_type');
  assert(!!typeTool, 'browser_type tool exists');
  assert(typeTool!.definition.parameters?.required?.includes('text'), 'Type requires text');

  // Verify browser_click supports multiple strategies
  const clickParams = clickTool!.definition.parameters?.properties as Record<string, any>;
  assert(!!clickParams?.strategy, 'Click tool has strategy parameter');
  assertIncludes(clickParams?.strategy?.description || '', 'css', 'Click supports CSS strategy');
  assertIncludes(clickParams?.strategy?.description || '', 'testId', 'Click supports testId strategy');
}

// ── Test 7: Conversation message building ────────────────────────────────────

async function testConversationMessageBuilding() {
  section('Test 6: Conversation builds interleaved messages correctly');

  const cm = new ConversationManager('System prompt here.');

  // Simulate a multi-step tool interaction
  cm.addUserMessage('Create a playwright test for login');

  // Step 1: LLM reads file
  cm.addToolStep(
    'Let me read the existing project structure first.',
    [{ id: 'tc1', name: 'list_directory', arguments: { path: '.' } }],
    [{ toolCallId: 'tc1', name: 'list_directory', result: 'src/ tests/ package.json', isError: false }],
  );

  // Step 2: LLM writes test file
  cm.addToolStep(
    'Now I will create the test file.',
    [{ id: 'tc2', name: 'write_file', arguments: { path: 'tests/login.spec.ts', content: 'test code' } }],
    [{ toolCallId: 'tc2', name: 'write_file', result: 'File written: tests/login.spec.ts', isError: false }],
  );

  cm.addAssistantMessage('I created the login test at tests/login.spec.ts.');

  const messages = cm.buildMessages();

  // Should have: system, user, assistant+tc1, tool_result1, assistant+tc2, tool_result2, assistant_final
  assert(messages[0]!.role === 'system', 'First message is system');
  assert(messages[1]!.role === 'user', 'Second message is user');
  assert(messages[2]!.role === 'assistant', 'Third message is assistant (step 1)');
  assert(messages[2]!.toolCalls?.length === 1, 'Step 1 has 1 tool call');
  assert(messages[2]!.toolCalls![0]!.name === 'list_directory', 'Step 1 tool is list_directory');
  assert(messages[3]!.role === 'tool', 'Fourth message is tool result');
  assert(messages[3]!.toolCallId === 'tc1', 'Tool result matches tc1');
  assert(messages[4]!.role === 'assistant', 'Fifth message is assistant (step 2)');
  assert(messages[4]!.toolCalls?.[0]?.name === 'write_file', 'Step 2 tool is write_file');
  assert(messages[5]!.role === 'tool', 'Sixth message is tool result');
  assert(messages[5]!.toolCallId === 'tc2', 'Tool result matches tc2');

  // Final assistant message should be present
  const lastMsg = messages[messages.length - 1];
  assert(lastMsg!.role === 'assistant', 'Last message is assistant');
  assertIncludes(lastMsg!.content || '', 'login test', 'Final message summarizes work');
}

// ── Test 8: LLM Integration (live API call) ─────────────────────────────────

async function testLLMIntegration() {
  section('Test 7: LLM Integration (live API call)');

  // Check if we have an API key
  const hasXAI = !!process.env.XAI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasXAI && !hasOpenAI && !hasAnthropic) {
    console.log('  \x1b[33m⚠\x1b[0m Skipping LLM integration test - no API keys set');
    return;
  }

  try {
    const { Orchestrator } = await import('./src/core/orchestrator.js');

    const orchestrator = new Orchestrator(process.cwd());
    await orchestrator.initialize();

    // Test a simple non-tool request
    let response = '';
    let hasToolCalls = false;
    let hasError = false;

    for await (const chunk of orchestrator.processStream('What test frameworks do you support? Reply in one short sentence.')) {
      if (chunk.type === 'text') {
        response += chunk.content;
      } else if (chunk.type === 'tool_call') {
        hasToolCalls = true;
      } else if (chunk.type === 'error') {
        hasError = true;
        console.log(`  \x1b[33m⚠\x1b[0m LLM error: ${chunk.error}`);
      }
    }

    assert(!hasError, 'No errors from LLM');
    assert(response.length > 10, `LLM response received (${response.length} chars)`);

    // The response should mention at least one framework
    const mentionsFramework =
      response.toLowerCase().includes('playwright') ||
      response.toLowerCase().includes('cypress') ||
      response.toLowerCase().includes('selenium') ||
      response.toLowerCase().includes('puppeteer') ||
      response.toLowerCase().includes('appium');
    assert(mentionsFramework, 'LLM mentions a test framework in response');

    await orchestrator.dispose();
  } catch (error) {
    assert(false, `LLM integration failed: ${error}`);
  }
}

// ── Test 9: Orchestrator with Tool Execution ─────────────────────────────────

async function testOrchestratorToolExecution() {
  section('Test 8: Orchestrator tool execution with permission');

  const hasXAI = !!process.env.XAI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasXAI && !hasOpenAI && !hasAnthropic) {
    console.log('  \x1b[33m⚠\x1b[0m Skipping tool execution test - no API keys set');
    return;
  }

  try {
    const { Orchestrator } = await import('./src/core/orchestrator.js');

    const orchestrator = new Orchestrator(process.cwd());

    // Set up auto-approve permission callback
    orchestrator.setPermissionCallback(async (toolName: string, args: Record<string, unknown>) => {
      // Auto-approve read-only tools, deny write tools
      const readOnly = ['list_directory', 'read_file', 'glob_search', 'grep_search', 'get_test_results'];
      return { granted: readOnly.includes(toolName), remember: false };
    });

    let toolCallNames: string[] = [];
    orchestrator.setToolExecutionCallback((phase, toolName) => {
      if (phase === 'start') toolCallNames.push(toolName);
    });

    await orchestrator.initialize();

    // Ask something that should trigger a tool call
    let response = '';
    for await (const chunk of orchestrator.processStream('List the files in the current directory. Just show them briefly.')) {
      if (chunk.type === 'text') {
        response += chunk.content;
      }
    }

    assert(response.length > 0, 'Got response from orchestrator');
    // The LLM should have tried to call list_directory
    const triedListing = toolCallNames.includes('list_directory') || toolCallNames.includes('glob_search');
    assert(triedListing, `LLM called file listing tool (tools used: ${toolCallNames.join(', ')})`);

    await orchestrator.dispose();
  } catch (error) {
    assert(false, `Orchestrator tool execution failed: ${error}`);
  }
}

// ── Run All Tests ────────────────────────────────────────────────────────────

async function main() {
  console.log('\x1b[1m\x1b[35m');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  qabot End-to-End Verification Test Suite');
  console.log('═══════════════════════════════════════════════════════');
  console.log('\x1b[0m');

  const startTime = Date.now();

  try {
    await testGenerateTestCode();
    await testSystemPrompt();
    await testToolRegistry();
    await testConversationTruncation();
    await testBrowserToolFeedback();
    await testConversationMessageBuilding();
    await testLLMIntegration();
    await testOrchestratorToolExecution();
  } catch (error) {
    console.log(`\n\x1b[31mFatal error: ${error}\x1b[0m`);
    if (error instanceof Error) console.log(error.stack);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n\x1b[1m');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Results: \x1b[32m${passed} passed\x1b[0m\x1b[1m, \x1b[31m${failed} failed\x1b[0m\x1b[1m (${duration}s)`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('\x1b[0m');

  if (errors.length > 0) {
    console.log('\x1b[31mFailed tests:\x1b[0m');
    errors.forEach(e => console.log(`  - ${e}`));
  }

  // Cleanup test scaffold if it somehow still exists
  const tmpBase = resolve(process.cwd(), '.test-scaffolds');
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });

  process.exit(failed > 0 ? 1 : 0);
}

main();
