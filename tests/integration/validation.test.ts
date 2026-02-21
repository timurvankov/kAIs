import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '@kais/api';
import type { DbClient, NatsClient } from '@kais/api';
import {
  createDbClient,
  createNatsClient,
  closeAll,
  type TestDbClient,
  type TestNatsClient,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Test suite: Input validation and edge cases
// ---------------------------------------------------------------------------

describe('Input validation (integration)', () => {
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

  // -----------------------------------------------------------------------
  // Health check
  // -----------------------------------------------------------------------

  it('GET /healthz returns ok', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/healthz',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  // -----------------------------------------------------------------------
  // Cell name validation
  // -----------------------------------------------------------------------

  it('rejects cell names with special characters', async () => {
    const badNames = ['cell/inject', 'cell.dot', 'UPPERCASE', 'cell name', 'cell_underscore'];

    for (const name of badNames) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cells/${encodeURIComponent(name)}/exec`,
        payload: { message: 'test' },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('accepts valid RFC 1123 cell names', async () => {
    const goodNames = ['my-cell', 'cell1', 'a', 'cell-with-numbers-123'];

    for (const name of goodNames) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/cells/${name}/exec`,
        payload: { message: 'test' },
      });
      // Should succeed (200) — not rejected (400)
      expect(res.statusCode).toBe(200);
    }
  });

  // -----------------------------------------------------------------------
  // Namespace validation
  // -----------------------------------------------------------------------

  it('rejects invalid namespace on exec', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/valid-cell/exec',
      payload: { message: 'test', namespace: 'INVALID!' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/namespace/i);
  });

  it('rejects invalid namespace on logs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/valid-cell/logs?namespace=INVALID!',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid namespace on usage', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/valid-cell/usage?namespace=BAD NS',
    });
    expect(res.statusCode).toBe(400);
  });

  // -----------------------------------------------------------------------
  // Exec body validation
  // -----------------------------------------------------------------------

  it('rejects exec with no body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/valid-cell/exec',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects exec with non-string message', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/valid-cell/exec',
      payload: { message: 123 },
    });
    expect(res.statusCode).toBe(400);
  });

  // -----------------------------------------------------------------------
  // Exec with custom namespace
  // -----------------------------------------------------------------------

  it('exec uses custom namespace in NATS subject', async () => {
    const cellName = 'ns-test-cell';
    const namespace = 'custom-ns';

    // We need a separate NATS client to subscribe before publishing
    const sub = nats.subscribe(`cell.${namespace}.${cellName}.inbox`);
    const collected: Uint8Array[] = [];
    const done = new Promise<void>((resolve) => {
      void (async () => {
        for await (const msg of sub) {
          collected.push(msg.data);
          sub.unsubscribe();
          resolve();
          return;
        }
      })();
    });
    const timeout = setTimeout(() => sub.unsubscribe(), 5_000);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/cells/${cellName}/exec`,
      payload: { message: 'hello', namespace },
    });

    expect(res.statusCode).toBe(200);

    await done;
    clearTimeout(timeout);

    expect(collected).toHaveLength(1);
    const envelope = JSON.parse(new TextDecoder().decode(collected[0]));
    expect(envelope.to).toBe(`cell.${namespace}.${cellName}`);
  });

  // -----------------------------------------------------------------------
  // Invalid cell name on logs/usage
  // -----------------------------------------------------------------------

  it('rejects invalid cell name on logs endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/BAD_NAME/logs',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid cell name on usage endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/BAD_NAME/usage',
    });
    expect(res.statusCode).toBe(400);
  });
});
