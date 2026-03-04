import type { ToolDefinition, ToolCall, ToolResult } from '../../types/index.js';
import { createLogger } from '../../utils/index.js';

const logger = createLogger('tools');

// ── Tool Execution Context ────────────────────────────────────────────────────

export interface ToolExecutionContext {
  workingDirectory: string;
  browserSession?: unknown;
  metadata?: Record<string, unknown>;
}

// ── Tool Registration ─────────────────────────────────────────────────────────

export interface ToolRegistration {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown>;
  category: string;
}

// ── Tool Registry ─────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, ToolRegistration>();

  register(tool: ToolRegistration): void {
    if (this.tools.has(tool.definition.name)) {
      logger.warn(`Overwriting existing tool: ${tool.definition.name}`);
    }
    this.tools.set(tool.definition.name, tool);
    logger.debug(`Registered tool: ${tool.definition.name} [${tool.category}]`);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  getCategories(): string[] {
    const cats = new Set<string>();
    for (const tool of this.tools.values()) {
      cats.add(tool.category);
    }
    return Array.from(cats);
  }

  getByCategory(category: string): ToolRegistration[] {
    return Array.from(this.tools.values()).filter((t) => t.category === category);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    logger.debug(`Executing tool: ${name}`, args);
    const start = Date.now();

    try {
      const result = await tool.handler(args, context);
      const duration = Date.now() - start;
      logger.debug(`Tool ${name} completed in ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      logger.error(`Tool ${name} failed after ${duration}ms: ${error}`);
      throw error;
    }
  }

  async executeToolCall(
    toolCall: ToolCall,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    try {
      const result = await this.execute(toolCall.name, toolCall.arguments, context);
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: `Error: ${message}`,
        isError: true,
      };
    }
  }

  getToolCount(): number {
    return this.tools.size;
  }

  listTools(): Array<{ name: string; description: string; category: string }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.definition.name,
      description: t.definition.description,
      category: t.category,
    }));
  }
}

let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}
