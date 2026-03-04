import type { ElementSelector, SelectorStrategy } from '../types/index.js';

interface SelectorCandidate {
  strategy: SelectorStrategy;
  value: string;
  score: number;
}

const DYNAMIC_CLASS_PATTERN = /[a-z]*[-_][a-f0-9]{4,}|css[-_]\w+|sc[-_]\w{5,}|^[A-Z]\w+__\w+|styled\w+|^_|__\w{5,}|^jsx-/i;
const DYNAMIC_ID_PATTERN = /[a-z]+-[a-f0-9]{5,}|^:[a-z]|^react-|^__next|^radix-|^headlessui-/i;

/**
 * Checks if a string looks like a stable, meaningful value (not random/dynamic).
 */
function isStableValue(val: string): boolean {
  if (!val || val.length === 0) return false;
  // Too short to be meaningful
  if (val.length < 2) return false;
  // Contains obvious hash patterns
  if (/[a-f0-9]{8,}/i.test(val)) return false;
  // Looks like a UUID
  if (/^[a-f0-9]{8}-[a-f0-9]{4}/i.test(val)) return false;
  return true;
}

/**
 * Clean text for use in selectors — remove extra whitespace, normalize.
 */
function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Escape a CSS selector value — handle special chars in attribute values.
 */
