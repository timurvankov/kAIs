import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { SpanKind, SpanStatusCode, context, propagation } from '@opentelemetry/api';

import { createEnvelope, getTracer } from '@kais/core';
import type { DbClient, NatsClient } from './clients.js';

const tracer = getTracer('kais-api');

/**
 * RFC 1123 label: lowercase alphanumeric and hyphens, 1-63 chars,
 * must start and end with alphanumeric. Prevents NATS wildcard/subject injection.
 */
const SAFE_IDENTIFIER = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function validateIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value);
}

/** Options for building the kAIs API server. */
export interface BuildServerOptions {
  nats: NatsClient;
  db: DbClient;
  logger?: boolean;
}

/**
 * Build and return a configured Fastify instance.
 * Does NOT call listen() — the caller is responsible for starting it.
 */
export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const { nats, db, logger = true } = opts;

  const app = Fastify({ logger });
  await app.register(fastifyWebsocket);

  // ---------- OTel request tracing ----------

  app.addHook('onRequest', (req, _reply, done) => {
    const span = tracer.startSpan(`${req.method} ${req.routeOptions?.url ?? req.url}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
      },
    });
    (req as any).otelSpan = span;
    done();
  });

  app.addHook('onResponse', (req, reply, done) => {
    const span = (req as any).otelSpan;
    if (span) {
      span.setAttributes({ 'http.status_code': reply.statusCode });
      if (reply.statusCode >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }
      span.end();
    }
    done();
  });

  // ---------- Health check ----------

  app.get('/healthz', async () => ({ ok: true }));

  // ---------- POST /api/v1/cells/:name/exec ----------
  // Publish a message envelope to cell.{namespace}.{name}.inbox via NATS

  app.post<{
    Params: { name: string };
    Body: { message: string; namespace?: string };
  }>('/api/v1/cells/:name/exec', async (req, reply) => {
    const { name } = req.params;
    if (!name || !validateIdentifier(name)) {
      return reply.status(400).send({ error: 'Invalid cell name' });
    }

    const body = req.body as { message?: string; namespace?: string } | undefined;
    if (!body || typeof body.message !== 'string' || body.message.length === 0) {
      return reply.status(400).send({ error: 'Missing or empty message' });
    }

    const namespace = body.namespace ?? 'default';
    if (!validateIdentifier(namespace)) {
      return reply.status(400).send({ error: 'Invalid namespace' });
    }
    const traceCtx: Record<string, string> = {};
    propagation.inject(context.active(), traceCtx);

    const envelope = createEnvelope({
      from: 'api',
      to: `cell.${namespace}.${name}`,
      type: 'message',
      payload: { content: body.message },
      traceContext: Object.keys(traceCtx).length > 0 ? traceCtx : undefined,
    });

    const encoded = new TextEncoder().encode(JSON.stringify(envelope));
    await nats.publish(`cell.${namespace}.${name}.inbox`, encoded);
    return { ok: true, messageId: envelope.id };
  });

  // ---------- GET /api/v1/cells/:name/logs ----------
  // Query cell_events from Postgres

  app.get<{
    Params: { name: string };
    Querystring: { namespace?: string; limit?: string; offset?: string };
  }>('/api/v1/cells/:name/logs', async (req, reply) => {
    const { name } = req.params;
    if (!name || !validateIdentifier(name)) {
      return reply.status(400).send({ error: 'Invalid cell name' });
    }

    const namespace = req.query.namespace ?? 'default';
    if (!validateIdentifier(namespace)) {
      return reply.status(400).send({ error: 'Invalid namespace' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);

    const logs = await db.query(
      'SELECT * FROM cell_events WHERE cell_name = $1 AND namespace = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
      [name, namespace, limit, offset],
    );

    const total = await db.query(
      'SELECT COUNT(*) as count FROM cell_events WHERE cell_name = $1 AND namespace = $2',
      [name, namespace],
    );

    const countRow = total.rows[0] as { count: string } | undefined;
    return {
      logs: logs.rows,
      total: parseInt(countRow?.count ?? '0', 10),
    };
  });

  // ---------- GET /api/v1/cells/:name/usage ----------
  // Aggregated cost / token stats from cell_events

  app.get<{
    Params: { name: string };
    Querystring: { namespace?: string };
  }>('/api/v1/cells/:name/usage', async (req, reply) => {
    const { name } = req.params;
    if (!name || !validateIdentifier(name)) {
      return reply.status(400).send({ error: 'Invalid cell name' });
    }

    const namespace = req.query.namespace ?? 'default';
    if (!validateIdentifier(namespace)) {
      return reply.status(400).send({ error: 'Invalid namespace' });
    }

    const result = await db.query(
      `SELECT
         COUNT(*) as events,
         COALESCE(SUM((payload->'usage'->>'cost')::numeric), 0) as total_cost,
         COALESCE(SUM((payload->'usage'->>'totalTokens')::integer), 0) as total_tokens
       FROM cell_events
       WHERE cell_name = $1 AND namespace = $2 AND event_type = 'response'`,
      [name, namespace],
    );

    const row = result.rows[0] as
      | { events: string; total_cost: string; total_tokens: string }
      | undefined;
    return {
      totalCost: parseFloat(row?.total_cost ?? '0'),
      totalTokens: parseInt(row?.total_tokens ?? '0', 10),
      events: parseInt(row?.events ?? '0', 10),
    };
  });

  // ---------- GET /api/v1/metrics ----------
  // Aggregated platform-wide metrics

  app.get('/api/v1/metrics', async () => {
    // Count distinct active cells (cells that had events in the last hour)
    const activeCellsResult = await db.query(
      `SELECT COUNT(DISTINCT cell_name) as count
       FROM cell_events
       WHERE created_at > NOW() - INTERVAL '1 hour'`,
    );

    // Aggregate today's cost and tokens from response events
    const todayResult = await db.query(
      `SELECT
         COUNT(*) as llm_calls,
         COALESCE(SUM((payload->'usage'->>'cost')::numeric), 0) as total_cost,
         COALESCE(SUM((payload->'usage'->>'totalTokens')::integer), 0) as total_tokens
       FROM cell_events
       WHERE event_type = 'response'
         AND created_at > CURRENT_DATE`,
    );

    const activeCells = parseInt((activeCellsResult.rows[0] as any)?.count ?? '0', 10);
    const row = todayResult.rows[0] as any;

    return {
      activeCells,
      totalCostToday: parseFloat(row?.total_cost ?? '0'),
      totalTokensToday: parseInt(row?.total_tokens ?? '0', 10),
      llmCallsToday: parseInt(row?.llm_calls ?? '0', 10),
    };
  });

  // ---------- WS /api/v1/cells/:name/attach ----------
  // Bidirectional WebSocket bridge to NATS

  app.get<{
    Params: { name: string };
    Querystring: { namespace?: string };
  }>('/api/v1/cells/:name/attach', { websocket: true }, (socket, req) => {
    const { name } = req.params;
    const namespace = (req.query as { namespace?: string }).namespace ?? 'default';

    if (!validateIdentifier(name) || !validateIdentifier(namespace)) {
      socket.close(1008, 'Invalid cell name or namespace');
      return;
    }

    // Subscribe to cell outbox
    const sub = nats.subscribe(`cell.${namespace}.${name}.outbox`);
    const decoder = new TextDecoder();

    // Forward NATS outbox messages to WebSocket
    void (async () => {
      try {
        for await (const msg of sub) {
          if (socket.readyState === 1 /* OPEN */) {
            socket.send(decoder.decode(msg.data));
          }
        }
      } catch {
        // Subscription ended (e.g. socket closed)
      }
    })();

    // Forward WS messages to cell inbox
    socket.on('message', (data: Buffer | string) => {
      const content = typeof data === 'string' ? data : data.toString();
      const envelope = createEnvelope({
        from: 'api.attach',
        to: `cell.${namespace}.${name}`,
        type: 'message',
        payload: { content },
      });
      const encoded = new TextEncoder().encode(JSON.stringify(envelope));
      void nats.publish(`cell.${namespace}.${name}.inbox`, encoded);
    });

    socket.on('close', () => {
      sub.unsubscribe();
    });
  });

  // ---------- Knowledge proxy routes ----------
  const KNOWLEDGE_URL = process.env['KNOWLEDGE_SERVICE_URL'] ?? 'http://kais-knowledge.kais-system:8000';

  app.post('/api/v1/knowledge/search', async (req, reply) => {
    const res = await fetch(`${KNOWLEDGE_URL}/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    reply.status(res.status).send(await res.json());
  });

  app.post('/api/v1/knowledge/add', async (req, reply) => {
    const res = await fetch(`${KNOWLEDGE_URL}/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    reply.status(res.status).send(await res.json());
  });

  app.post('/api/v1/knowledge/invalidate', async (req, reply) => {
    const res = await fetch(`${KNOWLEDGE_URL}/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    reply.status(res.status).send(await res.json());
  });

  return app;
}
