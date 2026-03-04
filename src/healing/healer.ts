import type {
  ElementSelector,
  ElementFingerprint,
  HealingResult,
  HealingAttempt,
  HealingStrategy,
  HealingOptions,
} from '../types/index.js';
import { ElementFingerprinter } from './fingerprint.js';
import { HealingStore } from './store.js';
import type { WebAdapter } from '../browser/adapter.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('healer');

/**
 * Result of healFromSnapshot() — headless healing for external frameworks.
 */
export interface SnapshotHealResult {
  healed: boolean;
  selector?: string;
  selectorStrategy?: string;
  confidence: number;
  strategy?: string;
  durationMs: number;
  candidates?: Array<{ selector: string; strategy: string }>;
}

export class SelfHealer {
  private fingerprinter = new ElementFingerprinter();
  private store: HealingStore;
  private options: HealingOptions;

  private strategies: HealingStrategy[] = [
    'fingerprint',
    'similarSelector',
    'textMatch',
    'positionMatch',
    'ancestorSearch',
  ];

  constructor(options?: Partial<HealingOptions>) {
    this.options = {
      enabled: true,
      confidenceThreshold: 0.7,
      maxAttempts: 5,
      updateFingerprints: true,
      ...options,
    };
    this.store = new HealingStore(this.options.dbPath);
  }

  async heal(
    adapter: WebAdapter,
    originalSelector: ElementSelector,
    _pageUrl: string,
  ): Promise<HealingResult> {
    const start = Date.now();
    const attempts: HealingAttempt[] = [];
    const selectorKey = `${originalSelector.strategy}:${originalSelector.value}`;

    // Get stored fingerprint
    const stored = this.store.get(selectorKey);
    if (!stored) {
      logger.warn(`No stored fingerprint for selector: ${selectorKey}`);
      return {
        healed: false,
        originalSelector,
        confidence: 0,
        attempts: [],
        duration: Date.now() - start,
      };
    }

    // Try each strategy
    for (const strategy of this.strategies) {
      const attemptStart = Date.now();

      try {
        const result = await this.tryStrategy(
          strategy,
          adapter,
          stored.fingerprint,
          _pageUrl,
        );

        const attempt: HealingAttempt = {
          strategy,
          originalSelector,
          healedSelector: result?.selector,
          confidence: result?.confidence || 0,
          success: result !== null && result.confidence >= this.options.confidenceThreshold,
          duration: Date.now() - attemptStart,
        };
        attempts.push(attempt);

        if (attempt.success && result) {
          logger.info(
            `Healed selector via ${strategy} (confidence: ${result.confidence.toFixed(2)})`,
          );

          // Update stored fingerprint
          if (this.options.updateFingerprints && result.fingerprint) {
            this.storeFingerprint(selectorKey, _pageUrl, result.fingerprint);
          }

          this.store.incrementSuccess(selectorKey);

          return {
            healed: true,
            originalSelector,
            healedSelector: result.selector,
            confidence: result.confidence,
            strategy,
            attempts,
            duration: Date.now() - start,
          };
        }
      } catch (error) {
        logger.debug(`Strategy ${strategy} failed: ${error}`);
        attempts.push({
          strategy,
          originalSelector,
          confidence: 0,
          success: false,
          duration: Date.now() - attemptStart,
        });
      }
    }

    // All strategies failed
    this.store.incrementFailure(selectorKey);

    return {
      healed: false,
      originalSelector,
      confidence: 0,
      attempts,
      duration: Date.now() - start,
    };
  }

  storeFingerprint(selectorKey: string, url: string, fingerprint: ElementFingerprint): void {
    this.store.save({ selectorKey, url, fingerprint });
  }

  getStats() {
    return this.store.getStats();
  }

  private async tryStrategy(
    strategy: HealingStrategy,
    adapter: WebAdapter,
    storedFingerprint: ElementFingerprint,
    _pageUrl: string,
  ): Promise<{ selector: ElementSelector; confidence: number; fingerprint?: ElementFingerprint } | null> {
    switch (strategy) {
      case 'fingerprint':
        return this.tryFingerprintMatch(adapter, storedFingerprint);
      case 'similarSelector':
        return this.trySimilarSelector(adapter, storedFingerprint);
      case 'textMatch':
        return this.tryTextMatch(adapter, storedFingerprint);
      case 'positionMatch':
        return this.tryPositionMatch(adapter, storedFingerprint);
      case 'ancestorSearch':
        return this.tryAncestorSearch(adapter, storedFingerprint);
      case 'aiHealing':
        return this.tryAIHealing(storedFingerprint, _pageUrl);
      default:
        return null;
    }
  }

