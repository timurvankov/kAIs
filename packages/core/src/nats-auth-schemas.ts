import { z } from 'zod';

// --- NATS Permission ---

export const NatsPermissionSchema = z.object({
  /** NATS subjects this Cell can publish to. */
  publish: z.array(z.string()),
  /** NATS subjects this Cell can subscribe to. */
  subscribe: z.array(z.string()),
});

// --- NATS Credentials ---

export const NatsCredentialsSchema = z.object({
  cellId: z.string(),
  namespace: z.string(),
  /** NATS username (cell-scoped). */
  username: z.string(),
  /** NATS password (generated). */
  password: z.string(),
  /** Allowed pub/sub subjects. */
  permissions: NatsPermissionSchema,
  createdAt: z.string(),
  revokedAt: z.string().optional(),
});

// --- Audit Log ---

export const AuditActionSchema = z.enum([
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'allocate',
  'spend',
  'reclaim',
  'top_up',
  'login',
  'spawn',
  'exec',
  'attach',
]);

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  /** ISO timestamp. */
  timestamp: z.string(),
  /** Who performed the action (user name or cell ID). */
  actor: z.string(),
  /** What action was performed. */
  action: AuditActionSchema,
  /** What resource type was affected. */
  resourceType: z.string(),
  /** Which specific resource (name or ID). */
  resourceId: z.string().optional(),
  /** Namespace scope. */
  namespace: z.string(),
  /** Additional details (request body, result, etc.). */
  detail: z.record(z.unknown()).optional(),
  /** Outcome: success or failure. */
  outcome: z.enum(['success', 'failure']),
  /** HTTP status code if from API. */
  statusCode: z.number().int().optional(),
});
