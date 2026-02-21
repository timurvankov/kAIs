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
  const out: OllamaMessage[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }

    // For array content, split into: text/tool_use parts (keep original role)
    // and tool_result parts (emit as role: 'tool').
    const textParts: string[] = [];
    const toolCalls: OllamaToolCall[] = [];
    const toolResults: string[] = [];

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
        toolResults.push(block.content ?? '');
      }
    }

    // Emit assistant message with text + tool_calls first
    if (textParts.length > 0 || toolCalls.length > 0) {
      const result: OllamaMessage = {
        role: msg.role,
        content: textParts.join('\n'),
      };
      if (toolCalls.length > 0) {
        result.tool_calls = toolCalls;
      }
      out.push(result);
    }

    // Then emit tool results as separate role: 'tool' messages
    for (const content of toolResults) {
      out.push({ role: 'tool', content });
    }
  }

  return out;
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
    const options: Record<string, unknown> = {};
    if (input.temperature !== undefined) options['temperature'] = input.temperature;
    if (input.maxTokens !== undefined) options['num_predict'] = input.maxTokens;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: mapMessages(input.messages),
      stream: false,
      think: false, // Disable extended thinking to reduce latency on CPU
      ...(Object.keys(options).length > 0 && { options }),
    };

    if (input.tools && input.tools.length > 0) {
      body['tools'] = mapTools(input.tools);
    }

    let res: Response;
    try {
      const msgCount = (body['messages'] as unknown[]).length;
      console.log(`[OllamaMind] POST ${this.baseUrl}/api/chat model=${this.model} msgs=${msgCount} tools=${(body['tools'] as unknown[] | undefined)?.length ?? 0}`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 600_000); // 10 min timeout
      const t0 = Date.now();
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      console.log(`[OllamaMind] Response ${res.status} in ${Date.now() - t0}ms`);
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
