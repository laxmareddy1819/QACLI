import type { ElementFingerprint } from '../types/index.js';
import { DOMAnalyzer } from './dom-analyzer.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('ai-healer');

export interface AIHealResult {
  selector: string;
  confidence: number;
  reasoning: string;
}

export interface VisionHealResult extends AIHealResult {
  screenshotAnalyzed: boolean;
  elementDescription?: string;
}

export interface HealingTestContext {
  testName?: string;
  stepName?: string;
  scenarioName?: string;
  testFilePath?: string;
  actionType?: string;
  errorMessage?: string;
}

export interface PermanentFixSuggestion {
  originalSelector: string;
  suggestedSelector: string;
  confidence: number;
  reasoning: string;
  codeChange: string;
  selectorType: 'testId' | 'ariaLabel' | 'role' | 'css' | 'xpath' | 'text';
  stability: 'high' | 'medium' | 'low';
}

const SYSTEM_PROMPT = `You are an expert at fixing broken CSS selectors in web test automation.
Given a broken selector and the element's stored fingerprint (attributes captured when it last worked),
suggest a new CSS selector that would match the same element.

Respond ONLY with valid JSON: {"selector": "...", "confidence": 0.0-1.0, "reasoning": "..."}

Rules:
- confidence should reflect how certain you are the selector will match the correct element
- Prefer data-testid, id, aria-label selectors (most stable)
- Avoid fragile selectors (nth-child with high index, deep nesting, dynamic hash classes)
- If fingerprint has data-testid, prefer [data-testid="value"]
- If multiple attributes are available, use the most specific stable one
- If the action is "fill", "type", or "clear", prefer input/textarea/select selectors
- If the action is "click", prefer button/a/[role="button"] or clickable element selectors
- If the action is "check" or "uncheck", prefer input[type="checkbox"] selectors
- If the action is "selectOption", prefer select element selectors
- Consider the test step name to understand what element is expected
- Return exactly one selector, not multiple`;

const VISION_SYSTEM_PROMPT = `You are an expert at identifying web elements from screenshots for test automation healing.
You will be shown a screenshot of a web page and an element description. Your job is to:
1. Identify where the element should be on the page
2. Suggest a stable CSS selector to find it
3. Describe the element visually

Respond ONLY with valid JSON:
{
  "selector": "...",
  "confidence": 0.0-1.0,
  "reasoning": "...",
  "elementDescription": "Visual description of the element"
}

Rules:
- If the action is "fill"/"type", look for input fields, textareas, or editable elements
- If the action is "click", look for buttons, links, or clickable elements
- If a test step name is provided, use it to understand what element the test expects
- Prefer data-testid, id, aria-label selectors (most stable)
- Use the element description attributes to narrow down which element on the page matches`;

const FIX_SUGGESTION_PROMPT = `You are an expert test automation engineer reviewing healing events.
Based on the healing history, suggest permanent code fixes for the test selectors.

For each healing event, provide:
1. A stable replacement selector (prefer data-testid > aria-label > role-based > stable CSS)
2. The exact code change needed
3. Stability assessment

Respond with valid JSON array:
[{
  "originalSelector": "...",
  "suggestedSelector": "...",
  "confidence": 0.0-1.0,
  "reasoning": "Why this selector is more stable",
  "codeChange": "// Before: page.locator('old')\\n// After: page.locator('new')",
  "selectorType": "testId|ariaLabel|role|css|xpath|text",
  "stability": "high|medium|low"
}]`;

/**
 * AI-powered healing fallback using the configured LLM provider.
 * Used as strategy #6 when all deterministic strategies fail.
 *
 * Phase 3 additions:
 * - Vision-based healing: uses multimodal LLM with screenshots
 * - Permanent fix suggestions: analyzes healing patterns and suggests code changes
 */
export class AIHealer {
  private domAnalyzer = new DOMAnalyzer();

