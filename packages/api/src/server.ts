import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { SpanKind, SpanStatusCode, context, propagation } from '@opentelemetry/api';

import { createEnvelope, getTracer } from '@kais/core';
import type { AuditEntry, AuthUser, RbacResource, RbacVerb, SpawnRequestPhase } from '@kais/core';
import type { DbClient, NatsClient } from './clients.js';
import type { AuthProvider } from './auth.js';
import { extractBearerToken } from './auth.js';
import type { RbacService } from './rbac.js';
import type { BudgetLedgerService } from './budget-ledger.js';
import type { CellTreeService } from './cell-tree.js';
import type { SpawnRequestService } from './spawn-request.js';
import type { AuditLogService, AuditQueryOptions } from './audit-log.js';

const tracer = getTracer('kais-api');

/**
 * RFC 1123 label: lowercase alphanumeric and hyphens, 1-63 chars,
 * must start and end with alphanumeric. Prevents NATS wildcard/subject injection.
 */
const SAFE_IDENTIFIER = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function validateIdentifier(value: string): boolean {
  return SAFE_IDENTIFIER.test(value);
}

/** HTTP method → RBAC verb mapping. */
function httpMethodToVerb(method: string): RbacVerb {
  switch (method.toUpperCase()) {
    case 'GET': return 'get';
    case 'POST': return 'create';
    case 'PUT': return 'update';
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return 'get';
  }
}

/** Extract the resource type from a URL path segment. */
function extractResource(url: string): RbacResource | undefined {
  const match = /\/api\/v1\/(\w[\w-]*)/.exec(url);
  if (!match?.[1]) return undefined;
  return match[1] as RbacResource;
}

/** Options for building the kAIs API server. */
export interface BuildServerOptions {
  nats: NatsClient;
  db: DbClient;
  logger?: boolean;
  /** Auth provider — if omitted, RBAC is disabled (open access). */
  auth?: AuthProvider;
  /** RBAC service — if omitted, RBAC is disabled (open access). */
  rbac?: RbacService;
  /** Budget ledger — if provided, budget endpoints are enabled. */
  budgetLedger?: BudgetLedgerService;
  /** Cell tree — if provided, tree endpoints are enabled. */
  cellTree?: CellTreeService;
  /** Spawn request service — if provided, spawn-request endpoints are enabled. */
  spawnRequests?: SpawnRequestService;
  /** Audit log service — if provided, audit log endpoints + middleware are enabled. */
  auditLog?: AuditLogService;
}

/**
 * Build and return a configured Fastify instance.
 * Does NOT call listen() — the caller is responsible for starting it.
 */