  private async tryFingerprintMatch(
    adapter: WebAdapter,
    stored: ElementFingerprint,
  ): Promise<{ selector: ElementSelector; confidence: number; fingerprint?: ElementFingerprint } | null> {
    // Generate candidate selectors from fingerprint attributes
    const candidates: string[] = [];

    if (stored.id) candidates.push(`#${stored.id}`);
    if (stored.testId) candidates.push(`[data-testid="${stored.testId}"]`);
    if (stored.ariaLabel) candidates.push(`[aria-label="${stored.ariaLabel}"]`);
    if (stored.name) candidates.push(`${stored.tagName}[name="${stored.name}"]`);

    for (const selector of candidates) {
      try {
        const visible = await adapter.isVisible(selector);
        if (visible) {
          const fingerprint = await adapter.getElementFingerprint(selector);
          const match = this.fingerprinter.compare(stored, fingerprint);
          if (match.confidence >= this.options.confidenceThreshold) {
            return {
              selector: { strategy: 'css', value: selector },
              confidence: match.confidence,
              fingerprint,
            };
          }
        }
      } catch {
        // Candidate not found
      }
    }

    return null;
  }

  private async trySimilarSelector(
    adapter: WebAdapter,
    stored: ElementFingerprint,
  ): Promise<{ selector: ElementSelector; confidence: number; fingerprint?: ElementFingerprint } | null> {
    // Try variations: stable classes, tag + attribute combos
    const variations: string[] = [];

    if (stored.className) {
      const stableClasses = stored.className
        .split(/\s+/)
        .filter((c) => c && !/[a-z]+-[a-f0-9]{5,}/i.test(c));
      if (stableClasses.length > 0) {
        variations.push(`${stored.tagName}.${stableClasses.join('.')}`);
      }
    }

    if (stored.type) {
      variations.push(`${stored.tagName}[type="${stored.type}"]`);
    }

    for (const selector of variations) {
      try {
        const visible = await adapter.isVisible(selector);
        if (visible) {
          const fingerprint = await adapter.getElementFingerprint(selector);
          const match = this.fingerprinter.compare(stored, fingerprint);
          if (match.confidence >= this.options.confidenceThreshold) {
            return {
              selector: { strategy: 'css', value: selector },
              confidence: match.confidence,
              fingerprint,
            };
          }
        }
      } catch {
        // Variation not found
      }
    }

    return null;
  }

  private async tryTextMatch(
    adapter: WebAdapter,
    stored: ElementFingerprint,
  ): Promise<{ selector: ElementSelector; confidence: number; fingerprint?: ElementFingerprint } | null> {
    if (!stored.textContent) return null;

    // Try finding by text content
    const text = stored.textContent.trim().slice(0, 50);
    try {
      const visible = await adapter.isVisible(`text=${text}`);
      if (visible) {
        return {
          selector: { strategy: 'text', value: text },
          confidence: 0.75,
        };
      }
    } catch {
      // Text not found
    }

    return null;
  }

  private async tryPositionMatch(
    adapter: WebAdapter,
    stored: ElementFingerprint,
  ): Promise<{ selector: ElementSelector; confidence: number; fingerprint?: ElementFingerprint } | null> {
    if (!stored.boundingBox) return null;

    // Try finding elements of the same tag near the stored position
    const selector = stored.tagName;
    try {
      const fingerprint = await adapter.getElementFingerprint(selector);
      const match = this.fingerprinter.compare(stored, fingerprint);
      if (match.confidence >= this.options.confidenceThreshold) {
        return {
          selector: { strategy: 'css', value: selector },
          confidence: match.confidence,
          fingerprint,
        };
      }
    } catch {
      // Not found
    }

    return null;
  }

  /**
   * Strategy 5: ancestorSearch — look for the element within known parent containers.
   * Uses stored parentTag + siblingIndex to find the element via a parent context.
   */
  private async tryAncestorSearch(
    adapter: WebAdapter,
    stored: ElementFingerprint,
  ): Promise<{ selector: ElementSelector; confidence: number; fingerprint?: ElementFingerprint } | null> {
    if (!stored.parentTag) return null;

    // Build ancestor-based selectors
    const candidates: string[] = [];

    // Try: parentTag > tagName (nth-child if we know sibling index)
    if (stored.siblingIndex !== undefined && stored.siblingIndex >= 0) {
      candidates.push(`${stored.parentTag} > ${stored.tagName}:nth-child(${stored.siblingIndex + 1})`);
    }

    // Try: parentTag > tagName with text
    if (stored.textContent) {
      const text = stored.textContent.trim().slice(0, 30);
      candidates.push(`${stored.parentTag} ${stored.tagName}:has-text("${text}")`);
    }

    // Try: parentTag > tagName[type] for form elements
    if (stored.type) {
      candidates.push(`${stored.parentTag} > ${stored.tagName}[type="${stored.type}"]`);
    }

    // Try: parentTag > tagName with aria attributes
    if (stored.ariaRole) {
      candidates.push(`${stored.parentTag} [role="${stored.ariaRole}"]`);
    }

    for (const selector of candidates) {
      try {
        const visible = await adapter.isVisible(selector);
        if (visible) {
          const fingerprint = await adapter.getElementFingerprint(selector);
          const match = this.fingerprinter.compare(stored, fingerprint);
          if (match.confidence >= this.options.confidenceThreshold) {
            return {
              selector: { strategy: 'css', value: selector },
              confidence: match.confidence,
              fingerprint,
            };
          }
        }
      } catch {
        // Candidate not found
      }
    }

    return null;
  }

