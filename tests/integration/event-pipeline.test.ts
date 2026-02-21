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
  pollUntil,
  type TestDbClient,
  type TestNatsClient,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Test suite: Event Pipeline (integration)
// ---------------------------------------------------------------------------

describe('Event Pipeline (integration)', () => {
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
  // Full pipeline: NATS event -> EventConsumer -> Postgres -> API logs
  // -----------------------------------------------------------------------

  it('NATS event flows through EventConsumer to Postgres and appears in API logs', async () => {
    const cellName = 'pipeline1';

    await consumer.start();

    // Publish an event to the cell.events subject (what EventConsumer listens to)
    const event = {
      cellName,
      namespace: 'default',
      type: 'message',
      payload: { content: 'pipeline test message' },
    };
    const encoded = new TextEncoder().encode(JSON.stringify(event));
    await nats.publish(`cell.events.default.${cellName}`, encoded);

    // Poll until the event appears in Postgres
    await pollUntil(async () => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM cell_events WHERE cell_name = $1 AND namespace = $2',
        [cellName, 'default'],
      );
      const row = result.rows[0] as { count: string };
      return parseInt(row.count, 10) >= 1;
    });

    // Verify via the API
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.logs).toHaveLength(1);

    const log = body.logs[0] as Record<string, unknown>;
    expect(log.cell_name).toBe(cellName);
    expect(log.namespace).toBe('default');
    expect(log.event_type).toBe('message');

    const payload = log.payload as Record<string, unknown>;
    expect(payload.content).toBe('pipeline test message');

    await consumer.stop();
  });

  // -----------------------------------------------------------------------
  // Multiple events are ordered by created_at
  // -----------------------------------------------------------------------

  it('multiple events are persisted and returned ordered by created_at', async () => {
    const cellName = 'pipeline2';

    await consumer.start();

    // Publish 3 events with different types, in sequence with small delays
    const types = ['request', 'response', 'error'];
    for (const eventType of types) {
      const event = {
        cellName,
        namespace: 'default',
        type: eventType,
        payload: { content: `event-${eventType}` },
      };
      const encoded = new TextEncoder().encode(JSON.stringify(event));
      await nats.publish(`cell.events.default.${cellName}`, encoded);
      // Small delay to ensure distinct created_at timestamps
      await new Promise((r) => setTimeout(r, 50));
    }

    // Poll until all 3 events appear in Postgres
    await pollUntil(async () => {
      const result = await db.query(
        'SELECT COUNT(*) as count FROM cell_events WHERE cell_name = $1 AND namespace = $2',
        [cellName, 'default'],
      );
      const row = result.rows[0] as { count: string };
      return parseInt(row.count, 10) >= 3;
    });

    // Verify via the API
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.logs).toHaveLength(3);

    // API returns logs ORDER BY created_at DESC, so newest first
    const eventTypes = body.logs.map((log: Record<string, unknown>) => log.event_type);
    expect(eventTypes).toEqual(['error', 'response', 'request']);

    await consumer.stop();
  });
});
