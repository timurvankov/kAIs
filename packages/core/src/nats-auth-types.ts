import type { z } from 'zod';

import type {
  AuditActionSchema,
  AuditEntrySchema,
  NatsCredentialsSchema,
  NatsPermissionSchema,
} from './nats-auth-schemas.js';

export type NatsPermission = z.infer<typeof NatsPermissionSchema>;
export type NatsCredentials = z.infer<typeof NatsCredentialsSchema>;
export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
