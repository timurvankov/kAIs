import { describe, expect, it, vi } from 'vitest';

import type { Role, StaticTokenEntry } from '@kais/core';
import type { DbClient, DbQueryResult, NatsClient, NatsSubscription } from '../clients.js';
import { buildServer } from '../server.js';
import { StaticTokenAuthProvider } from '../auth.js';
import { InMemoryRbacStore, RbacService } from '../rbac.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockNats(): NatsClient {
  return {
    async publish() {},
    subscribe(): NatsSubscription {
      return {
        async *[Symbol.asyncIterator]() {},
        unsubscribe: vi.fn(),
      };
    },
  };
}

function createMockDb(responses: DbQueryResult[] = []): DbClient {
  let idx = 0;
  return {
    async query() {
      return responses[idx++] ?? { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const adminRole: Role = {
  name: 'admin',
  spec: {
    rules: [
      {
        resources: ['cells', 'formations', 'missions'],
        verbs: ['get', 'list', 'create', 'update', 'delete'],
      },
    ],
  },
};

const observerRole: Role = {
  name: 'observer',
  spec: {
    rules: [
      {
        resources: ['cells', 'formations', 'missions'],
        verbs: ['get', 'list'],
      },
    ],
  },
};

const tokens: StaticTokenEntry[] = [
  { name: 'admin-user', token: 'admin-secret', roles: ['admin'] },
  { name: 'viewer-user', token: 'viewer-secret', roles: ['observer'] },
];

function buildAuthServer() {
  const auth = new StaticTokenAuthProvider(tokens);
  const rbac = new RbacService(new InMemoryRbacStore([adminRole, observerRole]));
  return buildServer({
    nats: createMockNats(),
    db: createMockDb([{ rows: [] }, { rows: [{ count: '0' }] }]),
    logger: false,
    auth,
    rbac,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RBAC integration with API server', () => {
  it('healthz is accessible without auth', async () => {
    const app = await buildAuthServer();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('rejects request without Authorization header', async () => {
    const app = await buildAuthServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/test-cell/logs',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('Unauthorized');
    await app.close();
  });

  it('rejects request with invalid token', async () => {
    const app = await buildAuthServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/test-cell/logs',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Invalid token');
    await app.close();
  });

  it('allows admin to GET cell logs', async () => {
    const app = await buildAuthServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/test-cell/logs',
      headers: { authorization: 'Bearer admin-secret' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('allows observer to GET cell logs (read-only)', async () => {
    const app = await buildAuthServer();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/test-cell/logs',
      headers: { authorization: 'Bearer viewer-secret' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('allows admin to POST exec (create verb)', async () => {
    const app = await buildAuthServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/test-cell/exec',
      headers: {
        authorization: 'Bearer admin-secret',
        'content-type': 'application/json',
      },
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('denies observer from POST exec (create verb)', async () => {
    const app = await buildAuthServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cells/test-cell/exec',
      headers: {
        authorization: 'Bearer viewer-secret',
        'content-type': 'application/json',
      },
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('Forbidden');
    await app.close();
  });

  it('server without auth/rbac allows all requests', async () => {
    const app = await buildServer({
      nats: createMockNats(),
      db: createMockDb([{ rows: [] }, { rows: [{ count: '0' }] }]),
      logger: false,
      // No auth/rbac options — open access
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/cells/test-cell/logs',
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
