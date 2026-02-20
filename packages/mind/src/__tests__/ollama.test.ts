import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransientError } from '@kais/core';

import { OllamaMind } from '../ollama.js';

describe('OllamaMind', () => {
  let mind: OllamaMind;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mind = new OllamaMind('llama3.2', 'http://localhost:11434');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('has correct provider and model', () => {
    expect(mind.provider).toBe('ollama');
    expect(mind.model).toBe('llama3.2');
  });

  describe('request format', () => {
    it('sends correct request body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'Hello!' },
          done: true,
          prompt_eval_count: 20,
          eval_count: 10,
        }),
      });

      await mind.think({
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hi' },
        ],
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:11434/api/chat');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body['model']).toBe('llama3.2');
      expect(body['stream']).toBe(false);
      expect(body['messages']).toEqual([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ]);
    });

    it('sends tools when provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'ok' },
          done: true,
          prompt_eval_count: 20,
          eval_count: 10,
        }),
      });

      await mind.think({
        messages: [{ role: 'user', content: 'call tool' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      });

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<
        string,
        unknown
      >;
      expect(body['tools']).toEqual([
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather',
            parameters: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      ]);
    });

    it('passes temperature in options', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'ok' },
          done: true,
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.3,
      });

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<
        string,
        unknown
      >;
      expect(body['options']).toEqual({ temperature: 0.3 });
    });

    it('passes maxTokens as num_predict in options', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'ok' },
          done: true,
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 512,
      });

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<
        string,
        unknown
      >;
      expect(body['options']).toEqual({ num_predict: 512 });
    });

    it('passes both temperature and maxTokens in options', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'ok' },
          done: true,
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.5,
        maxTokens: 1024,
      });

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<
        string,
        unknown
      >;
      expect(body['options']).toEqual({ temperature: 0.5, num_predict: 1024 });
    });

    it('omits options when neither temperature nor maxTokens provided', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'ok' },
          done: true,
          prompt_eval_count: 10,
          eval_count: 5,
        }),
      });

      await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<
        string,
        unknown
      >;
      expect(body['options']).toBeUndefined();
    });
  });

  describe('response parsing', () => {
    it('parses text response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'Hello there!' },
          done: true,
          prompt_eval_count: 15,
          eval_count: 8,
        }),
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.content).toBe('Hello there!');
      expect(result.toolCalls).toBeUndefined();
      expect(result.stopReason).toBe('end_turn');
      expect(result.model).toBe('llama3.2');
      expect(result.usage.inputTokens).toBe(15);
      expect(result.usage.outputTokens).toBe(8);
      expect(result.usage.totalTokens).toBe(23);
    });

    it('parses tool call response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              { function: { name: 'get_weather', arguments: { city: 'Tokyo' } } },
            ],
          },
          done: true,
          prompt_eval_count: 20,
          eval_count: 15,
        }),
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'weather?' }],
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]!.name).toBe('get_weather');
      expect(result.toolCalls![0]!.input).toEqual({ city: 'Tokyo' });
      expect(result.stopReason).toBe('tool_use');
    });

    it('cost is always 0', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'hi' },
          done: true,
          prompt_eval_count: 1_000_000,
          eval_count: 500_000,
        }),
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.usage.cost).toBe(0);
    });

    it('handles missing token counts', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'llama3.2',
          message: { role: 'assistant', content: 'hi' },
          done: true,
        }),
      });

      const result = await mind.think({
        messages: [{ role: 'user', content: 'hi' }],
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
      expect(result.usage.totalTokens).toBe(0);
    });
  });

  describe('error handling', () => {
    it('wraps fetch network error as TransientError', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('connection error');
    });

    it('wraps HTTP error as TransientError', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(TransientError);

      await expect(
        mind.think({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow('HTTP 500');
    });
  });

  describe('default base URL', () => {
    it('uses OLLAMA_URL env var when not provided', async () => {
      const original = process.env['OLLAMA_URL'];
      process.env['OLLAMA_URL'] = 'http://custom:1234';

      try {
        const m = new OllamaMind('llama3.2');
        // We can't directly access private baseUrl, but we can test via fetch call
        fetchMock.mockResolvedValue({
          ok: true,
          json: async () => ({
            model: 'llama3.2',
            message: { role: 'assistant', content: 'hi' },
            done: true,
          }),
        });

        await m.think({ messages: [{ role: 'user', content: 'hi' }] });
        const [url] = fetchMock.mock.calls[0] as [string];
        expect(url).toBe('http://custom:1234/api/chat');
      } finally {
        // Restore
        if (original !== undefined) {
          process.env['OLLAMA_URL'] = original;
        } else {
          delete process.env['OLLAMA_URL'];
        }
      }
    });
  });
});
