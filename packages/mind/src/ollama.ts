/**
 * OllamaMind — Ollama REST API provider for the Mind interface.
 *
 * Calls the local Ollama server via HTTP fetch (no SDK).
 */
import { TransientError } from '@kais/core';

import type { ContentBlock, Message, Mind, ThinkInput, ThinkOutput, ToolDefinition } from './types.js';

/** Ollama chat message format. */
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: unknown;
  };
}

/** Ollama tool definition format. */
interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** Ollama /api/chat response shape. */
interface OllamaChatResponse {
  model: string;
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Map our messages to Ollama format.
 * Ollama supports system, user, assistant, and tool roles natively.
 */
function mapMessages(messages: Message[]): OllamaMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    // For array content, we need to flatten blocks into a single content string
    // and extract tool_calls for assistant messages.
    const textParts: string[] = [];
    const toolCalls: OllamaToolCall[] = [];

    for (const block of msg.content as ContentBlock[]) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          function: {
            name: block.toolName ?? '',
            arguments: block.input ?? {},
          },
        });
      } else if (block.type === 'tool_result') {
        textParts.push(block.content ?? '');
      }
    }

    const result: OllamaMessage = {
      role: msg.role,
      content: textParts.join('\n'),
    };

    if (toolCalls.length > 0) {
      result.tool_calls = toolCalls;
    }

    return result;
  });
}

/**
 * Map our ToolDefinition[] to Ollama tool format.
 */
function mapTools(tools: ToolDefinition[]): OllamaTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

export class OllamaMind implements Mind {
  public readonly provider = 'ollama';
  public readonly model: string;

  private readonly baseUrl: string;

  constructor(model: string, baseUrl?: string) {
    this.model = model;
    this.baseUrl = baseUrl ?? process.env['OLLAMA_URL'] ?? 'http://localhost:11434';
  }

  async think(input: ThinkInput): Promise<ThinkOutput> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: mapMessages(input.messages),
      stream: false,
      ...(input.temperature !== undefined && {
        options: { temperature: input.temperature },
      }),
    };

    if (input.tools && input.tools.length > 0) {
      body['tools'] = mapTools(input.tools);
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new TransientError(
        `Ollama connection error: ${err instanceof Error ? err.message : String(err)}`,
        'CONNECTION_ERROR',
        { cause: err },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      throw new TransientError(`Ollama HTTP ${res.status}: ${text}`, 'OLLAMA_ERROR');
    }

    const data = (await res.json()) as OllamaChatResponse;

    // Extract tool calls if present
    const toolCalls: ThinkOutput['toolCalls'] = [];
    if (data.message.tool_calls) {
      for (const tc of data.message.tool_calls) {
        toolCalls.push({
          id: `ollama-${crypto.randomUUID()}`,
          name: tc.function.name,
          input: tc.function.arguments,
        });
      }
    }

    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;
    const hasToolCalls = toolCalls.length > 0;

    return {
      content: data.message.content,
      toolCalls: hasToolCalls ? toolCalls : undefined,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: 0, // Local model — always free
      },
      model: data.model,
      stopReason: hasToolCalls ? 'tool_use' : 'end_turn',
    };
  }
}
