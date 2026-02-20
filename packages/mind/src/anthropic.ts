/**
 * AnthropicMind — Anthropic API provider for the Mind interface.
 */
import Anthropic from '@anthropic-ai/sdk';
import { LLMError, TransientError } from '@kais/core';

import { computeCost } from './pricing.js';
import type { ContentBlock, Message, Mind, ThinkInput, ThinkOutput, ToolDefinition } from './types.js';

/**
 * Map our ToolDefinition[] to Anthropic Tool[] format.
 */
function mapTools(tools: ToolDefinition[]): Anthropic.Messages.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool.InputSchema,
  }));
}

/**
 * Map a single ContentBlock to an Anthropic ContentBlockParam.
 */
function mapContentBlock(block: ContentBlock): Anthropic.Messages.ContentBlockParam {
  if (block.type === 'text') {
    return { type: 'text', text: block.text ?? '' };
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.toolUseId ?? '',
      name: block.toolName ?? '',
      input: block.input ?? {},
    };
  }
  if (block.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: block.toolUseId ?? '',
      content: block.content,
      is_error: block.isError,
    };
  }
  // Fallback — shouldn't happen
  return { type: 'text', text: '' };
}

/**
 * Flatten a ContentBlock[] to a single string by joining text blocks.
 */
function flattenContent(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

/**
 * Map our Message[] to Anthropic's format.
 * Extracts system messages into a separate system prompt string.
 * Multiple system messages are concatenated with double newlines.
 * Returns { system, messages }.
 */
function mapMessages(messages: Message[]): {
  system: string | undefined;
  messages: Anthropic.Messages.MessageParam[];
} {
  const systemMessages: string[] = [];
  const mapped: Anthropic.Messages.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string' ? msg.content : flattenContent(msg.content);
      systemMessages.push(text);
      continue;
    }

    if (typeof msg.content === 'string') {
      mapped.push({ role: msg.role, content: msg.content });
    } else {
      mapped.push({
        role: msg.role,
        content: msg.content.map(mapContentBlock),
      });
    }
  }

  const system = systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined;

  return { system, messages: mapped };
}

/**
 * Map Anthropic stop_reason to our stopReason type.
 */
function mapStopReason(
  reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null,
): ThinkOutput['stopReason'] {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  return 'end_turn';
}

/**
 * Map Anthropic SDK errors to kAIs error classes.
 */
function mapError(err: unknown): never {
  if (err instanceof Anthropic.RateLimitError) {
    throw new TransientError(`Anthropic rate limit: ${(err as Error).message}`, 'RATE_LIMIT', { cause: err });
  }
  if (err instanceof Anthropic.InternalServerError) {
    throw new TransientError(`Anthropic server error: ${(err as Error).message}`, 'SERVER_ERROR', { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    throw new TransientError(`Anthropic connection error: ${(err as Error).message}`, 'CONNECTION_ERROR', {
      cause: err,
    });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    throw new LLMError(`Anthropic auth error: ${(err as Error).message}`, 'AUTH_ERROR', { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    throw new LLMError(`Anthropic API error: ${(err as Error).message}`, 'LLM_ERROR', { cause: err });
  }
  if (err instanceof Error) {
    throw new TransientError(`Anthropic unknown error: ${err.message}`, 'UNKNOWN_ERROR', { cause: err });
  }
  throw new LLMError('Anthropic unknown error', 'UNKNOWN_ERROR');
}

export class AnthropicMind implements Mind {
  public readonly provider = 'anthropic';
  public readonly model: string;

  private readonly client: Anthropic;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.client = new Anthropic({
      apiKey: apiKey ?? process.env['ANTHROPIC_API_KEY'],
    });
  }

  async think(input: ThinkInput): Promise<ThinkOutput> {
    const { system, messages } = mapMessages(input.messages);

    const params: Anthropic.Messages.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: input.maxTokens ?? 4096,
      messages,
      ...(system !== undefined && { system }),
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.tools && input.tools.length > 0 && { tools: mapTools(input.tools) }),
    };

    let response: Anthropic.Messages.Message;
    try {
      response = await this.client.messages.create(params);
    } catch (err) {
      mapError(err);
    }

    // Extract text and tool_use blocks
    let content = '';
    const toolCalls: ThinkOutput['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input,
        });
      }
    }

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: computeCost(this.model, inputTokens, outputTokens),
      },
      model: response.model,
      stopReason: mapStopReason(response.stop_reason),
    };
  }
}
