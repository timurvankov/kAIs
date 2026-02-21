/**
 * Integration Test: 3-level recursive spawn with budget cascade (T4)
 *
 * Tests the full recursive ecosystem lifecycle:
 * - CellTree tracks parent-child hierarchy (3 levels)
 * - BudgetLedger flows budget down the tree
 * - RecursionValidator enforces depth + descendant + budget limits
 * - Budget cascade: spend, reclaim, exhaustion
 * - Tree deletion cascades correctly
 */
import { describe, it, expect, beforeEach } from 'vitest';

import type { DbClient, DbQueryResult } from '@kais/api';
import {
  createBudgetLedger,
  createCellTree,
  createRecursionValidator,
  createSpawnRequestService,
  type BudgetLedgerService,
  type CellTreeService,
  type RecursionValidator,
  type SpawnRequestService,
} from '@kais/api';
import type { RecursionSpec } from '@kais/core';

// ---------------------------------------------------------------------------
// Combined in-memory DB mock that supports both cell_tree and budget tables
// ---------------------------------------------------------------------------

interface TreeRow {
  cell_id: string;
  parent_id: string | null;
  root_id: string;
  depth: number;
  path: string;
  descendant_count: number;
  namespace: string;
}

function createCombinedMockDb(): DbClient & {
  treeNodes: Map<string, TreeRow>;
  balances: Map<string, { allocated: number; spent: number; delegated: number }>;
} {
  const treeNodes = new Map<string, TreeRow>();
  const balances = new Map<string, { allocated: number; spent: number; delegated: number }>();
  const ledgerEntries: Array<Record<string, unknown>> = [];
  const spawnRequests: Array<Record<string, unknown>> = [];
  let ledgerId = 1;
  let spawnRequestId = 1;

  return {
    treeNodes,
    balances,
    async query(text: string, params?: unknown[]): Promise<DbQueryResult> {
      // ============ cell_tree queries ============

      // INSERT INTO cell_tree ... ON CONFLICT DO NOTHING
      if (text.includes('INSERT INTO cell_tree') && text.includes('ON CONFLICT')) {
        const cellId = params![0] as string;
        if (!treeNodes.has(cellId)) {
          const isRoot = params!.length === 2;
          treeNodes.set(cellId, {
            cell_id: cellId,
            parent_id: isRoot ? null : (params![1] as string | null),
            root_id: isRoot ? cellId : (params![2] as string),
            depth: isRoot ? 0 : (params![3] as number),
            path: isRoot ? cellId : (params![4] as string),
            descendant_count: 0,
            namespace: isRoot ? (params![1] as string) : (params![5] as string),
          });
        }
        return { rows: [] };
      }

      // SELECT root_id, depth, path FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT root_id, depth, path FROM cell_tree')) {
        const cellId = params![0] as string;
        const node = treeNodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ root_id: node.root_id, depth: node.depth, path: node.path }] };
      }

      // UPDATE cell_tree SET descendant_count = descendant_count + 1
      if (text.includes('descendant_count = descendant_count + 1')) {
        const childPath = params![0] as string;
        const parentId = params![1] as string;
        for (const node of treeNodes.values()) {
          if (childPath.startsWith(node.path + '/') || node.cell_id === parentId) {
            node.descendant_count++;
          }
        }
        return { rows: [] };
      }

      // UPDATE SET descendant_count = GREATEST(descendant_count - $1, 0)
      if (text.includes('GREATEST(descendant_count -')) {
        const count = params![0] as number;
        const cellIds = params![1] as string[];
        for (const id of cellIds) {
          const node = treeNodes.get(id);
          if (node) node.descendant_count = Math.max(node.descendant_count - count, 0);
        }
        return { rows: [] };
      }

      // SELECT depth FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT depth FROM cell_tree')) {
        const cellId = params![0] as string;
        const node = treeNodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ depth: node.depth }] };
      }

      // SELECT descendant_count FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT descendant_count FROM cell_tree')) {
        const cellId = params![0] as string;
        const node = treeNodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ descendant_count: node.descendant_count }] };
      }

      // SELECT path FROM cell_tree WHERE cell_id
      if (text.includes('SELECT path FROM cell_tree WHERE cell_id')) {
        const cellId = params![0] as string;
        const node = treeNodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ path: node.path }] };
      }

      // SELECT * FROM cell_tree WHERE cell_id = ANY($1) ORDER BY depth ASC
      if (text.includes('cell_id = ANY($1)') && text.includes('ORDER BY depth ASC')) {
        const cellIds = params![0] as string[];
        const results = cellIds
          .map(id => treeNodes.get(id))
          .filter(Boolean)
          .sort((a, b) => a!.depth - b!.depth);
        return { rows: results as Record<string, unknown>[] };
      }

      // SELECT * FROM cell_tree WHERE cell_id = $1
      if (text.includes('SELECT * FROM cell_tree WHERE cell_id = $1')) {
        const cellId = params![0] as string;
        const node = treeNodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [node as unknown as Record<string, unknown>] };
      }

      // SELECT * FROM cell_tree WHERE root_id = $1 ORDER BY depth
      if (text.includes('WHERE root_id = $1') && text.includes('ORDER BY depth')) {
        const rootId = params![0] as string;
        const results = Array.from(treeNodes.values())
          .filter(n => n.root_id === rootId)
          .sort((a, b) => a.depth - b.depth || a.cell_id.localeCompare(b.cell_id));
        return { rows: results as unknown as Record<string, unknown>[] };
      }

      // SELECT parent_id, path, descendant_count FROM cell_tree WHERE cell_id = $1
      if (text.includes('parent_id, path, descendant_count')) {
        const cellId = params![0] as string;
        const node = treeNodes.get(cellId);
        if (!node) return { rows: [] };
        return { rows: [{ parent_id: node.parent_id, path: node.path, descendant_count: node.descendant_count }] };
      }

      // DELETE FROM cell_tree WHERE cell_id = $1
      if (text.includes('DELETE FROM cell_tree')) {
        const cellId = params![0] as string;
        const node = treeNodes.get(cellId);
        if (node) {
          const prefix = node.path + '/';
          for (const [id, n] of treeNodes.entries()) {
            if (n.path.startsWith(prefix)) {
              treeNodes.delete(id);
            }
          }
          treeNodes.delete(cellId);
        }
        return { rows: [] };
      }

      // WITH RECURSIVE subtree ... COUNT
      if (text.includes('WITH RECURSIVE subtree')) {
        const cellId = params![0] as string;
        let count = 0;
        const countChildren = (parentId: string) => {
          for (const node of treeNodes.values()) {
            if (node.parent_id === parentId) {
              count++;
              countChildren(node.cell_id);
            }
          }
        };
        countChildren(cellId);
        return { rows: [{ cnt: String(count) }] };
      }

      // UPDATE cell_tree SET descendant_count = $2
      if (text.includes('UPDATE cell_tree SET descendant_count = $2')) {
        const cellId = params![0] as string;
        const count = params![1] as number;
        const node = treeNodes.get(cellId);
        if (node) node.descendant_count = count;
        return { rows: [] };
      }

      // ============ budget_balances queries ============

      // INSERT INTO budget_balances ... ON CONFLICT DO NOTHING
      if (text.includes('INSERT INTO budget_balances') && text.includes('ON CONFLICT')) {
        const cellId = params![0] as string;
        if (!balances.has(cellId)) {
          balances.set(cellId, { allocated: 0, spent: 0, delegated: 0 });
        }
        return { rows: [] };
      }

      // UPDATE budget_balances SET allocated = $2 (exact set, not increment)
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
        ledgerEntries.push({
          id: ledgerId++,
          cell_id: params![0],
          operation: params![1],
          amount: String(params![2]),
          from_cell_id: params![3],
          to_cell_id: params![4],
          balance_after: String(params![5]),
          reason: params![6],
          created_at: new Date(),
        });
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
        const rootCellId = params![0] as string;
        const results = Array.from(treeNodes.values())
          .filter(n => n.root_id === rootCellId)
          .sort((a, b) => a.depth - b.depth || a.cell_id.localeCompare(b.cell_id))
          .map(n => {
            const b = balances.get(n.cell_id);
            return {
              cell_id: n.cell_id,
              parent_id: n.parent_id,
              allocated: b ? String(b.allocated) : null,
              spent: b ? String(b.spent) : null,
              delegated: b ? String(b.delegated) : null,
            };
          });
        return { rows: results };
      }

      // ============ spawn_requests queries ============

      // INSERT INTO spawn_requests
      if (text.includes('INSERT INTO spawn_requests')) {
        const req: Record<string, unknown> = {
          id: spawnRequestId++,
          name: params![0],
          namespace: params![1],
          requestor_cell_id: params![2],
          requested_spec: params![3],
          reason: params![4],
          status: 'Pending',
          decided_by: null,
          decided_at: null,
          rejection_reason: null,
          created_at: new Date(),
        };
        spawnRequests.push(req);
        return { rows: [req] };
      }

      return { rows: [] };
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: simulate a cell spawn (tree + budget allocation)
// ---------------------------------------------------------------------------

