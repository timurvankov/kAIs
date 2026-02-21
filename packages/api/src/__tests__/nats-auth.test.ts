import { describe, it, expect, beforeEach } from 'vitest';
import type { DbClient, DbQueryResult } from '../clients.js';
import { createNatsAuthService, buildCellPermissions, matchSubject, type NatsAuthService } from '../nats-auth.js';

/**
 * In-memory Postgres mock for nats_credentials table.
 */
function createMockDb(): DbClient {
  const rows: Array<Record<string, unknown>> = [];
  let nextId = 1;

  return {
    async query(text: string, params?: unknown[]): Promise<DbQueryResult> {
      // UPDATE ... SET revoked_at = now() WHERE cell_id = $1 AND revoked_at IS NULL
      if (text.includes('UPDATE nats_credentials SET revoked_at')) {
        const cellId = params![0] as string;
        for (const row of rows) {
          if (row.cell_id === cellId && !row.revoked_at) {
            row.revoked_at = new Date();
          }
        }
        return { rows: [] };
      }

      // INSERT INTO nats_credentials ... RETURNING *
      if (text.includes('INSERT INTO nats_credentials')) {
        const row: Record<string, unknown> = {
          id: nextId++,
          cell_id: params![0],
          namespace: params![1],
          username: params![2],
          password: params![3],
          permissions: JSON.parse(params![4] as string),
          created_at: new Date(),
          revoked_at: null,
        };
        rows.push(row);
        return { rows: [row] };
      }

      // SELECT * FROM nats_credentials WHERE cell_id = $1 AND revoked_at IS NULL ...
      if (text.includes('SELECT') && text.includes('cell_id = $1') && text.includes('revoked_at IS NULL') && text.includes('LIMIT 1')) {
        const cellId = params![0] as string;
        const active = rows.filter(r => r.cell_id === cellId && !r.revoked_at);
        const latest = active.sort((a, b) =>
          (b.created_at as Date).getTime() - (a.created_at as Date).getTime()
        )[0];
        return { rows: latest ? [latest] : [] };
      }

      // SELECT * FROM nats_credentials WHERE revoked_at IS NULL ORDER BY ...
      if (text.includes('SELECT') && text.includes('revoked_at IS NULL') && !text.includes('cell_id')) {
        const active = rows.filter(r => !r.revoked_at);
        return { rows: active };
      }

      return { rows: [] };
    },
  };
}

describe('buildCellPermissions', () => {
  it('generates default permissions for a cell', () => {
    const perms = buildCellPermissions('worker-0', 'default');
    expect(perms.subscribe).toEqual(['cell.default.worker-0.inbox']);
    expect(perms.publish).toEqual([
      'cell.default.worker-0.outbox',
      'cell.events.default.worker-0',
    ]);
  });

  it('adds topology routes to publish permissions', () => {
    const perms = buildCellPermissions('architect', 'team', ['worker-0', 'worker-1']);
    expect(perms.publish).toContain('cell.team.worker-0.inbox');
    expect(perms.publish).toContain('cell.team.worker-1.inbox');
    expect(perms.publish).toHaveLength(4); // outbox + events + 2 peers
  });

  it('deduplicates topology routes', () => {
    const perms = buildCellPermissions('a', 'ns', ['b', 'b', 'c']);
    const peerInboxes = perms.publish.filter(s => s.includes('.inbox'));
    expect(peerInboxes).toHaveLength(2); // b and c, not b twice
  });

  it('handles empty topology routes', () => {
    const perms = buildCellPermissions('cell-x', 'ns', []);
    expect(perms.publish).toHaveLength(2); // outbox + events only
  });
});

describe('matchSubject', () => {
  it('matches exact subjects', () => {
    expect(matchSubject('cell.default.foo.inbox', 'cell.default.foo.inbox')).toBe(true);
  });

  it('rejects non-matching subjects', () => {
    expect(matchSubject('cell.default.foo.inbox', 'cell.default.bar.inbox')).toBe(false);
  });

  it('matches single-token wildcard *', () => {
    expect(matchSubject('cell.*.foo.inbox', 'cell.default.foo.inbox')).toBe(true);
    expect(matchSubject('cell.*.foo.inbox', 'cell.prod.foo.inbox')).toBe(true);
  });

  it('rejects wildcard * with wrong token count', () => {
    expect(matchSubject('cell.*', 'cell.default.foo')).toBe(false);
  });

  it('matches multi-token wildcard >', () => {
    expect(matchSubject('cell.>', 'cell.default.foo.inbox')).toBe(true);
    expect(matchSubject('cell.events.>', 'cell.events.default.worker')).toBe(true);
  });

  it('> requires at least one following token', () => {
    expect(matchSubject('cell.default.>', 'cell.default')).toBe(false);
    expect(matchSubject('cell.default.>', 'cell.default.foo')).toBe(true);
  });

  it('rejects shorter subject than pattern', () => {
    expect(matchSubject('a.b.c.d', 'a.b.c')).toBe(false);
  });
});

