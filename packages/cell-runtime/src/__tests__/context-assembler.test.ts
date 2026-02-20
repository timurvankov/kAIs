import { describe, expect, it } from 'vitest';

import { ContextAssembler } from '../context/context-assembler.js';

describe('ContextAssembler', () => {
  const assembler = new ContextAssembler();

  it('assembles basic system prompt + messages', () => {
    const result = assembler.assemble({
      systemPrompt: 'You are a helpful assistant.',
      workingMemory: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    });

    expect(result).toHaveLength(3);
    expect(result[0]!.role).toBe('system');
    expect(result[0]!.content).toBe('You are a helpful assistant.');
    expect(result[1]!.role).toBe('user');
    expect(result[1]!.content).toBe('Hello');
    expect(result[2]!.role).toBe('assistant');
    expect(result[2]!.content).toBe('Hi there');
  });

  it('appends injections to system prompt with separator', () => {
    const result = assembler.assemble({
      systemPrompt: 'You are a helpful assistant.',
      workingMemory: [{ role: 'user', content: 'Hello' }],
      injections: ['Knowledge: The sky is blue.', 'Context: Today is Monday.'],
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.role).toBe('system');
    expect(result[0]!.content).toBe(
      'You are a helpful assistant.\n\n---\n\nKnowledge: The sky is blue.\n\n---\n\nContext: Today is Monday.',
    );
  });

  it('handles empty working memory', () => {
    const result = assembler.assemble({
      systemPrompt: 'You are a bot.',
      workingMemory: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe('system');
    expect(result[0]!.content).toBe('You are a bot.');
  });

  it('handles no injections (undefined)', () => {
    const result = assembler.assemble({
      systemPrompt: 'Prompt.',
      workingMemory: [{ role: 'user', content: 'Hi' }],
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe('Prompt.');
  });

  it('handles empty injections array', () => {
    const result = assembler.assemble({
      systemPrompt: 'Prompt.',
      workingMemory: [{ role: 'user', content: 'Hi' }],
      injections: [],
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe('Prompt.');
  });

  it('preserves message order', () => {
    const result = assembler.assemble({
      systemPrompt: 'System.',
      workingMemory: [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
        { role: 'user', content: 'C' },
        { role: 'assistant', content: 'D' },
      ],
    });

    expect(result).toHaveLength(5);
    expect(result.map(m => m.content)).toEqual(['System.', 'A', 'B', 'C', 'D']);
  });
});
