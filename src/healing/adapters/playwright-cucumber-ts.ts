import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HealingAdapter, HealingAdapterConfig } from './base.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Auto-detect the hooks directory from the project's cucumber.js config.
 * Parses `--require` globs and finds the directory that contains hooks.
 *
 * Returns { hooksDir, needsCucumberJsUpdate }
 */
function detectHooksDir(projectPath: string): { hooksDir: string; needsCucumberJsUpdate: boolean; cucumberJsContent: string | null } {
  // Try multiple Cucumber config file names
  const cucumberConfigNames = ['cucumber.js', 'cucumber.mjs', 'cucumber.cjs'];
  let cucumberJsPath: string | null = null;
  let cucumberJsContent: string | null = null;

  for (const name of cucumberConfigNames) {
    const p = join(projectPath, name);
    if (existsSync(p)) {
      cucumberJsPath = p;
      cucumberJsContent = readFileSync(p, 'utf-8');
      break;
    }
  }

  if (!cucumberJsContent) {
    // No cucumber.js found — use default, will need to create one or warn
    return { hooksDir: 'src/hooks', needsCucumberJsUpdate: false, cucumberJsContent: null };
  }

  // Parse all --require patterns from the config
  const requirePatterns: string[] = [];
  const requireRegex = /--require\s+([^\s'"`,\]]+)/g;
  let match: RegExpExecArray | null;
  while ((match = requireRegex.exec(cucumberJsContent)) !== null) {
    requirePatterns.push(match[1]!);
  }

  // Find a require pattern that matches a hooks-like directory with glob
  // e.g., 'src/hooks/**/*.ts', 'features/support/**/*.ts', 'test/hooks/**/*.ts'
  for (const pattern of requirePatterns) {
    // Check if glob covers a directory that could include our hooks
    const globIndex = pattern.indexOf('/**');
    if (globIndex === -1) continue;

    const dir = pattern.slice(0, globIndex);
    // If it's a hooks-like directory (hooks, support, step_definitions dir parent)
    // OR if the glob ends with *.ts which would include our .ts files
    if (pattern.endsWith('*.ts') || pattern.endsWith('*.js')) {
      // This glob will auto-include our healing-hooks.ts file
      return { hooksDir: dir, needsCucumberJsUpdate: false, cucumberJsContent };
    }
  }

  // Also check for specific file requires (not globs)
  // e.g., '--require src/support/hooks.ts'
  for (const pattern of requirePatterns) {
    if (pattern.includes('/**') || pattern.includes('/*')) continue; // skip globs, already checked
    // Extract directory from specific file require
    const lastSlash = pattern.lastIndexOf('/');
    if (lastSlash > 0) {
      const dir = pattern.slice(0, lastSlash);
      // We'll generate in this dir but need to add our specific file to require
      return { hooksDir: dir, needsCucumberJsUpdate: true, cucumberJsContent };
    }
  }

  // No require patterns found at all — use src/hooks and update cucumber.js
  return { hooksDir: 'src/hooks', needsCucumberJsUpdate: true, cucumberJsContent };
}

/**
 * Add healing hooks require to cucumber.js config content.
 * Handles common patterns: array-based, string-based, etc.
 */
function addHealingRequire(content: string, hooksDir: string): string {
  const healingRequire = `--require ${hooksDir}/healing-hooks.ts`;

  // If content already has the healing require, skip
  if (content.includes('healing-hooks')) return content;

  // Pattern 1: Array-style config with .join(' ')
  //   const common = [ '--require ...', ... ].join(' ');
  const arrayJoinMatch = content.match(/(const\s+\w+\s*=\s*\[)([\s\S]*?)(]\s*\.join\s*\(\s*['"][^'"]*['"]\s*\))/);
  if (arrayJoinMatch) {
    const [fullMatch, prefix, items, suffix] = arrayJoinMatch;
    // Add our require as the last item before the closing bracket
    const trimmedItems = items!.trimEnd();
    const lastChar = trimmedItems.slice(-1);
    const comma = lastChar === ',' || lastChar === "'" || lastChar === '"' ? (lastChar === ',' ? '' : ',') : ',';
    const updated = `${prefix}${items!.trimEnd()}${comma}\n  '${healingRequire}'${suffix}`;
    return content.replace(fullMatch!, updated);
  }

  // Pattern 2: String concatenation or template literal
  // Try to find a --require line and add after it
  const requireLineMatch = content.match(/(.*--require\s+[^\n]+)/);
  if (requireLineMatch) {
    const lastRequireLine = requireLineMatch[0];
    // Check if it's in a string array
    if (lastRequireLine.includes("'") || lastRequireLine.includes('"')) {
      return content.replace(lastRequireLine, `${lastRequireLine}\n  '${healingRequire}',`);
    }
  }

  // Fallback: append a comment
  return content + `\n// qabot healing hooks\n// Add to your Cucumber config: ${healingRequire}\n`;
}

// ── Adapter ──────────────────────────────────────────────────────────────────

/**
 * Playwright + Cucumber (BDD) TypeScript healing adapter.
 *
 * Smart features:
 * 1. Auto-detects hooks directory from cucumber.js --require patterns
 * 2. Auto-updates cucumber.js if needed to include healing hooks
 * 3. Handles .first()/.nth()/.last() chain propagation for healing wrappers
 */
export const playwrightCucumberTsAdapter: HealingAdapter = {
  framework: 'playwright-cucumber',
  language: 'typescript',
  displayName: 'Playwright + Cucumber BDD (TypeScript)',

  generate(config: HealingAdapterConfig): Record<string, string> {
    const files: Record<string, string> = {};

    // ── Auto-detect hooks directory from cucumber.js ──────────────────
    const { hooksDir, needsCucumberJsUpdate, cucumberJsContent } = detectHooksDir(config.projectPath);

    console.log(`[qabot-heal] Auto-detected hooks directory: ${hooksDir}/`);

    // If cucumber.js needs updating, include the modified version
    if (needsCucumberJsUpdate && cucumberJsContent) {
      const updatedContent = addHealingRequire(cucumberJsContent, hooksDir);
      files['cucumber.js'] = updatedContent;
      console.log(`[qabot-heal] Auto-updated cucumber.js to include healing hooks`);
    }

    // ── Healing Client ─────────────────────────────────────────────────────
    files[`${hooksDir}/healing-client.ts`] = `/**
 * qabot Healing Client — HTTP bridge to qabot's self-healing API.
 * Auto-generated by qabot. Do not edit manually.
 */

const HEALING_SERVER = '${config.healingServerUrl}';
const CONFIDENCE_THRESHOLD = ${config.confidenceThreshold};

export interface ElementFingerprint {
  tagName: string;
  id?: string;
  testId?: string;
  className?: string;
  ariaLabel?: string;
  ariaRole?: string;
  name?: string;
  placeholder?: string;
  textContent?: string;
  href?: string;
  type?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  parentTag?: string;
  siblingIndex?: number;
  childCount?: number;
}

export interface HealResult {
  healed: boolean;
  selector?: string;
  selectorStrategy?: string;
  confidence: number;
  strategy?: string;
  durationMs: number;
  candidates?: Array<{ selector: string; strategy: string }>;
}

export class HealingClient {
  private serverUrl: string;

  constructor(serverUrl: string = HEALING_SERVER) {
    this.serverUrl = serverUrl;
  }

  async storeFingerprint(selectorKey: string, url: string, fingerprint: ElementFingerprint, testContext?: { scenarioName?: string; stepName?: string }): Promise<void> {
    try {
      await fetch(\`\${this.serverUrl}/api/heal/fingerprint\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectorKey, url, fingerprint, framework: 'playwright-cucumber', testContext }),
      });
    } catch {
      // qabot server not running — continue silently
    }
  }

  async resolve(selector: string, pageUrl: string, fingerprint?: ElementFingerprint, errorMessage?: string): Promise<HealResult | null> {
    try {
      const resp = await fetch(\`\${this.serverUrl}/api/heal/resolve\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selector,
          selectorStrategy: 'css',
          fingerprint,
          pageUrl,
          framework: 'playwright-cucumber',
          language: 'typescript',
          errorMessage,
        }),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as HealResult;
      if (data.healed && data.confidence >= CONFIDENCE_THRESHOLD) return data;
      return data.healed ? data : null;
    } catch {
      return null;
    }
  }

  async resolveAI(selector: string, pageUrl: string, errorMessage?: string, testContext?: { testName?: string; stepName?: string; scenarioName?: string; actionType?: string }): Promise<HealResult | null> {
    try {
      const resp = await fetch(\`\${this.serverUrl}/api/heal/resolve\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selector,
          selectorStrategy: 'css',
          pageUrl,
          framework: 'playwright-cucumber',
          language: 'typescript',
          errorMessage,
          requestAI: true,
          testContext,
        }),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as HealResult;
      if (data.healed && data.selector) return data;
      return null;
    } catch {
      return null;
    }
  }

  async resolveVision(selector: string, pageUrl: string, screenshotBase64: string, testContext?: { testName?: string; stepName?: string; scenarioName?: string; actionType?: string; errorMessage?: string }): Promise<HealResult | null> {
    try {
      const resp = await fetch(\`\${this.serverUrl}/api/heal/vision\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selector,
          pageUrl,
          screenshotBase64,
          framework: 'playwright-cucumber',
          language: 'typescript',
          errorMessage: testContext?.errorMessage,
          testContext,
        }),
      });
      if (!resp.ok) return null;
      const data = await resp.json() as HealResult;
      if (data.healed && data.selector) return data;
      return null;
    } catch {
      return null;
    }
  }

  async report(selectorKey: string, url: string, healed: boolean, healedSelector?: string, confidence?: number, strategy?: string, durationMs?: number, testContext?: { scenarioName?: string; stepName?: string; actionType?: string }): Promise<void> {
    try {
      await fetch(\`\${this.serverUrl}/api/heal/report\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectorKey,
          url,
          healed,
          healedSelector,
          confidence,
          strategy,
          framework: 'playwright-cucumber',
          language: 'typescript',
          originalSelector: selectorKey,
          durationMs: durationMs || 0,
          testContext,
        }),
      });
    } catch {
      // Silently ignore
    }
  }
}

/**
 * Capture an element's fingerprint for self-healing baseline storage.
 *
 * Uses page.evaluate() with document.querySelector() — this runs directly in
 * the browser DOM and naturally returns the FIRST matching element. Unlike
 * page.$eval() and locator.evaluate(), querySelector never throws strict mode
 * violations when a selector matches multiple elements.
 *
 * IMPORTANT: The selector is embedded directly into the expression string via
 * JSON.stringify() (IIFE pattern) rather than passed as a separate argument.
 * When page.evaluate() receives a STRING function, Playwright does not reliably
 * pass the second argument to the browser context — the arg is silently lost
 * and querySelector receives undefined, always returning null.
 *
 * Limitation: only works for CSS selectors. Playwright-specific selectors
 * (text="...", role=, :has-text) return null (querySelector doesn't understand
 * them). This is acceptable because the vast majority of page.locator() calls
 * use CSS selectors; getByText/getByRole use different APIs not wrapped here.
 */
export async function captureFingerprint(
  page: any,
  selector: string,
): Promise<ElementFingerprint | null> {
  try {
    return await page.evaluate(\`(() => {
      const el = document.querySelector(\${JSON.stringify(selector)});
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        tagName: el.tagName.toLowerCase(),
        id: el.id || undefined,
        testId: el.getAttribute('data-testid') || undefined,
        className: el.className || undefined,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        ariaRole: el.getAttribute('role') || undefined,
        name: el.getAttribute('name') || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        textContent: (el.textContent || '').trim().slice(0, 100) || undefined,
        href: el.href || undefined,
        type: el.type || undefined,
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : undefined,
        siblingIndex: el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : undefined,
        childCount: el.children.length,
      };
    })()\`);
  } catch {
    return null;
  }
}

/**
 * Capture fingerprint using a Playwright locator directly (fallback for getBy* selectors).
 *
 * document.querySelector() cannot resolve Playwright-specific selectors like
 * getByText, getByRole, getByLabel etc. This function uses the locator's own
 * .evaluate() method to extract DOM attributes from the matched element.
 * Called when captureFingerprint() returns null for non-CSS selectors.
 */
export async function captureFingerprintFromLocator(
  locator: any,
): Promise<ElementFingerprint | null> {
  try {
    return await locator.first().evaluate((el: Element) => {
      const rect = el.getBoundingClientRect();
      return {
        tagName: el.tagName.toLowerCase(),
        id: el.getAttribute('id') || undefined,
        testId: el.getAttribute('data-testid') || undefined,
        className: el.getAttribute('class') || undefined,
        ariaLabel: el.getAttribute('aria-label') || undefined,
        ariaRole: el.getAttribute('role') || undefined,
        name: el.getAttribute('name') || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        textContent: (el.textContent || '').trim().slice(0, 100) || undefined,
        href: el.getAttribute('href') || undefined,
        type: el.getAttribute('type') || undefined,
        boundingBox: rect.width > 0 ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined,
        parentTag: el.parentElement ? el.parentElement.tagName.toLowerCase() : undefined,
        siblingIndex: el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : undefined,
        childCount: el.children.length,
      };
    }) as ElementFingerprint | null;
  } catch {
    return null;
  }
}
`;

    // ── Cucumber Healing Hooks ──────────────────────────────────────────────
    files[`${hooksDir}/healing-hooks.ts`] = `/**
 * qabot Self-Healing Cucumber Hooks.
 * Auto-generated by qabot. Do not edit manually.
 *
 * These hooks integrate self-healing into Cucumber BDD tests that use
 * Playwright as their browser engine. They wrap page.locator() via a
 * BeforeStep hook so that locator failures are automatically healed.
 *
 * Features:
 * - Auto-heals broken selectors via qabot's healing API
 * - Selector cache: healed selectors persist for the scenario lifetime
 * - Locator upgrade: after healing, the locator object is upgraded in-place
 * - Propagates healing through .first()/.nth()/.last() chains
 * - Logs healed selectors to console with color-coded output
 * - Warns if healing server is not running
 */
import { BeforeStep, After } from '@cucumber/cucumber';
import { HealingClient, captureFingerprint, captureFingerprintFromLocator, type ElementFingerprint } from './healing-client';

const HEALING_SERVER = '${config.healingServerUrl}';
const client = new HealingClient();
const healingLog: Array<{ selector: string; healed: string; confidence: number; strategy: string }> = [];
/** Pending report/fingerprint promises — flushed in After hook so the scenario doesn't exit mid-flight. */
const pendingReports: Array<Promise<void>> = [];
/** Selectors already fingerprinted this scenario — prevents redundant baseline captures. */
const fingerprintedSelectors = new Set<string>();
let healingStatusLogged = false;

// Interaction methods: throw on element-not-found → healing is appropriate
const HEAL_METHODS = [
  'click', 'dblclick', 'fill', 'type', 'check', 'uncheck', 'selectOption',
  'hover', 'focus', 'press', 'scrollIntoViewIfNeeded', 'waitFor', 'tap',
  'setInputFiles', 'selectText', 'clear', 'inputValue', 'textContent',
  'innerText', 'innerHTML', 'getAttribute',
];

// State-probe methods: return boolean/number (no throw) → fingerprint-only, no healing
// count() returns a number — truthy (>0) triggers fingerprint capture, same as boolean probes
const PROBE_METHODS = [
  'isVisible', 'isEnabled', 'isChecked', 'isDisabled', 'isEditable', 'isHidden', 'count',
];

// Chain methods that return sub-locators
const CHAIN_METHODS = ['first', 'last', 'nth', 'filter', 'locator'];

/**
 * Upgrade a locator object in-place: rebind ALL methods to the healed locator.
 * After healing succeeds, subsequent calls (like isVisible after waitFor)
 * will operate on the healed element instead of the broken original.
 *
 * CRITICAL: Must include PROBE_METHODS (isVisible, isEnabled, etc.) — not just
 * HEAL_METHODS. FallbackLocator-style patterns call waitFor() then isVisible().
 * If isVisible still points at the broken selector, it returns false and the
 * caller rejects the healed locator.
 */
function upgradeLocator(loc: any, healedLoc: any): void {
  for (const m of [...HEAL_METHODS, ...PROBE_METHODS, ...CHAIN_METHODS]) {
    if (typeof healedLoc[m] === 'function') {
      loc[m] = healedLoc[m].bind(healedLoc);
    }
  }
}

/**
 * Wrap all action methods on a locator with self-healing.
 * Also propagates wrappers through .first()/.nth()/.last() chains.
 *
 * @param selectorCache — shared Map<brokenSelector, healedSelector> for
 *   pre-resolving selectors in future page.locator() calls.
 */
function wrapLocatorActions(
  loc: any,
  selector: string,
  originalLocator: (...args: any[]) => any,
  page: any,
  selectorCache: Map<string, string>,
): void {
  // Skip if already wrapped
  if (loc.__qabotWrapped) return;
  loc.__qabotWrapped = true;

  // ── HEAL_METHODS: wrap with self-healing on element-not-found ──
  for (const methodName of HEAL_METHODS) {
    const original = loc[methodName]?.bind(loc);
    if (typeof original !== 'function') continue;

    loc[methodName] = async (...args: any[]) => {
      // Pre-capture fingerprint baseline BEFORE calling the action.
      //
      // Why before? Actions like click() can cause page navigation. Once the
      // page navigates, the element is gone and captureFingerprint returns null.
      // Awaiting here is safe — deduplication guarantees this runs at most once
      // per selector per scenario, so it adds negligible overhead.
      //
      // We also snapshot page.url() now; after navigation it will have changed.
      let preCapture: ElementFingerprint | null = null;
      let preCaptureUrl = '';
      if (!fingerprintedSelectors.has(selector)) {
        preCaptureUrl = page.url();
        preCapture = await captureFingerprint(page, selector).catch(() => null);
        // Fallback: for getBy* selectors, querySelector can't resolve them.
        // Use the locator's own evaluate() to extract the fingerprint directly.
        if (!preCapture) {
          preCapture = await captureFingerprintFromLocator(loc).catch(() => null);
        }
      }

      try {
        const result = await original(...args);
        // Action succeeded — store the pre-captured fingerprint (deduped)
        if (preCapture && !fingerprintedSelectors.has(selector)) {
          fingerprintedSelectors.add(selector);
          const fpContext = {
            ...(page.__qabotScenarioName ? { scenarioName: page.__qabotScenarioName } : {}),
            ...(page.__qabotStepName ? { stepName: page.__qabotStepName } : {}),
          };
          const fpKey = selector.startsWith('getBy') ? selector : \`css:\${selector}\`;
          const fpPromise = client.storeFingerprint(fpKey, preCaptureUrl, preCapture, fpContext).catch(() => {});
          pendingReports.push(fpPromise);
        }
        return result;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '';

        // ── Strict mode violation: selector found multiple elements ──
        // The selector works but is ambiguous. Standard healing (find a new selector)
        // won't help here. Instead, auto-disambiguate by targeting .first() — this
        // resolves most SPA cases (hidden overlay/duplicate inputs, ghost elements).
        // loc.first() returns a plain (unwrapped) Playwright locator, so no recursion.
        if (errMsg.includes('strict mode violation')) {
          try {
            const firstLoc = loc.first();
            const result = await (firstLoc as any)[methodName](...args);
            console.log(
              \`[qabot-heal] ⚠️  Strict mode: "\${selector}" matched multiple elements. \` +
              \`Auto-disambiguated with .first() — consider making your selector more specific.\`
            );
            // Capture fingerprint on strict-mode success (element is on-page right now)
            if (!fingerprintedSelectors.has(selector)) {
              let fp = await captureFingerprint(page, selector).catch(() => null);
              if (!fp) fp = await captureFingerprintFromLocator(loc).catch(() => null);
              if (fp) {
                fingerprintedSelectors.add(selector);
                const fpContext = {
                  ...(page.__qabotScenarioName ? { scenarioName: page.__qabotScenarioName } : {}),
                  ...(page.__qabotStepName ? { stepName: page.__qabotStepName } : {}),
                };
                const fpKey = selector.startsWith('getBy') ? selector : \`css:\${selector}\`;
                pendingReports.push(client.storeFingerprint(fpKey, page.url(), fp, fpContext).catch(() => {}));
              }
            }
            return result;
          } catch {
            // .first() also failed — throw the original strict mode error
            throw error;
          }
        }

        // Only heal when the element wasn't found / doesn't match.
        // Skip healing for errors where the element WAS found but action failed
        // for other reasons (popup overlay blocking clicks, navigation timeout, etc.)
        const isElementNotFound =
          errMsg.includes('waiting for locator') ||
          errMsg.includes('resolved to 0 elements') ||
          errMsg.includes('no element matches') ||
          errMsg.includes('Element is not') ||
          errMsg.includes('element is not') ||
          errMsg.includes('not attached') ||
          errMsg.includes('Target closed') ||
          errMsg.includes('frame was detached');
        const isInterception =
          errMsg.includes('intercepts pointer events') ||
          errMsg.includes('element is outside of the viewport');

        if (isInterception || (!isElementNotFound && errMsg.includes('Timeout'))) {
          // Element exists but action can't reach it — healing won't help
          throw error;
        }

        // Element not found — try healing with 3-phase strategy chain
        const selectorKey = selector.startsWith('getBy') ? selector : \`css:\${selector}\`;

        // Build test context for AI healing (methodName = 'click', 'fill', etc.)
        const testContext = {
          actionType: methodName,
          ...(page.__qabotScenarioName ? { scenarioName: page.__qabotScenarioName } : {}),
          ...(page.__qabotStepName ? { stepName: page.__qabotStepName } : {}),
        };

        // ── Phase 1: Deterministic candidates (fingerprint, similarSelector, textMatch, ancestorSearch) ──
        const healResult = await client.resolve(selector, page.url(), undefined, errMsg);
        if (healResult && healResult.selector && healResult.selector !== selector) {
          // Build ordered candidate list: best first, then remaining from candidates array
          const candidateSelectors: Array<{ selector: string; strategy: string }> = [
            { selector: healResult.selector, strategy: healResult.strategy || 'fingerprint' },
          ];
          if (healResult.candidates) {
            for (const c of healResult.candidates) {
              if (c.selector !== selector && c.selector !== healResult.selector) {
                candidateSelectors.push(c);
              }
            }
          }

          for (let i = 0; i < candidateSelectors.length; i++) {
            const candidate = candidateSelectors[i]!;
            console.log(
              \`[qabot-heal] \${i === 0 ? 'Trying' : 'Fallback'}: "\\x1b[31m\${selector}\\x1b[0m" → "\\x1b[32m\${candidate.selector}\\x1b[0m" \` +
              \`(strategy: \${candidate.strategy}\${i > 0 ? \`, attempt \${i + 1}/\${candidateSelectors.length}\` : ''})\`
            );
            const healedLoc = originalLocator(candidate.selector);
            try {
              const result = await healedLoc[methodName](...args);
              healingLog.push({ selector, healed: candidate.selector, confidence: healResult.confidence, strategy: candidate.strategy });
              upgradeLocator(loc, healedLoc);
              selectorCache.set(selector, candidate.selector);
              pendingReports.push(client.report(selectorKey, page.url(), true, candidate.selector, healResult.confidence, candidate.strategy, undefined, testContext).catch(() => {}));
              return result;
            } catch {
              // This candidate failed — try next
            }
          }
        }

        // ── Phase 2: AI text-based healing (LLM fallback) ──
        try {
          const aiResult = await client.resolveAI(selector, page.url(), errMsg, testContext);
          if (aiResult && aiResult.selector && aiResult.selector !== selector) {
            console.log(
              \`[qabot-heal] AI: "\\x1b[31m\${selector}\\x1b[0m" → "\\x1b[35m\${aiResult.selector}\\x1b[0m" \` +
              \`(confidence: \${Math.round(aiResult.confidence * 100)}%, strategy: aiHealing)\`
            );
            const aiLoc = originalLocator(aiResult.selector);
            try {
              const result = await aiLoc[methodName](...args);
              healingLog.push({ selector, healed: aiResult.selector, confidence: aiResult.confidence, strategy: 'aiHealing' });
              upgradeLocator(loc, aiLoc);
              selectorCache.set(selector, aiResult.selector);
              pendingReports.push(client.report(selectorKey, page.url(), true, aiResult.selector, aiResult.confidence, 'aiHealing', undefined, testContext).catch(() => {}));
              return result;
            } catch {
              // AI suggestion didn't work — try vision
            }
          }
        } catch {
          // AI healing unavailable
        }

        // ── Phase 3: Vision healing (screenshot + multimodal LLM) ──
        try {
          const screenshotBuf = await page.screenshot({ type: 'png' });
          const screenshotBase64 = screenshotBuf.toString('base64');
          const visionResult = await client.resolveVision(selector, page.url(), screenshotBase64, { ...testContext, errorMessage: errMsg });
          if (visionResult && visionResult.selector && visionResult.selector !== selector) {
            console.log(
              \`[qabot-heal] Vision: "\\x1b[31m\${selector}\\x1b[0m" → "\\x1b[36m\${visionResult.selector}\\x1b[0m" \` +
              \`(confidence: \${Math.round(visionResult.confidence * 100)}%, strategy: visionHealing)\`
            );
            const visionLoc = originalLocator(visionResult.selector);
            try {
              const result = await visionLoc[methodName](...args);
              healingLog.push({ selector, healed: visionResult.selector, confidence: visionResult.confidence, strategy: 'visionHealing' });
              upgradeLocator(loc, visionLoc);
              selectorCache.set(selector, visionResult.selector);
              pendingReports.push(client.report(selectorKey, page.url(), true, visionResult.selector, visionResult.confidence, 'visionHealing', undefined, testContext).catch(() => {}));
              return result;
            } catch {
              // Vision suggestion didn't work either
            }
          }
        } catch {
          // Screenshot or vision healing unavailable
        }

        // All strategies exhausted — report failure and throw original error
        pendingReports.push(client.report(selectorKey, page.url(), false, undefined, undefined, undefined, undefined, testContext).catch(() => {}));
        throw error;
      }
    };
  }

  // ── PROBE_METHODS: fingerprint-only on truthy result, no healing ──
  for (const methodName of PROBE_METHODS) {
    const original = loc[methodName]?.bind(loc);
    if (typeof original !== 'function') continue;

    loc[methodName] = async (...args: any[]) => {
      const result = await original(...args);
      // Capture fingerprint when element is found/visible/enabled (deduped).
      //
      // CRITICAL: await captureFingerprint HERE — do NOT fire-and-forget.
      // The element is guaranteed on-page right now (result just returned truthy).
      // Fire-and-forget runs after the caller continues (scrollTo → click → navigate)
      // so by the time the promise executes, the element is gone and evaluate times out.
      //
      // IMPORTANT: Only mark as fingerprinted AFTER capture succeeds (not before).
      // If capture fails (e.g. transient issue), we want to retry on the next call.
      if (result && !fingerprintedSelectors.has(selector)) {
        const fpContext = {
          ...(page.__qabotScenarioName ? { scenarioName: page.__qabotScenarioName } : {}),
          ...(page.__qabotStepName ? { stepName: page.__qabotStepName } : {}),
        };
        const currentUrl = page.url();
        let fp = await captureFingerprint(page, selector).catch(() => null);
        if (!fp) fp = await captureFingerprintFromLocator(loc).catch(() => null);
        if (fp) {
          fingerprintedSelectors.add(selector);
          const fpKey = selector.startsWith('getBy') ? selector : \`css:\${selector}\`;
          pendingReports.push(client.storeFingerprint(fpKey, currentUrl, fp, fpContext).catch(() => {}));
        }
      }
      return result;
    };
  }

  // ── Propagate healing wrappers through .first() / .last() chains ──
  // Pass a chained factory so the healed locator preserves .first()/.last() context.
  // Without this, healing creates a base locator that hits strict mode violations.
  for (const sub of ['first', 'last'] as const) {
    const origSub = loc[sub]?.bind(loc);
    if (typeof origSub !== 'function') continue;
    loc[sub] = () => {
      const subLoc = origSub();
      const chainedFactory = (sel: string) => originalLocator(sel)[sub]();
      wrapLocatorActions(subLoc, selector, chainedFactory, page, selectorCache);
      return subLoc;
    };
  }

  // ── Propagate through .nth(index) ──
  const origNth = loc.nth?.bind(loc);
  if (typeof origNth === 'function') {
    loc.nth = (index: number) => {
      const subLoc = origNth(index);
      const chainedFactory = (sel: string) => originalLocator(sel).nth(index);
      wrapLocatorActions(subLoc, selector, chainedFactory, page, selectorCache);
      return subLoc;
    };
  }

  // ── Propagate through .filter() ──
  const origFilter = loc.filter?.bind(loc);
  if (typeof origFilter === 'function') {
    loc.filter = (options: any) => {
      const subLoc = origFilter(options);
      const chainedFactory = (sel: string) => originalLocator(sel).filter(options);
      wrapLocatorActions(subLoc, selector, chainedFactory, page, selectorCache);
      return subLoc;
    };
  }
}

/**
 * Wraps page.locator() to add self-healing on element-not-found failures.
 *
 * Key features:
 * - Selector cache: previously healed selectors are resolved before locator creation
 * - Locator upgrade: after healing, the locator is upgraded in-place
 * - Chain propagation: .first()/.nth()/.last()/.filter() carry healing wrappers
 */
function wrapPageWithHealing(page: any): void {
  if (!page || page.__qabotHealingWrapped) return;
  page.__qabotHealingWrapped = true;

  const originalLocator = page.locator.bind(page);
  const selectorCache = new Map<string, string>();

  page.locator = (selector: string, options?: any) => {
    // Pre-resolve: if this selector was previously healed, use the healed version
    const resolved = selectorCache.get(selector) || selector;
    const loc = originalLocator(resolved, options);
    wrapLocatorActions(loc, selector, originalLocator, page, selectorCache);
    return loc;
  };

  // ── Wrap getBy* methods for healing + fingerprinting ──────────────────────
  // Playwright's page.getByText(), page.getByRole(), etc. return Locators that
  // bypass page.locator() — wrapping them enables healing + fingerprinting for
  // built-in semantic selectors (text, role, label, etc.).
  // captureFingerprint (querySelector) returns null for these selectors, but
  // captureFingerprintFromLocator (locator.evaluate) extracts the fingerprint.
  const GETBY_METHODS = ['getByText', 'getByRole', 'getByTestId', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle'];
  for (const method of GETBY_METHODS) {
    const origMethod = (page as any)[method]?.bind(page);
    if (typeof origMethod !== 'function') continue;
    (page as any)[method] = (...args: any[]) => {
      const loc = origMethod(...args);
      const selectorDesc = \`\${method}:\${typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0])}\`;
      wrapLocatorActions(loc, selectorDesc, originalLocator, page, selectorCache);
      return loc;
    };
  }
}

/**
 * BeforeStep: wrap the page object with healing capabilities.
 *
 * Uses BeforeStep instead of Before because Cucumber runs Before hooks in
 * file-load order — healing-hooks.ts loads before hooks.ts (alphabetical),
 * so a Before hook here would run BEFORE the page is created.
 * BeforeStep runs before each step, AFTER all Before hooks have completed,
 * guaranteeing this.page exists. The __qabotHealingWrapped guard ensures
 * wrapping only happens once per scenario (O(1) check on subsequent steps).
 */
BeforeStep({ tags: 'not @no-healing' }, async function (testStepResult) {
  const world = this as any;
  if (world.page && !world.page.__qabotHealingWrapped) {
    wrapPageWithHealing(world.page);
  }

  // Capture test context on page for AI healing (scenario + step name)
  if (world.page) {
    world.page.__qabotScenarioName = world.pickle?.name || '';
    const step = testStepResult?.pickleStep || world.pickle?.steps?.[0];
    world.page.__qabotStepName = step?.text || '';
  }

  // One-time: check healing server connectivity and log status
  if (!healingStatusLogged) {
    healingStatusLogged = true;
    try {
      const resp = await fetch(\`\${HEALING_SERVER}/api/heal/events\`, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) {
        console.log(\`[qabot-heal] ✅ Connected to healing server at \${HEALING_SERVER}\`);
      } else {
        console.log(\`[qabot-heal] ⚠️  Healing server responded with status \${resp.status} — healing may not work\`);
      }
    } catch {
      console.log(\`[qabot-heal] ⚠️  Healing server not running at \${HEALING_SERVER} — auto-healing disabled\`);
    }
  }
});

/**
 * After each scenario: flush pending reports, log healing summary, reset state.
 */
After({ name: 'qabot-healing-report' }, async function () {
  // Flush all pending report/fingerprint promises before the scenario exits
  if (pendingReports.length > 0) {
    await Promise.allSettled(pendingReports);
    pendingReports.length = 0;
  }

  // Log healing summary if any selectors were healed
  if (healingLog.length > 0) {
    console.log(\`\\n[qabot-heal] Scenario healed \${healingLog.length} selector(s):\`);
    for (const entry of healingLog) {
      console.log(\`  \\x1b[31m\${entry.selector}\\x1b[0m → \\x1b[32m\${entry.healed}\\x1b[0m (\${Math.round(entry.confidence * 100)}%)\`);
    }
    healingLog.length = 0;
  }

  // Reset fingerprint deduplication for the next scenario
  fingerprintedSelectors.clear();
});
`;

    return files;
  },

  getIntegrationInstructions(config: HealingAdapterConfig): string {
    const { hooksDir } = detectHooksDir(config.projectPath);
    return `
## Playwright + Cucumber Self-Healing Integration

### Generated Files:
- ${hooksDir}/healing-client.ts — HTTP client for qabot healing API
- ${hooksDir}/healing-hooks.ts — Cucumber Before/After hooks with self-healing

### Setup:
1. Start qabot UI server: \`qabot /buildUI\` or \`qabot\` then \`/ui\`
2. Run tests normally — healing hooks are auto-configured in your cucumber.js

### How It Works:
- The healing Before hook wraps \`this.page.locator()\` with self-healing
- Healing propagates through \`.first()\`, \`.nth()\`, \`.last()\`, \`.filter()\` chains
- On success: captures element fingerprints and stores them via qabot API
- On failure: requests healed selectors from qabot's healing engine, retries
- Logs healed selectors to console: [qabot-heal] Healed: "old" → "new"
- After each scenario: shows healing summary if any selectors were healed
- Skip healing for specific scenarios with \`@no-healing\` tag
- All healing events are tracked in qabot's dashboard at ${config.healingServerUrl}/healing

### Notes:
- Works with CustomWorld pattern (this.page)
- Compatible with BrowserActions, FallbackLocator, BasePage patterns
- Handles .first()/.nth()/.last()/.filter() Locator chains correctly
- Works with local browsers and cloud providers (BrowserStack, LambdaTest, SauceLabs)
`.trim();
  },
};
