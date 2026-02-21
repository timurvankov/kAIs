import { describe, it, expect, beforeEach } from 'vitest';
import type { DbClient, DbQueryResult } from '../clients.js';
import { createBudgetLedger, type BudgetLedgerService } from '../budget-ledger.js';

/**
 * In-memory Postgres mock for budget tables.
 * Simulates budget_balances and budget_ledger tables.
 */
function createMockDb(): DbClient & { balances: Map<string, { allocated: number; spent: number; delegated: number }> } {
  const balances = new Map<string, { allocated: number; spent: number; delegated: number }>();
  const ledgerEntries: Array<Record<string, unknown>> = [];
  let ledgerId = 1;

  return {
    balances,
    async query(text: string, params?: unknown[]): Promise<DbQueryResult> {
      // INSERT INTO budget_balances ... ON CONFLICT DO NOTHING
      if (text.includes('INSERT INTO budget_balances') && text.includes('ON CONFLICT')) {
        const cellId = params![0] as string;
        if (!balances.has(cellId)) {
          balances.set(cellId, { allocated: 0, spent: 0, delegated: 0 });
        }
        return { rows: [] };
      }

      // UPDATE budget_balances SET allocated = $2
      if (text.includes('UPDATE budget_balances SET allocated =') && !text.includes('+') && !text.includes('-')) {
        const cellId = params![0] as string;
        const value = params![1] as number;
        const b = balances.get(cellId);
        if (b) b.allocated = value;
        return { rows: [] };
      }

      // UPDATE budget_balances SET allocated = allocated + $2
      if (text.includes('SET allocated = allocated + $2')) {
        const cellId = params![0] as string;
        const amount = params![1] as number;
        const b = balances.get(cellId);
        if (b) b.allocated += amount;
        return { rows: [] };
      }

      // UPDATE budget_balances SET allocated = allocated - $2
      if (text.includes('SET allocated = allocated - $2')) {
        const cellId = params![0] as string;
        const amount = params![1] as number;
        const b = balances.get(cellId);
        if (b) b.allocated -= amount;
        return { rows: [] };
      }

      // UPDATE budget_balances SET delegated = delegated + $2
      if (text.includes('SET delegated = delegated + $2')) {
        const cellId = params![0] as string;
        const amount = params![1] as number;
        const b = balances.get(cellId);
        if (b) b.delegated += amount;
        return { rows: [] };
      }

      // UPDATE budget_balances SET delegated = delegated - $2
      if (text.includes('SET delegated = delegated - $2')) {
        const cellId = params![0] as string;
        const amount = params![1] as number;
        const b = balances.get(cellId);
        if (b) b.delegated -= amount;
        return { rows: [] };
      }

      // UPDATE budget_balances SET spent = spent + $2
      if (text.includes('SET spent = spent + $2')) {
        const cellId = params![0] as string;
        const amount = params![1] as number;
        const b = balances.get(cellId);
        if (b) b.spent += amount;
        return { rows: [] };
      }

      // SELECT ... FROM budget_balances WHERE cell_id = $1
      if (text.includes('FROM budget_balances WHERE cell_id')) {
        const cellId = params![0] as string;
        const b = balances.get(cellId);
        if (!b) return { rows: [] };
        return {
          rows: [{
            cell_id: cellId,
            allocated: String(b.allocated),
            spent: String(b.spent),
            delegated: String(b.delegated),
          }],
        };
      }

      // INSERT INTO budget_ledger
      if (text.includes('INSERT INTO budget_ledger')) {
        const entry = {
          id: ledgerId++,
          cell_id: params![0],
          operation: params![1],
          amount: String(params![2]),
          from_cell_id: params![3],
          to_cell_id: params![4],
          balance_after: String(params![5]),
          reason: params![6],
          created_at: new Date(),
        };
        ledgerEntries.push(entry);
        return { rows: [] };
      }

      // SELECT ... FROM budget_ledger WHERE cell_id
      if (text.includes('FROM budget_ledger WHERE cell_id')) {
        const cellId = params![0] as string;
        const limit = params![1] as number;
        const filtered = ledgerEntries
          .filter(e => e.cell_id === cellId)
          .slice(0, limit);
        return { rows: filtered };
      }

      // SELECT ... FROM cell_tree ct LEFT JOIN budget_balances
      if (text.includes('FROM cell_tree ct')) {
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}

describe('BudgetLedger', () => {
  let db: ReturnType<typeof createMockDb>;
  let ledger: BudgetLedgerService;

  beforeEach(() => {
    db = createMockDb();
    ledger = createBudgetLedger(db);
  });

  describe('initRoot', () => {
    it('should initialize a root cell budget', async () => {
      await ledger.initRoot('root-cell', 100);
      const balance = await ledger.getBalance('root-cell');
      expect(balance).not.toBeNull();
      expect(balance!.allocated).toBe(100);
      expect(balance!.spent).toBe(0);
      expect(balance!.delegated).toBe(0);
      expect(balance!.available).toBe(100);
    });
  });

  describe('allocate', () => {
    it('should allocate budget from parent to child', async () => {
      await ledger.initRoot('parent', 100);
      await ledger.allocate('parent', 'child-a', 40);

      const parentBalance = await ledger.getBalance('parent');
      expect(parentBalance!.delegated).toBe(40);
      expect(parentBalance!.available).toBe(60);

      const childBalance = await ledger.getBalance('child-a');
      expect(childBalance!.allocated).toBe(40);
      expect(childBalance!.available).toBe(40);
    });

    it('should reject allocation exceeding available budget', async () => {
      await ledger.initRoot('parent', 50);
      await expect(ledger.allocate('parent', 'child', 60)).rejects.toThrow('Insufficient budget');
    });

    it('should reject allocation for non-existent parent', async () => {
      await expect(ledger.allocate('nonexistent', 'child', 10)).rejects.toThrow('no budget record');
    });

    it('should reject non-positive allocation', async () => {
      await ledger.initRoot('parent', 100);
      await expect(ledger.allocate('parent', 'child', 0)).rejects.toThrow('positive');
      await expect(ledger.allocate('parent', 'child', -5)).rejects.toThrow('positive');
    });

    it('should support multiple allocations', async () => {
      await ledger.initRoot('parent', 100);
      await ledger.allocate('parent', 'child-a', 30);
      await ledger.allocate('parent', 'child-b', 25);

      const parentBalance = await ledger.getBalance('parent');
      expect(parentBalance!.delegated).toBe(55);
      expect(parentBalance!.available).toBe(45);
    });
  });

  describe('spend', () => {
    it('should record spending', async () => {
      await ledger.initRoot('cell', 50);
      await ledger.spend('cell', 5.23);

      const balance = await ledger.getBalance('cell');
      expect(balance!.spent).toBeCloseTo(5.23);
      expect(balance!.available).toBeCloseTo(44.77);
    });

    it('should reject spending exceeding available budget', async () => {
      await ledger.initRoot('cell', 10);
      await expect(ledger.spend('cell', 15)).rejects.toThrow('Budget exhausted');
    });

    it('should track multiple spends', async () => {
      await ledger.initRoot('cell', 100);
      await ledger.spend('cell', 10);
      await ledger.spend('cell', 20);
      await ledger.spend('cell', 5);

      const balance = await ledger.getBalance('cell');
      expect(balance!.spent).toBe(35);
      expect(balance!.available).toBe(65);
    });
  });

  describe('reclaim', () => {
    it('should reclaim unspent budget from child', async () => {
      await ledger.initRoot('parent', 100);
      await ledger.allocate('parent', 'child', 40);
      await ledger.spend('child', 15);

      const reclaimed = await ledger.reclaim('child', 'parent');
      expect(reclaimed).toBe(25); // 40 allocated - 15 spent = 25 available

      const parentBalance = await ledger.getBalance('parent');
      expect(parentBalance!.delegated).toBe(15); // 40 - 25 reclaimed
      expect(parentBalance!.available).toBe(85); // 60 + 25

      const childBalance = await ledger.getBalance('child');
      expect(childBalance!.allocated).toBe(15); // 40 - 25 reclaimed
      expect(childBalance!.available).toBe(0); // all spent
    });

    it('should return 0 for fully spent child', async () => {
      await ledger.initRoot('parent', 100);
      await ledger.allocate('parent', 'child', 10);
      await ledger.spend('child', 10);

      const reclaimed = await ledger.reclaim('child', 'parent');
      expect(reclaimed).toBe(0);
    });

    it('should return 0 for non-existent child', async () => {
      const reclaimed = await ledger.reclaim('nonexistent', 'parent');
      expect(reclaimed).toBe(0);
    });
  });

  describe('topUp', () => {
    it('should top up a child budget', async () => {
      await ledger.initRoot('parent', 100);
      await ledger.allocate('parent', 'child', 20);
      await ledger.topUp('parent', 'child', 10);

      const childBalance = await ledger.getBalance('child');
      expect(childBalance!.allocated).toBe(30);

      const parentBalance = await ledger.getBalance('parent');
      expect(parentBalance!.delegated).toBe(30);
      expect(parentBalance!.available).toBe(70);
    });

    it('should reject top-up exceeding parent budget', async () => {
      await ledger.initRoot('parent', 100);
      await ledger.allocate('parent', 'child', 90);
      await expect(ledger.topUp('parent', 'child', 20)).rejects.toThrow('Insufficient budget');
    });
  });

  describe('getBalance', () => {
    it('should return null for non-existent cell', async () => {
      const balance = await ledger.getBalance('nonexistent');
      expect(balance).toBeNull();
    });

    it('should compute available correctly with allocations and spending', async () => {
      await ledger.initRoot('root', 100);
      await ledger.allocate('root', 'child-a', 30);
      await ledger.allocate('root', 'child-b', 25);
      await ledger.spend('root', 5);

      const balance = await ledger.getBalance('root');
      expect(balance!.allocated).toBe(100);
      expect(balance!.spent).toBe(5);
      expect(balance!.delegated).toBe(55);
      expect(balance!.available).toBe(40); // 100 - 5 - 55
    });
  });

  describe('getHistory', () => {
    it('should return ledger entries for a cell', async () => {
      await ledger.initRoot('cell', 100);
      await ledger.spend('cell', 10);
      await ledger.spend('cell', 5);

      const history = await ledger.getHistory('cell');
      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('budget cascade (multi-level)', () => {
    it('should support 3-level budget flow', async () => {
      // Root → backend-team → developer-0
      await ledger.initRoot('root', 100);
      await ledger.allocate('root', 'backend-team', 40);
      await ledger.allocate('backend-team', 'developer-0', 15);

      // Developer spends
      await ledger.spend('developer-0', 8);

      const rootBalance = await ledger.getBalance('root');
      expect(rootBalance!.available).toBe(60);

      const teamBalance = await ledger.getBalance('backend-team');
      expect(teamBalance!.available).toBe(25); // 40 - 15 delegated

      const devBalance = await ledger.getBalance('developer-0');
      expect(devBalance!.available).toBe(7); // 15 - 8 spent
    });
  });
});
