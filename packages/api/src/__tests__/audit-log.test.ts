import { describe, it, expect, beforeEach } from 'vitest';
import type { DbClient, DbQueryResult } from '../clients.js';
import { createAuditLog, type AuditLogService } from '../audit-log.js';
import type { AuditAction } from '@kais/core';

/**
 * In-memory Postgres mock for audit_log table.
 */
function createMockDb(): DbClient {
  const entries: Array<Record<string, unknown>> = [];
  let nextId = 1;

  return {
    async query(text: string, params?: unknown[]): Promise<DbQueryResult> {
      // INSERT INTO audit_log ... RETURNING *
      if (text.includes('INSERT INTO audit_log')) {
        const row: Record<string, unknown> = {
          id: nextId++,
          timestamp: new Date(),
          actor: params![0],
          action: params![1],
          resource_type: params![2],
          resource_id: params![3],
          namespace: params![4],
          detail: params![5] ? JSON.parse(params![5] as string) : null,
          outcome: params![6],
          status_code: params![7],
        };
        entries.push(row);
        return { rows: [row] };
      }

      // SELECT COUNT(*)
      if (text.includes('SELECT COUNT(*)')) {
        let filtered = [...entries];
        filtered = applyFilters(filtered, text, params ?? []);
        return { rows: [{ cnt: String(filtered.length) }] };
      }

      // SELECT * FROM audit_log ...
      if (text.startsWith('SELECT * FROM audit_log')) {
        let filtered = [...entries];
        filtered = applyFilters(filtered, text, params ?? []);

        // Sort by timestamp DESC
        filtered.sort((a, b) =>
          (b.timestamp as Date).getTime() - (a.timestamp as Date).getTime()
        );

        // Extract limit and offset from params (last two)
        const limitIdx = text.match(/LIMIT \$(\d+)/);
        const offsetIdx = text.match(/OFFSET \$(\d+)/);
        if (limitIdx && offsetIdx) {
          const limit = params![parseInt(limitIdx[1]!) - 1] as number;
          const offset = params![parseInt(offsetIdx[1]!) - 1] as number;
          filtered = filtered.slice(offset, offset + limit);
        }

        return { rows: filtered };
      }

      return { rows: [] };
    },
  };
}

function applyFilters(
  entries: Array<Record<string, unknown>>,
  text: string,
  params: unknown[],
): Array<Record<string, unknown>> {
  let filtered = entries;

  // Parse WHERE conditions from the SQL
  if (text.includes('actor =')) {
    const actorIdx = text.match(/actor = \$(\d+)/);
    if (actorIdx) {
      const actor = params[parseInt(actorIdx[1]!) - 1] as string;
      filtered = filtered.filter(e => e.actor === actor);
    }
  }

  if (text.includes('action =')) {
    const actionIdx = text.match(/action = \$(\d+)/);
    if (actionIdx) {
      const action = params[parseInt(actionIdx[1]!) - 1] as string;
      filtered = filtered.filter(e => e.action === action);
    }
  }

  if (text.includes('resource_type =')) {
    const rtIdx = text.match(/resource_type = \$(\d+)/);
    if (rtIdx) {
      const rt = params[parseInt(rtIdx[1]!) - 1] as string;
      filtered = filtered.filter(e => e.resource_type === rt);
    }
  }

  if (text.includes('namespace = $') && text.includes('WHERE')) {
    const nsIdx = text.match(/namespace = \$(\d+)/);
    if (nsIdx) {
      const ns = params[parseInt(nsIdx[1]!) - 1] as string;
      filtered = filtered.filter(e => e.namespace === ns);
    }
  }

  if (text.includes('outcome =')) {
    const outIdx = text.match(/outcome = \$(\d+)/);
    if (outIdx) {
      const outcome = params[parseInt(outIdx[1]!) - 1] as string;
      filtered = filtered.filter(e => e.outcome === outcome);
    }
  }

  return filtered;
}

