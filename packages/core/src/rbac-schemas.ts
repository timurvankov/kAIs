import { z } from 'zod';

// --- RBAC Rule ---

export const RbacVerbSchema = z.enum([
  'get',
  'list',
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'use',
  'allocate',
  'view',
  'add',
  'invalidate',
  'promote',
]);

export const RbacResourceSchema = z.enum([
  'cells',
  'formations',
  'missions',
  'experiments',
  'evolutions',
  'blueprints',
  'knowledge',
  'spawn-requests',
  'budgets',
  'dashboard',
  'roles',
  'instincts',
  'rituals',
  'swarms',
  'channels',
]);

export const RbacRuleSchema = z.object({
  resources: z.array(RbacResourceSchema).min(1),
  verbs: z.array(RbacVerbSchema).min(1),
  /** Maximum budget this rule allows allocating (only relevant for budget verbs). */
  maxAllocation: z.number().positive().optional(),
});

// --- Role ---

export const RoleSpecSchema = z.object({
  rules: z.array(RbacRuleSchema).min(1),
});

export const RoleSchema = z.object({
  name: z.string().min(1),
  /** Namespace scope. null/undefined = cluster-wide role. */
  namespace: z.string().min(1).optional(),
  spec: RoleSpecSchema,
});

// --- RoleBinding ---

export const RoleBindingSchema = z.object({
  userName: z.string().min(1),
  roleName: z.string().min(1),
  /** Namespace scope. null/undefined = inherits from Role. */
  namespace: z.string().min(1).optional(),
});

// --- AuthUser ---

export const AuthUserSchema = z.object({
  name: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
});

// --- Auth config ---

export const StaticTokenEntrySchema = z.object({
  name: z.string().min(1),
  token: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
});

export const AuthConfigSchema = z.object({
  method: z.enum(['token', 'oidc']),
  /** Static tokens for token-based auth. */
  tokens: z.array(StaticTokenEntrySchema).optional(),
  /** OIDC config (Phase 8 keeps this as a placeholder). */
  issuer: z.string().url().optional(),
  clientId: z.string().optional(),
  roleMapping: z.record(z.string(), z.array(z.string())).optional(),
});

// --- RBAC check request/result ---

export const RbacCheckRequestSchema = z.object({
  user: AuthUserSchema,
  resource: RbacResourceSchema,
  verb: RbacVerbSchema,
  namespace: z.string().min(1).optional(),
});

export const RbacCheckResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
});
