import type { StreamChunk, ProviderName } from './llm.js';
import type { ActionResult, ElementSelector } from './adapter.js';
import type { HealingResult } from './healing.js';
import type { RecordedAction } from './recording.js';

// ── Event Map ─────────────────────────────────────────────────────────────────

export interface QabotEventMap {
  // LLM events
  'llm:request:start': { provider: ProviderName; model?: string };
  'llm:request:complete': { provider: ProviderName; duration: number; tokens?: number };
  'llm:request:error': { provider: ProviderName; error: Error };
  'llm:stream:chunk': StreamChunk;
  'llm:stream:start': { provider: ProviderName };
  'llm:stream:end': { provider: ProviderName; duration: number };

  // Tool events
  'tool:call:start': { name: string; args: Record<string, unknown> };
  'tool:call:complete': { name: string; result: unknown; duration: number };
  'tool:call:error': { name: string; error: Error };
  'tool:permission:request': { name: string; args: Record<string, unknown> };
  'tool:permission:granted': { name: string };
  'tool:permission:denied': { name: string };

  // Browser events
  'browser:launch': { browser: string; headless: boolean };
  'browser:close': { sessionId: string };
  'browser:navigate': { url: string };
  'browser:action:start': { action: string; selector?: ElementSelector };
  'browser:action:complete': { action: string; result: ActionResult };
  'browser:action:error': { action: string; error: Error };

  // Healing events
  'healing:attempt': { selector: ElementSelector; strategy: string };
  'healing:success': { result: HealingResult };
  'healing:failure': { selector: ElementSelector; error: string };

  // Recording events
  'recording:start': { url: string };
  'recording:action': { action: RecordedAction };
  'recording:stop': { actionCount: number };

  // Conversation events
  'conversation:message:user': { content: string };
  'conversation:message:assistant': { content: string };
  'conversation:reset': void;
  'conversation:truncate': { removedTurns: number };

  // System events
  'system:ready': void;
  'system:error': { error: Error };
  'system:shutdown': void;
}

export type QabotEvent = keyof QabotEventMap;
