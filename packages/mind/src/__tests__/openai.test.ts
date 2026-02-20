import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMError, TransientError } from '@kais/core';

import { OpenAIMind } from '../openai.js';

// Mock the OpenAI SDK
vi.mock('openai', () => {
  const createMock = vi.fn();

  class OpenAIError extends Error {}

  class APIError extends OpenAIError {
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

  class OpenAI {
    chat: { completions: { create: typeof createMock } };
    constructor() {
      this.chat = { completions: { create: createMock } };
    }
  }

  const defaultExport = Object.assign(OpenAI, {
    RateLimitError,
    AuthenticationError,
    APIConnectionError,
    InternalServerError,
    BadRequestError,
    APIError,
    OpenAIError,
  });

  return {
    default: defaultExport,
    RateLimitError,
    AuthenticationError,
    APIConnectionError,
    InternalServerError,
    BadRequestError,
    APIError,
    OpenAIError,
  };
});

import OpenAI from 'openai';

function getCreateMock() {
  const instance = new (OpenAI as unknown as new () => {
    chat: { completions: { create: ReturnType<typeof vi.fn> } };
  })();
  return instance.chat.completions.create;
}

describe('OpenAIMind', () => {
  let mind: OpenAIMind;
  let createMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mind = new OpenAIMind('gpt-4o', 'test-key');
    createMock = getCreateMock();
    createMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct provider and model', () => {
    expect(mind.provider).toBe('openai');
    expect(mind.model).toBe('gpt-4o');
  });

  describe('message mapping', () => {
    it('maps system, user, and assistant messages', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await mind.think({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['messages']).toEqual([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ]);
    });

    it('maps assistant messages with tool_use blocks', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'done', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      });

      await mind.think({
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me check.' },
              { type: 'tool_use', toolUseId: 'tc-1', toolName: 'search', input: { q: 'foo' } },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'tool_result', toolUseId: 'tc-1', content: 'result data' },
            ],
          },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      const messages = callArgs['messages'] as Array<Record<string, unknown>>;

      // First assistant message has text + tool_calls
      expect(messages[0]!['role']).toBe('assistant');
      expect(messages[0]!['content']).toBe('Let me check.');
      expect(messages[0]!['tool_calls']).toEqual([
        {
          id: 'tc-1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"foo"}' },
        },
      ]);

      // Tool result becomes a 'tool' role message
      expect(messages[1]!['role']).toBe('assistant');
      // The second assistant message with just tool_result generates tool message(s)
      expect(messages[2]!['role']).toBe('tool');
      expect(messages[2]!['tool_call_id']).toBe('tc-1');
      expect(messages[2]!['content']).toBe('result data');
    });
  });

  describe('tool definition mapping', () => {
    it('maps tools to OpenAI function format', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'call tool' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['tools']).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get the weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ]);
    });
  });

  describe('response parsing', () => {
    it('parses text-only response', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'Hello!', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.content).toBe('Hello!');
      expect(result.toolCalls).toBeUndefined();
      expect(result.stopReason).toBe('end_turn');
      expect(result.model).toBe('gpt-4o');
    });

    it('parses tool call response', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"London"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'weather?' }],
      });

      expect(result.content).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_abc',
        name: 'get_weather',
        input: { city: 'London' },
      });
      expect(result.stopReason).toBe('tool_use');
    });

    it('handles invalid JSON in tool call arguments gracefully', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: 'call_xyz',
                  type: 'function',
                  function: {
                    name: 'search',
                    arguments: 'not-valid-json',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'search' }],
      });

      // Falls back to raw string when JSON.parse fails
      expect(result.toolCalls![0]!.input).toBe('not-valid-json');
    });

    it('throws LLMError when no choices returned', async () => {
      createMock.mockResolvedValue({
        choices: [],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
      });

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(LLMError);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('no choices');
    });
  });

  describe('cost computation', () => {
    it('computes correct cost for gpt-4o', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000, total_tokens: 1_500_000 },
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      // $2.50/1M input + $10/1M * 0.5M output = $2.50 + $5 = $7.50
      expect(result.usage.cost).toBeCloseTo(7.5, 6);
    });

    it('handles missing usage gracefully', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });
  });

  describe('stop reason mapping', () => {
    it('maps stop to end_turn', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'done', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const result = await mind.think({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.stopReason).toBe('end_turn');
    });

    it('maps length to max_tokens', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'truncat', refusal: null },
            finish_reason: 'length',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const result = await mind.think({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.stopReason).toBe('max_tokens');
    });

    it('maps tool_calls to tool_use', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [{ id: 'tc-1', type: 'function', function: { name: 'f', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const result = await mind.think({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.stopReason).toBe('tool_use');
    });
  });

  describe('error mapping', () => {
    it('maps rate limit to TransientError', async () => {
      const err = new (OpenAI as unknown as Record<string, new () => Error>)['RateLimitError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);
    });

    it('maps server error to TransientError', async () => {
      const err = new (OpenAI as unknown as Record<string, new () => Error>)['InternalServerError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);
    });

    it('maps connection error to TransientError', async () => {
      const err = new (OpenAI as unknown as Record<string, new () => Error>)['APIConnectionError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);
    });

    it('maps auth error to LLMError', async () => {
      const err = new (OpenAI as unknown as Record<string, new () => Error>)['AuthenticationError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(LLMError);
    });

    it('maps bad request to LLMError', async () => {
      const err = new (OpenAI as unknown as Record<string, new () => Error>)['BadRequestError']!();
      createMock.mockRejectedValue(err);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(LLMError);
    });

    it('maps generic Error to TransientError', async () => {
      createMock.mockRejectedValue(new Error('kaboom'));

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);
    });
  });

  describe('parameters', () => {
    it('passes temperature when provided', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.9,
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['temperature']).toBe(0.9);
    });

    it('passes maxTokens when provided', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 2048,
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['max_tokens']).toBe(2048);
    });

    it('does not set max_tokens or temperature when not provided', async () => {
      createMock.mockResolvedValue({
        choices: [
          {
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
          },
        ],
        model: 'gpt-4o',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      const callArgs = createMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(callArgs['max_tokens']).toBeUndefined();
      expect(callArgs['temperature']).toBeUndefined();
    });
  });
});
