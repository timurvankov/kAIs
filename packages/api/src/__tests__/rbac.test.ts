import { describe, expect, it } from 'vitest';

import type { AuthUser, Role } from '@kais/core';
import { InMemoryRbacStore, RbacService } from '../rbac.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const adminRole: Role = {
  name: 'admin',
  spec: {
    rules: [
      {
        resources: ['cells', 'formations', 'missions', 'experiments', 'evolutions', 'blueprints', 'knowledge', 'spawn-requests', 'budgets', 'dashboard', 'roles'],
        verbs: ['get', 'list', 'create', 'update', 'delete', 'approve', 'reject', 'use', 'allocate', 'view', 'add', 'invalidate', 'promote'],
        maxAllocation: 1000,
      },
    ],
  },
};

const observerRole: Role = {
  name: 'observer',
  spec: {
    rules: [
      {
        resources: ['cells', 'formations', 'missions', 'experiments', 'evolutions', 'blueprints', 'knowledge'],
        verbs: ['get', 'list'],
      },
      {
        resources: ['dashboard'],
        verbs: ['view'],
      },
    ],
  },
};

const projectLeadRole: Role = {
  name: 'project-lead',
  namespace: 'project-x',
  spec: {
    rules: [
      {
        resources: ['cells', 'formations', 'missions'],
        verbs: ['get', 'list', 'create', 'update', 'delete'],
      },
      {
        resources: ['budgets'],
        verbs: ['get', 'allocate'],
        maxAllocation: 100,
      },
    ],
  },
};

const researcherRole: Role = {
  name: 'researcher',
  namespace: 'experiments',
  spec: {
    rules: [
      {
        resources: ['experiments', 'evolutions'],
        verbs: ['get', 'list', 'create', 'update', 'delete'],
      },
      {
        resources: ['cells', 'formations'],
        verbs: ['get', 'list'],
      },
      {
        resources: ['budgets'],
        verbs: ['get', 'allocate'],
        maxAllocation: 50,
      },
    ],
  },
};

function makeStore(roles: Role[]): InMemoryRbacStore {
  return new InMemoryRbacStore(roles);
}

function makeService(roles: Role[]): RbacService {
  return new RbacService(makeStore(roles));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InMemoryRbacStore', () => {
  it('returns roles by names', async () => {
    const store = makeStore([adminRole, observerRole]);
    const result = await store.getRolesByNames(['admin', 'observer']);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name)).toEqual(['admin', 'observer']);
  });

  it('returns empty array for unknown role names', async () => {
    const store = makeStore([adminRole]);
    const result = await store.getRolesByNames(['nonexistent']);
    expect(result).toHaveLength(0);
  });

  it('skips unknown names in a mixed query', async () => {
    const store = makeStore([adminRole, observerRole]);
    const result = await store.getRolesByNames(['admin', 'nonexistent']);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('admin');
  });
});

