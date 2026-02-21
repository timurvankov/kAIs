/**
 * Audit Log — append-only event log for compliance and security.
 *
 * Records all significant API operations with who, what, when, where.
 * Entries are immutable — no update or delete operations.
 */
import type { AuditAction, AuditEntry } from '@kais/core';

import type { DbClient } from './clients.js';

export interface AuditLogService {
  /** Record an audit entry (append-only). */
  record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry>;

  /** Query audit log with filters. */
  query(opts?: AuditQueryOptions): Promise<AuditEntry[]>;

  /** Count entries matching filters. */
  count(opts?: Omit<AuditQueryOptions, 'limit' | 'offset'>): Promise<number>;
}

export interface AuditQueryOptions {
  /** Filter by actor (exact match). */
  actor?: string;
  /** Filter by action type. */
  action?: AuditAction;
  /** Filter by resource type. */
  resourceType?: string;
  /** Filter by namespace. */
  namespace?: string;
  /** Filter by outcome. */
  outcome?: 'success' | 'failure';
  /** Start of time range (ISO string). */
  since?: string;
  /** End of time range (ISO string). */
  until?: string;
  /** Max entries to return (default 100, max 1000). */
  limit?: number;
  /** Offset for pagination. */
  offset?: number;
}

function rowToAuditEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: Number(row.id),
    timestamp: (row.timestamp as Date).toISOString(),
    actor: row.actor as string,
    action: row.action as AuditAction,
    resourceType: row.resource_type as string,
    resourceId: row.resource_id as string | undefined,
    namespace: row.namespace as string,
    detail: row.detail as Record<string, unknown> | undefined,
    outcome: row.outcome as 'success' | 'failure',
    statusCode: row.status_code != null ? Number(row.status_code) : undefined,
  };
}

export function createAuditLog(db: DbClient): AuditLogService {
  return {
    async record(entry): Promise<AuditEntry> {
      const result = await db.query(
        `INSERT INTO audit_log (actor, action, resource_type, resource_id, namespace, detail, outcome, status_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          entry.actor,
          entry.action,
          entry.resourceType,
          entry.resourceId ?? null,
          entry.namespace,
          entry.detail ? JSON.stringify(entry.detail) : null,
          entry.outcome,
          entry.statusCode ?? null,
        ],
      );
      return rowToAuditEntry(result.rows[0]!);
    },

    async query(opts?): Promise<AuditEntry[]> {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (opts?.actor) {
        conditions.push(`actor = $${idx++}`);
        params.push(opts.actor);
      }
      if (opts?.action) {
        conditions.push(`action = $${idx++}`);
        params.push(opts.action);
      }
      if (opts?.resourceType) {
        conditions.push(`resource_type = $${idx++}`);
        params.push(opts.resourceType);
      }
      if (opts?.namespace) {
        conditions.push(`namespace = $${idx++}`);
        params.push(opts.namespace);
      }
      if (opts?.outcome) {
        conditions.push(`outcome = $${idx++}`);
        params.push(opts.outcome);
      }
      if (opts?.since) {
        conditions.push(`timestamp >= $${idx++}`);
        params.push(opts.since);
      }
      if (opts?.until) {
        conditions.push(`timestamp <= $${idx++}`);
        params.push(opts.until);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 1000);
      const offset = Math.max(opts?.offset ?? 0, 0);

      const result = await db.query(
        `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT $${idx++} OFFSET $${idx}`,
        [...params, limit, offset],
      );
      return result.rows.map((r) => rowToAuditEntry(r));
    },

    async count(opts?): Promise<number> {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (opts?.actor) {
        conditions.push(`actor = $${idx++}`);
        params.push(opts.actor);
      }
      if (opts?.action) {
        conditions.push(`action = $${idx++}`);
        params.push(opts.action);
      }
      if (opts?.resourceType) {
        conditions.push(`resource_type = $${idx++}`);
        params.push(opts.resourceType);
      }
      if (opts?.namespace) {
        conditions.push(`namespace = $${idx++}`);
        params.push(opts.namespace);
      }
      if (opts?.outcome) {
        conditions.push(`outcome = $${idx++}`);
        params.push(opts.outcome);
      }
      if (opts?.since) {
        conditions.push(`timestamp >= $${idx++}`);
        params.push(opts.since);
      }
      if (opts?.until) {
        conditions.push(`timestamp <= $${idx++}`);
        params.push(opts.until);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await db.query(
        `SELECT COUNT(*) as cnt FROM audit_log ${where}`,
        params,
      );
      return Number((result.rows[0] as Record<string, unknown>)?.cnt ?? 0);
    },
  };
}
