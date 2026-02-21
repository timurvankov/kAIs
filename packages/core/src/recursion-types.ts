import type { z } from 'zod';

import type {
  BudgetBalanceSchema,
  BudgetLedgerEntrySchema,
  BudgetOperationSchema,
  CellTreeNodeSchema,
  RecursionSpecSchema,
  RequestedCellSpecSchema,
  SpawnPolicySchema,
  SpawnRequestPhaseSchema,
  SpawnRequestSchema,
  SpawnValidationResultSchema,
} from './recursion-schemas.js';

export type SpawnPolicy = z.infer<typeof SpawnPolicySchema>;
export type RecursionSpec = z.infer<typeof RecursionSpecSchema>;
export type BudgetOperation = z.infer<typeof BudgetOperationSchema>;
export type BudgetLedgerEntry = z.infer<typeof BudgetLedgerEntrySchema>;
export type BudgetBalance = z.infer<typeof BudgetBalanceSchema>;
export type CellTreeNode = z.infer<typeof CellTreeNodeSchema>;
export type SpawnRequestPhase = z.infer<typeof SpawnRequestPhaseSchema>;
export type RequestedCellSpec = z.infer<typeof RequestedCellSpecSchema>;
export type SpawnRequest = z.infer<typeof SpawnRequestSchema>;
export type SpawnValidationResult = z.infer<typeof SpawnValidationResultSchema>;
