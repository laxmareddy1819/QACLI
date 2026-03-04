import type { ElementFingerprint } from '../types/index.js';

interface MatchResult {
  confidence: number;
  matchDetails: Record<string, number>;
}

const SIGNAL_WEIGHTS = {
  id: 0.20,
  testId: 0.30,
  ariaLabel: 0.10,
  className: 0.10,
  tagName: 0.10,
  textContent: 0.10,
  position: 0.05,
  attributes: 0.05,
};

export class ElementFingerprinter {
  compare(stored: ElementFingerprint, candidate: ElementFingerprint): MatchResult {
    const matchDetails: Record<string, number> = {};
    let totalWeight = 0;
    let totalScore = 0;

    // ID match - only count if both have id or candidate explicitly differs
    if (stored.id) {
      if (candidate.id !== undefined) {
        totalWeight += SIGNAL_WEIGHTS.id;
        const score = stored.id === candidate.id ? 1.0 : 0.0;
        matchDetails['id'] = score;
        totalScore += score * SIGNAL_WEIGHTS.id;
      }
      // If candidate has no id at all, skip - absence is not the same as mismatch
    }

    // Test ID match
    if (stored.testId) {
      if (candidate.testId !== undefined) {
        totalWeight += SIGNAL_WEIGHTS.testId;
        const score = stored.testId === candidate.testId ? 1.0 : 0.0;
        matchDetails['testId'] = score;
        totalScore += score * SIGNAL_WEIGHTS.testId;
      }
    }

    // Aria label match
    if (stored.ariaLabel) {
      if (candidate.ariaLabel !== undefined) {
        totalWeight += SIGNAL_WEIGHTS.ariaLabel;
        const score = stored.ariaLabel === candidate.ariaLabel
          ? 1.0
          : this.levenshteinSimilarity(stored.ariaLabel, candidate.ariaLabel);
        matchDetails['ariaLabel'] = score;
        totalScore += score * SIGNAL_WEIGHTS.ariaLabel;
      }
    }

    // Tag name match
    totalWeight += SIGNAL_WEIGHTS.tagName;
    const tagScore = stored.tagName === candidate.tagName ? 1.0 : 0.0;
    matchDetails['tagName'] = tagScore;
    totalScore += tagScore * SIGNAL_WEIGHTS.tagName;

    // Class name match (Jaccard similarity)
    if (stored.className) {
      totalWeight += SIGNAL_WEIGHTS.className;
      const score = this.classNameSimilarity(stored.className, candidate.className || '');
      matchDetails['className'] = score;
      totalScore += score * SIGNAL_WEIGHTS.className;
    }

    // Text content match
    if (stored.textContent) {
      totalWeight += SIGNAL_WEIGHTS.textContent;
      const score = this.levenshteinSimilarity(
        stored.textContent,
        candidate.textContent || '',
      );
      matchDetails['textContent'] = score;
      totalScore += score * SIGNAL_WEIGHTS.textContent;
    }

    // Position match
    if (stored.boundingBox && candidate.boundingBox) {
      totalWeight += SIGNAL_WEIGHTS.position;
      const score = this.positionSimilarity(stored.boundingBox, candidate.boundingBox);
      matchDetails['position'] = score;
      totalScore += score * SIGNAL_WEIGHTS.position;
    }

    // Normalize by total weight
    const confidence = totalWeight > 0 ? totalScore / totalWeight : 0;

    return { confidence, matchDetails };
  }

  private classNameSimilarity(a: string, b: string): number {
    const setA = new Set(a.split(/\s+/).filter(Boolean));
    const setB = new Set(b.split(/\s+/).filter(Boolean));

    if (setA.size === 0 && setB.size === 0) return 1.0;
    if (setA.size === 0 || setB.size === 0) return 0.0;

    let intersection = 0;
    for (const item of setA) {
      if (setB.has(item)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private levenshteinSimilarity(a: string, b: string): number {
    return levenshteinSimilarity(a, b);
  }

  private levenshteinDistance(a: string, b: string): number {
    return levenshteinDistance(a, b);
  }

  private positionSimilarity(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ): number {
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const dw = Math.abs(a.width - b.width);
    const dh = Math.abs(a.height - b.height);

    const distance = Math.sqrt(dx * dx + dy * dy + dw * dw + dh * dh);
    const threshold = 100;
    return Math.max(0, 1 - distance / threshold);
  }
}

// ── Exported standalone utility functions ────────────────────────────────────

/**
 * Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[m]![n]!;
}

/**
 * Levenshtein similarity: 0.0 (completely different) → 1.0 (identical).
 * Used for fuzzy selector key matching in self-healing.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;

  const dist = levenshteinDistance(a, b);
  return 1.0 - dist / maxLen;
}
