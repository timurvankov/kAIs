/**
 * E2E test: RBAC enforcement
 *
 * Tests that the API server correctly enforces RBAC when auth is configured.
 * Uses a real Fastify server (injected) with static token auth.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// We import from the built packages directly
import { buildServer } from '@kais/api';
import type { NatsClient, NatsSubscription, DbClient, DbQueryResult } from '@kais/api';
import { StaticTokenAuthProvider, InMemoryRbacStore, RbacService } from '@kais/api';
import type { Role, StaticTokenEntry } from '@kais/core';

// ---------------------------------------------------------------------------
// Mock infra
// ---------------------------------------------------------------------------

function createMockNats(): NatsClient {
  return {
    async publish() {},
    subscribe(): NatsSubscription {
      return {
        async *[Symbol.asyncIterator]() {},
        unsubscribe() {},
      };
    },
  };
}

function createMockDb(): DbClient {
  const rows: Record<string, unknown>[] = [];
  return {
    async query(): Promise<DbQueryResult> {
      return { rows: [{ count: '0' }] };
    },
  };
}

// ---------------------------------------------------------------------------
// RBAC config
// ---------------------------------------------------------------------------

const roles: Role[] = [
  {
    name: 'admin',
    spec: {
      rules: [
        {
          resources: ['cells', 'formations', 'missions'],
          verbs: ['get', 'list', 'create', 'update', 'delete'],
        },
        {
          resources: ['budgets'],
          verbs: ['get', 'allocate'],
          maxAllocation: 500,
        },
      ],
    },
  },
  {
    name: 'viewer',
    spec: {
      rules: [
        {
          resources: ['cells', 'formations', 'missions'],
          verbs: ['get', 'list'],
        },
      ],
    },
  },
  {
    name: 'ns-developer',
    namespace: 'dev-ns',
    spec: {
      rules: [
        {
          resources: ['cells', 'formations'],
          verbs: ['get', 'list', 'create', 'update'],
        },
      ],
    },
  },
];

const tokens: StaticTokenEntry[] = [
  { name: 'admin-user', token: 'tok-admin', roles: ['admin'] },
  { name: 'viewer-user', token: 'tok-viewer', roles: ['viewer'] },
  { name: 'dev-user', token: 'tok-dev', roles: ['ns-developer'] },
];

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  const auth = new StaticTokenAuthProvider(tokens);
  const rbac = new RbacService(new InMemoryRbacStore(roles));

  app = await buildServer({
    nats: createMockNats(),
    db: createMockDb(),
    logger: false,
    auth,
    rbac,
  });
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RBAC E2E — healthz', () => {
  it('is accessible without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('RBAC E2E — authentication', () => {
  it('rejects requests without Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/cells/test/logs' });
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/test/logs',
      headers: { authorization: 'Bearer bad-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Invalid token');
  });

  it('rejects requests with malformed Authorization (no Bearer prefix)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/test/logs',
      headers: { authorization: 'tok-admin' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('RBAC E2E — admin user', () => {
  const headers = { authorization: 'Bearer tok-admin' };

  it('can GET cell logs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/cells/test/logs', headers });
    expect(res.statusCode).toBe(200);
  });

  it('can GET cell usage', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/cells/test/usage', headers });
    expect(res.statusCode).toBe(200);
  });

  it('can POST exec (create)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/test/exec',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('RBAC E2E — viewer user (read-only)', () => {
  const headers = { authorization: 'Bearer tok-viewer' };

  it('can GET cell logs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/cells/test/logs', headers });
    expect(res.statusCode).toBe(200);
  });

  it('cannot POST exec (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/test/exec',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('Forbidden');
  });
});

describe('RBAC E2E — namespace-scoped developer', () => {
  const headers = { authorization: 'Bearer tok-dev' };

  it('can GET cells in own namespace', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/test/logs?namespace=dev-ns',
      headers,
    });
    expect(res.statusCode).toBe(200);
  });

  it('cannot create cells in a different namespace (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/test/exec',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: { message: 'hello', namespace: 'production' },
    });
    expect(res.statusCode).toBe(403);
  });
});
