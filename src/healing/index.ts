export { SelfHealer, type SnapshotHealResult } from './healer.js';
export { ElementFingerprinter } from './fingerprint.js';
export { HealingStore } from './store.js';
export { DOMAnalyzer, type DOMValidationResult, type DOMContext } from './dom-analyzer.js';
export { AIHealer, type AIHealResult } from './ai-healer.js';
export {
  type HealingAdapter,
  type HealingAdapterConfig,
  DEFAULT_ADAPTER_CONFIG,
  getHealingAdapters,
  getHealingAdapter,
  getSupportedAdapters,
} from './adapters/index.js';
