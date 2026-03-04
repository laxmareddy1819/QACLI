import type { Message, ToolCall, ToolResult } from '../types/index.js';
import { generateId } from '../utils/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single step in a multi-step tool interaction */
interface ToolStep {
  assistantMessage: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}

export interface ConversationTurn {
  id: string;
  userMessage: string;
  assistantMessage?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  /** Multi-step tool interaction steps (for interleaved assistant/tool messages) */
  toolSteps?: ToolStep[];
  timestamp: number;
}

export interface ConversationContext {
  id: string;
  createdAt: number;
  updatedAt: number;
  turns: ConversationTurn[];
  systemPrompt: string;
  metadata: Record<string, unknown>;
}

// ── Conversation Manager ──────────────────────────────────────────────────────

export class ConversationManager {
  private context: ConversationContext;
  private currentTurn: ConversationTurn | null = null;

  constructor(systemPrompt: string) {
    const now = Date.now();
    this.context = {
      id: generateId('conv'),
      createdAt: now,
      updatedAt: now,
      turns: [],
      systemPrompt,
      metadata: {},
    };
  }

  getContext(): ConversationContext {
    return this.context;
  }

  setSystemPrompt(prompt: string): void {
    this.context.systemPrompt = prompt;
    this.context.updatedAt = Date.now();
  }

  getSystemPrompt(): string {
    return this.context.systemPrompt;
  }

  addUserMessage(content: string): void {
    this.currentTurn = {
      id: generateId('turn'),
      userMessage: content,
      timestamp: Date.now(),
    };
    this.context.turns.push(this.currentTurn);
    this.context.updatedAt = Date.now();
  }

  addAssistantMessage(content: string): void {
    if (this.currentTurn) {
      this.currentTurn.assistantMessage = content;
      this.context.updatedAt = Date.now();
    }
  }

  addToolCalls(toolCalls: ToolCall[]): void {
    if (this.currentTurn) {
      this.currentTurn.toolCalls = [
        ...(this.currentTurn.toolCalls || []),
        ...toolCalls,
      ];
    }
  }

  addToolResults(results: ToolResult[]): void {
    if (this.currentTurn) {
      this.currentTurn.toolResults = [
        ...(this.currentTurn.toolResults || []),
        ...results,
      ];
      this.context.updatedAt = Date.now();
    }
  }

  /**
   * Record a complete tool step (assistant message + tool calls + results)
   * for multi-iteration tool loops. This preserves the interleaved structure
   * so the LLM can correlate tool results with the correct tool calls.
   */
  addToolStep(assistantText: string, toolCalls: ToolCall[], results: ToolResult[]): void {
    if (this.currentTurn) {
      if (!this.currentTurn.toolSteps) {
        this.currentTurn.toolSteps = [];
      }
      this.currentTurn.toolSteps.push({
        assistantMessage: assistantText,
        toolCalls,
        toolResults: results,
      });
      // Also maintain the flat arrays for backward compatibility
      this.currentTurn.toolCalls = [
        ...(this.currentTurn.toolCalls || []),
        ...toolCalls,
      ];
      this.currentTurn.toolResults = [
        ...(this.currentTurn.toolResults || []),
        ...results,
      ];
      this.context.updatedAt = Date.now();
    }
  }

