import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '@kais/api';
import type { DbClient, NatsClient } from '@kais/api';
import { EventConsumer } from '@kais/api';
import {
  createDbClient,
  createNatsClient,
  resetDb,
  closeAll,
  collectMessages,
  pollUntil,
  type TestDbClient,
  type TestNatsClient,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Test suite: Multi-cell event pipeline
// ---------------------------------------------------------------------------

describe('Multi-cell event pipeline (integration)', () => {
  let db: TestDbClient;
  let nats: TestNatsClient;
  let app: FastifyInstance;
  let consumer: EventConsumer;

  beforeAll(async () => {
    db = createDbClient();
    nats = await createNatsClient();
    app = await buildServer({ nats: nats as NatsClient, db: db as DbClient, logger: false });
    consumer = new EventConsumer(nats as NatsClient, db as DbClient);
  });

  afterAll(async () => {
    await consumer.stop();
    await app.close();
    await closeAll(db, nats);
  });

  beforeEach(async () => {
    await consumer.stop();
    await resetDb(db);
  });

  // -----------------------------------------------------------------------
  // Multiple cells publish events concurrently
  // -----------------------------------------------------------------------

  it('persists events from multiple cells concurrently', async () => {
    await consumer.start();

    const cells = ['cell-alpha', 'cell-beta', 'cell-gamma'];

    // Publish events from all cells
    for (const cellName of cells) {
      const event = {
        cellName,
        namespace: 'default',
        type: 'message',
        payload: { content: `hello from ${cellName}` },
      };
      await nats.publish(
        `cell.events.default.${cellName}`,
        new TextEncoder().encode(JSON.stringify(event)),
      );
    }

    // Wait for all events to be persisted
    await pollUntil(async () => {
      const result = await db.query('SELECT COUNT(*) as count FROM cell_events');
      return parseInt((result.rows[0] as { count: string }).count, 10) >= 3;
    });

    // Verify each cell has its own event
    for (const cellName of cells) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/cells/${cellName}/logs`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.total).toBe(1);
      expect(body.logs[0].cell_name).toBe(cellName);
    }

    await consumer.stop();
  });

  // -----------------------------------------------------------------------
  // Different event types from same cell
  // -----------------------------------------------------------------------

  it('handles different event types from the same cell', async () => {
    await consumer.start();

    const cellName = 'multi-type-cell';
    const events = [
      { type: 'message', payload: { content: 'user input' } },
      { type: 'response', payload: { content: 'llm output', usage: { cost: 0.01, totalTokens: 100 } } },
      { type: 'tool_call', payload: { tool: 'bash', args: { command: 'ls' } } },
      { type: 'tool_result', payload: { tool: 'bash', output: 'file1.txt\nfile2.txt' } },
      { type: 'error', payload: { message: 'rate limit exceeded' } },
    ];

    for (const eventData of events) {
      const event = { cellName, namespace: 'default', ...eventData };
      await nats.publish(
        `cell.events.default.${cellName}`,
        new TextEncoder().encode(JSON.stringify(event)),
      );
      await new Promise((r) => setTimeout(r, 20));
    }

    await pollUntil(async () => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM cell_events WHERE cell_name = $1',
        [cellName],
      );
      return parseInt((result.rows[0] as { count: string }).count, 10) >= 5;
    });

    // Verify all event types persisted
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs?limit=10`,
    });
    const body = res.json();
    expect(body.total).toBe(5);

    const types = body.logs.map((l: Record<string, unknown>) => l.event_type);
    expect(types).toContain('message');
    expect(types).toContain('response');
    expect(types).toContain('tool_call');
    expect(types).toContain('tool_result');
    expect(types).toContain('error');

    // Verify usage only counts response events
    const usageRes = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/usage`,
    });
    const usage = usageRes.json();
    expect(usage.events).toBe(1);
    expect(usage.totalCost).toBeCloseTo(0.01, 5);
    expect(usage.totalTokens).toBe(100);

    await consumer.stop();
  });

  // -----------------------------------------------------------------------
  // Exec publishes to correct cell inbox
  // -----------------------------------------------------------------------

  it('exec messages are published to the correct per-cell subject', async () => {
    const cells = ['target-a', 'target-b'];

    for (const cellName of cells) {
      const { promise } = collectMessages(nats, `cell.default.${cellName}.inbox`, 1, 5_000);

      await app.inject({
        method: 'POST',
        url: `/api/v1/cells/${cellName}/exec`,
        payload: { message: `msg for ${cellName}` },
      });

      const msgs = await promise;
      expect(msgs).toHaveLength(1);
      const envelope = JSON.parse(new TextDecoder().decode(msgs[0].data));
      expect(envelope.to).toBe(`cell.default.${cellName}`);
      expect(envelope.payload.content).toBe(`msg for ${cellName}`);
    }
  });

  // -----------------------------------------------------------------------
  // EventConsumer stop/restart
  // -----------------------------------------------------------------------

  it('EventConsumer can be stopped and restarted', async () => {
    const cellName = 'restart-cell';

    // Start consumer, publish event, verify persisted
    await consumer.start();
    await nats.publish(
      `cell.events.default.${cellName}`,
      new TextEncoder().encode(JSON.stringify({
        cellName,
        namespace: 'default',
        type: 'message',
        payload: { phase: 'before-restart' },
      })),
    );

    await pollUntil(async () => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM cell_events WHERE cell_name = $1',
        [cellName],
      );
      return parseInt((result.rows[0] as { count: string }).count, 10) >= 1;
    });

    // Stop consumer
    await consumer.stop();

    // Restart consumer
    await consumer.start();

    // Publish another event
    await nats.publish(
      `cell.events.default.${cellName}`,
      new TextEncoder().encode(JSON.stringify({
        cellName,
        namespace: 'default',
        type: 'response',
        payload: { phase: 'after-restart' },
      })),
    );

    await pollUntil(async () => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM cell_events WHERE cell_name = $1',
        [cellName],
      );
      return parseInt((result.rows[0] as { count: string }).count, 10) >= 2;
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs`,
    });
    expect(res.json().total).toBe(2);

    await consumer.stop();
  });

  // -----------------------------------------------------------------------
  // EventConsumer skips malformed events
  // -----------------------------------------------------------------------

  it('EventConsumer skips events with missing cellName', async () => {
    await consumer.start();
    const cellName = 'good-cell';

    // Publish a malformed event (no cellName)
    await nats.publish(
      'cell.events.default.bad',
      new TextEncoder().encode(JSON.stringify({
        type: 'message',
        payload: { content: 'no cell name' },
      })),
    );

    // Publish a good event
    await nats.publish(
      `cell.events.default.${cellName}`,
      new TextEncoder().encode(JSON.stringify({
        cellName,
        namespace: 'default',
        type: 'message',
        payload: { content: 'good event' },
      })),
    );

    await pollUntil(async () => {
      const result = await db.query('SELECT COUNT(*) as count FROM cell_events');
      return parseInt((result.rows[0] as { count: string }).count, 10) >= 1;
    });

    // Only the good event should be persisted
    const result = await db.query('SELECT * FROM cell_events');
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as Record<string, unknown>).cell_name).toBe(cellName);

    await consumer.stop();
  });
});
