import { describe, expect, it, beforeEach } from 'vitest';
import { MockMind } from '@kais/mind';

import { WorkingMemoryManager } from '../memory/working-memory.js';
import type { Message } from '@kais/mind';
import { makeThinkOutput } from './helpers.js';

describe('WorkingMemoryManager', () => {
  let wm: WorkingMemoryManager;

  beforeEach(() => {
    wm = new WorkingMemoryManager({ maxMessages: 5, summarizeAfter: 3 });
  });

  describe('addMessage and getMessages', () => {
    it('adds messages and retrieves them', () => {
      wm.addMessage({ role: 'user', content: 'Hello' });
      wm.addMessage({ role: 'assistant', content: 'Hi there' });

      const messages = wm.getMessages();
      expect(messages).toHaveLength(2);
      expect(messages[0]!.content).toBe('Hello');
      expect(messages[1]!.content).toBe('Hi there');
    });

    it('returns a copy of messages (not a reference)', () => {
      wm.addMessage({ role: 'user', content: 'Hello' });
      const messages = wm.getMessages();
      messages.push({ role: 'user', content: 'Injected' });

      expect(wm.getMessages()).toHaveLength(1);
    });
  });

  describe('sliding window', () => {
    it('evicts oldest messages when exceeding maxMessages', () => {
      for (let i = 0; i < 7; i++) {
        wm.addMessage({ role: 'user', content: `Message ${i}` });
      }

      const messages = wm.getMessages();
      expect(messages).toHaveLength(5); // maxMessages = 5
      expect(messages[0]!.content).toBe('Message 2'); // oldest 2 were evicted
      expect(messages[4]!.content).toBe('Message 6');
    });
  });

  describe('pinMessage', () => {
    it('pinned message survives eviction', () => {
      wm.addMessage({ role: 'user', content: 'Important' }); // index 0
      wm.pinMessage(0);

      // Add enough messages to trigger eviction
      for (let i = 1; i <= 6; i++) {
        wm.addMessage({ role: 'user', content: `Message ${i}` });
      }

      const messages = wm.getMessages();
      expect(messages).toHaveLength(5); // maxMessages = 5

      // The pinned message should still be present
      const contents = messages.map(m => m.content);
      expect(contents).toContain('Important');
    });

    it('pinning out of bounds does nothing', () => {
      wm.addMessage({ role: 'user', content: 'Hello' });
      wm.pinMessage(10); // out of bounds
      expect(wm.getStats().pinnedCount).toBe(0);
    });
  });

  describe('summarization', () => {
    it('calls Mind and replaces old messages with summary', async () => {
      const mind = new MockMind();
      mind.enqueue(makeThinkOutput({
        content: 'Summary: user greeted and assistant responded.',
      }));

      // Add more messages than summarizeAfter (3)
      for (let i = 0; i < 5; i++) {
        wm.addMessage({ role: 'user', content: `Message ${i}` });
      }

      expect(wm.shouldSummarize()).toBe(true);

      await wm.summarize(mind);

      const messages = wm.getMessages();
      // Should have fewer messages now (5 - 2 summarized + 1 summary = 4)
      expect(messages.length).toBeLessThan(5);

      // Check that summary message was inserted
      const summaryMsg = messages.find(m =>
        typeof m.content === 'string' && m.content.includes('[Summary of earlier conversation]'),
      );
      expect(summaryMsg).toBeDefined();
      expect(summaryMsg!.role).toBe('system');

      // Mind should have been called once for summarization
      expect(mind.calls).toHaveLength(1);
    });

    it('does not summarize when below threshold', async () => {
      const mind = new MockMind();

      wm.addMessage({ role: 'user', content: 'Hello' });
      wm.addMessage({ role: 'assistant', content: 'Hi' });

      expect(wm.shouldSummarize()).toBe(false);
      await wm.summarize(mind);

      // Mind should NOT have been called
      expect(mind.calls).toHaveLength(0);
    });

    it('does not summarize pinned messages', async () => {
      const mind = new MockMind();
      mind.enqueue(makeThinkOutput({ content: 'Summary' }));

      // Add messages, pin the first one
      wm.addMessage({ role: 'user', content: 'Pinned message' }); // index 0
      wm.pinMessage(0);

      for (let i = 1; i <= 4; i++) {
        wm.addMessage({ role: 'user', content: `Message ${i}` });
      }

      await wm.summarize(mind);

      const messages = wm.getMessages();
      // The pinned message should still be present
      const contents = messages.map(m => typeof m.content === 'string' ? m.content : '');
      expect(contents).toContain('Pinned message');
    });

    it('sets summarized flag', async () => {
      const mind = new MockMind();
      mind.enqueue(makeThinkOutput({ content: 'Summary' }));

      for (let i = 0; i < 5; i++) {
        wm.addMessage({ role: 'user', content: `Message ${i}` });
      }

      expect(wm.getStats().summarized).toBe(false);
      await wm.summarize(mind);
      expect(wm.getStats().summarized).toBe(true);
    });
  });

  describe('tool result compression', () => {
    it('truncates tool results longer than 2000 chars', () => {
      const longContent = 'x'.repeat(3000);
      const message: Message = {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tc-1',
            content: longContent,
          },
        ],
      };

      wm.addMessage(message);

      const messages = wm.getMessages();
      const block = (messages[0]!.content as Array<{ type: string; content?: string }>)[0]!;
      expect(block.content!.length).toBeLessThan(3000);
      expect(block.content).toContain('[truncated]');
      // Should be 2000 chars + '\n[truncated]'
      expect(block.content!.length).toBe(2000 + '\n[truncated]'.length);
    });

    it('does not truncate short tool results', () => {
      const message: Message = {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tc-1',
            content: 'Short result',
          },
        ],
      };

      wm.addMessage(message);

      const messages = wm.getMessages();
      const block = (messages[0]!.content as Array<{ type: string; content?: string }>)[0]!;
      expect(block.content).toBe('Short result');
    });

    it('does not affect text messages', () => {
      wm.addMessage({ role: 'user', content: 'x'.repeat(5000) });

      const messages = wm.getMessages();
      expect((messages[0]!.content as string).length).toBe(5000);
    });
  });

  describe('getStats', () => {
    it('reports correct stats', () => {
      expect(wm.getStats()).toEqual({
        totalMessages: 0,
        pinnedCount: 0,
        summarized: false,
      });

      wm.addMessage({ role: 'user', content: 'Hello' });
      wm.addMessage({ role: 'assistant', content: 'Hi' });
      wm.pinMessage(0);

      expect(wm.getStats()).toEqual({
        totalMessages: 2,
        pinnedCount: 1,
        summarized: false,
      });
    });
  });
});