  buildMessages(): Message[] {
    const messages: Message[] = [
      { role: 'system', content: this.context.systemPrompt },
    ];

    for (const turn of this.context.turns) {
      messages.push({ role: 'user', content: turn.userMessage });

      // If we have structured tool steps, emit them in interleaved order
      if (turn.toolSteps && turn.toolSteps.length > 0) {
        for (const step of turn.toolSteps) {
          // Assistant message (with tool calls for proper correlation)
          messages.push({
            role: 'assistant',
            content: step.assistantMessage || '',
            toolCalls: step.toolCalls,
          });

          // Tool results
          for (const result of step.toolResults) {
            messages.push({
              role: 'tool',
              content: typeof result.result === 'string' ? result.result : (result.result != null ? JSON.stringify(result.result) : 'Done'),
              toolCallId: result.toolCallId,
              name: result.name,
            });
          }
        }

        // Final assistant message after all tool steps (if different)
        if (turn.assistantMessage) {
          const lastStepMsg = turn.toolSteps[turn.toolSteps.length - 1]?.assistantMessage;
          if (turn.assistantMessage !== lastStepMsg) {
            messages.push({ role: 'assistant', content: turn.assistantMessage });
          }
        }
      } else if (turn.toolCalls && turn.toolResults) {
        // Flat format (single-step tool call, backward compatible)
        messages.push({
          role: 'assistant',
          content: turn.assistantMessage || '',
          toolCalls: turn.toolCalls,
        });

        for (const result of turn.toolResults) {
          messages.push({
            role: 'tool',
            content: typeof result.result === 'string' ? result.result : (result.result != null ? JSON.stringify(result.result) : 'Done'),
            toolCallId: result.toolCallId,
            name: result.name,
          });
        }
      } else if (turn.assistantMessage) {
        messages.push({ role: 'assistant', content: turn.assistantMessage });
      }
    }

    return messages;
  }

  estimateTokens(): number {
    const messages = this.buildMessages();
    let total = 0;
    for (const msg of messages) {
      const content = msg.content || '';
      total += Math.ceil(content.length / 4);
      // Account for tool calls in token estimate
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          total += Math.ceil((tc.name.length + JSON.stringify(tc.arguments).length) / 4);
        }
      }
    }
    return total;
  }

  truncateToFit(maxTokens: number): number {
    let removed = 0;
    // Smart truncation: preserve turns with critical infrastructure tool calls
    // (browser_launch, write_file) so the LLM maintains
    // state awareness. Always preserve the last turn (current interaction).
    const criticalTools = new Set([
      'browser_launch', 'write_file',
    ]);

    while (this.context.turns.length > 1 && this.estimateTokens() > maxTokens) {
      // Find the first non-critical turn to remove (skip the last turn)
      let removedOne = false;
      for (let i = 0; i < this.context.turns.length - 1; i++) {
        const turn = this.context.turns[i]!;
        const hasCritical = turn.toolSteps?.some(step =>
          step.toolCalls.some(tc => criticalTools.has(tc.name)),
        ) || turn.toolCalls?.some(tc => criticalTools.has(tc.name));

        if (!hasCritical) {
          this.context.turns.splice(i, 1);
          removed++;
          removedOne = true;
          break;
        }
      }
      // If only critical turns remain (plus current), summarize the oldest one
      if (!removedOne) {
        if (this.context.turns.length > 2) {
          const oldest = this.context.turns[0]!;
          const toolNames = oldest.toolCalls?.map(tc => tc.name).join(', ') || 'none';
          oldest.toolSteps = undefined;
          oldest.toolCalls = undefined;
          oldest.toolResults = undefined;
          oldest.assistantMessage = `[Previous context truncated. Tools used: ${toolNames}]`;
          removed++;
        }
        break; // Can't reduce further without losing all context
      }
    }
    return removed;
  }

  getTurnCount(): number {
    return this.context.turns.length;
  }

  getLastAssistantMessage(): string | undefined {
    for (let i = this.context.turns.length - 1; i >= 0; i--) {
      if (this.context.turns[i]?.assistantMessage) {
        return this.context.turns[i]!.assistantMessage;
      }
    }
    return undefined;
  }

  reset(): void {
    const now = Date.now();
    this.context = {
      id: generateId('conv'),
      createdAt: now,
      updatedAt: now,
      turns: [],
      systemPrompt: this.context.systemPrompt,
      metadata: {},
    };
    this.currentTurn = null;
  }

  exportHistory(): ConversationTurn[] {
    return [...this.context.turns];
  }
}