describe('AuditLogService', () => {
  let db: DbClient;
  let audit: AuditLogService;

  beforeEach(() => {
    db = createMockDb();
    audit = createAuditLog(db);
  });

  it('records an audit entry', async () => {
    const entry = await audit.record({
      actor: 'admin',
      action: 'create',
      resourceType: 'cells',
      resourceId: 'worker-0',
      namespace: 'default',
      outcome: 'success',
      statusCode: 200,
    });

    expect(entry.id).toBe(1);
    expect(entry.actor).toBe('admin');
    expect(entry.action).toBe('create');
    expect(entry.resourceType).toBe('cells');
    expect(entry.resourceId).toBe('worker-0');
    expect(entry.outcome).toBe('success');
    expect(entry.timestamp).toBeDefined();
  });

  it('records entry with detail', async () => {
    const entry = await audit.record({
      actor: 'user1',
      action: 'update',
      resourceType: 'formations',
      namespace: 'prod',
      detail: { replicas: 3, model: 'claude-sonnet' },
      outcome: 'success',
    });

    expect(entry.detail).toEqual({ replicas: 3, model: 'claude-sonnet' });
  });

  it('records failures', async () => {
    const entry = await audit.record({
      actor: 'viewer',
      action: 'create',
      resourceType: 'cells',
      namespace: 'default',
      outcome: 'failure',
      statusCode: 403,
    });

    expect(entry.outcome).toBe('failure');
    expect(entry.statusCode).toBe(403);
  });

  it('queries all entries', async () => {
    await audit.record({ actor: 'a', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'b', action: 'delete', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'c', action: 'update', resourceType: 'formations', namespace: 'ns', outcome: 'failure' });

    const entries = await audit.query();
    expect(entries).toHaveLength(3);
  });

  it('filters by actor', async () => {
    await audit.record({ actor: 'admin', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'viewer', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'failure' });

    const entries = await audit.query({ actor: 'admin' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actor).toBe('admin');
  });

  it('filters by action', async () => {
    await audit.record({ actor: 'a', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'a', action: 'delete', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'a', action: 'create', resourceType: 'missions', namespace: 'ns', outcome: 'success' });

    const entries = await audit.query({ action: 'create' });
    expect(entries).toHaveLength(2);
  });

  it('filters by resource type', async () => {
    await audit.record({ actor: 'a', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'a', action: 'create', resourceType: 'formations', namespace: 'ns', outcome: 'success' });

    const entries = await audit.query({ resourceType: 'formations' });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.resourceType).toBe('formations');
  });

  it('filters by outcome', async () => {
    await audit.record({ actor: 'a', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'b', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'failure' });
    await audit.record({ actor: 'c', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'failure' });

    const failures = await audit.query({ outcome: 'failure' });
    expect(failures).toHaveLength(2);
  });

  it('filters by namespace', async () => {
    await audit.record({ actor: 'a', action: 'create', resourceType: 'cells', namespace: 'prod', outcome: 'success' });
    await audit.record({ actor: 'a', action: 'create', resourceType: 'cells', namespace: 'dev', outcome: 'success' });

    const entries = await audit.query({ namespace: 'prod' });
    expect(entries).toHaveLength(1);
  });

  it('counts entries', async () => {
    await audit.record({ actor: 'a', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'b', action: 'delete', resourceType: 'cells', namespace: 'ns', outcome: 'success' });
    await audit.record({ actor: 'c', action: 'create', resourceType: 'cells', namespace: 'ns', outcome: 'failure' });

    expect(await audit.count()).toBe(3);
    expect(await audit.count({ outcome: 'failure' })).toBe(1);
    expect(await audit.count({ action: 'create' })).toBe(2);
  });

  it('supports combined filters', async () => {
    await audit.record({ actor: 'admin', action: 'create', resourceType: 'cells', namespace: 'prod', outcome: 'success' });
    await audit.record({ actor: 'admin', action: 'create', resourceType: 'formations', namespace: 'prod', outcome: 'success' });
    await audit.record({ actor: 'admin', action: 'delete', resourceType: 'cells', namespace: 'prod', outcome: 'success' });
    await audit.record({ actor: 'viewer', action: 'create', resourceType: 'cells', namespace: 'prod', outcome: 'failure' });

    const entries = await audit.query({ actor: 'admin', action: 'create' });
    expect(entries).toHaveLength(2);
  });

  it('respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await audit.record({
        actor: `user-${i}`,
        action: 'create',
        resourceType: 'cells',
        namespace: 'ns',
        outcome: 'success',
      });
    }

    const page1 = await audit.query({ limit: 2, offset: 0 });
    expect(page1).toHaveLength(2);

    const page2 = await audit.query({ limit: 2, offset: 2 });
    expect(page2).toHaveLength(2);

    const page3 = await audit.query({ limit: 2, offset: 4 });
    expect(page3).toHaveLength(1);
  });
});
