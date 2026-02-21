import { describe, it, expect, beforeEach } from 'vitest';
import type { DbClient, DbQueryResult } from '../clients.js';
import { createSpawnRequestService, type SpawnRequestService } from '../spawn-request.js';

/**
 * In-memory mock for spawn_requests table.
 * Uses a command-tracking approach instead of fragile SQL text matching.
 */
function createMockDb(): DbClient {
  const requests: Array<Record<string, unknown>> = [];
  let nextId = 1;

  return {
    async query(text: string, params?: unknown[]): Promise<DbQueryResult> {
      const trimmed = text.replace(/\s+/g, ' ').trim();

      // INSERT
      if (trimmed.startsWith('INSERT INTO spawn_requests')) {
        const entry: Record<string, unknown> = {
          id: nextId++,
          name: params![0],
          namespace: params![1],
          requestor_cell_id: params![2],
          requested_spec: JSON.parse(params![3] as string),
          reason: params![4],
          status: 'Pending',
          decided_by: null,
          decided_at: null,
          rejection_reason: null,
          created_at: new Date(),
        };
        requests.push(entry);
        return { rows: [{ ...entry }] };
      }

      // UPDATE ... Approved
      if (trimmed.startsWith('UPDATE spawn_requests') && trimmed.includes("'Approved'")) {
        const id = params![0] as number;
        const decidedBy = params![1] as string;
        const req = requests.find(r => r.id === id && r.status === 'Pending');
        if (!req) return { rows: [] };
        req.status = 'Approved';
        req.decided_by = decidedBy;
        req.decided_at = new Date();
        return { rows: [{ ...req }] };
      }

      // UPDATE ... Rejected
      if (trimmed.startsWith('UPDATE spawn_requests') && trimmed.includes("'Rejected'")) {
        const id = params![0] as number;
        const decidedBy = params![1] as string;
        const reason = params![2] as string | null;
        const req = requests.find(r => r.id === id && r.status === 'Pending');
        if (!req) return { rows: [] };
        req.status = 'Rejected';
        req.decided_by = decidedBy;
        req.decided_at = new Date();
        req.rejection_reason = reason;
        return { rows: [{ ...req }] };
      }

      // SELECT by id
      if (trimmed.startsWith('SELECT') && trimmed.includes('WHERE id =')) {
        const id = params![0] as number;
        const req = requests.find(r => r.id === id);
        if (!req) return { rows: [] };
        return { rows: [{ ...req }] };
      }

      // SELECT list (with optional filters)
      if (trimmed.startsWith('SELECT') && trimmed.includes('FROM spawn_requests')) {
        let filtered = requests.map(r => ({ ...r }));

        // Check which filters are present by counting params
        // The last param is always limit. Preceding params are filters.
        const lastParamIdx = params!.length - 1;
        const limit = params![lastParamIdx] as number;
        let filterIdx = 0;

        if (trimmed.includes('status =')) {
          const statusVal = params![filterIdx++];
          filtered = filtered.filter(r => r.status === statusVal);
        }
        if (trimmed.includes('namespace =') && trimmed.includes('WHERE')) {
          const nsVal = params![filterIdx++];
          filtered = filtered.filter(r => r.namespace === nsVal);
        }

        return { rows: filtered.slice(0, limit) };
      }

      return { rows: [] };
    },
  };
}

