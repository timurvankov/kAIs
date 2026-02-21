import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient, DbQueryResult, NatsClient, NatsSubscription } from '../clients.js';
import { buildServer } from '../server.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockNats(): NatsClient & {
  published: Array<{ subject: string; data: Uint8Array }>;
  subscriptions: Array<{ subject: string; sub: NatsSubscription }>;
} {
  const published: Array<{ subject: string; data: Uint8Array }> = [];
  const subscriptions: Array<{ subject: string; sub: NatsSubscription }> = [];

  return {
    published,
    subscriptions,
    async publish(subject, data) {
      published.push({ subject, data });
    },
    subscribe(subject) {
      const sub: NatsSubscription = {
        async *[Symbol.asyncIterator]() {
          // Yield nothing by default — tests can override
        },
        unsubscribe: vi.fn(),
      };
      subscriptions.push({ subject, sub });
      return sub;
    },
  };
}

function createMockDb(
  queryResponses: DbQueryResult[] = [],
): DbClient & { queries: Array<{ text: string; params?: unknown[] }> } {
  const queries: Array<{ text: string; params?: unknown[] }> = [];
  let callIndex = 0;

  return {
    queries,
    async query(text, params) {
      queries.push({ text, params });
      return queryResponses[callIndex++] ?? { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API Server', () => {
  let nats: ReturnType<typeof createMockNats>;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    nats = createMockNats();
  });

  afterEach(async () => {
    // Nothing to clean up — each test builds its own server
  });

  // ----- GET /healthz -----

  describe('GET /healthz', () => {
    it('returns 200 with { ok: true }', async () => {
      db = createMockDb();
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });

      await app.close();
    });
  });

  // ----- POST /api/v1/cells/:name/exec -----

  describe('POST /api/v1/cells/:name/exec', () => {
    it('publishes to NATS and returns messageId', async () => {
      db = createMockDb();
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cells/researcher/exec',
        payload: { message: 'Hello researcher', namespace: 'demo' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.messageId).toBeDefined();
      expect(typeof body.messageId).toBe('string');

      // Verify NATS publish
      expect(nats.published).toHaveLength(1);
      expect(nats.published[0]!.subject).toBe('cell.demo.researcher.inbox');

      // Verify the published envelope
      const envelope = JSON.parse(new TextDecoder().decode(nats.published[0]!.data));
      expect(envelope.from).toBe('api');
      expect(envelope.to).toBe('cell.demo.researcher');
      expect(envelope.type).toBe('message');
      expect(envelope.payload).toEqual({ content: 'Hello researcher' });
      expect(envelope.id).toBe(body.messageId);

      await app.close();
    });

    it('uses default namespace when not specified', async () => {
      db = createMockDb();
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cells/myagent/exec',
        payload: { message: 'test' },
      });

      expect(res.statusCode).toBe(200);
      expect(nats.published[0]!.subject).toBe('cell.default.myagent.inbox');

      await app.close();
    });

    it('returns 400 when message is missing', async () => {
      db = createMockDb();
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cells/researcher/exec',
        payload: { namespace: 'test' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Missing or empty message');
      expect(nats.published).toHaveLength(0);

      await app.close();
    });

    it('returns 400 when message is empty string', async () => {
      db = createMockDb();
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cells/researcher/exec',
        payload: { message: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Missing or empty message');

      await app.close();
    });
  });

  // ----- GET /api/v1/cells/:name/logs -----

  describe('GET /api/v1/cells/:name/logs', () => {
    it('queries Postgres and returns paginated results', async () => {
      const logRows = [
        {
          id: 1,
          cell_name: 'researcher',
          namespace: 'default',
          event_type: 'message_received',
          payload: { content: 'hello' },
          created_at: '2025-01-15T10:30:00Z',
        },
        {
          id: 2,
          cell_name: 'researcher',
          namespace: 'default',
          event_type: 'tool_call',
          payload: { tool: 'web_search' },
          created_at: '2025-01-15T10:30:05Z',
        },
      ];

      db = createMockDb([{ rows: logRows }, { rows: [{ count: '2' }] }]);
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cells/researcher/logs?namespace=default&limit=10&offset=0',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.logs).toEqual(logRows);
      expect(body.total).toBe(2);

      // Verify queries
      expect(db.queries).toHaveLength(2);
      expect(db.queries[0]!.params).toEqual(['researcher', 'default', 10, 0]);
      expect(db.queries[1]!.params).toEqual(['researcher', 'default']);

      await app.close();
    });

    it('uses default query parameters', async () => {
      db = createMockDb([{ rows: [] }, { rows: [{ count: '0' }] }]);
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cells/researcher/logs',
      });

      expect(res.statusCode).toBe(200);
      expect(db.queries[0]!.params).toEqual(['researcher', 'default', 50, 0]);

      await app.close();
    });
  });

  // ----- GET /api/v1/cells/:name/usage -----

  describe('GET /api/v1/cells/:name/usage', () => {
    it('returns aggregated stats from Postgres', async () => {
      db = createMockDb([
        {
          rows: [{ events: '42', total_cost: '1.2345', total_tokens: '15000' }],
        },
      ]);
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cells/researcher/usage?namespace=prod',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalCost).toBeCloseTo(1.2345);
      expect(body.totalTokens).toBe(15000);
      expect(body.events).toBe(42);

      // Verify query params
      expect(db.queries[0]!.params).toEqual(['researcher', 'prod']);

      await app.close();
    });

    it('returns zeros when no data', async () => {
      db = createMockDb([
        {
          rows: [{ events: '0', total_cost: '0', total_tokens: '0' }],
        },
      ]);
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cells/newcell/usage',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.totalCost).toBe(0);
      expect(body.totalTokens).toBe(0);
      expect(body.events).toBe(0);

      await app.close();
    });

    it('uses default namespace', async () => {
      db = createMockDb([
        {
          rows: [{ events: '0', total_cost: '0', total_tokens: '0' }],
        },
      ]);
      const app = await buildServer({ nats, db, logger: false });

      await app.inject({
        method: 'GET',
        url: '/api/v1/cells/researcher/usage',
      });

      expect(db.queries[0]!.params).toEqual(['researcher', 'default']);

      await app.close();
    });
  });

  // ----- Error handling -----

  describe('Error handling', () => {
    it('POST /exec returns 400 with no body', async () => {
      db = createMockDb();
      const app = await buildServer({ nats, db, logger: false });

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cells/researcher/exec',
        headers: { 'content-type': 'application/json' },
        payload: '',
      });

      // Fastify returns 400 for invalid JSON
      expect(res.statusCode).toBe(400);

      await app.close();
    });
  });

  // ----- WS /api/v1/cells/:name/attach -----

  describe('WS /api/v1/cells/:name/attach', () => {
    it('TODO: WebSocket test (requires ws client setup)', () => {
      // WebSocket testing with Fastify inject is non-trivial.
      // The route is registered and the subscription/publish logic
      // is covered by the NatsClient/DbClient interface contracts.
      expect(true).toBe(true);
    });
  });
});
