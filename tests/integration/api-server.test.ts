import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '@kais/api';
import type { DbClient, NatsClient } from '@kais/api';
import {
  createDbClient,
  createNatsClient,
  resetDb,
  closeAll,
  collectMessages,
  type TestDbClient,
  type TestNatsClient,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Test suite: API Server (integration)
// ---------------------------------------------------------------------------

describe('API Server (integration)', () => {
  let db: TestDbClient;
  let nats: TestNatsClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = createDbClient();
    nats = await createNatsClient();
    app = await buildServer({ nats: nats as NatsClient, db: db as DbClient, logger: false });
  });

  afterAll(async () => {
    await app.close();
    await closeAll(db, nats);
  });

  beforeEach(async () => {
    await resetDb(db);
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/cells/:name/exec — publishes to NATS
  // -----------------------------------------------------------------------

  it('POST /api/v1/cells/:name/exec publishes envelope to NATS inbox', async () => {
    const cellName = 'postcell1';
    const subject = `cell.default.${cellName}.inbox`;

    // Subscribe BEFORE the request so we don't miss the message
    const { promise } = collectMessages(nats, subject, 1, 5_000);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/cells/${cellName}/exec`,
      payload: { message: 'hello integration' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.messageId).toBeDefined();

    // Verify the message was received on NATS
    const messages = await promise;
    expect(messages).toHaveLength(1);

    const envelope = JSON.parse(new TextDecoder().decode(messages[0].data));
    expect(envelope.type).toBe('message');
    expect(envelope.payload.content).toBe('hello integration');
    expect(envelope.to).toBe(`cell.default.${cellName}`);
    expect(envelope.from).toBe('api');
    expect(envelope.id).toBe(body.messageId);
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/cells/:name/logs — reads from Postgres
  // -----------------------------------------------------------------------

  it('GET /api/v1/cells/:name/logs returns events from Postgres', async () => {
    const cellName = 'logcell1';

    // Insert test rows directly into the database
    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES
        ($1, 'default', 'message',  '{"content": "first"}'),
        ($1, 'default', 'response', '{"content": "second"}'),
        ($1, 'default', 'error',    '{"content": "third"}')`,
      [cellName],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.logs).toHaveLength(3);

    // Logs are ordered by created_at DESC
    const eventTypes = body.logs.map((log: Record<string, unknown>) => log.event_type);
    expect(eventTypes).toContain('message');
    expect(eventTypes).toContain('response');
    expect(eventTypes).toContain('error');
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/cells/:name/usage — aggregates from Postgres
  // -----------------------------------------------------------------------

  it('GET /api/v1/cells/:name/usage aggregates usage data', async () => {
    const cellName = 'usagecell1';

    // Insert response events with usage payloads
    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES
        ($1, 'default', 'response', '{"usage": {"cost": 0.005, "totalTokens": 100}}'),
        ($1, 'default', 'response', '{"usage": {"cost": 0.010, "totalTokens": 250}}'),
        ($1, 'default', 'response', '{"usage": {"cost": 0.003, "totalTokens": 50}}')`,
      [cellName],
    );

    // Also insert a non-response event that should NOT be counted
    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES
        ($1, 'default', 'message', '{"content": "not a response"}')`,
      [cellName],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/usage`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.events).toBe(3);
    expect(body.totalCost).toBeCloseTo(0.018, 5);
    expect(body.totalTokens).toBe(400);
  });

  // -----------------------------------------------------------------------
  // POST with invalid cell name — returns 400
  // -----------------------------------------------------------------------

  it('POST /api/v1/cells/:name/exec returns 400 for invalid cell name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/INVALID_NAME!/exec',
      payload: { message: 'test' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/[Ii]nvalid cell name/);
  });

  // -----------------------------------------------------------------------
  // POST with empty message — returns 400
  // -----------------------------------------------------------------------

  it('POST /api/v1/cells/:name/exec returns 400 for empty message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/validcell/exec',
      payload: { message: '' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toMatch(/[Mm]issing|[Ee]mpty/);
  });
});
