/**
 * OpenAIMind — OpenAI API provider for the Mind interface.
 */
import OpenAI from 'openai';
import { LLMError, TransientError } from '@kais/core';

import { computeCost } from './pricing.js';
import type { ContentBlock, Message, Mind, ThinkInput, ThinkOutput, ToolDefinition } from './types.js';

type OpenAIMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;

/**
 * Map our ToolDefinition[] to OpenAI function-calling format.
 */
function mapTools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/**
 * Map our Message[] to OpenAI ChatCompletionMessageParam[].
 * OpenAI supports system, user, assistant, and tool roles natively.
 */
function mapMessages(messages: Message[]): OpenAIMessageParam[] {
  const result: OpenAIMessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const content = typeof msg.content === 'string' ? msg.content : flattenContent(msg.content);
      result.push({ role: 'system', content });
      continue;
    }

    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : flattenContent(msg.content);
      result.push({ role: 'user', content });
      continue;
    }

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content });
        continue;
      }

      // For assistant messages with blocks, extract text and tool_calls
      const textParts: string[] = [];
      const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
      const toolResults: Array<{ toolCallId: string; content: string; isError?: boolean }> = [];

      for (const block of msg.content as ContentBlock[]) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.toolUseId ?? '',
            type: 'function',
            function: {
              name: block.toolName ?? '',
              arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
            },
          });
        } else if (block.type === 'tool_result') {
          toolResults.push({
            toolCallId: block.toolUseId ?? '',
            content: block.content ?? '',
            isError: block.isError,
          });
        }
      }

      // Push assistant message with tool_calls if any
      if (toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: textParts.join('\n') || null,
          tool_calls: toolCalls,
        });
      } else {
        result.push({
          role: 'assistant',
          content: textParts.join('\n'),
        });
      }

      // Push tool result messages
      for (const tr of toolResults) {
        result.push({
          role: 'tool',
          tool_call_id: tr.toolCallId,
          content: tr.content,
        });
      }
      continue;
    }
  }

  return result;
}

/**
 * Flatten ContentBlock[] to a single string.
 */
function flattenContent(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

/**
 * Map OpenAI finish_reason to our stopReason.
 */
function mapStopReason(
  reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null | undefined,
): ThinkOutput['stopReason'] {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  return 'end_turn';
}

/**
 * Map OpenAI SDK errors to kAIs error classes.
 */
function mapError(err: unknown): never {
  if (err instanceof OpenAI.RateLimitError) {
    throw new TransientError(`OpenAI rate limit: ${(err as Error).message}`, 'RATE_LIMIT', { cause: err });
  }
  if (err instanceof OpenAI.InternalServerError) {
    throw new TransientError(`OpenAI server error: ${(err as Error).message}`, 'SERVER_ERROR', { cause: err });
  }
  if (err instanceof OpenAI.APIConnectionError) {
    throw new TransientError(`OpenAI connection error: ${(err as Error).message}`, 'CONNECTION_ERROR', { cause: err });
  }
  if (err instanceof OpenAI.AuthenticationError) {
    throw new LLMError(`OpenAI auth error: ${(err as Error).message}`, 'AUTH_ERROR', { cause: err });
  }
  if (err instanceof OpenAI.APIError) {
    throw new LLMError(`OpenAI API error: ${(err as Error).message}`, 'LLM_ERROR', { cause: err });
  }
  if (err instanceof Error) {
    throw new TransientError(`OpenAI unknown error: ${err.message}`, 'UNKNOWN_ERROR', { cause: err });
  }
  throw new LLMError('OpenAI unknown error', 'UNKNOWN_ERROR');
}

export class OpenAIMind implements Mind {
  public readonly provider = 'openai';
  public readonly model: string;

  private readonly client: OpenAI;

  constructor(model: string, apiKey?: string) {
    this.model = model;
    this.client = new OpenAI({
      apiKey: apiKey ?? process.env['OPENAI_API_KEY'],
    });
  }

  async think(input: ThinkInput): Promise<ThinkOutput> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: mapMessages(input.messages),
      max_tokens: input.maxTokens ?? 4096,
      ...(input.temperature !== undefined && { temperature: input.temperature }),
      ...(input.tools && input.tools.length > 0 && { tools: mapTools(input.tools) }),
    };

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.client.chat.completions.create(params);
    } catch (err) {
      mapError(err);
    }

    const choice = response.choices[0];
    if (!choice) {
      throw new LLMError('OpenAI returned no choices', 'NO_CHOICES');
    }

    const message = choice.message;
    const content = message.content ?? '';

    // Extract tool calls
    const toolCalls: ThinkOutput['toolCalls'] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let parsedInput: unknown;
        try {
          parsedInput = JSON.parse(tc.function.arguments);
        } catch {
          parsedInput = tc.function.arguments;
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          input: parsedInput,
        });
      }
    }

    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

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
      stopReason: mapStopReason(choice.finish_reason),
    };
  }
}
