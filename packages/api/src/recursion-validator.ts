/**
 * Recursion safety validator — prevents runaway Cell spawning.
 *
 * Validates: depth limit, descendant count, spawn policy, budget, platform limit.
 */
import type { RecursionSpec, SpawnValidationResult } from '@kais/core';

import type { BudgetLedgerService } from './budget-ledger.js';
import type { CellTreeService } from './cell-tree.js';
import type { SpawnRequestService } from './spawn-request.js';

export interface SpawnInput {
  name: string;
  systemPrompt: string;
  budget?: number;
  blueprintRef?: string;
  canSpawnChildren?: boolean;
  maxDepth?: number;
}

export interface RecursionValidatorConfig {
  cellTree: CellTreeService;
  budgetLedger: BudgetLedgerService;
  spawnRequests: SpawnRequestService;
  /** Platform-wide maximum number of Cells. */
  maxTotalCells?: number;
}

export interface RecursionValidator {
  /** Validate whether a spawn is allowed. */
  validateSpawn(
    parentCellId: string,
    namespace: string,
    recursionSpec: RecursionSpec | undefined,
    input: SpawnInput,
  ): Promise<SpawnValidationResult>;
}

export function createRecursionValidator(config: RecursionValidatorConfig): RecursionValidator {
  const { cellTree, budgetLedger, spawnRequests } = config;
  const platformCellLimit = config.maxTotalCells ?? 500;

  return {
    async validateSpawn(
      parentCellId: string,
      namespace: string,
      recursionSpec: RecursionSpec | undefined,
      input: SpawnInput,
    ): Promise<SpawnValidationResult> {
      const maxDepth = recursionSpec?.maxDepth ?? 5;
      const maxDescendants = recursionSpec?.maxDescendants ?? 50;
      const spawnPolicy = recursionSpec?.spawnPolicy ?? 'open';

      // 1. Spawn policy check
      if (spawnPolicy === 'disabled') {
        return { allowed: false, reason: 'Spawning is disabled for this Cell' };
      }

      if (spawnPolicy === 'blueprint_only' && !input.blueprintRef) {
        return { allowed: false, reason: 'Only Blueprint instantiation is allowed for this Cell' };
      }

      if (spawnPolicy === 'approval_required') {
        // Queue for human approval
        await spawnRequests.create({
          name: input.name,
          namespace,
          requestorCellId: parentCellId,
          requestedSpec: {
            name: input.name,
            systemPrompt: input.systemPrompt,
            budget: input.budget,
            canSpawnChildren: input.canSpawnChildren ?? false,
            maxDepth: input.maxDepth,
          },
          reason: `Automatic spawn request from ${parentCellId}`,
        });
        return { allowed: false, reason: 'Spawn request queued for approval', pending: true };
      }

      // 2. Depth check
      const currentDepth = await cellTree.getDepth(parentCellId);
      if (currentDepth >= maxDepth) {
        return {
          allowed: false,
          reason: `Maximum depth ${maxDepth} reached (current depth: ${currentDepth})`,
        };
      }

      // 3. Descendant count check
      const descendants = await cellTree.countDescendants(parentCellId);
      if (descendants >= maxDescendants) {
        return {
          allowed: false,
          reason: `Maximum descendants ${maxDescendants} reached (current: ${descendants})`,
        };
      }

      // 4. Budget check
      if (input.budget !== undefined) {
        const balance = await budgetLedger.getBalance(parentCellId);
        if (balance && input.budget > balance.available) {
          return {
            allowed: false,
            reason: `Insufficient budget: $${balance.available.toFixed(4)} available, requested $${input.budget.toFixed(4)}`,
          };
        }
      }

      // 5. Platform-wide Cell limit
      const treeNodes = await cellTree.getTree(parentCellId);
      // This is an approximation — ideally we'd count all cells across all trees
      // For now, use the root's tree as a proxy
      const node = await cellTree.getNode(parentCellId);
      if (node) {
        const rootTree = await cellTree.getTree(node.rootId);
        if (rootTree.length >= platformCellLimit) {
          return {
            allowed: false,
            reason: `Platform limit of ${platformCellLimit} Cells reached`,
          };
        }
      }

      return { allowed: true };
    },
  };
}
