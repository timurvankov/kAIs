/**
 * Core types for the Mind abstraction layer.
 *
 * These types define the unified interface for calling different LLM providers.
 */

// --- Messages ---

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  content?: string;
  isError?: boolean;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

// --- Tools ---

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

// --- Think I/O ---

export interface ThinkInput {
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface ThinkOutput {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
  };
  model: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

// --- Mind interface ---

export interface Mind {
  think(input: ThinkInput): Promise<ThinkOutput>;
  readonly provider: string;
  readonly model: string;
}