export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const { nats, db, logger = true, auth, rbac, budgetLedger, cellTree, spawnRequests, auditLog } = opts;

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

  // ---------- Decorate request with user ----------

  app.decorateRequest('user', undefined);

  // ---------- Auth + RBAC hooks ----------

  if (auth && rbac) {
    app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for health checks
      if (req.url === '/healthz') return;

      const token = extractBearerToken(req.headers.authorization);
      if (!token) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid Authorization header. Use: Bearer <token>',
        });
      }

      const user = await auth.authenticate(token);
      if (!user) {
        return reply.status(401).send({
          error: 'Unauthorized',
          message: 'Invalid token',
        });
      }

      // Attach user to request for downstream use
      (req as FastifyRequest & { user: AuthUser }).user = user;

      // Determine resource + verb from the request
      const resource = extractResource(req.url);
      if (!resource) return; // Non-API routes (healthz etc.) pass through

      const verb: RbacVerb = httpMethodToVerb(req.method);
      const namespace = (req.query as Record<string, string | undefined>).namespace
        ?? (req.body as Record<string, string | undefined> | null)?.namespace
        ?? 'default';

      const check = await rbac.check({ user, resource, verb, namespace });
      if (!check.allowed) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: check.reason ?? `User ${user.name} cannot ${verb} ${resource}`,
        });
      }
    });
  }

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

  // ========== Phase 8: Auth + RBAC query endpoints ==========

  if (auth && rbac) {
    // GET /api/v1/auth/whoami — return authenticated user info
    app.get('/api/v1/auth/whoami', async (req) => {
      const user = (req as FastifyRequest & { user?: AuthUser }).user;
      return { user: user ?? null };
    });

    // GET /api/v1/roles — list all roles
    app.get('/api/v1/roles', async () => {
      const roles = await rbac.listRoles();
      return { roles };
    });

    // GET /api/v1/roles/:name — get a single role
    app.get<{ Params: { name: string } }>('/api/v1/roles/:name', async (req, reply) => {
      const role = await rbac.getRole(req.params.name);
      if (!role) return reply.status(404).send({ error: 'Role not found' });
      return role;
    });
  }

  // ========== Phase 8: Budget, Tree, SpawnRequest endpoints ==========

  // ---------- GET /api/v1/budgets/:cellId ----------
  if (budgetLedger) {
    app.get<{
      Params: { cellId: string };
    }>('/api/v1/budgets/:cellId', async (req, reply) => {
      const { cellId } = req.params;
      if (!cellId || !validateIdentifier(cellId)) {
        return reply.status(400).send({ error: 'Invalid cell ID' });
      }
      const balance = await budgetLedger.getBalance(cellId);
      if (!balance) {
        return reply.status(404).send({ error: 'No budget record found' });
      }
      return balance;
    });

    // ---------- GET /api/v1/budgets/:cellId/tree ----------
    app.get<{
      Params: { cellId: string };
    }>('/api/v1/budgets/:cellId/tree', async (req, reply) => {
      const { cellId } = req.params;
      if (!cellId || !validateIdentifier(cellId)) {
        return reply.status(400).send({ error: 'Invalid cell ID' });
      }
      const tree = await budgetLedger.getTree(cellId);
      return { tree };
    });

    // ---------- GET /api/v1/budgets/:cellId/history ----------
    app.get<{
      Params: { cellId: string };
      Querystring: { limit?: string };
    }>('/api/v1/budgets/:cellId/history', async (req, reply) => {
      const { cellId } = req.params;
      if (!cellId || !validateIdentifier(cellId)) {
        return reply.status(400).send({ error: 'Invalid cell ID' });
      }
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 500);
      const history = await budgetLedger.getHistory(cellId, limit);
      return { history };
    });

    // ---------- POST /api/v1/budgets/:cellId/top-up ----------
    app.post<{
      Params: { cellId: string };
      Body: { childCellId: string; amount: number };
    }>('/api/v1/budgets/:cellId/top-up', async (req, reply) => {
      const { cellId } = req.params;
      if (!cellId || !validateIdentifier(cellId)) {
        return reply.status(400).send({ error: 'Invalid cell ID' });
      }
      const body = req.body as { childCellId?: string; amount?: number } | undefined;
      if (!body?.childCellId || typeof body.amount !== 'number' || body.amount <= 0) {
        return reply.status(400).send({ error: 'childCellId and positive amount required' });
      }
      try {
        await budgetLedger.topUp(cellId, body.childCellId, body.amount);
        return { ok: true };
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
    });
  }

  // ---------- GET /api/v1/tree/:cellId ----------
  if (cellTree) {
    app.get<{
      Params: { cellId: string };
    }>('/api/v1/tree/:cellId', async (req, reply) => {
      const { cellId } = req.params;
      if (!cellId || !validateIdentifier(cellId)) {
        return reply.status(400).send({ error: 'Invalid cell ID' });
      }
      const node = await cellTree.getNode(cellId);
      if (!node) {
        return reply.status(404).send({ error: 'Cell not found in tree' });
      }
      const tree = await cellTree.getTree(node.rootId);
      return { root: node.rootId, nodes: tree };
    });

    app.get<{
      Params: { cellId: string };
    }>('/api/v1/tree/:cellId/ancestors', async (req, reply) => {
      const { cellId } = req.params;
      if (!cellId || !validateIdentifier(cellId)) {
        return reply.status(400).send({ error: 'Invalid cell ID' });
      }
      const ancestors = await cellTree.getAncestors(cellId);
      return { ancestors };
    });
  }

  // ---------- Spawn Requests ----------
  if (spawnRequests) {
    app.get<{
      Querystring: { status?: SpawnRequestPhase; namespace?: string; limit?: string };
    }>('/api/v1/spawn-requests', async (req) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 500);
      const list = await spawnRequests.list({
        status: req.query.status as SpawnRequestPhase | undefined,
        namespace: req.query.namespace,
        limit,
      });
      return { requests: list };
    });

    app.get<{
      Params: { id: string };
    }>('/api/v1/spawn-requests/:id', async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return reply.status(400).send({ error: 'Invalid request ID' });
      const request = await spawnRequests.get(id);
      if (!request) return reply.status(404).send({ error: 'SpawnRequest not found' });
      return request;
    });

    app.post<{
      Params: { id: string };
    }>('/api/v1/spawn-requests/:id/approve', async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return reply.status(400).send({ error: 'Invalid request ID' });
      const user = (req as FastifyRequest & { user?: AuthUser }).user;
      try {
        const result = await spawnRequests.approve(id, user?.name ?? 'anonymous');
        return result;
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
    });

    app.post<{
      Params: { id: string };
      Body: { reason?: string };
    }>('/api/v1/spawn-requests/:id/reject', async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return reply.status(400).send({ error: 'Invalid request ID' });
      const user = (req as FastifyRequest & { user?: AuthUser }).user;
      const body = req.body as { reason?: string } | undefined;
      try {
        const result = await spawnRequests.reject(id, user?.name ?? 'anonymous', body?.reason);
        return result;
      } catch (err) {
        return reply.status(400).send({ error: (err as Error).message });
      }
    });
  }

  // ========== Phase 8: Audit Log ==========

  if (auditLog) {
    // Audit log middleware — record all API mutations
    app.addHook('onResponse', async (req, reply) => {
      // Only audit mutating operations on API routes
      if (!req.url.startsWith('/api/v1/')) return;
      if (req.method === 'GET' && !req.url.includes('/exec')) return;

      const user = (req as FastifyRequest & { user?: AuthUser }).user;
      const resource = extractResource(req.url);
      if (!resource) return;

      const verb = httpMethodToVerb(req.method);
      const namespace = (req.query as Record<string, string | undefined>).namespace ?? 'default';

      try {
        await auditLog.record({
          actor: user?.name ?? 'anonymous',
          action: verb as AuditEntry['action'],
          resourceType: resource,
          resourceId: (req.params as Record<string, string>)?.name
            ?? (req.params as Record<string, string>)?.cellId
            ?? (req.params as Record<string, string>)?.id
            ?? undefined,
          namespace,
          outcome: reply.statusCode < 400 ? 'success' : 'failure',
          statusCode: reply.statusCode,
        });
      } catch {
        // Audit log failures must not break API
      }
    });

    // ---------- GET /api/v1/audit-log ----------
    app.get<{
      Querystring: {
        actor?: string;
        action?: string;
        resourceType?: string;
        namespace?: string;
        outcome?: string;
        since?: string;
        until?: string;
        limit?: string;
        offset?: string;
      };
    }>('/api/v1/audit-log', async (req) => {
      const queryOpts: AuditQueryOptions = {};
      if (req.query.actor) queryOpts.actor = req.query.actor;
      if (req.query.action) queryOpts.action = req.query.action as AuditQueryOptions['action'];
      if (req.query.resourceType) queryOpts.resourceType = req.query.resourceType;
      if (req.query.namespace) queryOpts.namespace = req.query.namespace;
      if (req.query.outcome) queryOpts.outcome = req.query.outcome as 'success' | 'failure';
      if (req.query.since) queryOpts.since = req.query.since;
      if (req.query.until) queryOpts.until = req.query.until;
      queryOpts.limit = Math.min(Math.max(parseInt(req.query.limit ?? '100', 10) || 100, 1), 1000);
      queryOpts.offset = Math.max(parseInt(req.query.offset ?? '0', 10) || 0, 0);

      const [entries, total] = await Promise.all([
        auditLog.query(queryOpts),
        auditLog.count(queryOpts),
      ]);
      return { entries, total };
    });
  }

  return app;
}
