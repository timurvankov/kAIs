/**
 * ToolExecutor — registry and executor for tools available to the Cell.
 */
import type { ToolCall, ToolDefinition } from '@kais/mind';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown): Promise<string>;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

export class ToolExecutor {
  private readonly tools: Map<string, Tool> = new Map();

  /**
   * Register a tool.
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Execute a tool by name.
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = this.tools.get(toolCall.name);
    if (!tool) {
      return {
        content: `Unknown tool: ${toolCall.name}`,
        isError: true,
      };
    }

    try {
      const result = await tool.execute(toolCall.input);
      return { content: result, isError: false };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: `Tool error: ${message}`, isError: true };
    }
  }

  /**
   * Get all tool definitions (for Mind.think input).
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }
}
