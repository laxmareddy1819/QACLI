import type { ElementFingerprint } from '../types/index.js';

export interface DOMValidationResult {
  valid: boolean;
  matchCount: number;
  stabilityScore: number;
}

export interface DOMContext {
  html: string;
  size: number;
  scope: 'full' | 'section' | 'minimal';
}

const SCOPE_LIMITS = {
  full: 8192,
  section: 2048,
  minimal: 512,
} as const;

/**
 * Lightweight DOM analysis for healing.
 * Works with raw HTML strings — no full DOM parser needed.
 */
export class DOMAnalyzer {
  /**
   * Extract a relevant section of DOM around the element's expected location.
   * Uses fingerprint attributes as anchor points to find the right region.
   */
  extractContext(
    domSnapshot: string,
    fingerprint: ElementFingerprint,
    scope: 'full' | 'section' | 'minimal' = 'section',
  ): DOMContext {
    const limit = SCOPE_LIMITS[scope];

    if (domSnapshot.length <= limit) {
      return { html: domSnapshot, size: domSnapshot.length, scope };
    }

    // Find an anchor point in the DOM using fingerprint attributes
    const anchorIndex = this.findAnchorIndex(domSnapshot, fingerprint);

    if (anchorIndex >= 0) {
      // Extract a window around the anchor
      const halfWindow = Math.floor(limit / 2);
      const start = Math.max(0, anchorIndex - halfWindow);
      const end = Math.min(domSnapshot.length, anchorIndex + halfWindow);
      const html = domSnapshot.slice(start, end);
      return { html, size: html.length, scope };
    }

    // No anchor found — return from the start, truncated
    const html = domSnapshot.slice(0, limit);
    return { html, size: html.length, scope };
  }

  /**
   * Validate that a selector's target attributes exist in the DOM snapshot.
   * Lightweight regex-based check (not a full CSS engine).
   */
  validateSelector(domSnapshot: string, selector: string): DOMValidationResult {
    const stability = this.scoreStability(selector);

    // Extract the key attribute/value from the selector
    const checks = this.extractSelectorChecks(selector);
    let matchCount = 0;

    for (const check of checks) {
      const regex = new RegExp(check, 'gi');
      const matches = domSnapshot.match(regex);
      if (matches) {
        matchCount += matches.length;
      }
    }

    return {
      valid: matchCount > 0,
      matchCount,
      stabilityScore: stability,
    };
  }

  /**
   * Score a selector by stability heuristics.
   * Higher = more stable (less likely to break).
   */
  scoreStability(selector: string): number {
    if (/\[data-testid[=~|^$*]?=/.test(selector)) return 1.0;
    if (/^#[a-zA-Z][\w-]*$/.test(selector)) return 0.9;
    if (/\[aria-label[=~|^$*]?=/.test(selector)) return 0.8;
    if (/\[name[=~|^$*]?=/.test(selector)) return 0.7;
    if (/\[placeholder[=~|^$*]?=/.test(selector)) return 0.65;
    if (/\[role[=~|^$*]?=/.test(selector)) return 0.6;
    if (/\.[a-zA-Z][\w-]+/.test(selector)) return 0.5;
    if (/^(button|input|select|textarea|a|form|img|h[1-6]|label)$/i.test(selector)) return 0.3;
    if (/:nth-child/.test(selector)) return 0.2;
    return 0.4;
  }

  /**
   * Rank candidates by combined validity + stability.
   */
  rankCandidates(
    domSnapshot: string,
    candidates: Array<{ selector: string; strategy: string }>,
  ): Array<{ selector: string; strategy: string; score: number; valid: boolean }> {
    const ranked = candidates.map((c) => {
      const validation = this.validateSelector(domSnapshot, c.selector);
      const score = validation.valid
        ? validation.stabilityScore * (1 / Math.max(validation.matchCount, 1))
        : 0;
      return { selector: c.selector, strategy: c.strategy, score, valid: validation.valid };
    });

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  /**
   * Find the character index in the DOM where the fingerprinted element is likely located.
   */
  private findAnchorIndex(dom: string, fp: ElementFingerprint): number {
    // Try anchors in order of specificity
    const anchors: string[] = [];
    if (fp.testId) anchors.push(`data-testid="${fp.testId}"`, `data-testid='${fp.testId}'`);
    if (fp.id) anchors.push(`id="${fp.id}"`, `id='${fp.id}'`);
    if (fp.ariaLabel) anchors.push(`aria-label="${fp.ariaLabel}"`);
    if (fp.name) anchors.push(`name="${fp.name}"`);
    if (fp.placeholder) anchors.push(`placeholder="${fp.placeholder}"`);

    for (const anchor of anchors) {
      const idx = dom.indexOf(anchor);
      if (idx >= 0) return idx;
    }

    // Try text content (search for the text within tags)
    if (fp.textContent) {
      const shortText = fp.textContent.trim().slice(0, 40);
      if (shortText.length >= 3) {
        const idx = dom.indexOf(shortText);
        if (idx >= 0) return idx;
      }
    }

    return -1;
  }

  /**
   * Extract regex patterns from a CSS selector to check against raw HTML.
   */
  private extractSelectorChecks(selector: string): string[] {
    const checks: string[] = [];

    // [data-testid="value"]
    const attrMatch = selector.match(/\[([a-zA-Z-]+)=["']([^"']+)["']\]/g);
    if (attrMatch) {
      for (const m of attrMatch) {
        const parts = m.match(/\[([a-zA-Z-]+)=["']([^"']+)["']\]/);
        if (parts) {
          checks.push(`${parts[1]}=["']${this.escapeRegex(parts[2]!)}["']`);
        }
      }
    }

    // #id
    const idMatch = selector.match(/#([a-zA-Z][\w-]*)/);
    if (idMatch) {
      checks.push(`id=["']${this.escapeRegex(idMatch[1]!)}["']`);
    }

    // .className
    const classMatches = selector.match(/\.([a-zA-Z][\w-]*)/g);
    if (classMatches) {
      for (const cm of classMatches) {
        checks.push(`class=["'][^"']*${this.escapeRegex(cm.slice(1))}[^"']*["']`);
      }
    }

    // tagName (simple)
    const tagMatch = selector.match(/^([a-zA-Z][\w]*)/);
    if (tagMatch && checks.length === 0) {
      checks.push(`<${tagMatch[1]}[\\s>]`);
    }

    return checks;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
