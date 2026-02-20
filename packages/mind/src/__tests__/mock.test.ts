import { describe, expect, it } from 'vitest';
import { LLMError } from '@kais/core';

import { MockMind } from '../mock.js';
import type { ThinkOutput } from '../types.js';

function makeOutput(overrides: Partial<ThinkOutput> = {}): ThinkOutput {
  return {
    content: 'hello',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cost: 0 },
    model: 'mock-model',
    stopReason: 'end_turn',
    ...overrides,
  };
}

describe('MockMind', () => {
  it('has correct provider and model', () => {
    const mind = new MockMind('test-model');
    expect(mind.provider).toBe('mock');
    expect(mind.model).toBe('test-model');
  });

  it('defaults model to mock-model', () => {
    const mind = new MockMind();
    expect(mind.model).toBe('mock-model');
  });

  it('returns queued responses in FIFO order', async () => {
    const mind = new MockMind();
    const out1 = makeOutput({ content: 'first' });
    const out2 = makeOutput({ content: 'second' });

    mind.enqueue(out1, out2);

    const r1 = await mind.think({ messages: [{ role: 'user', content: 'a' }] });
    expect(r1.content).toBe('first');

    const r2 = await mind.think({ messages: [{ role: 'user', content: 'b' }] });
    expect(r2.content).toBe('second');
  });

  it('records all think() calls', async () => {
    const mind = new MockMind();
    mind.enqueue(makeOutput(), makeOutput());

    await mind.think({ messages: [{ role: 'user', content: 'hello' }] });
    await mind.think({ messages: [{ role: 'user', content: 'world' }], temperature: 0.5 });

    expect(mind.calls).toHaveLength(2);
    expect(mind.calls[0]!.messages[0]!.content).toBe('hello');
    expect(mind.calls[1]!.temperature).toBe(0.5);
  });

  it('throws LLMError when queue is empty', async () => {
    const mind = new MockMind();
    await expect(mind.think({ messages: [] })).rejects.toThrow(LLMError);
    await expect(mind.think({ messages: [] })).rejects.toThrow('no responses queued');
  });

  it('supports tool call simulation', async () => {
    const mind = new MockMind();
    const output = makeOutput({
      content: '',
      toolCalls: [{ id: 'tc-1', name: 'get_weather', input: { city: 'SF' } }],
      stopReason: 'tool_use',
    });

    mind.enqueue(output);

    const result = await mind.think({ messages: [{ role: 'user', content: 'weather?' }] });
    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0]!.name).toBe('get_weather');
  });

  it('reset clears queue and calls', async () => {
    const mind = new MockMind();
    mind.enqueue(makeOutput());
    await mind.think({ messages: [] });

    expect(mind.calls).toHaveLength(1);

    mind.reset();
    expect(mind.calls).toHaveLength(0);

    // Queue is also empty, so this should throw
    await expect(mind.think({ messages: [] })).rejects.toThrow(LLMError);
  });
});
