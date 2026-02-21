/**
 * BudgetLedger — append-only budget tracking for recursive Cell ecosystems.
 *
 * Each Cell has a balance: allocated (by parent) - spent (LLM calls) - delegated (to children).
 * All mutations are recorded in the budget_ledger table for auditability.
 */
import type { BudgetBalance, BudgetLedgerEntry, BudgetOperation } from '@kais/core';

import type { DbClient } from './clients.js';

export interface BudgetLedgerService {
  /** Initialize a root Cell's budget (no parent). */
  initRoot(cellId: string, amount: number): Promise<void>;
  /** Parent allocates budget to a child. */
  allocate(fromCellId: string, toCellId: string, amount: number, reason?: string): Promise<void>;
  /** Cell spends budget (e.g., LLM call). */
  spend(cellId: string, amount: number, reason?: string): Promise<void>;
  /** Reclaim unspent budget from a child back to parent. Returns reclaimed amount. */
  reclaim(childCellId: string, parentCellId: string, reason?: string): Promise<number>;
  /** Parent tops up a child's budget. */
  topUp(fromCellId: string, toCellId: string, amount: number, reason?: string): Promise<void>;
  /** Get current balance for a Cell. */
  getBalance(cellId: string): Promise<BudgetBalance | null>;
  /** Get budget tree starting from root. */
  getTree(rootCellId: string): Promise<BudgetTreeNode[]>;
  /** Get ledger history for a Cell. */
  getHistory(cellId: string, limit?: number): Promise<BudgetLedgerEntry[]>;
}

export interface BudgetTreeNode {
  cellId: string;
  balance: BudgetBalance;
  children: BudgetTreeNode[];
}