describe('NatsAuthService', () => {
  let db: DbClient;
  let service: NatsAuthService;

  beforeEach(() => {
    db = createMockDb();
    service = createNatsAuthService(db);
  });

  it('generates credentials for a cell', async () => {
    const creds = await service.generateCredentials('worker-0', 'default');
    expect(creds.cellId).toBe('worker-0');
    expect(creds.namespace).toBe('default');
    expect(creds.username).toBe('cell-default-worker-0');
    expect(creds.password).toHaveLength(32);
    expect(creds.permissions.subscribe).toContain('cell.default.worker-0.inbox');
    expect(creds.permissions.publish).toContain('cell.default.worker-0.outbox');
  });

  it('generates unique passwords', async () => {
    const c1 = await service.generateCredentials('a', 'ns');
    const c2 = await service.generateCredentials('b', 'ns');
    expect(c1.password).not.toBe(c2.password);
  });

  it('includes topology routes in permissions', async () => {
    const creds = await service.generateCredentials('arch', 'team', ['dev-0', 'dev-1']);
    expect(creds.permissions.publish).toContain('cell.team.dev-0.inbox');
    expect(creds.permissions.publish).toContain('cell.team.dev-1.inbox');
  });

  it('retrieves credentials for a cell', async () => {
    await service.generateCredentials('foo', 'ns');
    const creds = await service.getCredentials('foo');
    expect(creds).not.toBeNull();
    expect(creds!.cellId).toBe('foo');
  });

  it('returns null for nonexistent cell', async () => {
    const creds = await service.getCredentials('nonexistent');
    expect(creds).toBeNull();
  });

  it('revokes credentials', async () => {
    await service.generateCredentials('cell-a', 'ns');
    await service.revokeCredentials('cell-a');
    const creds = await service.getCredentials('cell-a');
    expect(creds).toBeNull();
  });

  it('validates allowed publish access', async () => {
    await service.generateCredentials('w0', 'default');
    const allowed = await service.validateAccess('w0', 'cell.default.w0.outbox', 'publish');
    expect(allowed).toBe(true);
  });

  it('rejects unauthorized publish access', async () => {
    await service.generateCredentials('w0', 'default');
    const allowed = await service.validateAccess('w0', 'cell.default.other.inbox', 'publish');
    expect(allowed).toBe(false);
  });

  it('validates allowed subscribe access', async () => {
    await service.generateCredentials('w0', 'default');
    const allowed = await service.validateAccess('w0', 'cell.default.w0.inbox', 'subscribe');
    expect(allowed).toBe(true);
  });

  it('rejects unauthorized subscribe access', async () => {
    await service.generateCredentials('w0', 'default');
    const allowed = await service.validateAccess('w0', 'cell.default.other.inbox', 'subscribe');
    expect(allowed).toBe(false);
  });

  it('validates access with topology routes', async () => {
    await service.generateCredentials('arch', 'ns', ['worker-0']);
    const allowed = await service.validateAccess('arch', 'cell.ns.worker-0.inbox', 'publish');
    expect(allowed).toBe(true);
  });

  it('returns false for revoked credentials', async () => {
    await service.generateCredentials('cell-x', 'ns');
    await service.revokeCredentials('cell-x');
    const allowed = await service.validateAccess('cell-x', 'cell.ns.cell-x.inbox', 'subscribe');
    expect(allowed).toBe(false);
  });

  it('lists active credentials', async () => {
    await service.generateCredentials('a', 'ns');
    await service.generateCredentials('b', 'ns');
    await service.generateCredentials('c', 'ns');
    await service.revokeCredentials('b');

    const active = await service.listActive();
    const cellIds = active.map(c => c.cellId);
    expect(cellIds).toContain('a');
    expect(cellIds).toContain('c');
    expect(cellIds).not.toContain('b');
  });

  it('regenerating credentials revokes old ones', async () => {
    const first = await service.generateCredentials('foo', 'ns');
    const second = await service.generateCredentials('foo', 'ns');
    expect(second.password).not.toBe(first.password);
    // Only the latest should be active
    const creds = await service.getCredentials('foo');
    expect(creds!.password).toBe(second.password);
  });
});
