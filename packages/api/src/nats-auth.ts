/**
 * NATS Authorization — per-Cell credential management.
 *
 * Each Cell gets unique NATS credentials with subject restrictions
 * based on its name, namespace, and topology routes.
 *
 * A Cell "foo" in namespace "bar" gets:
 *   subscribe: cell.bar.foo.inbox
 *   publish:   cell.bar.foo.outbox, cell.events.bar.foo
 *   + additional subjects from topology routes
 */
import type { NatsCredentials, NatsPermission } from '@kais/core';

import type { DbClient } from './clients.js';

export interface NatsAuthService {
  /** Generate credentials for a Cell with subject restrictions. */
  generateCredentials(
    cellId: string,
    namespace: string,
    topologyRoutes?: string[],
  ): Promise<NatsCredentials>;

  /** Revoke credentials for a Cell (e.g., on deletion). */
  revokeCredentials(cellId: string): Promise<void>;

  /** Get current credentials for a Cell. */
  getCredentials(cellId: string): Promise<NatsCredentials | null>;

  /** Validate whether a Cell can pub/sub on a given subject. */
  validateAccess(
    cellId: string,
    subject: string,
    operation: 'publish' | 'subscribe',
  ): Promise<boolean>;

  /** List all active credentials (for NATS config generation). */
  listActive(): Promise<NatsCredentials[]>;
}

/**
 * Build the default subject permissions for a Cell.
 *
 * Subscribe:
 *   - cell.{namespace}.{cellId}.inbox  (receive messages)
 *
 * Publish:
 *   - cell.{namespace}.{cellId}.outbox (send responses)
 *   - cell.events.{namespace}.{cellId} (emit events)
 *
 * Plus any topology route targets (publish to peer inboxes).
 */
export function buildCellPermissions(
  cellId: string,
  namespace: string,
  topologyRoutes?: string[],
): NatsPermission {
  const subscribe = [
    `cell.${namespace}.${cellId}.inbox`,
  ];

  const publish = [
    `cell.${namespace}.${cellId}.outbox`,
    `cell.events.${namespace}.${cellId}`,
  ];

  // Topology routes allow publishing to specific peer inboxes
  if (topologyRoutes) {
    for (const target of topologyRoutes) {
      const peerInbox = `cell.${namespace}.${target}.inbox`;
      if (!publish.includes(peerInbox)) {
        publish.push(peerInbox);
      }
    }
  }

  return { publish, subscribe };
}

/**
 * Generate a random password for NATS auth.
 * Uses crypto.getRandomValues for secure random bytes.
 */
function generatePassword(length = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function createNatsAuthService(db: DbClient): NatsAuthService {
  function rowToCredentials(row: Record<string, unknown>): NatsCredentials {
    return {
      cellId: row.cell_id as string,
      namespace: row.namespace as string,
      username: row.username as string,
      password: row.password as string,
      permissions: row.permissions as NatsPermission,
      createdAt: (row.created_at as Date).toISOString(),
      revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : undefined,
    };
  }

  return {
    async generateCredentials(
      cellId: string,
      namespace: string,
      topologyRoutes?: string[],
    ): Promise<NatsCredentials> {
      const username = `cell-${namespace}-${cellId}`;
      const password = generatePassword();
      const permissions = buildCellPermissions(cellId, namespace, topologyRoutes);

      // Revoke any existing active credentials for this cell
      await db.query(
        `UPDATE nats_credentials SET revoked_at = now() WHERE cell_id = $1 AND revoked_at IS NULL`,
        [cellId],
      );

      const result = await db.query(
        `INSERT INTO nats_credentials (cell_id, namespace, username, password, permissions)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [cellId, namespace, username, password, JSON.stringify(permissions)],
      );

      return rowToCredentials(result.rows[0]!);
    },

    async revokeCredentials(cellId: string): Promise<void> {
      await db.query(
        `UPDATE nats_credentials SET revoked_at = now() WHERE cell_id = $1 AND revoked_at IS NULL`,
        [cellId],
      );
    },

    async getCredentials(cellId: string): Promise<NatsCredentials | null> {
      const result = await db.query(
        `SELECT * FROM nats_credentials WHERE cell_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [cellId],
      );
      if (result.rows.length === 0) return null;
      return rowToCredentials(result.rows[0]!);
    },

    async validateAccess(
      cellId: string,
      subject: string,
      operation: 'publish' | 'subscribe',
    ): Promise<boolean> {
      const creds = await this.getCredentials(cellId);
      if (!creds) return false;

      const allowed = operation === 'publish'
        ? creds.permissions.publish
        : creds.permissions.subscribe;

      return allowed.some((pattern) => matchSubject(pattern, subject));
    },

    async listActive(): Promise<NatsCredentials[]> {
      const result = await db.query(
        `SELECT * FROM nats_credentials WHERE revoked_at IS NULL ORDER BY created_at DESC`,
        [],
      );
      return result.rows.map((r) => rowToCredentials(r));
    },
  };
}

/**
 * Match a NATS subject pattern against a concrete subject.
 * Supports '*' (single token) and '>' (multi-token tail) wildcards.
 */
export function matchSubject(pattern: string, subject: string): boolean {
  const patternParts = pattern.split('.');
  const subjectParts = subject.split('.');

  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]!;

    if (p === '>') {
      // '>' matches one or more remaining tokens
      return i < subjectParts.length;
    }

    if (i >= subjectParts.length) return false;

    if (p === '*') {
      // '*' matches exactly one token
      continue;
    }

    if (p !== subjectParts[i]) return false;
  }

  return patternParts.length === subjectParts.length;
}