  /**
   * Ask the LLM to suggest a new selector (text-only, fingerprint-based).
   * Returns null if LLM is unavailable or fails.
   */
  async heal(
    originalSelector: string,
    fingerprint: ElementFingerprint,
    domSnapshot?: string,
    snapshotScope?: 'full' | 'section' | 'minimal',
    testContext?: HealingTestContext,
  ): Promise<AIHealResult | null> {
    try {
      // Dynamic import to avoid breaking if LLM is not configured
      const { getRouter } = await import('../llm/index.js');
      const router = getRouter();

      // Build DOM context if snapshot provided
      let domContext = '';
      if (domSnapshot) {
        const ctx = this.domAnalyzer.extractContext(
          domSnapshot,
          fingerprint,
          snapshotScope || 'section',
        );
        domContext = `\n\nRelevant DOM section (${ctx.size} chars):\n${ctx.html}`;
      }

      // Build test context section
      let testContextSection = '';
      if (testContext) {
        const parts: string[] = [];
        if (testContext.actionType) parts.push(`- Action: ${testContext.actionType}`);
        if (testContext.testName) parts.push(`- Test: ${testContext.testName}`);
        if (testContext.stepName) parts.push(`- Step: ${testContext.stepName}`);
        if (testContext.scenarioName) parts.push(`- Scenario: ${testContext.scenarioName}`);
        if (testContext.testFilePath) parts.push(`- File: ${testContext.testFilePath}`);
        if (testContext.errorMessage) parts.push(`- Error: ${testContext.errorMessage.slice(0, 200)}`);
        if (parts.length > 0) testContextSection = `\n\nTest context:\n${parts.join('\n')}`;
      }

      const userPrompt = `Broken selector: ${originalSelector}

Element fingerprint (from when it last worked):
- Tag: ${fingerprint.tagName}
${fingerprint.id ? `- ID: ${fingerprint.id}` : ''}
${fingerprint.testId ? `- data-testid: ${fingerprint.testId}` : ''}
${fingerprint.className ? `- Classes: ${fingerprint.className}` : ''}
${fingerprint.ariaLabel ? `- aria-label: ${fingerprint.ariaLabel}` : ''}
${fingerprint.ariaRole ? `- role: ${fingerprint.ariaRole}` : ''}
${fingerprint.name ? `- name: ${fingerprint.name}` : ''}
${fingerprint.placeholder ? `- placeholder: ${fingerprint.placeholder}` : ''}
${fingerprint.textContent ? `- Text: ${fingerprint.textContent.slice(0, 60)}` : ''}
${fingerprint.type ? `- type: ${fingerprint.type}` : ''}
${fingerprint.href ? `- href: ${fingerprint.href}` : ''}
${fingerprint.parentTag ? `- Parent tag: ${fingerprint.parentTag}` : ''}
${fingerprint.siblingIndex !== undefined ? `- Sibling index: ${fingerprint.siblingIndex}` : ''}${domContext}${testContextSection}

Suggest a new selector that would find this element.`;

      const response = await router.complete({
        messages: [
          { role: 'system' as const, content: SYSTEM_PROMPT },
          { role: 'user' as const, content: userPrompt },
        ],
        temperature: 0.2,
        maxTokens: 256,
      });

      return this.parseResponse(response.content);
    } catch (error) {
      logger.debug(`AI healing failed: ${error}`);
      return null;
    }
  }

