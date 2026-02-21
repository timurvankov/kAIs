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

  // --- v2: Token budget management ---

  describe('v2 token budgeting', () => {
    it('truncates oldest messages when exceeding maxTokens', () => {
      const result = assembler.assemble({
        systemPrompt: 'Sys.',
        workingMemory: [
          { role: 'user', content: 'A'.repeat(100) },
          { role: 'assistant', content: 'B'.repeat(100) },
          { role: 'user', content: 'C'.repeat(100) },
          { role: 'assistant', content: 'D'.repeat(100) },
        ],
        maxTokens: 50, // Very tight budget — only system + last few msgs
      });

      // System always included
      expect(result[0]!.role).toBe('system');
      // Some messages should be dropped due to budget
      expect(result.length).toBeLessThan(5);
      // Last message should be the most recent one that fits
      if (result.length > 1) {
        expect(result[result.length - 1]!.content).toBe('D'.repeat(100));
      }
    });

    it('keeps all messages when budget is generous', () => {
      const result = assembler.assemble({
        systemPrompt: 'Sys.',
        workingMemory: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        maxTokens: 10000,
      });

      expect(result).toHaveLength(3);
    });

    it('returns only system when budget is extremely small', () => {
      const result = assembler.assemble({
        systemPrompt: 'X',
        workingMemory: [
          { role: 'user', content: 'A'.repeat(10000) },
        ],
        maxTokens: 5,
      });

      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe('system');
    });
  });

  // --- v2: Knowledge injection ---

  describe('v2 knowledge injection', () => {
    it('injects knowledge facts into system prompt', () => {
      const result = assembler.assemble({
        systemPrompt: 'You are helpful.',
        workingMemory: [],
        knowledge: [
          { content: 'Fact A', relevance: 0.9 },
          { content: 'Fact B', relevance: 0.5 },
        ],
      });

      expect(result[0]!.content).toContain('Fact A');
      expect(result[0]!.content).toContain('Fact B');
    });

    it('sorts knowledge by relevance (highest first)', () => {
      const result = assembler.assemble({
        systemPrompt: 'Sys.',
        workingMemory: [],
        knowledge: [
          { content: 'Low relevance', relevance: 0.1 },
          { content: 'High relevance', relevance: 0.9 },
        ],
      });

      const content = result[0]!.content as string;
      expect(content.indexOf('High relevance')).toBeLessThan(
        content.indexOf('Low relevance'),
      );
    });

    it('limits knowledge injection within token budget', () => {
      const result = assembler.assemble({
        systemPrompt: 'Sys.',
        workingMemory: [],
        maxTokens: 20,
        knowledge: [
          { content: 'Short fact', relevance: 0.9 },
          { content: 'X'.repeat(500), relevance: 0.5 },
        ],
      });

      const content = result[0]!.content as string;
      expect(content).toContain('Short fact');
      // Long fact should be excluded due to budget
      expect(content).not.toContain('X'.repeat(500));
    });
  });

  // --- v2: Self-awareness injection ---

  describe('v2 self-awareness', () => {
    it('injects self-awareness into system prompt', () => {
      const result = assembler.assemble({
        systemPrompt: 'You are helpful.',
        workingMemory: [],
        selfAwareness: 'I am good at code review but weak at design.',
      });

      expect(result[0]!.content).toContain('Self-Awareness');
      expect(result[0]!.content).toContain('good at code review');
    });
  });
});
