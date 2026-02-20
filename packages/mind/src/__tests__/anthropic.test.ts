import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMError, TransientError } from '@kais/core';

import { AnthropicMind } from '../anthropic.js';
import type { ThinkInput } from '../types.js';

// We mock the Anthropic SDK at module level
vi.mock('@anthropic-ai/sdk', () => {
  const createMock = vi.fn();

  // Build error classes that match the real SDK hierarchy
  class AnthropicError extends Error {}

  class APIError extends AnthropicError {
    status: number | undefined;
    headers: unknown;
    error: unknown;
    constructor(status: number | undefined, error: unknown, message: string | undefined, headers: unknown) {
      super(message ?? 'API error');
      this.status = status;
      this.headers = headers;
      this.error = error;
    }
    static generate() {
      return new APIError(500, undefined, 'generated error', undefined);
    }
  }

  class RateLimitError extends APIError {
    constructor() {
      super(429, undefined, 'rate limited', {});
    }
  }

  class AuthenticationError extends APIError {
    constructor() {
      super(401, undefined, 'auth failed', {});
    }
  }

  class APIConnectionError extends APIError {
    constructor() {
      super(undefined, undefined, 'connection failed', undefined);
    }
  }

  class InternalServerError extends APIError {
    constructor() {
      super(500, undefined, 'server error', {});
    }
  }

  class BadRequestError extends APIError {
    constructor() {
      super(400, undefined, 'bad request', {});
    }
  }

  class Anthropic {
    messages: { create: typeof createMock };
    constructor() {
      this.messages = { create: createMock };
    }
  }

  // Attach error classes as static properties on the default export
  const defaultExport = Object.assign(Anthropic, {
    RateLimitError,
    AuthenticationError,
    APIConnectionError,
    InternalServerError,
    BadRequestError,
    APIError,
    AnthropicError,
  });

  return {
    default: defaultExport,
    RateLimitError,
    AuthenticationError,
    APIConnectionError,
    InternalServerError,
    BadRequestError,
    APIError,
    AnthropicError,
  };
});

// Import after mock so we get the mocked version
import Anthropic from '@anthropic-ai/sdk';

function getCreateMock() {
  // Access the mocked create function
  const instance = new (Anthropic as unknown as new () => { messages: { create: ReturnType<typeof vi.fn> } })();
  return instance.messages.create;
}

