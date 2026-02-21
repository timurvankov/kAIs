/**
 * LLM Smoke Tests — verify real LLM providers work end-to-end.
 *
 * Uses Claude Haiku for cheap, fast verification (~$0.01 per run).
 * Requires ANTHROPIC_API_KEY env var.
 */
import { describe, it, expect } from 'vitest';
import { AnthropicMind } from '@kais/mind';
import { MockMind } from '@kais/mind';

describe('LLM Smoke Tests', () => {
  describe('MockMind (baseline)', () => {
    it('returns enqueued responses deterministically', async () => {
      const mock = new MockMind();
      mock.enqueue({
        content: 'Hello from mock',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0 },
        model: 'mock-model',
        stopReason: 'end_turn',
      });

      const result = await mock.think({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(result.content).toBe('Hello from mock');
      expect(result.model).toBe('mock-model');
      expect(mock.calls).toHaveLength(1);
    });
  });

  describe('Anthropic Haiku (real LLM)', () => {
    const apiKey = process.env['ANTHROPIC_API_KEY'];

    it.skipIf(!apiKey)('generates a text response', async () => {
      const mind = new AnthropicMind('claude-haiku-4-5-20251001', apiKey);

      const result = await mind.think({
        messages: [
          { role: 'user', content: 'What is 2 + 2? Reply with just the number.' },
        ],
        maxTokens: 32,
        temperature: 0,
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content).toContain('4');
      expect(result.usage.inputTokens).toBeGreaterThan(0);
      expect(result.usage.outputTokens).toBeGreaterThan(0);
      expect(result.stopReason).toBe('end_turn');
    });

    it.skipIf(!apiKey)('handles tool calls', async () => {
      const mind = new AnthropicMind('claude-haiku-4-5-20251001', apiKey);

      const result = await mind.think({
        messages: [
          { role: 'user', content: 'What is the weather in San Francisco?' },
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get the current weather in a city',
            inputSchema: {
              type: 'object',
              properties: {
                city: { type: 'string', description: 'City name' },
              },
              required: ['city'],
            },
          },
        ],
        maxTokens: 256,
        temperature: 0,
      });

      expect(result.stopReason).toBe('tool_use');
      expect(result.toolCalls).toBeDefined();
      expect(result.toolCalls!.length).toBeGreaterThan(0);

      const toolCall = result.toolCalls![0]!;
      expect(toolCall.name).toBe('get_weather');
      expect(toolCall.id).toBeDefined();
      expect(toolCall.input).toBeDefined();
      const input = toolCall.input as { city: string };
      expect(input.city).toBeDefined();
    });

    it.skipIf(!apiKey)('respects system prompt', async () => {
      const mind = new AnthropicMind('claude-haiku-4-5-20251001', apiKey);

      const result = await mind.think({
        messages: [
          {
            role: 'system',
            content: 'You are a pirate. Every response must include "arr".',
          },
          { role: 'user', content: 'Hello!' },
        ],
        maxTokens: 64,
        temperature: 0,
      });

      expect(result.content.toLowerCase()).toContain('arr');
    });
  });
});