describe('RbacService.check', () => {
  it('allows admin to do anything', async () => {
    const svc = makeService([adminRole]);
    const user: AuthUser = { name: 'timur', roles: ['admin'] };

    const result = await svc.check({ user, resource: 'cells', verb: 'create' });
    expect(result.allowed).toBe(true);
  });

  it('allows admin to delete in any namespace', async () => {
    const svc = makeService([adminRole]);
    const user: AuthUser = { name: 'timur', roles: ['admin'] };

    const result = await svc.check({ user, resource: 'cells', verb: 'delete', namespace: 'production' });
    expect(result.allowed).toBe(true);
  });

  it('allows observer to get cells', async () => {
    const svc = makeService([observerRole]);
    const user: AuthUser = { name: 'viewer', roles: ['observer'] };

    const result = await svc.check({ user, resource: 'cells', verb: 'get' });
    expect(result.allowed).toBe(true);
  });

  it('denies observer from creating cells', async () => {
    const svc = makeService([observerRole]);
    const user: AuthUser = { name: 'viewer', roles: ['observer'] };

    const result = await svc.check({ user, resource: 'cells', verb: 'create' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('cannot');
  });

  it('denies observer from deleting formations', async () => {
    const svc = makeService([observerRole]);
    const user: AuthUser = { name: 'viewer', roles: ['observer'] };

    const result = await svc.check({ user, resource: 'formations', verb: 'delete' });
    expect(result.allowed).toBe(false);
  });

  it('allows observer to view dashboard', async () => {
    const svc = makeService([observerRole]);
    const user: AuthUser = { name: 'viewer', roles: ['observer'] };

    const result = await svc.check({ user, resource: 'dashboard', verb: 'view' });
    expect(result.allowed).toBe(true);
  });

  it('denies access when user has no valid roles', async () => {
    const svc = makeService([adminRole]);
    const user: AuthUser = { name: 'unknown', roles: ['nonexistent'] };

    const result = await svc.check({ user, resource: 'cells', verb: 'get' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('No roles found');
  });

  // --- Namespace scoping ---

  it('allows namespaced role in its own namespace', async () => {
    const svc = makeService([projectLeadRole]);
    const user: AuthUser = { name: 'lead', roles: ['project-lead'] };

    const result = await svc.check({ user, resource: 'cells', verb: 'create', namespace: 'project-x' });
    expect(result.allowed).toBe(true);
  });

  it('denies namespaced role in a different namespace', async () => {
    const svc = makeService([projectLeadRole]);
    const user: AuthUser = { name: 'lead', roles: ['project-lead'] };

    const result = await svc.check({ user, resource: 'cells', verb: 'create', namespace: 'other-project' });
    expect(result.allowed).toBe(false);
  });

  it('allows cluster-wide role in any namespace', async () => {
    const svc = makeService([adminRole]);
    const user: AuthUser = { name: 'admin', roles: ['admin'] };

    const result = await svc.check({ user, resource: 'cells', verb: 'create', namespace: 'any-ns' });
    expect(result.allowed).toBe(true);
  });

  // --- Multiple roles ---

  it('merges permissions from multiple roles', async () => {
    const svc = makeService([observerRole, projectLeadRole]);
    const user: AuthUser = { name: 'multi', roles: ['observer', 'project-lead'] };

    // observer can read knowledge, project-lead cannot
    const r1 = await svc.check({ user, resource: 'knowledge', verb: 'get' });
    expect(r1.allowed).toBe(true);

    // project-lead can create cells in project-x, observer cannot
    const r2 = await svc.check({ user, resource: 'cells', verb: 'create', namespace: 'project-x' });
    expect(r2.allowed).toBe(true);
  });

  it('denies if no role grants the required verb', async () => {
    const svc = makeService([observerRole, researcherRole]);
    const user: AuthUser = { name: 'limited', roles: ['observer', 'researcher'] };

    // Neither observer nor researcher can delete formations
    const result = await svc.check({ user, resource: 'formations', verb: 'delete', namespace: 'experiments' });
    expect(result.allowed).toBe(false);
  });
});

describe('RbacService.getMaxAllocation', () => {
  it('returns maxAllocation from admin role', async () => {
    const svc = makeService([adminRole]);
    const user: AuthUser = { name: 'timur', roles: ['admin'] };

    const max = await svc.getMaxAllocation(user);
    expect(max).toBe(1000);
  });

  it('returns 0 when user has no budget rules', async () => {
    const svc = makeService([observerRole]);
    const user: AuthUser = { name: 'viewer', roles: ['observer'] };

    const max = await svc.getMaxAllocation(user);
    expect(max).toBe(0);
  });

  it('returns highest allocation from matching roles', async () => {
    const svc = makeService([projectLeadRole, researcherRole]);
    const user: AuthUser = { name: 'multi', roles: ['project-lead', 'researcher'] };

    // project-lead: 100 (in project-x), researcher: 50 (in experiments)
    // Without namespace, both apply
    const max = await svc.getMaxAllocation(user);
    expect(max).toBe(100);
  });

  it('respects namespace scope for allocation', async () => {
    const svc = makeService([projectLeadRole, researcherRole]);
    const user: AuthUser = { name: 'multi', roles: ['project-lead', 'researcher'] };

    // Only researcher applies in 'experiments' namespace
    const max = await svc.getMaxAllocation(user, 'experiments');
    expect(max).toBe(50);
  });
});