describe('SpawnRequestService', () => {
  let db: DbClient;
  let service: SpawnRequestService;

  beforeEach(() => {
    db = createMockDb();
    service = createSpawnRequestService(db);
  });

  describe('create', () => {
    it('should create a pending spawn request', async () => {
      const req = await service.create({
        name: 'security-auditor',
        namespace: 'project-x',
        requestorCellId: 'architect-0',
        requestedSpec: {
          name: 'security-auditor',
          systemPrompt: 'Audit all code for security vulnerabilities',
          model: 'claude-sonnet-4-20250514',
          budget: 15,
          canSpawnChildren: false,
        },
        reason: 'Need dedicated security review',
      });

      expect(req.id).toBe(1);
      expect(req.status).toBe('Pending');
      expect(req.requestorCellId).toBe('architect-0');
      expect(req.requestedSpec.name).toBe('security-auditor');
      expect(req.requestedSpec.budget).toBe(15);
    });
  });

  describe('approve', () => {
    it('should approve a pending request', async () => {
      await service.create({
        name: 'test-cell',
        namespace: 'default',
        requestorCellId: 'parent',
        requestedSpec: { name: 'test-cell', systemPrompt: 'test' },
      });

      const approved = await service.approve(1, 'admin');
      expect(approved.status).toBe('Approved');
      expect(approved.decidedBy).toBe('admin');
      expect(approved.decidedAt).toBeDefined();
    });

    it('should throw when approving non-pending request', async () => {
      await service.create({
        name: 'test',
        namespace: 'default',
        requestorCellId: 'parent',
        requestedSpec: { name: 'test', systemPrompt: 'test' },
      });
      await service.approve(1, 'admin');

      // Try to approve again
      await expect(service.approve(1, 'admin')).rejects.toThrow('not in Pending');
    });

    it('should throw for non-existent request', async () => {
      await expect(service.approve(999, 'admin')).rejects.toThrow('not found');
    });
  });

  describe('reject', () => {
    it('should reject a pending request with reason', async () => {
      await service.create({
        name: 'test',
        namespace: 'default',
        requestorCellId: 'parent',
        requestedSpec: { name: 'test', systemPrompt: 'test' },
      });

      const rejected = await service.reject(1, 'admin', 'Use existing reviewer instead');
      expect(rejected.status).toBe('Rejected');
      expect(rejected.decidedBy).toBe('admin');
      expect(rejected.rejectionReason).toBe('Use existing reviewer instead');
    });
  });

  describe('get', () => {
    it('should return null for non-existent request', async () => {
      const req = await service.get(999);
      expect(req).toBeNull();
    });

    it('should return the request by ID', async () => {
      await service.create({
        name: 'cell-1',
        namespace: 'default',
        requestorCellId: 'parent',
        requestedSpec: { name: 'cell-1', systemPrompt: 'prompt' },
      });

      const req = await service.get(1);
      expect(req).not.toBeNull();
      expect(req!.name).toBe('cell-1');
    });
  });

  describe('list', () => {
    it('should list all requests', async () => {
      await service.create({
        name: 'a',
        namespace: 'default',
        requestorCellId: 'parent',
        requestedSpec: { name: 'a', systemPrompt: 'a' },
      });
      await service.create({
        name: 'b',
        namespace: 'project-x',
        requestorCellId: 'parent',
        requestedSpec: { name: 'b', systemPrompt: 'b' },
      });

      const all = await service.list();
      expect(all).toHaveLength(2);
    });

    it('should filter by status', async () => {
      await service.create({
        name: 'a',
        namespace: 'default',
        requestorCellId: 'parent',
        requestedSpec: { name: 'a', systemPrompt: 'a' },
      });
      await service.create({
        name: 'b',
        namespace: 'default',
        requestorCellId: 'parent',
        requestedSpec: { name: 'b', systemPrompt: 'b' },
      });
      await service.approve(1, 'admin');

      const pending = await service.list({ status: 'Pending' });
      expect(pending).toHaveLength(1);
      expect(pending[0]!.name).toBe('b');
    });

    it('should filter by namespace', async () => {
      await service.create({
        name: 'a',
        namespace: 'ns-1',
        requestorCellId: 'parent',
        requestedSpec: { name: 'a', systemPrompt: 'a' },
      });
      await service.create({
        name: 'b',
        namespace: 'ns-2',
        requestorCellId: 'parent',
        requestedSpec: { name: 'b', systemPrompt: 'b' },
      });

      const ns1 = await service.list({ namespace: 'ns-1' });
      expect(ns1).toHaveLength(1);
      expect(ns1[0]!.namespace).toBe('ns-1');
    });
  });
});
