import type { z } from 'zod';

import type {
  AuthConfigSchema,
  AuthUserSchema,
  RbacCheckRequestSchema,
  RbacCheckResultSchema,
  RbacResourceSchema,
  RbacRuleSchema,
  RbacVerbSchema,
  RoleBindingSchema,
  RoleSchema,
  RoleSpecSchema,
  StaticTokenEntrySchema,
} from './rbac-schemas.js';

export type RbacVerb = z.infer<typeof RbacVerbSchema>;
export type RbacResource = z.infer<typeof RbacResourceSchema>;
export type RbacRule = z.infer<typeof RbacRuleSchema>;
export type RoleSpec = z.infer<typeof RoleSpecSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type RoleBinding = z.infer<typeof RoleBindingSchema>;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type StaticTokenEntry = z.infer<typeof StaticTokenEntrySchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type RbacCheckRequest = z.infer<typeof RbacCheckRequestSchema>;
export type RbacCheckResult = z.infer<typeof RbacCheckResultSchema>;
