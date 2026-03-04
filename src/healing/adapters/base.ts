/**
 * Base interface for framework-specific healing code generators.
 *
 * Each adapter generates native-language healing libraries for a specific
 * test framework. The generated code is written into the user's project
 * and communicates with qabot's Healing API via HTTP.
 */
export interface HealingAdapterConfig {
  /** qabot healing API URL (default: http://localhost:3700) */
  healingServerUrl: string;
  /** Minimum confidence to accept a healed selector (default: 0.7) */
  confidenceThreshold: number;
  /** Enable AI-powered healing fallback (default: true) */
  enableAIFallback: boolean;
  /** How much DOM to send: 'full' | 'section' | 'minimal' (default: 'section') */
  snapshotScope: 'full' | 'section' | 'minimal';
  /** Absolute path to the user's project */
  projectPath: string;
}

export interface HealingAdapter {
  /** Framework identifier */
  framework: string;
  /** Programming language */
  language: string;
  /** Human-readable display name */
  displayName: string;

  /**
   * Generate healing library files for this framework/language.
   * Returns a map of relative file paths to their content.
   */
  generate(config: HealingAdapterConfig): Record<string, string>;

  /**
   * Get human-readable integration instructions for the user.
   */
  getIntegrationInstructions(config: HealingAdapterConfig): string;
}

export const DEFAULT_ADAPTER_CONFIG: HealingAdapterConfig = {
  healingServerUrl: 'http://localhost:3700',
  confidenceThreshold: 0.7,
  enableAIFallback: true,
  snapshotScope: 'section',
  projectPath: '.',
};