describe('AnthropicMind', () => {
  let mind: AnthropicMind;
  let createMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mind = new AnthropicMind('claude-sonnet-4-20250514', 'test-key');
    createMock = getCreateMock();
    createMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct provider and model', () => {
    expect(mind.provider).toBe('anthropic');
    expect(mind.model).toBe('claude-sonnet-4-20250514');
  });

  describe('message mapping', () => {
    it('extracts system prompt from first system message', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['system']).toBe('You are helpful.');
      expect(callArgs['messages']).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('concatenates multiple system messages', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'Hello' },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['system']).toBe('You are helpful.\n\nBe concise.');
      expect(callArgs['messages']).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('handles system message with ContentBlock[] content', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [
          {
            role: 'system',
            content: [
              { type: 'text', text: 'You are helpful.' },
              { type: 'text', text: 'Be concise.' },
            ],
          },
          { role: 'user', content: 'Hello' },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['system']).toBe('You are helpful.\nBe concise.');
      expect(callArgs['messages']).toEqual([{ role: 'user', content: 'Hello' }]);
    });

    it('maps user and assistant messages correctly', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['messages']).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ]);
      expect(callArgs['system']).toBeUndefined();
    });

    it('maps content blocks in messages', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'tool_result', toolUseId: 'tc-1', content: 'result data', isError: false },
            ],
          },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      const msgs = callArgs['messages'] as Array<{ content: unknown }>;
      expect(msgs[0]!.content).toEqual([
        { type: 'tool_result', tool_use_id: 'tc-1', content: 'result data', is_error: false },
      ]);
    });
  });

  describe('tool definition mapping', () => {
    it('maps tools to Anthropic format', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'call tool' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a city',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['tools']).toEqual([
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          input_schema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ]);
    });

    it('does not include tools when none provided', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hello' }],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['tools']).toBeUndefined();
    });
  });

  describe('response parsing', () => {
    it('parses text-only response', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello, world!' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.content).toBe('Hello, world!');
      expect(result.toolCalls).toBeUndefined();
      expect(result.stopReason).toBe('end_turn');
      expect(result.model).toBe('claude-sonnet-4-20250514');
    });

    it('parses tool_use response', async () => {
      createMock.mockResolvedValue({
        content: [
          { type: 'tool_use', id: 'tc-abc', name: 'get_weather', input: { city: 'London' } },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: { input_tokens: 80, output_tokens: 30 },
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'weather?' }],
      });

      expect(result.content).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'tc-abc',
        name: 'get_weather',
        input: { city: 'London' },
      });
      expect(result.stopReason).toBe('tool_use');
    });

    it('parses mixed text + tool_use response', async () => {
      createMock.mockResolvedValue({
        content: [
          { type: 'text', text: 'Let me check.' },
          { type: 'tool_use', id: 'tc-123', name: 'search', input: { q: 'foo' } },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: { input_tokens: 50, output_tokens: 40 },
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'search' }],
      });

      expect(result.content).toBe('Let me check.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]!.name).toBe('search');
      expect(result.stopReason).toBe('tool_use');
    });
  });

  describe('cost computation', () => {
    it('computes cost with known token counts', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      // $3/1M input + $15/1M * 0.5M output = $3 + $7.50 = $10.50
      expect(result.usage.inputTokens).toBe(1_000_000);
      expect(result.usage.outputTokens).toBe(500_000);
      expect(result.usage.totalTokens).toBe(1_500_000);
      expect(result.usage.cost).toBeCloseTo(10.5, 6);
    });
  });

  describe('stop reason mapping', () => {
    it('maps end_turn', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'done' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await mind.think({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.stopReason).toBe('end_turn');
    });

    it('maps max_tokens', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'truncated' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'max_tokens',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await mind.think({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.stopReason).toBe('max_tokens');
    });

    it('maps tool_use', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'tool_use', id: 'tc-1', name: 'fn', input: {} }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await mind.think({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.stopReason).toBe('tool_use');
    });

    it('maps stop_sequence to end_turn', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'done' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'stop_sequence',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await mind.think({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.stopReason).toBe('end_turn');
    });

    it('maps null to end_turn', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'done' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const result = await mind.think({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.stopReason).toBe('end_turn');
    });
  });

  describe('error mapping', () => {
    it('maps rate limit to TransientError', async () => {
      const err = new (Anthropic as unknown as Record<string, new () => Error>)['RateLimitError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);
    });

    it('maps server error to TransientError', async () => {
      const err = new (Anthropic as unknown as Record<string, new () => Error>)['InternalServerError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);
    });

    it('maps connection error to TransientError', async () => {
      const err = new (Anthropic as unknown as Record<string, new () => Error>)['APIConnectionError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);
    });

    it('maps auth error to LLMError', async () => {
      const err = new (Anthropic as unknown as Record<string, new () => Error>)['AuthenticationError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(LLMError);
    });

    it('maps bad request to LLMError', async () => {
      const err = new (Anthropic as unknown as Record<string, new () => Error>)['BadRequestError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(LLMError);
    });

    it('maps generic Error to TransientError', async () => {
      createMock.mockRejectedValue(new Error('network hiccup'));

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);
    });
  });

  describe('parameters', () => {
    it('passes temperature when provided', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.7,
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['temperature']).toBe(0.7);
    });

    it('passes maxTokens override', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 1000,
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['max_tokens']).toBe(1000);
    });

    it('defaults maxTokens to 4096', async () => {
      createMock.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['max_tokens']).toBe(4096);
    });
  });
});
