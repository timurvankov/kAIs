/**
 * SpawnRequest service — approval workflow for Cell spawning.
 *
 * When a Cell has spawnPolicy: approval_required, spawn requests
 * are queued here for human (or automated) approval.
 */
import type { RequestedCellSpec, SpawnRequest, SpawnRequestPhase } from '@kais/core';

import type { DbClient } from './clients.js';

export interface SpawnRequestService {
  /** Create a new spawn request. */
  create(opts: {
    name: string;
    namespace: string;
    requestorCellId: string;
    requestedSpec: RequestedCellSpec;
    reason?: string;
  }): Promise<SpawnRequest>;
  /** Approve a spawn request. */
  approve(id: number, decidedBy: string): Promise<SpawnRequest>;
  /** Reject a spawn request. */
  reject(id: number, decidedBy: string, reason?: string): Promise<SpawnRequest>;
  /** Get a single spawn request by ID. */
  get(id: number): Promise<SpawnRequest | null>;
  /** List spawn requests with optional filters. */
  list(opts?: { status?: SpawnRequestPhase; namespace?: string; limit?: number }): Promise<SpawnRequest[]>;
}

function rowToSpawnRequest(row: Record<string, unknown>): SpawnRequest {
  return {
    id: Number(row.id),
    name: row.name as string,
    namespace: row.namespace as string,
    requestorCellId: row.requestor_cell_id as string,
    requestedSpec: row.requested_spec as RequestedCellSpec,
    reason: row.reason as string | undefined,
    status: row.status as SpawnRequestPhase,
    decidedBy: row.decided_by as string | undefined,
    decidedAt: row.decided_at ? (row.decided_at as Date).toISOString() : undefined,
    rejectionReason: row.rejection_reason as string | undefined,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export function createSpawnRequestService(db: DbClient): SpawnRequestService {
  return {
    async create(opts): Promise<SpawnRequest> {
      const result = await db.query(
        `INSERT INTO spawn_requests (name, namespace, requestor_cell_id, requested_spec, reason)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [opts.name, opts.namespace, opts.requestorCellId, JSON.stringify(opts.requestedSpec), opts.reason ?? null],
      );
      return rowToSpawnRequest(result.rows[0]!);
    },

    async approve(id: number, decidedBy: string): Promise<SpawnRequest> {
      const result = await db.query(
        `UPDATE spawn_requests
         SET status = 'Approved', decided_by = $2, decided_at = now()
         WHERE id = $1 AND status = 'Pending'
         RETURNING *`,
        [id, decidedBy],
      );
      if (result.rows.length === 0) {
        throw new Error(`SpawnRequest ${id} not found or not in Pending state`);
      }
      return rowToSpawnRequest(result.rows[0]!);
    },

    async reject(id: number, decidedBy: string, reason?: string): Promise<SpawnRequest> {
      const result = await db.query(
        `UPDATE spawn_requests
         SET status = 'Rejected', decided_by = $2, decided_at = now(), rejection_reason = $3
         WHERE id = $1 AND status = 'Pending'
         RETURNING *`,
        [id, decidedBy, reason ?? null],
      );
      if (result.rows.length === 0) {
        throw new Error(`SpawnRequest ${id} not found or not in Pending state`);
      }
      return rowToSpawnRequest(result.rows[0]!);
    },

    async get(id: number): Promise<SpawnRequest | null> {
      const result = await db.query(
        'SELECT * FROM spawn_requests WHERE id = $1',
        [id],
      );
      if (result.rows.length === 0) return null;
      return rowToSpawnRequest(result.rows[0]!);
    },

    async list(opts?): Promise<SpawnRequest[]> {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (opts?.status) {
        conditions.push(`status = $${paramIndex++}`);
        params.push(opts.status);
      }
      if (opts?.namespace) {
        conditions.push(`namespace = $${paramIndex++}`);
        params.push(opts.namespace);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = opts?.limit ?? 100;

      const result = await db.query(
        `SELECT * FROM spawn_requests ${where} ORDER BY created_at DESC LIMIT $${paramIndex}`,
        [...params, limit],
      );
      return result.rows.map(r => rowToSpawnRequest(r));
    },
  };
}
