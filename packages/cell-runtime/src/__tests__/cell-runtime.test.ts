import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MockMind } from '@kais/mind';
import type { CellSpec } from '@kais/core';

import { CellRuntime, BudgetTracker } from '../cell-runtime.js';
import type { Tool } from '../tools/tool-executor.js';
import { MockNatsConnection, makeThinkOutput, makeEnvelope } from './helpers.js';

function makeSpec(overrides: Partial<CellSpec> = {}): CellSpec {
  return {
    mind: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are a helpful assistant.',
      ...overrides.mind,
    },
    tools: overrides.tools,
    resources: overrides.resources,
  };
}

function makeEchoTool(): Tool {
  return {
    name: 'echo',
    description: 'Echoes input back',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    async execute(input: unknown): Promise<string> {
      return `Echo: ${(input as { text: string }).text}`;
    },
  };
}

describe('CellRuntime', () => {
  let mind: MockMind;
  let nats: MockNatsConnection;

  beforeEach(() => {
    mind = new MockMind();
    nats = new MockNatsConnection();
  });

  describe('processMessage — simple request/response', () => {
    it('processes a message and publishes response to outbox', async () => {
      mind.enqueue(makeThinkOutput({ content: 'Hello from the assistant!' }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      const envelope = makeEnvelope({
        from: 'user',
        to: 'test-cell',
        payload: { content: 'Hi there' },
      });

      await runtime.processMessage(envelope);

      // Mind should have been called once
      expect(mind.calls).toHaveLength(1);

      // System prompt should be first message
      const callMessages = mind.calls[0]!.messages;
      expect(callMessages[0]!.role).toBe('system');
      expect(callMessages[0]!.content).toBe('You are a helpful assistant.');

      // User message should follow
      expect(callMessages[1]!.role).toBe('user');
      expect(callMessages[1]!.content).toBe('Hi there');

      // Should have published to outbox
      const outboxMessages = nats.getPublished('cell.default.test-cell.outbox');
      expect(outboxMessages).toHaveLength(1);

      const responseEnvelope = JSON.parse(outboxMessages[0]!.data);
      expect(responseEnvelope.payload.content).toBe('Hello from the assistant!');
      expect(responseEnvelope.from).toBe('test-cell');
      expect(responseEnvelope.to).toBe('user');
    });
  });

  describe('processMessage — tool use loop', () => {
    it('executes tool calls and loops back to mind', async () => {
      // First response: tool use
      mind.enqueue(makeThinkOutput({
        content: '',
        stopReason: 'tool_use',
        toolCalls: [{ id: 'tc-1', name: 'echo', input: { text: 'ping' } }],
      }));

      // Second response: final answer after tool result
      mind.enqueue(makeThinkOutput({
        content: 'The echo said: Echo: ping',
        stopReason: 'end_turn',
      }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
        tools: [makeEchoTool()],
      });

      const envelope = makeEnvelope({ payload: { content: 'Please echo ping' } });
      await runtime.processMessage(envelope);

      // Mind should have been called twice (tool use + final response)
      expect(mind.calls).toHaveLength(2);

      // Second call should include tool result in messages
      const secondCallMessages = mind.calls[1]!.messages;
      // Find tool_result in the messages
      const toolResultMsg = secondCallMessages.find(m =>
        Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'),
      );
      expect(toolResultMsg).toBeDefined();
      const toolResultBlock = (toolResultMsg!.content as Array<{ type: string; content?: string }>)
        .find(b => b.type === 'tool_result');
      expect(toolResultBlock!.content).toBe('Echo: ping');

      // Should have published final response
      const outboxMessages = nats.getPublished('cell.default.test-cell.outbox');
      expect(outboxMessages).toHaveLength(1);
      const response = JSON.parse(outboxMessages[0]!.data);
      expect(response.payload.content).toBe('The echo said: Echo: ping');
    });

    it('handles multiple tool calls in one response', async () => {
      mind.enqueue(makeThinkOutput({
        content: '',
        stopReason: 'tool_use',
        toolCalls: [
          { id: 'tc-1', name: 'echo', input: { text: 'a' } },
          { id: 'tc-2', name: 'echo', input: { text: 'b' } },
        ],
      }));

      mind.enqueue(makeThinkOutput({
        content: 'Done with both',
        stopReason: 'end_turn',
      }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
        tools: [makeEchoTool()],
      });

      const envelope = makeEnvelope({ payload: { content: 'Echo a and b' } });
      await runtime.processMessage(envelope);

      expect(mind.calls).toHaveLength(2);

      // Second call should have tool results for both
      const secondCallMessages = mind.calls[1]!.messages;
      const toolResultMsg = secondCallMessages.find(m =>
        Array.isArray(m.content) && m.content.some(b => b.type === 'tool_result'),
      );
      const blocks = toolResultMsg!.content as Array<{ type: string; toolUseId?: string; content?: string }>;
      const toolBlocks = blocks.filter(b => b.type === 'tool_result');
      expect(toolBlocks).toHaveLength(2);
      expect(toolBlocks[0]!.content).toBe('Echo: a');
      expect(toolBlocks[1]!.content).toBe('Echo: b');
    });
  });

  describe('budget tracking', () => {
    it('accumulates cost across think calls', async () => {
      mind.enqueue(makeThinkOutput({ usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.005 } }));
      mind.enqueue(makeThinkOutput({ usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.003 } }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      await runtime.processMessage(makeEnvelope({ payload: { content: 'msg 1' } }));
      await runtime.processMessage(makeEnvelope({ payload: { content: 'msg 2' } }));

      expect(runtime.getBudget().getTotalCost()).toBeCloseTo(0.008, 5);
    });

    it('pauses when maxTotalCost is exceeded', async () => {
      // First call costs 0.05, which exceeds the max of 0.04
      mind.enqueue(makeThinkOutput({
        content: 'Response 1',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.05 },
      }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec({ resources: { maxTotalCost: 0.04 } }),
        mind,
        nats,
      });

      // First message processes fine (budget checked before think, cost added after)
      await runtime.processMessage(makeEnvelope({ payload: { content: 'msg 1' } }));

      // Budget should be exceeded now (0.05 > 0.04), but pause happens on next message
      expect(runtime.getBudget().isExceeded()).toBe(true);

      // Second message should trigger the budget check and pause
      nats.published = []; // reset published
      await runtime.processMessage(makeEnvelope({ payload: { content: 'msg 2' } }));

      // Runtime should now be paused
      expect(runtime.isPaused()).toBe(true);

      // Mind should have been called only once (the first message)
      expect(mind.calls).toHaveLength(1);

      // Should publish a budget exceeded message to outbox
      const outbox = nats.getPublished('cell.default.test-cell.outbox');
      expect(outbox).toHaveLength(1);
      const response = JSON.parse(outbox[0]!.data);
      expect(response.payload.content).toContain('Budget exceeded');

      // Third message should also be rejected (paused)
      nats.published = [];
      await runtime.processMessage(makeEnvelope({ payload: { content: 'msg 3' } }));
      const outbox2 = nats.getPublished('cell.default.test-cell.outbox');
      expect(outbox2).toHaveLength(1);
      const response2 = JSON.parse(outbox2[0]!.data);
      expect(response2.payload.content).toContain('paused');
    });
  });

  describe('working memory integration', () => {
    it('messages accumulate across calls', async () => {
      mind.enqueue(makeThinkOutput({ content: 'Response 1' }));
      mind.enqueue(makeThinkOutput({ content: 'Response 2' }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      await runtime.processMessage(makeEnvelope({ payload: { content: 'msg 1' } }));
      await runtime.processMessage(makeEnvelope({ payload: { content: 'msg 2' } }));

      // Second call should include messages from first conversation
      const secondCall = mind.calls[1]!;
      // system + user(msg1) + assistant(Response 1) + user(msg2) = 4 messages
      expect(secondCall.messages).toHaveLength(4);
      expect(secondCall.messages[0]!.role).toBe('system');
      expect(secondCall.messages[1]!.content).toBe('msg 1');
      expect(secondCall.messages[2]!.content).toBe('Response 1');
      expect(secondCall.messages[3]!.role).toBe('user');
      expect(secondCall.messages[3]!.content).toBe('msg 2');
    });
  });

  describe('start and stop', () => {
    it('subscribes to inbox on start', async () => {
      mind.enqueue(makeThinkOutput({ content: 'OK' }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      await runtime.start();

      // Inject a message into the inbox
      const envelope = makeEnvelope({ payload: { content: 'Test via NATS' } });
      nats.inject('cell.default.test-cell.inbox', envelope);

      // Give async processing a tick
      await new Promise(r => setTimeout(r, 10));

      // Mind should have been called
      expect(mind.calls).toHaveLength(1);

      await runtime.stop();
    });

    it('publishes events on start and stop', async () => {
      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      await runtime.start();
      await runtime.stop();

      const events = nats.getPublished('cell.events.default.test-cell');
      expect(events.length).toBeGreaterThanOrEqual(2);

      const eventTypes = events.map(e => JSON.parse(e.data).type);
      expect(eventTypes).toContain('started');
      expect(eventTypes).toContain('stopped');
    });
  });

  describe('processMessage — events', () => {
    it('publishes response event with usage info', async () => {
      mind.enqueue(makeThinkOutput({
        content: 'Hello',
        model: 'test-model',
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.001 },
      }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      await runtime.processMessage(makeEnvelope({ payload: { content: 'Hi' } }));

      const events = nats.getPublished('cell.events.default.test-cell');
      const responseEvent = events.map(e => JSON.parse(e.data)).find(e => e.type === 'response');
      expect(responseEvent).toBeDefined();
      expect(responseEvent.model).toBe('test-model');
      expect(responseEvent.usage.inputTokens).toBe(100);
      expect(responseEvent.iterations).toBe(1);
    });
  });

  describe('processMessage — envelope payload formats', () => {
    it('handles string payload', async () => {
      mind.enqueue(makeThinkOutput({ content: 'OK' }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      await runtime.processMessage(makeEnvelope({ payload: 'Plain string message' }));

      const callMessages = mind.calls[0]!.messages;
      expect(callMessages[1]!.content).toBe('Plain string message');
    });

    it('handles payload without content field', async () => {
      mind.enqueue(makeThinkOutput({ content: 'OK' }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      await runtime.processMessage(makeEnvelope({ payload: { data: 123, flag: true } }));

      const callMessages = mind.calls[0]!.messages;
      // Should JSON.stringify the payload
      expect(callMessages[1]!.content).toBe('{"data":123,"flag":true}');
    });
  });

  describe('serial message processing (C1)', () => {
    it('processes messages sequentially when injected rapidly', async () => {
      const processingOrder: string[] = [];

      // Create a slow echo tool that records execution order
      const slowTool: Tool = {
        name: 'slow_echo',
        description: 'Slow echo',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        async execute(input: unknown): Promise<string> {
          const text = (input as { text: string }).text;
          processingOrder.push(`start:${text}`);
          await new Promise(r => setTimeout(r, 20));
          processingOrder.push(`end:${text}`);
          return `Echo: ${text}`;
        },
      };

      // First message: tool use -> final response
      mind.enqueue(makeThinkOutput({
        content: '',
        stopReason: 'tool_use',
        toolCalls: [{ id: 'tc-1', name: 'slow_echo', input: { text: 'first' } }],
      }));
      mind.enqueue(makeThinkOutput({ content: 'Response 1', stopReason: 'end_turn' }));

      // Second message: tool use -> final response
      mind.enqueue(makeThinkOutput({
        content: '',
        stopReason: 'tool_use',
        toolCalls: [{ id: 'tc-2', name: 'slow_echo', input: { text: 'second' } }],
      }));
      mind.enqueue(makeThinkOutput({ content: 'Response 2', stopReason: 'end_turn' }));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
        tools: [slowTool],
      });

      await runtime.start();

      // Inject two messages rapidly (no await between)
      const envelope1 = makeEnvelope({ payload: { content: 'msg 1' } });
      const envelope2 = makeEnvelope({ payload: { content: 'msg 2' } });
      nats.inject('cell.default.test-cell.inbox', envelope1);
      nats.inject('cell.default.test-cell.inbox', envelope2);

      // Wait for both to finish processing
      await new Promise(r => setTimeout(r, 200));

      // Verify sequential processing: first must complete before second starts
      expect(processingOrder).toEqual([
        'start:first',
        'end:first',
        'start:second',
        'end:second',
      ]);

      await runtime.stop();
    });
  });

  describe('processMessage — mind.think() error handling (I1)', () => {
    it('catches mind.think() error and publishes error response', async () => {
      mind.setError(new Error('Network timeout'));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      const envelope = makeEnvelope({ payload: { content: 'Hello' } });
      await runtime.processMessage(envelope);

      // Should NOT throw — the error is caught

      // Should publish an error response to outbox
      const outboxMessages = nats.getPublished('cell.default.test-cell.outbox');
      expect(outboxMessages).toHaveLength(1);
      const response = JSON.parse(outboxMessages[0]!.data);
      expect(response.payload.content).toContain('Error: Network timeout');

      // Should publish an error event
      const events = nats.getPublished('cell.events.default.test-cell');
      const errorEvent = events.map(e => JSON.parse(e.data)).find(e => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.messageId).toBe(envelope.id);
      expect(errorEvent.error).toContain('Network timeout');
    });

    it('does not break the queue after mind.think() error', async () => {
      // First call: error
      mind.setError(new Error('Auth error'));

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
      });

      const envelope1 = makeEnvelope({ payload: { content: 'msg 1' } });
      await runtime.processMessage(envelope1);

      // Clear error and enqueue a successful response for the next message
      mind.clearError();
      mind.enqueue(makeThinkOutput({ content: 'Success!' }));

      const envelope2 = makeEnvelope({ payload: { content: 'msg 2' } });
      await runtime.processMessage(envelope2);

      // Second call should succeed
      const outboxMessages = nats.getPublished('cell.default.test-cell.outbox');
      expect(outboxMessages).toHaveLength(2);
      const response2 = JSON.parse(outboxMessages[1]!.data);
      expect(response2.payload.content).toBe('Success!');
    });
  });

  describe('max iterations (I6)', () => {
    it('publishes response and event when max iterations reached', async () => {
      // Enqueue 21 tool-use responses (more than the 20-iteration limit)
      for (let i = 0; i < 21; i++) {
        mind.enqueue(makeThinkOutput({
          content: '',
          stopReason: 'tool_use',
          toolCalls: [{ id: `tc-${i}`, name: 'echo', input: { text: `iter-${i}` } }],
        }));
      }

      const runtime = new CellRuntime({
        cellName: 'test-cell',
        namespace: 'default',
        spec: makeSpec(),
        mind,
        nats,
        tools: [makeEchoTool()],
        workingMemoryConfig: { maxMessages: 200, summarizeAfter: 200 },
      });

      const envelope = makeEnvelope({ payload: { content: 'Loop forever' } });
      await runtime.processMessage(envelope);

      // Mind should have been called exactly 20 times (the max)
      expect(mind.calls).toHaveLength(20);

      // Should have published a max-iterations response to outbox
      const outboxMessages = nats.getPublished('cell.default.test-cell.outbox');
      expect(outboxMessages).toHaveLength(1);
      const response = JSON.parse(outboxMessages[0]!.data);
      expect(response.payload.content).toContain('Maximum tool call iterations reached');

      // Should have published a max_iterations event
      const events = nats.getPublished('cell.events.default.test-cell');
      const maxIterEvent = events.map(e => JSON.parse(e.data)).find(e => e.type === 'max_iterations');
      expect(maxIterEvent).toBeDefined();
      expect(maxIterEvent.iterations).toBe(20);
    });
  });

  describe('BudgetTracker pruning (I5)', () => {
    it('prunes cost entries older than 1 hour', () => {
      const tracker = new BudgetTracker(1.0, undefined); // $1/hour max

      // Manually manipulate Date.now to simulate old entries
      const now = Date.now();
      const realDateNow = Date.now;

      // Add a cost entry "2 hours ago"
      vi.spyOn(Date, 'now').mockReturnValue(now - 7_200_000);
      tracker.addCost(0.5);

      // Add a cost entry "now"
      vi.spyOn(Date, 'now').mockReturnValue(now);
      tracker.addCost(0.3);

      // isExceeded should only consider the recent entry (0.3 < 1.0)
      expect(tracker.isExceeded()).toBe(false);

      // The old entry should have been pruned
      // Add more cost to push over the hourly limit
      tracker.addCost(0.8);
      // Now recent cost = 0.3 + 0.8 = 1.1 > 1.0
      expect(tracker.isExceeded()).toBe(true);

      vi.restoreAllMocks();
    });
  });
});