async function spawnCell(
  cellTree: CellTreeService,
  budgetLedger: BudgetLedgerService,
  parentId: string,
  childId: string,
  namespace: string,
  budget: number,
): Promise<void> {
  await cellTree.insertChild(childId, parentId, namespace);
  await budgetLedger.allocate(parentId, childId, budget);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('3-level recursive spawn with budget cascade', () => {
  let db: ReturnType<typeof createCombinedMockDb>;
  let cellTree: CellTreeService;
  let budgetLedger: BudgetLedgerService;
  let validator: RecursionValidator;
  let spawnReqSvc: SpawnRequestService;

  const NS = 'test-ns';
  const defaultRecursion: RecursionSpec = {
    maxDepth: 5,
    maxDescendants: 50,
    spawnPolicy: 'open',
  };

  beforeEach(() => {
    db = createCombinedMockDb();
    cellTree = createCellTree(db);
    budgetLedger = createBudgetLedger(db);
    spawnReqSvc = createSpawnRequestService(db);
    validator = createRecursionValidator({
      cellTree,
      budgetLedger,
      spawnRequests: spawnReqSvc,
      maxTotalCells: 100,
    });
  });

  // ---------- Build 3-level tree ----------

  it('should build a 3-level tree: root → 2 children → 2 grandchildren', async () => {
    // Root with $100
    await cellTree.insertRoot('project-lead', NS);
    await budgetLedger.initRoot('project-lead', 100);

    // Validate + spawn children
    const v1 = await validator.validateSpawn('project-lead', NS, defaultRecursion, {
      name: 'backend-team',
      systemPrompt: 'Backend dev',
      budget: 40,
    });
    expect(v1.allowed).toBe(true);
    await spawnCell(cellTree, budgetLedger, 'project-lead', 'backend-team', NS, 40);

    const v2 = await validator.validateSpawn('project-lead', NS, defaultRecursion, {
      name: 'frontend-team',
      systemPrompt: 'Frontend dev',
      budget: 30,
    });
    expect(v2.allowed).toBe(true);
    await spawnCell(cellTree, budgetLedger, 'project-lead', 'frontend-team', NS, 30);

    // Validate + spawn grandchildren
    const v3 = await validator.validateSpawn('backend-team', NS, defaultRecursion, {
      name: 'db-specialist',
      systemPrompt: 'DB expert',
      budget: 15,
    });
    expect(v3.allowed).toBe(true);
    await spawnCell(cellTree, budgetLedger, 'backend-team', 'db-specialist', NS, 15);

    const v4 = await validator.validateSpawn('frontend-team', NS, defaultRecursion, {
      name: 'ui-designer',
      systemPrompt: 'UI/UX',
      budget: 10,
    });
    expect(v4.allowed).toBe(true);
    await spawnCell(cellTree, budgetLedger, 'frontend-team', 'ui-designer', NS, 10);

    // Verify tree structure
    const tree = await cellTree.getTree('project-lead');
    expect(tree).toHaveLength(5);
    // Sorted by depth ASC, then cellId ASC
    expect(tree.map(n => n.cellId)).toEqual([
      'project-lead', 'backend-team', 'frontend-team', 'db-specialist', 'ui-designer',
    ]);

    // Verify depths
    expect(await cellTree.getDepth('project-lead')).toBe(0);
    expect(await cellTree.getDepth('backend-team')).toBe(1);
    expect(await cellTree.getDepth('db-specialist')).toBe(2);

    // Verify descendant counts
    expect(await cellTree.countDescendants('project-lead')).toBe(4);
    expect(await cellTree.countDescendants('backend-team')).toBe(1);
    expect(await cellTree.countDescendants('frontend-team')).toBe(1);
    expect(await cellTree.countDescendants('db-specialist')).toBe(0);
  });

  it('should correctly cascade budget through 3 levels', async () => {
    // Root: $100
    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);

    // Root → child ($50)
    await spawnCell(cellTree, budgetLedger, 'root', 'child', NS, 50);

    // Child → grandchild ($20)
    await spawnCell(cellTree, budgetLedger, 'child', 'grandchild', NS, 20);

    // Verify balances at each level
    const rootBal = await budgetLedger.getBalance('root');
    expect(rootBal!.allocated).toBe(100);
    expect(rootBal!.delegated).toBe(50);
    expect(rootBal!.available).toBe(50);

    const childBal = await budgetLedger.getBalance('child');
    expect(childBal!.allocated).toBe(50);
    expect(childBal!.delegated).toBe(20);
    expect(childBal!.available).toBe(30);

    const grandchildBal = await budgetLedger.getBalance('grandchild');
    expect(grandchildBal!.allocated).toBe(20);
    expect(grandchildBal!.delegated).toBe(0);
    expect(grandchildBal!.available).toBe(20);
  });

  it('should track spending at each level independently', async () => {
    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);
    await spawnCell(cellTree, budgetLedger, 'root', 'child', NS, 50);
    await spawnCell(cellTree, budgetLedger, 'child', 'grandchild', NS, 20);

    // Grandchild spends $8
    await budgetLedger.spend('grandchild', 8, 'LLM call');
    const gcBal = await budgetLedger.getBalance('grandchild');
    expect(gcBal!.spent).toBe(8);
    expect(gcBal!.available).toBe(12);

    // Child spends $5
    await budgetLedger.spend('child', 5, 'LLM call');
    const childBal = await budgetLedger.getBalance('child');
    expect(childBal!.spent).toBe(5);
    expect(childBal!.available).toBe(25); // 50 - 5(spent) - 20(delegated)

    // Root spends $10
    await budgetLedger.spend('root', 10, 'LLM call');
    const rootBal = await budgetLedger.getBalance('root');
    expect(rootBal!.spent).toBe(10);
    expect(rootBal!.available).toBe(40); // 100 - 10(spent) - 50(delegated)
  });

  it('should reject spending beyond available budget', async () => {
    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 50);
    await spawnCell(cellTree, budgetLedger, 'root', 'child', NS, 30);

    // Child has $30, try to spend $35
    await expect(budgetLedger.spend('child', 35)).rejects.toThrow('Budget exhausted');

    // Root has $20 available (50 - 30 delegated), try to spend $25
    await expect(budgetLedger.spend('root', 25)).rejects.toThrow('Budget exhausted');
  });

  it('should reclaim unspent budget from child to parent', async () => {
    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);
    await spawnCell(cellTree, budgetLedger, 'root', 'child', NS, 40);

    // Child spends $15
    await budgetLedger.spend('child', 15);
    expect((await budgetLedger.getBalance('child'))!.available).toBe(25);

    // Reclaim unspent from child
    const reclaimed = await budgetLedger.reclaim('child', 'root');
    expect(reclaimed).toBe(25); // 40 - 15 = 25 reclaimable

    // Root gets budget back
    const rootBal = await budgetLedger.getBalance('root');
    expect(rootBal!.delegated).toBe(15); // 40 - 25 reclaimed
    expect(rootBal!.available).toBe(85); // 100 - 15 delegated

    // Child has nothing available
    const childBal = await budgetLedger.getBalance('child');
    expect(childBal!.available).toBe(0);
  });

  it('should support top-up from parent to child', async () => {
    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);
    await spawnCell(cellTree, budgetLedger, 'root', 'child', NS, 20);

    // Child spends almost everything
    await budgetLedger.spend('child', 18);
    expect((await budgetLedger.getBalance('child'))!.available).toBe(2);

    // Top up child with $10 more
    await budgetLedger.topUp('root', 'child', 10);

    const childBal = await budgetLedger.getBalance('child');
    expect(childBal!.allocated).toBe(30); // 20 + 10
    expect(childBal!.available).toBe(12); // 30 - 18

    const rootBal = await budgetLedger.getBalance('root');
    expect(rootBal!.delegated).toBe(30); // 20 + 10
    expect(rootBal!.available).toBe(70); // 100 - 30
  });

  // ---------- Recursion depth enforcement ----------

  it('should enforce maxDepth limit', async () => {
    const shallowSpec: RecursionSpec = {
      maxDepth: 2,
      maxDescendants: 50,
      spawnPolicy: 'open',
    };

    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);

    // Depth 0 → spawn at depth 1: allowed
    const v1 = await validator.validateSpawn('root', NS, shallowSpec, {
      name: 'child',
      systemPrompt: 'test',
    });
    expect(v1.allowed).toBe(true);
    await cellTree.insertChild('child', 'root', NS);

    // Depth 1 → spawn at depth 2: allowed (maxDepth=2 means depth < 2)
    const v2 = await validator.validateSpawn('child', NS, shallowSpec, {
      name: 'grandchild',
      systemPrompt: 'test',
    });
    expect(v2.allowed).toBe(true);
    await cellTree.insertChild('grandchild', 'child', NS);

    // Depth 2 → spawn at depth 3: blocked
    const v3 = await validator.validateSpawn('grandchild', NS, shallowSpec, {
      name: 'great-grandchild',
      systemPrompt: 'test',
    });
    expect(v3.allowed).toBe(false);
    expect(v3.reason).toContain('Maximum depth');
  });

  it('should enforce maxDescendants limit', async () => {
    const tinySpec: RecursionSpec = {
      maxDepth: 10,
      maxDescendants: 2,
      spawnPolicy: 'open',
    };

    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);

    // Spawn 2 children (reaching limit)
    await cellTree.insertChild('child-a', 'root', NS);
    await cellTree.insertChild('child-b', 'root', NS);

    // 3rd spawn blocked (descendants = 2 >= maxDescendants = 2)
    const v = await validator.validateSpawn('root', NS, tinySpec, {
      name: 'child-c',
      systemPrompt: 'test',
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('Maximum descendants');
  });

  it('should reject spawn when budget is insufficient', async () => {
    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 10);

    const v = await validator.validateSpawn('root', NS, defaultRecursion, {
      name: 'expensive-child',
      systemPrompt: 'test',
      budget: 20,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('Insufficient budget');
  });

  it('should enforce disabled spawn policy', async () => {
    const disabledSpec: RecursionSpec = {
      maxDepth: 5,
      maxDescendants: 50,
      spawnPolicy: 'disabled',
    };

    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);

    const v = await validator.validateSpawn('root', NS, disabledSpec, {
      name: 'child',
      systemPrompt: 'test',
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('disabled');
  });

  it('should queue spawn for approval when policy is approval_required', async () => {
    const approvalSpec: RecursionSpec = {
      maxDepth: 5,
      maxDescendants: 50,
      spawnPolicy: 'approval_required',
    };

    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);

    const v = await validator.validateSpawn('root', NS, approvalSpec, {
      name: 'pending-child',
      systemPrompt: 'test',
    });
    expect(v.allowed).toBe(false);
    expect(v.pending).toBe(true);
    expect(v.reason).toContain('approval');
  });

  it('should enforce blueprint_only policy', async () => {
    const blueprintSpec: RecursionSpec = {
      maxDepth: 5,
      maxDescendants: 50,
      spawnPolicy: 'blueprint_only',
    };

    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);

    // Without blueprintRef → rejected
    const v1 = await validator.validateSpawn('root', NS, blueprintSpec, {
      name: 'child',
      systemPrompt: 'test',
    });
    expect(v1.allowed).toBe(false);
    expect(v1.reason).toContain('Blueprint');

    // With blueprintRef → allowed
    const v2 = await validator.validateSpawn('root', NS, blueprintSpec, {
      name: 'child',
      systemPrompt: 'test',
      blueprintRef: 'bp-code-review',
    });
    expect(v2.allowed).toBe(true);
  });

  // ---------- Budget tree query ----------

  it('should return correct budget tree for 3-level hierarchy', async () => {
    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);
    await spawnCell(cellTree, budgetLedger, 'root', 'child-a', NS, 40);
    await spawnCell(cellTree, budgetLedger, 'root', 'child-b', NS, 20);
    await spawnCell(cellTree, budgetLedger, 'child-a', 'grandchild', NS, 15);

    // Spend some
    await budgetLedger.spend('grandchild', 3);
    await budgetLedger.spend('child-b', 7);

    const tree = await budgetLedger.getTree('root');
    expect(tree).toHaveLength(1);

    const root = tree[0]!;
    expect(root.cellId).toBe('root');
    expect(root.balance.delegated).toBe(60); // 40 + 20
    expect(root.children).toHaveLength(2);

    const childA = root.children.find(c => c.cellId === 'child-a');
    expect(childA).toBeDefined();
    expect(childA!.balance.delegated).toBe(15);
    expect(childA!.children).toHaveLength(1);
    expect(childA!.children[0]!.cellId).toBe('grandchild');
    expect(childA!.children[0]!.balance.spent).toBe(3);

    const childB = root.children.find(c => c.cellId === 'child-b');
    expect(childB).toBeDefined();
    expect(childB!.balance.spent).toBe(7);
  });

  // ---------- Ancestor chain ----------

  it('should return correct ancestor chain for grandchild', async () => {
    await cellTree.insertRoot('root', NS);
    await cellTree.insertChild('child', 'root', NS);
    await cellTree.insertChild('grandchild', 'child', NS);

    const ancestors = await cellTree.getAncestors('grandchild');
    expect(ancestors).toHaveLength(2);
    expect(ancestors[0]!.cellId).toBe('root');
    expect(ancestors[1]!.cellId).toBe('child');
  });

  // ---------- Tree deletion cascade ----------

  it('should cascade delete through tree and preserve budget history', async () => {
    await cellTree.insertRoot('root', NS);
    await budgetLedger.initRoot('root', 100);
    await spawnCell(cellTree, budgetLedger, 'root', 'child', NS, 50);
    await spawnCell(cellTree, budgetLedger, 'child', 'grandchild', NS, 20);
    await budgetLedger.spend('grandchild', 5);

    // Delete child (should cascade to grandchild)
    await cellTree.remove('child');

    // Tree should only have root
    const tree = await cellTree.getTree('root');
    expect(tree).toHaveLength(1);
    expect(tree[0]!.cellId).toBe('root');

    // Root descendant count should be 0
    expect(await cellTree.countDescendants('root')).toBe(0);

    // Grandchild and child should be gone from tree
    expect(await cellTree.getNode('child')).toBeNull();
    expect(await cellTree.getNode('grandchild')).toBeNull();

    // Budget history still exists (append-only ledger)
    const history = await budgetLedger.getHistory('grandchild', 10);
    expect(history.length).toBeGreaterThan(0);
  });

  // ---------- Full lifecycle scenario ----------

  it('should handle full lifecycle: spawn → work → reclaim → teardown', async () => {
    // 1. Init root with $100
    await cellTree.insertRoot('lead', NS);
    await budgetLedger.initRoot('lead', 100);

    // 2. Spawn 2 workers with $30 each
    for (const name of ['worker-a', 'worker-b']) {
      const v = await validator.validateSpawn('lead', NS, defaultRecursion, {
        name,
        systemPrompt: `Worker ${name}`,
        budget: 30,
      });
      expect(v.allowed).toBe(true);
      await spawnCell(cellTree, budgetLedger, 'lead', name, NS, 30);
    }

    // Lead has $40 available
    expect((await budgetLedger.getBalance('lead'))!.available).toBe(40);

    // 3. Workers do work
    await budgetLedger.spend('worker-a', 12);
    await budgetLedger.spend('worker-b', 8);

    // 4. Worker-a spawns a sub-worker
    const v = await validator.validateSpawn('worker-a', NS, defaultRecursion, {
      name: 'sub-worker',
      systemPrompt: 'Sub worker',
      budget: 10,
    });
    expect(v.allowed).toBe(true);
    await spawnCell(cellTree, budgetLedger, 'worker-a', 'sub-worker', NS, 10);
    await budgetLedger.spend('sub-worker', 4);

    // 5. Verify total tree: 4 cells
    const tree = await cellTree.getTree('lead');
    expect(tree).toHaveLength(4);

    // 6. Reclaim from sub-worker back to worker-a
    const reclaimedSub = await budgetLedger.reclaim('sub-worker', 'worker-a');
    expect(reclaimedSub).toBe(6); // 10 - 4

    // Worker-a available: 30 - 12(spent) - 10(delegated) + 6(reclaimed delegated) = 14
    expect((await budgetLedger.getBalance('worker-a'))!.available).toBe(14);

    // 7. Reclaim from worker-b back to lead
    const reclaimedB = await budgetLedger.reclaim('worker-b', 'lead');
    expect(reclaimedB).toBe(22); // 30 - 8

    // Lead: 100 - 30(worker-a still) - 8(worker-b leftover)
    expect((await budgetLedger.getBalance('lead'))!.delegated).toBe(38); // 60 - 22

    // 8. Delete sub-worker from tree
    await cellTree.remove('sub-worker');
    expect(await cellTree.countDescendants('worker-a')).toBe(0);

    // Verify all budgets still sum correctly
    const leadBal = (await budgetLedger.getBalance('lead'))!;
    const wasBal = (await budgetLedger.getBalance('worker-a'))!;
    const wbsBal = (await budgetLedger.getBalance('worker-b'))!;
    const totalSpent = leadBal.spent + wasBal.spent + wbsBal.spent + 4; // sub-worker spent 4
    expect(totalSpent).toBe(24); // 12 + 8 + 4
  });
});
