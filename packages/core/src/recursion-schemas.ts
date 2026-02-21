import { z } from 'zod';

// --- Spawn Policy ---

export const SpawnPolicySchema = z.enum([
  'open',
  'approval_required',
  'blueprint_only',
  'disabled',
]);

// --- Recursion Spec (added to Cell CRD) ---

export const RecursionSpecSchema = z.object({
  maxDepth: z.number().int().positive().default(5),
  maxDescendants: z.number().int().positive().default(50),
  spawnPolicy: SpawnPolicySchema.default('open'),
});

// --- Budget Operations ---

export const BudgetOperationSchema = z.enum([
  'allocate',
  'spend',
  'reclaim',
  'top_up',
]);

export const BudgetLedgerEntrySchema = z.object({
  id: z.number().int(),
  cellId: z.string(),
  operation: BudgetOperationSchema,
  amount: z.number(),
  fromCellId: z.string().optional(),
  toCellId: z.string().optional(),
  balanceAfter: z.number(),
  reason: z.string().optional(),
  createdAt: z.string(),
});

export const BudgetBalanceSchema = z.object({
  cellId: z.string(),
  allocated: z.number(),
  spent: z.number(),
  delegated: z.number(),
  available: z.number(),
});

// --- Cell Tree ---

export const CellTreeNodeSchema = z.object({
  cellId: z.string(),
  parentId: z.string().nullable(),
  rootId: z.string(),
  depth: z.number().int().nonnegative(),
  path: z.string(),
  descendantCount: z.number().int().nonnegative(),
  namespace: z.string(),
});

// --- Spawn Request ---

export const SpawnRequestPhaseSchema = z.enum(['Pending', 'Approved', 'Rejected']);

export const RequestedCellSpecSchema = z.object({
  name: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: z.string().optional(),
  provider: z.enum(['anthropic', 'openai', 'ollama']).optional(),
  tools: z.array(z.string()).optional(),
  budget: z.number().positive().optional(),
  canSpawnChildren: z.boolean().optional(),
  maxDepth: z.number().int().positive().optional(),
});

export const SpawnRequestSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  namespace: z.string(),
  requestorCellId: z.string(),
  requestedSpec: RequestedCellSpecSchema,
  reason: z.string().optional(),
  status: SpawnRequestPhaseSchema,
  decidedBy: z.string().optional(),
  decidedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  createdAt: z.string(),
});

// --- Spawn Validation ---

export const SpawnValidationResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  pending: z.boolean().optional(),
});
