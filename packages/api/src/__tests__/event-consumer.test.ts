import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventConsumer } from '../event-consumer.js';
import type { DbClient, DbQueryResult, NatsClient, NatsSubscription } from '../clients.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockNatsMessage {
  data: Uint8Array;
}

/**
 * Creates a mock NATS client where subscribe returns an async iterable
 * that can be fed messages externally.
 */
function createMockNats(): NatsClient & {
  published: Array<{ subject: string; data: Uint8Array }>;
  subscriptions: Array<{ subject: string; push: (msg: MockNatsMessage) => void; end: () => void }>;
} {
  const published: Array<{ subject: string; data: Uint8Array }> = [];
  const subscriptions: Array<{ subject: string; push: (msg: MockNatsMessage) => void; end: () => void }> = [];

  return {
    published,
    subscriptions,
    async publish(subject, data) {
      published.push({ subject, data });
    },
    subscribe(subject) {
      const queue: MockNatsMessage[] = [];
      let resolve: ((value: IteratorResult<MockNatsMessage>) => void) | null = null;
      let done = false;

      const push = (msg: MockNatsMessage) => {
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: msg, done: false });
        } else {
          queue.push(msg);
        }
      };

      const end = () => {
        done = true;
        if (resolve) {
          const r = resolve;
          resolve = null;
          r({ value: undefined as unknown as MockNatsMessage, done: true });
        }
      };

      subscriptions.push({ subject, push, end });

      const sub: NatsSubscription = {
        async *[Symbol.asyncIterator]() {
          while (true) {
            if (queue.length > 0) {
              yield queue.shift()!;
            } else if (done) {
              return;
            } else {
              const msg = await new Promise<IteratorResult<MockNatsMessage>>((r) => {
                resolve = r;
              });
              if (msg.done) return;
              yield msg.value;
            }
          }
        },
        unsubscribe: vi.fn(() => {
          end();
        }),
      };

      return sub;
    },
  };
}

function createMockDb(): DbClient & {
  queries: Array<{ text: string; params?: unknown[] }>;
} {
  const queries: Array<{ text: string; params?: unknown[] }> = [];

  return {
    queries,
    async query(text, params): Promise<DbQueryResult> {
      queries.push({ text, params });
      return { rows: [] };
    },
  };
}

function encodeEvent(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EventConsumer', () => {
  let nats: ReturnType<typeof createMockNats>;
  let db: ReturnType<typeof createMockDb>;
  let consumer: EventConsumer;

  beforeEach(() => {
    nats = createMockNats();
    db = createMockDb();
    consumer = new EventConsumer(nats, db);
  });

  afterEach(async () => {
    await consumer.stop();
  });

  it('subscribes to cell.events.> on start', async () => {
    await consumer.start();

    expect(nats.subscriptions).toHaveLength(1);
    expect(nats.subscriptions[0]!.subject).toBe('cell.events.>');
  });

  it('inserts events into cell_events table', async () => {
    await consumer.start();

    const event = {
      type: 'response',
      cellName: 'researcher',
      namespace: 'default',
      timestamp: '2025-01-15T10:30:00Z',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.001 },
    };

    nats.subscriptions[0]!.push({ data: encodeEvent(event) });

    // Give async processing a tick
    await new Promise(r => setTimeout(r, 10));

    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]!.text).toContain('INSERT INTO cell_events');
    expect(db.queries[0]!.params).toEqual([
      'researcher',
      'default',
      'response',
      JSON.stringify(event),
    ]);
  });

  it('processes multiple events', async () => {
    await consumer.start();

    const events = [
      { type: 'started', cellName: 'researcher', namespace: 'default', timestamp: '2025-01-15T10:00:00Z' },
      { type: 'response', cellName: 'researcher', namespace: 'default', timestamp: '2025-01-15T10:01:00Z', usage: { cost: 0.01 } },
      { type: 'stopped', cellName: 'researcher', namespace: 'default', timestamp: '2025-01-15T10:02:00Z' },
    ];

    for (const event of events) {
      nats.subscriptions[0]!.push({ data: encodeEvent(event) });
    }

    await new Promise(r => setTimeout(r, 50));

    expect(db.queries).toHaveLength(3);
    expect(db.queries[0]!.params![2]).toBe('started');
    expect(db.queries[1]!.params![2]).toBe('response');
    expect(db.queries[2]!.params![2]).toBe('stopped');
  });

  it('defaults namespace to "default" when missing', async () => {
    await consumer.start();

    const event = {
      type: 'started',
      cellName: 'researcher',
      // no namespace
    };

    nats.subscriptions[0]!.push({ data: encodeEvent(event) });
    await new Promise(r => setTimeout(r, 10));

    expect(db.queries).toHaveLength(1);
    expect(db.queries[0]!.params![1]).toBe('default');
  });

  it('skips events with missing cellName', async () => {
    await consumer.start();

    const event = {
      type: 'response',
      // no cellName
      namespace: 'default',
    };

    nats.subscriptions[0]!.push({ data: encodeEvent(event) });
    await new Promise(r => setTimeout(r, 10));

    // Should not insert
    expect(db.queries).toHaveLength(0);
  });

  it('skips events with missing type', async () => {
    await consumer.start();

    const event = {
      cellName: 'researcher',
      namespace: 'default',
      // no type
    };

    nats.subscriptions[0]!.push({ data: encodeEvent(event) });
    await new Promise(r => setTimeout(r, 10));

    expect(db.queries).toHaveLength(0);
  });

  it('handles invalid JSON gracefully', async () => {
    await consumer.start();

    nats.subscriptions[0]!.push({ data: new TextEncoder().encode('not json {{{') });
    await new Promise(r => setTimeout(r, 10));

    // Should not crash, should not insert
    expect(db.queries).toHaveLength(0);
  });

  it('handles DB errors gracefully without crashing', async () => {
    const errorDb: DbClient & { queries: Array<{ text: string; params?: unknown[] }> } = {
      queries: [],
      async query(text, params) {
        this.queries.push({ text, params });
        throw new Error('DB connection error');
      },
    };

    const errorConsumer = new EventConsumer(nats, errorDb);
    await errorConsumer.start();

    const event = {
      type: 'response',
      cellName: 'researcher',
      namespace: 'default',
    };

    nats.subscriptions[0]!.push({ data: encodeEvent(event) });
    await new Promise(r => setTimeout(r, 10));

    // Should have attempted the query
    expect(errorDb.queries).toHaveLength(1);

    // Should still be running (not crashed)
    // Push another event to verify
    nats.subscriptions[0]!.push({ data: encodeEvent({ ...event, type: 'started' }) });
    await new Promise(r => setTimeout(r, 10));

    expect(errorDb.queries).toHaveLength(2);

    await errorConsumer.stop();
  });

  it('stops cleanly', async () => {
    await consumer.start();
    await consumer.stop();

    // Subscription should have been unsubscribed
    // No crash, clean shutdown
    expect(nats.subscriptions).toHaveLength(1);
  });
});