  /**
   * Strategy 6: aiHealing — use configured LLM as last-resort fallback.
   */
  private async tryAIHealing(
    stored: ElementFingerprint,
    _pageUrl: string,
  ): Promise<{ selector: ElementSelector; confidence: number; fingerprint?: ElementFingerprint } | null> {
    try {
      const { AIHealer } = await import('./ai-healer.js');
      const aiHealer = new AIHealer();
      const originalDesc = stored.testId || stored.id || stored.ariaLabel || stored.tagName;
      const result = await aiHealer.heal(originalDesc, stored, undefined, 'section');
      if (result && result.confidence >= this.options.confidenceThreshold) {
        logger.info(`AI healer suggested: "${result.selector}" (confidence: ${result.confidence})`);
        return {
          selector: { strategy: 'css', value: result.selector },
          confidence: result.confidence,
        };
      }
    } catch (error) {
      logger.debug(`AI healing strategy failed: ${error}`);
    }
    return null;
  }

  /**
   * Heal from snapshot — headless healing for external frameworks.
   * No live browser needed; generates candidate selectors purely from stored fingerprint data.
   * Used by the Universal Healing API (/api/heal/resolve).
   */
  healFromSnapshot(
    selectorKey: string,
    pageUrl: string,
  ): SnapshotHealResult {
    const start = Date.now();

    const stored = this.store.get(selectorKey);
    if (!stored) {
      return {
        healed: false,
        confidence: 0,
        durationMs: Date.now() - start,
      };
    }

    const sf = stored.fingerprint;
    const candidates: Array<{ selector: string; strategy: string; confidence: number }> = [];

    // Rank candidates by specificity (most specific → least)
    if (sf.testId) {
      candidates.push({ selector: `[data-testid="${sf.testId}"]`, strategy: 'css', confidence: 0.92 });
    }
    if (sf.id) {
      candidates.push({ selector: `#${sf.id}`, strategy: 'css', confidence: 0.88 });
    }
    if (sf.ariaLabel) {
      candidates.push({ selector: `[aria-label="${sf.ariaLabel}"]`, strategy: 'css', confidence: 0.82 });
    }
    if (sf.name) {
      candidates.push({ selector: `${sf.tagName}[name="${sf.name}"]`, strategy: 'css', confidence: 0.80 });
    }
    if (sf.placeholder) {
      candidates.push({ selector: `${sf.tagName}[placeholder="${sf.placeholder}"]`, strategy: 'css', confidence: 0.78 });
    }
    if (sf.ariaRole) {
      candidates.push({ selector: `[role="${sf.ariaRole}"]`, strategy: 'css', confidence: 0.72 });
    }
    if (sf.textContent) {
      const text = sf.textContent.trim().slice(0, 50);
      candidates.push({ selector: `text=${text}`, strategy: 'text', confidence: 0.70 });
    }
    if (sf.className) {
      const stableClasses = sf.className
        .split(/\s+/)
        .filter((c) => c && !/[a-z]+-[a-f0-9]{5,}/i.test(c));
      if (stableClasses.length > 0) {
        candidates.push({ selector: `${sf.tagName}.${stableClasses.join('.')}`, strategy: 'css', confidence: 0.68 });
      }
    }
    if (sf.type) {
      candidates.push({ selector: `${sf.tagName}[type="${sf.type}"]`, strategy: 'css', confidence: 0.65 });
    }

    // Ancestor-based candidates
    if (sf.parentTag && sf.siblingIndex !== undefined && sf.siblingIndex >= 0) {
      candidates.push({
        selector: `${sf.parentTag} > ${sf.tagName}:nth-child(${sf.siblingIndex + 1})`,
        strategy: 'css',
        confidence: 0.60,
      });
    }

    const durationMs = Date.now() - start;

    if (candidates.length > 0) {
      const best = candidates[0]!;
      this.store.incrementSuccess(selectorKey);
      return {
        healed: true,
        selector: best.selector,
        selectorStrategy: best.strategy,
        confidence: best.confidence,
        strategy: 'fingerprint',
        durationMs,
        candidates: candidates.slice(0, 5).map((c) => ({ selector: c.selector, strategy: c.strategy })),
      };
    }

    this.store.incrementFailure(selectorKey);
    return {
      healed: false,
      confidence: 0,
      durationMs,
    };
  }

  getStore(): HealingStore {
    return this.store;
  }

  dispose(): void {
    this.store.close();
  }
}