export function createBudgetLedger(db: DbClient): BudgetLedgerService {
  async function getBalance(cellId: string): Promise<BudgetBalance | null> {
    const result = await db.query(
      'SELECT cell_id, allocated, spent, delegated FROM budget_balances WHERE cell_id = $1',
      [cellId],
    );
    const row = result.rows[0] as
      | { cell_id: string; allocated: string; spent: string; delegated: string }
      | undefined;
    if (!row) return null;
    const allocated = parseFloat(row.allocated);
    const spent = parseFloat(row.spent);
    const delegated = parseFloat(row.delegated);
    return {
      cellId: row.cell_id,
      allocated,
      spent,
      delegated,
      available: allocated - spent - delegated,
    };
  }

  async function recordEntry(
    cellId: string,
    operation: BudgetOperation,
    amount: number,
    balanceAfter: number,
    opts?: { fromCellId?: string; toCellId?: string; reason?: string },
  ): Promise<void> {
    await db.query(
      `INSERT INTO budget_ledger (cell_id, operation, amount, from_cell_id, to_cell_id, balance_after, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [cellId, operation, amount, opts?.fromCellId ?? null, opts?.toCellId ?? null, balanceAfter, opts?.reason ?? null],
    );
  }

  async function ensureBalance(cellId: string): Promise<void> {
    await db.query(
      `INSERT INTO budget_balances (cell_id, allocated, spent, delegated)
       VALUES ($1, 0, 0, 0)
       ON CONFLICT (cell_id) DO NOTHING`,
      [cellId],
    );
  }

  return {
    async initRoot(cellId: string, amount: number): Promise<void> {
      await ensureBalance(cellId);
      await db.query(
        'UPDATE budget_balances SET allocated = $2, updated_at = now() WHERE cell_id = $1',
        [cellId, amount],
      );
      await recordEntry(cellId, 'allocate', amount, amount, {
        reason: 'Root budget initialization',
      });
    },

    async allocate(fromCellId: string, toCellId: string, amount: number, reason?: string): Promise<void> {
      if (amount <= 0) throw new Error('Allocation amount must be positive');

      const parentBalance = await getBalance(fromCellId);
      if (!parentBalance) throw new Error(`Cell ${fromCellId} has no budget record`);
      if (amount > parentBalance.available) {
        throw new Error(
          `Insufficient budget: ${fromCellId} has $${parentBalance.available.toFixed(4)} available, requested $${amount.toFixed(4)}`,
        );
      }

      // Update parent: increase delegated
      await db.query(
        'UPDATE budget_balances SET delegated = delegated + $2, updated_at = now() WHERE cell_id = $1',
        [fromCellId, amount],
      );

      // Create/update child balance: increase allocated
      await ensureBalance(toCellId);
      await db.query(
        'UPDATE budget_balances SET allocated = allocated + $2, updated_at = now() WHERE cell_id = $1',
        [toCellId, amount],
      );

      // Record ledger entries
      const newParentBalance = await getBalance(fromCellId);
      await recordEntry(fromCellId, 'allocate', amount, newParentBalance!.available, {
        fromCellId,
        toCellId,
        reason: reason ?? `Allocate to ${toCellId}`,
      });

      const newChildBalance = await getBalance(toCellId);
      await recordEntry(toCellId, 'allocate', amount, newChildBalance!.available, {
        fromCellId,
        toCellId,
        reason: reason ?? `Received from ${fromCellId}`,
      });
    },

    async spend(cellId: string, amount: number, reason?: string): Promise<void> {
      if (amount <= 0) throw new Error('Spend amount must be positive');

      const balance = await getBalance(cellId);
      if (!balance) throw new Error(`Cell ${cellId} has no budget record`);
      if (amount > balance.available) {
        throw new Error(
          `Budget exhausted: ${cellId} has $${balance.available.toFixed(4)} available, tried to spend $${amount.toFixed(4)}`,
        );
      }

      await db.query(
        'UPDATE budget_balances SET spent = spent + $2, updated_at = now() WHERE cell_id = $1',
        [cellId, amount],
      );

      const newBalance = await getBalance(cellId);
      await recordEntry(cellId, 'spend', amount, newBalance!.available, { reason });
    },

    async reclaim(childCellId: string, parentCellId: string, reason?: string): Promise<number> {
      const childBalance = await getBalance(childCellId);
      if (!childBalance) return 0;

      const reclaimable = childBalance.available;
      if (reclaimable <= 0) return 0;

      // Reduce child's allocated
      await db.query(
        'UPDATE budget_balances SET allocated = allocated - $2, updated_at = now() WHERE cell_id = $1',
        [childCellId, reclaimable],
      );

      // Reduce parent's delegated
      await db.query(
        'UPDATE budget_balances SET delegated = delegated - $2, updated_at = now() WHERE cell_id = $1',
        [parentCellId, reclaimable],
      );

      // Record entries
      await recordEntry(childCellId, 'reclaim', reclaimable, 0, {
        fromCellId: childCellId,
        toCellId: parentCellId,
        reason: reason ?? `Reclaimed by ${parentCellId}`,
      });

      const newParentBalance = await getBalance(parentCellId);
      await recordEntry(parentCellId, 'reclaim', reclaimable, newParentBalance!.available, {
        fromCellId: childCellId,
        toCellId: parentCellId,
        reason: reason ?? `Reclaimed from ${childCellId}`,
      });

      return reclaimable;
    },

    async topUp(fromCellId: string, toCellId: string, amount: number, reason?: string): Promise<void> {
      if (amount <= 0) throw new Error('Top-up amount must be positive');

      const parentBalance = await getBalance(fromCellId);
      if (!parentBalance) throw new Error(`Cell ${fromCellId} has no budget record`);
      if (amount > parentBalance.available) {
        throw new Error(
          `Insufficient budget for top-up: ${fromCellId} has $${parentBalance.available.toFixed(4)} available`,
        );
      }

      // Increase parent's delegated
      await db.query(
        'UPDATE budget_balances SET delegated = delegated + $2, updated_at = now() WHERE cell_id = $1',
        [fromCellId, amount],
      );

      // Increase child's allocated
      await db.query(
        'UPDATE budget_balances SET allocated = allocated + $2, updated_at = now() WHERE cell_id = $1',
        [toCellId, amount],
      );

      const newParentBalance = await getBalance(fromCellId);
      await recordEntry(fromCellId, 'top_up', amount, newParentBalance!.available, {
        fromCellId,
        toCellId,
        reason: reason ?? `Top-up to ${toCellId}`,
      });

      const newChildBalance = await getBalance(toCellId);
      await recordEntry(toCellId, 'top_up', amount, newChildBalance!.available, {
        fromCellId,
        toCellId,
        reason: reason ?? `Top-up from ${fromCellId}`,
      });
    },

    getBalance,

    async getTree(rootCellId: string): Promise<BudgetTreeNode[]> {
      // Get all cells in the tree via cell_tree table
      const result = await db.query(
        `SELECT ct.cell_id, ct.parent_id, bb.allocated, bb.spent, bb.delegated
         FROM cell_tree ct
         LEFT JOIN budget_balances bb ON ct.cell_id = bb.cell_id
         WHERE ct.root_id = $1
         ORDER BY ct.depth ASC, ct.cell_id ASC`,
        [rootCellId],
      );

      const nodeMap = new Map<string, BudgetTreeNode>();
      const roots: BudgetTreeNode[] = [];

      for (const row of result.rows as Array<{
        cell_id: string;
        parent_id: string | null;
        allocated: string | null;
        spent: string | null;
        delegated: string | null;
      }>) {
        const allocated = parseFloat(row.allocated ?? '0');
        const spent = parseFloat(row.spent ?? '0');
        const delegated = parseFloat(row.delegated ?? '0');
        const node: BudgetTreeNode = {
          cellId: row.cell_id,
          balance: {
            cellId: row.cell_id,
            allocated,
            spent,
            delegated,
            available: allocated - spent - delegated,
          },
          children: [],
        };
        nodeMap.set(row.cell_id, node);

        if (row.parent_id && nodeMap.has(row.parent_id)) {
          nodeMap.get(row.parent_id)!.children.push(node);
        } else {
          roots.push(node);
        }
      }

      return roots;
    },

    async getHistory(cellId: string, limit = 50): Promise<BudgetLedgerEntry[]> {
      const result = await db.query(
        `SELECT id, cell_id, operation, amount, from_cell_id, to_cell_id, balance_after, reason, created_at
         FROM budget_ledger WHERE cell_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [cellId, limit],
      );
      return result.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: Number(r.id),
          cellId: r.cell_id as string,
          operation: r.operation as BudgetLedgerEntry['operation'],
          amount: parseFloat(r.amount as string),
          fromCellId: r.from_cell_id as string | undefined,
          toCellId: r.to_cell_id as string | undefined,
          balanceAfter: parseFloat(r.balance_after as string),
          reason: r.reason as string | undefined,
          createdAt: (r.created_at as Date).toISOString(),
        };
      });
    },
  };
}
