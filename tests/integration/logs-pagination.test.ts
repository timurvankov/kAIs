import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '@kais/api';
import type { DbClient, NatsClient } from '@kais/api';
import {
  createDbClient,
  createNatsClient,
  resetDb,
  closeAll,
  type TestDbClient,
  type TestNatsClient,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Test suite: Logs pagination and filtering
// ---------------------------------------------------------------------------

describe('Logs pagination and filtering (integration)', () => {
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
  // Pagination: limit + offset
  // -----------------------------------------------------------------------

  it('returns paginated results with limit and offset', async () => {
    const cellName = 'pagecell1';

    // Insert 10 events
    for (let i = 0; i < 10; i++) {
      await db.query(
        `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES ($1, 'default', 'message', $2)`,
        [cellName, JSON.stringify({ index: i })],
      );
      // Small delay for distinct timestamps
      await new Promise((r) => setTimeout(r, 10));
    }

    // Request page 1 (limit 3, offset 0)
    const res1 = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs?limit=3&offset=0`,
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json();
    expect(body1.total).toBe(10);
    expect(body1.logs).toHaveLength(3);

    // Request page 2 (limit 3, offset 3)
    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs?limit=3&offset=3`,
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.total).toBe(10);
    expect(body2.logs).toHaveLength(3);

    // Pages should not overlap
    const ids1 = new Set(body1.logs.map((l: Record<string, unknown>) => l.id));
    const ids2 = new Set(body2.logs.map((l: Record<string, unknown>) => l.id));
    for (const id of ids1) {
      expect(ids2.has(id)).toBe(false);
    }
  });

  it('returns empty array when offset exceeds total', async () => {
    const cellName = 'pagecell2';
    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES ($1, 'default', 'message', '{}')`,
      [cellName],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs?offset=100`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.logs).toHaveLength(0);
  });

  it('clamps limit to max 1000', async () => {
    const cellName = 'pagecell3';
    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES ($1, 'default', 'message', '{}')`,
      [cellName],
    );

    // Request with absurdly large limit — should not error
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs?limit=99999`,
    });
    expect(res.statusCode).toBe(200);
  });

  // -----------------------------------------------------------------------
  // Namespace isolation
  // -----------------------------------------------------------------------

  it('returns only events for the requested namespace', async () => {
    const cellName = 'nscell1';

    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES
        ($1, 'production', 'message', '{"env": "prod"}'),
        ($1, 'staging',    'message', '{"env": "staging"}'),
        ($1, 'production', 'response', '{"env": "prod2"}')`,
      [cellName],
    );

    // Query production namespace
    const resProd = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs?namespace=production`,
    });
    expect(resProd.statusCode).toBe(200);
    const prodBody = resProd.json();
    expect(prodBody.total).toBe(2);
    expect(prodBody.logs).toHaveLength(2);

    // Query staging namespace
    const resStaging = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/logs?namespace=staging`,
    });
    expect(resStaging.statusCode).toBe(200);
    const stagingBody = resStaging.json();
    expect(stagingBody.total).toBe(1);
    expect(stagingBody.logs).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Cell isolation
  // -----------------------------------------------------------------------

  it('returns only events for the requested cell', async () => {
    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES
        ('cell-a', 'default', 'message', '{"from": "a"}'),
        ('cell-b', 'default', 'message', '{"from": "b"}'),
        ('cell-a', 'default', 'response', '{"from": "a2"}')`,
    );

    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/cell-a/logs',
    });
    expect(resA.statusCode).toBe(200);
    expect(resA.json().total).toBe(2);

    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/cell-b/logs',
    });
    expect(resB.statusCode).toBe(200);
    expect(resB.json().total).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Empty results
  // -----------------------------------------------------------------------

  it('returns empty results for non-existent cell', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/nonexistent/logs',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(0);
    expect(body.logs).toHaveLength(0);
  });

  it('returns zero usage for cell with no response events', async () => {
    const cellName = 'nousage1';

    // Insert non-response events only
    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES
        ($1, 'default', 'message', '{"content": "hello"}'),
        ($1, 'default', 'error', '{"message": "oops"}')`,
      [cellName],
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/usage`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totalCost).toBe(0);
    expect(body.totalTokens).toBe(0);
    expect(body.events).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Usage namespace isolation
  // -----------------------------------------------------------------------

  it('usage aggregation respects namespace', async () => {
    const cellName = 'usagens1';

    await db.query(
      `INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES
        ($1, 'prod',    'response', '{"usage": {"cost": 0.10, "totalTokens": 500}}'),
        ($1, 'staging', 'response', '{"usage": {"cost": 0.01, "totalTokens": 50}}')`,
      [cellName],
    );

    const resProd = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/usage?namespace=prod`,
    });
    expect(resProd.statusCode).toBe(200);
    const prodBody = resProd.json();
    expect(prodBody.totalCost).toBeCloseTo(0.10, 5);
    expect(prodBody.totalTokens).toBe(500);
    expect(prodBody.events).toBe(1);

    const resStaging = await app.inject({
      method: 'GET',
      url: `/api/v1/cells/${cellName}/usage?namespace=staging`,
    });
    expect(resStaging.statusCode).toBe(200);
    const stagingBody = resStaging.json();
    expect(stagingBody.totalCost).toBeCloseTo(0.01, 5);
    expect(stagingBody.events).toBe(1);
  });
});