function cssEscapeAttr(val: string): string {
  return val.replace(/"/g, '\\"');
}

/**
 * Escape a value for safe use in XPath contains() — handles single/double quotes.
 */
function xpathEscape(val: string): string {
  if (!val.includes("'")) return `'${val}'`;
  if (!val.includes('"')) return `"${val}"`;
  // Contains both — use concat
  const parts = val.split("'");
  return `concat('${parts.join("',\"'\",'")}')`;
}

/**
 * SelectorGenerator — prioritizes CSS selectors, XPath, and text-based
 * locators for maximum framework compatibility.
 *
 * Priority order:
 *   1. data-testid (CSS)        — universal, explicit test hook      (100)
 *   2. CSS #id                   — universal, stable                  (95)
 *   3. CSS [name=...]            — universal, form fields             (90)
 *   4. CSS [placeholder=...]     — universal, input fields            (88)
 *   5. CSS tag.class             — universal, stable classes          (85)
 *   6. img[alt=...]              — images with alt text               (83)
 *   7. Text content              — framework-native (getByText)       (82)
 *   8. XPath by text             — universal fallback for text        (78)
 *   9. CSS [title=...]           — universal attribute selector       (76)
 *  10. Partial text (long text)  — first 40 chars of long text        (75)
 *  11. CSS tag[type=...]         — for input elements                 (72)
 *  12. CSS a[href=...]           — for links with stable href         (70)
 *  13. Partial text XPath        — XPath contains for long text       (68)
 *  14. closestHref CSS           — non-link elements inside links     (65)
 *  15. ARIA role + name          — Playwright-specific fallback       (55)
 *  16. aria-label CSS            — accessibility selector             (52)
 *  17. Associated label          — for form fields                    (48)
 *  18. Parent-context CSS        — ancestor#id + tag.class            (40)
 *  19. CSS path                  — last resort, fragile               (20)
 */
export class SelectorGenerator {
  generate(element: {
    tagName: string;
    id?: string | null;
    testId?: string | null;
    className?: string | null;
    ariaLabel?: string | null;
    ariaRole?: string | null;
    name?: string | null;
    placeholder?: string | null;
    textContent?: string | null;
    innerText?: string | null;
    label?: string | null;
    type?: string | null;
    title?: string | null;
    value?: string | null;
    cssPath?: string | null;
    href?: string | null;
    checked?: boolean | null;
    isDisabled?: boolean | null;
    alt?: string | null;
    src?: string | null;
    closestHref?: string | null;
  }): ElementSelector {
    const candidates: SelectorCandidate[] = [];

    // ── 1. data-testid (score: 100) — Explicit test hooks, highest priority, universal
    if (element.testId) {
      candidates.push({ strategy: 'testId', value: element.testId, score: 100 });
      // Also add as CSS attribute selector for universal compatibility
      candidates.push({ strategy: 'css', value: `[data-testid="${element.testId}"]`, score: 99 });
    }

    // ── 2. CSS #id (score: 95) — Universal, only if non-dynamic
    if (element.id && !DYNAMIC_ID_PATTERN.test(element.id) && isStableValue(element.id)) {
      candidates.push({ strategy: 'css', value: `#${element.id}`, score: 95 });
    }

    // ── 3. CSS [name=...] (score: 90) — Universal for form fields
    if (element.name && isStableValue(element.name)) {
      candidates.push({
        strategy: 'css',
        value: `${element.tagName}[name="${element.name}"]`,
        score: 90,
      });
    }

    // ── 4. CSS [placeholder=...] (score: 88) — Universal for inputs
    if (element.placeholder && isStableValue(element.placeholder)) {
      candidates.push({
        strategy: 'css',
        value: `${element.tagName}[placeholder="${element.placeholder}"]`,
        score: 88,
      });
      // Also keep as Playwright-native placeholder strategy as fallback
      candidates.push({ strategy: 'placeholder', value: element.placeholder, score: 60 });
    }

    // ── 5. CSS tag.class (score: 85) — Universal, only stable classes
    if (element.className) {
      const classes = element.className
        .split(/\s+/)
        .filter((c: string) => c && !DYNAMIC_CLASS_PATTERN.test(c) && c.length > 2 && c.length < 40);
      if (classes.length > 0 && classes.length <= 3) {
        const selector = `${element.tagName}.${classes.join('.')}`;
        candidates.push({ strategy: 'css', value: selector, score: 85 });
      }
    }

    // ── 6. img[alt=...] (score: 83) — For images with meaningful alt text
    if (element.alt && element.tagName === 'img' && isStableValue(element.alt)) {
      const escapedAlt = cssEscapeAttr(cleanText(element.alt));
      candidates.push({
        strategy: 'css',
        value: `img[alt="${escapedAlt}"]`,
        score: 83,
      });
    }

    // ── 7. Text content (score: 82) — Framework-native text matching
    const textValue = cleanText(element.textContent || element.innerText || '');
    if (textValue && textValue.length >= 2 && textValue.length < 60 && isStableValue(textValue)) {
      candidates.push({ strategy: 'text', value: textValue, score: 82 });
    }

    // ── 8. XPath by text (score: 78) — Universal text-based XPath
    if (textValue && textValue.length >= 2 && textValue.length < 60 && isStableValue(textValue)) {
      const xpathVal = xpathEscape(textValue);
      candidates.push({
        strategy: 'xpath',
        value: `//${element.tagName}[contains(text(), ${xpathVal})]`,
        score: 78,
      });
    }

    // ── 9. CSS [title=...] (score: 76) — Universal attribute selector
    if (element.title && isStableValue(element.title)) {
      candidates.push({ strategy: 'css', value: `[title="${element.title}"]`, score: 76 });
    }

    // ── 10. Partial text match (score: 75) — First chunk of long text
    // When text is >= 60 chars, use first 40 chars as a substring match
    const rawText = cleanText(element.textContent || element.innerText || '');
    if (rawText && rawText.length >= 60) {
      const partialText = rawText.slice(0, 40).trim();
      if (isStableValue(partialText)) {
        candidates.push({ strategy: 'text', value: partialText, score: 75 });
      }
    }

    // ── 11. CSS tag[type=...] (score: 72) — For input elements
    if (element.type && element.tagName === 'input' &&
        ['checkbox', 'radio', 'submit', 'button', 'file', 'range'].includes(element.type)) {
      candidates.push({
        strategy: 'css',
        value: `input[type="${element.type}"]`,
        score: 72,
      });
    }

    // ── 12. CSS a[href=...] (score: 70) — For links with stable href
    if (element.href && element.tagName === 'a' && isStableValue(element.href)) {
      // Use partial href if it's a full URL — just the path
      try {
        const urlPath = new URL(element.href).pathname;
        if (urlPath && urlPath !== '/' && urlPath.length < 80) {
          candidates.push({
            strategy: 'css',
            value: `a[href*="${urlPath}"]`,
            score: 70,
          });
        }
      } catch {
        // Not a valid URL, use as-is if short enough
        if (element.href.length < 80) {
          candidates.push({
            strategy: 'css',
            value: `a[href="${element.href}"]`,
            score: 70,
          });
        }
      }
    }

    // ── 13. Partial text XPath (score: 68) — XPath contains for long text
    if (rawText && rawText.length >= 60) {
      const partialText = rawText.slice(0, 40).trim();
      if (isStableValue(partialText)) {
        candidates.push({
          strategy: 'xpath',
          value: `//${element.tagName}[contains(text(), ${xpathEscape(partialText)})]`,
          score: 68,
        });
      }
    }

    // ── 14. closestHref CSS (score: 65) — For non-link elements inside links
    if (element.closestHref && isStableValue(element.closestHref)) {
      try {
        const urlPath = new URL(element.closestHref).pathname;
        if (urlPath && urlPath !== '/' && urlPath.length < 80) {
          candidates.push({
            strategy: 'css',
            value: `a[href*="${urlPath}"] ${element.tagName}`,
            score: 65,
          });
        }
      } catch {
        // Not a valid URL — skip
      }
    }

    // ── 15. ARIA role + name (score: 55) — Playwright-specific, fallback only
    if (element.ariaRole) {
      const accessibleName = cleanText(
        element.label || element.ariaLabel || element.textContent || element.innerText || ''
      );

      if (accessibleName && accessibleName.length >= 2 && accessibleName.length < 80) {
        candidates.push({
          strategy: 'role',
          value: `${element.ariaRole}|${accessibleName}`,
          score: 55,
        });
      } else {
        candidates.push({ strategy: 'role', value: element.ariaRole, score: 35 });
      }
    }

    // ── 16. aria-label as CSS attribute (score: 52) — Universal
    if (element.ariaLabel && isStableValue(element.ariaLabel)) {
      candidates.push({
        strategy: 'css',
        value: `[aria-label="${cleanText(element.ariaLabel)}"]`,
        score: 52,
      });
      // Also as label strategy (Playwright-native) at lower priority
      candidates.push({ strategy: 'label', value: cleanText(element.ariaLabel), score: 40 });
    }

    // ── 17. Associated label text (score: 48) — For form fields
    if (element.label && element.label !== element.ariaLabel && isStableValue(element.label)) {
      const tag = element.tagName;
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        candidates.push({ strategy: 'label', value: cleanText(element.label), score: 48 });
      }
    }

    // ── 18. Parent-context CSS (score: 40) — Nearest identified ancestor + tag
    // If cssPath starts with #someId, combine it with tag+class for a shorter, more stable selector
    if (element.cssPath && element.cssPath.includes('#')) {
      const hashIdx = element.cssPath.indexOf('#');
      const spaceAfter = element.cssPath.indexOf(' ', hashIdx);
      if (spaceAfter > 0) {
        const parentId = element.cssPath.slice(hashIdx, spaceAfter);
        if (element.className) {
          const stableClasses = element.className
            .split(/\s+/)
            .filter((c: string) => c && !DYNAMIC_CLASS_PATTERN.test(c) && c.length > 2 && c.length < 40)
            .slice(0, 2);
          if (stableClasses.length > 0) {
            candidates.push({
              strategy: 'css',
              value: `${parentId} ${element.tagName}.${stableClasses.join('.')}`,
              score: 40,
            });
          }
        }
        // Also try just #parentId tag (less specific but still better than full CSS path)
        candidates.push({
          strategy: 'css',
          value: `${parentId} ${element.tagName}`,
          score: 30,
        });
      }
    }

    // ── 19. CSS path (score: 20) — Last resort, fragile but unique
    if (element.cssPath) {
      candidates.push({
        strategy: 'css',
        value: element.cssPath,
        score: 20,
      });
    }

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length === 0) {
      return { strategy: 'css', value: element.tagName };
    }

    const primary = candidates[0]!;
    const fallbacks = candidates
      .slice(1, 5)
      .filter(c => c.strategy !== primary.strategy || c.value !== primary.value)
      .map((c) => ({ strategy: c.strategy, value: c.value }));

    return {
      strategy: primary.strategy,
      value: primary.value,
      fallbacks: fallbacks.length > 0 ? fallbacks : undefined,
    };
  }
}