  /**
   * Vision-based healing: uses a multimodal LLM to analyze a page screenshot
   * and suggest a selector for the target element.
   * This is used when both fingerprint-based and DOM-based strategies fail.
   */
  async healWithVision(
    originalSelector: string,
    fingerprint: ElementFingerprint,
    screenshotBase64: string,
    pageUrl: string,
    testContext?: HealingTestContext,
  ): Promise<VisionHealResult | null> {
    try {
      const { getRouter } = await import('../llm/index.js');
      const router = getRouter();

      const elementDesc = [
        `Tag: ${fingerprint.tagName}`,
        fingerprint.id ? `id: "${fingerprint.id}"` : '',
        fingerprint.testId ? `data-testid: "${fingerprint.testId}"` : '',
        fingerprint.textContent ? `Text: "${fingerprint.textContent.slice(0, 60)}"` : '',
        fingerprint.ariaLabel ? `aria-label: "${fingerprint.ariaLabel}"` : '',
        fingerprint.ariaRole ? `role: "${fingerprint.ariaRole}"` : '',
        fingerprint.name ? `name: "${fingerprint.name}"` : '',
        fingerprint.type ? `type: ${fingerprint.type}` : '',
        fingerprint.placeholder ? `placeholder: "${fingerprint.placeholder}"` : '',
        fingerprint.className ? `classes: ${fingerprint.className}` : '',
        fingerprint.href ? `href: ${fingerprint.href}` : '',
        fingerprint.parentTag ? `parent: ${fingerprint.parentTag}` : '',
      ].filter(Boolean).join(', ');

      // Build test context for vision prompt
      let contextLine = '';
      if (testContext) {
        const parts: string[] = [];
        if (testContext.actionType) parts.push(`Action: ${testContext.actionType}`);
        if (testContext.stepName) parts.push(`Step: ${testContext.stepName}`);
        if (testContext.testName) parts.push(`Test: ${testContext.testName}`);
        if (testContext.errorMessage) parts.push(`Error: ${testContext.errorMessage.slice(0, 150)}`);
        if (parts.length > 0) contextLine = `\n${parts.join(' | ')}`;
      }

      const userPrompt = `Page URL: ${pageUrl}
Broken selector: ${originalSelector}
Element description: ${elementDesc}${contextLine}

Look at the screenshot and identify this element. Suggest a stable CSS selector.`;

      // Use vision-capable message format
      const response = await router.complete({
        messages: [
          { role: 'system' as const, content: VISION_SYSTEM_PROMPT },
          {
            role: 'user' as const,
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
            ] as any,
          },
        ],
        temperature: 0.2,
        maxTokens: 512,
      });

      const result = this.parseVisionResponse(response.content);
      if (result) {
        result.screenshotAnalyzed = true;
      }
      return result;
    } catch (error) {
      logger.debug(`Vision-based healing failed: ${error}`);
      return null;
    }
  }

  /**
   * Analyze healing events and suggest permanent code fixes.
   * Reviews patterns in healed selectors and recommends stable replacements.
   */
  async suggestPermanentFixes(
    events: Array<{
      originalSelector: string;
      healedSelector?: string;
      strategy?: string;
      confidence: number;
      framework: string;
      url: string;
    }>,
  ): Promise<PermanentFixSuggestion[]> {
    if (events.length === 0) return [];

    try {
      const { getRouter } = await import('../llm/index.js');
      const router = getRouter();

      const eventSummary = events
        .filter((e) => e.healedSelector)
        .slice(0, 20) // Limit to 20 events to fit context window
        .map(
          (e, i) =>
            `${i + 1}. Original: "${e.originalSelector}" → Healed: "${e.healedSelector}" ` +
            `(strategy: ${e.strategy || 'unknown'}, confidence: ${e.confidence}, url: ${e.url})`,
        )
        .join('\n');

      if (!eventSummary) return [];

      const userPrompt = `Here are healing events where selectors broke and were auto-healed.
Suggest permanent code fixes for each to prevent future breaks:

${eventSummary}

For each event, suggest the most stable replacement selector and the code change needed.`;

      const response = await router.complete({
        messages: [
          { role: 'system' as const, content: FIX_SUGGESTION_PROMPT },
          { role: 'user' as const, content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 2048,
      });

      return this.parseFixSuggestions(response.content);
    } catch (error) {
      logger.debug(`Fix suggestion failed: ${error}`);
      return [];
    }
  }

  private parseResponse(content: string): AIHealResult | null {
    try {
      // Extract JSON — may be wrapped in markdown code blocks
      const jsonMatch = content.match(/\{[\s\S]*?"selector"[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.selector || typeof parsed.confidence !== 'number') return null;

      return {
        selector: parsed.selector,
        confidence: Math.min(Math.max(parsed.confidence, 0), 1),
        reasoning: parsed.reasoning || '',
      };
    } catch {
      return null;
    }
  }

  private parseVisionResponse(content: string): VisionHealResult | null {
    try {
      const jsonMatch = content.match(/\{[\s\S]*?"selector"[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.selector || typeof parsed.confidence !== 'number') return null;

      return {
        selector: parsed.selector,
        confidence: Math.min(Math.max(parsed.confidence, 0), 1),
        reasoning: parsed.reasoning || '',
        screenshotAnalyzed: true,
        elementDescription: parsed.elementDescription || '',
      };
    } catch {
      return null;
    }
  }

  private parseFixSuggestions(content: string): PermanentFixSuggestion[] {
    try {
      // Extract JSON array — may be wrapped in markdown
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(
          (item: any) =>
            item.originalSelector &&
            item.suggestedSelector &&
            typeof item.confidence === 'number',
        )
        .map((item: any) => ({
          originalSelector: item.originalSelector,
          suggestedSelector: item.suggestedSelector,
          confidence: Math.min(Math.max(item.confidence, 0), 1),
          reasoning: item.reasoning || '',
          codeChange: item.codeChange || '',
          selectorType: item.selectorType || 'css',
          stability: item.stability || 'medium',
        }));
    } catch {
      return [];
    }
  }
}
