import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRecursionValidator, type RecursionValidator, type SpawnInput } from '../recursion-validator.js';
import type { BudgetLedgerService } from '../budget-ledger.js';
import type { CellTreeService } from '../cell-tree.js';
import type { SpawnRequestService } from '../spawn-request.js';
import type { RecursionSpec, BudgetBalance, CellTreeNode, SpawnRequest } from '@kais/core';

function createMockCellTree(overrides?: Partial<CellTreeService>): CellTreeService {
  return {
    insertRoot: vi.fn(),
    insertChild: vi.fn(),
    remove: vi.fn(),
    getDepth: vi.fn().mockResolvedValue(0),
    countDescendants: vi.fn().mockResolvedValue(0),
    getAncestors: vi.fn().mockResolvedValue([]),
    getNode: vi.fn().mockResolvedValue({
      cellId: 'parent',
      parentId: null,
      rootId: 'parent',
      depth: 0,
      path: 'parent',
      descendantCount: 0,
      namespace: 'default',
    } satisfies CellTreeNode),
    getTree: vi.fn().mockResolvedValue([]),
    refreshDescendantCounts: vi.fn(),
    ...overrides,
  };
}

function createMockBudgetLedger(overrides?: Partial<BudgetLedgerService>): BudgetLedgerService {
  return {
    initRoot: vi.fn(),
    allocate: vi.fn(),
    spend: vi.fn(),
    reclaim: vi.fn(),
    topUp: vi.fn(),
    getBalance: vi.fn().mockResolvedValue({
      cellId: 'parent',
      allocated: 100,
      spent: 10,
      delegated: 20,
      available: 70,
    } satisfies BudgetBalance),
    getTree: vi.fn().mockResolvedValue([]),
    getHistory: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function createMockSpawnRequests(overrides?: Partial<SpawnRequestService>): SpawnRequestService {
  return {
    create: vi.fn().mockResolvedValue({
      id: 1,
      name: 'test',
      namespace: 'default',
      requestorCellId: 'parent',
      requestedSpec: { name: 'test', systemPrompt: 'test', canSpawnChildren: false },
      status: 'Pending',
      createdAt: new Date().toISOString(),
    } satisfies SpawnRequest),
    approve: vi.fn(),
    reject: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('RecursionValidator', () => {
  let validator: RecursionValidator;
  let mockTree: CellTreeService;
  let mockBudget: BudgetLedgerService;
  let mockSpawnReqs: SpawnRequestService;

  const defaultInput: SpawnInput = {
    name: 'child-cell',
    systemPrompt: 'You are a helper',
    budget: 10,
  };

  const defaultRecursion: RecursionSpec = {
    maxDepth: 5,
    maxDescendants: 50,
    spawnPolicy: 'open',
  };

  beforeEach(() => {
    mockTree = createMockCellTree();
    mockBudget = createMockBudgetLedger();
    mockSpawnReqs = createMockSpawnRequests();
    validator = createRecursionValidator({
      cellTree: mockTree,
      budgetLedger: mockBudget,
      spawnRequests: mockSpawnReqs,
    });
  });

  describe('spawn policy', () => {
    it('should allow spawn with open policy', async () => {
      const result = await validator.validateSpawn('parent', 'default', defaultRecursion, defaultInput);
      expect(result.allowed).toBe(true);
    });

    it('should reject spawn with disabled policy', async () => {
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        spawnPolicy: 'disabled',
      }, defaultInput);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    it('should reject non-blueprint spawn with blueprint_only policy', async () => {
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        spawnPolicy: 'blueprint_only',
      }, defaultInput);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Blueprint');
    });

    it('should allow blueprint spawn with blueprint_only policy', async () => {
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        spawnPolicy: 'blueprint_only',
      }, { ...defaultInput, blueprintRef: 'code-review-team' });
      expect(result.allowed).toBe(true);
    });

    it('should queue approval with approval_required policy', async () => {
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        spawnPolicy: 'approval_required',
      }, defaultInput);
      expect(result.allowed).toBe(false);
      expect(result.pending).toBe(true);
      expect(result.reason).toContain('approval');
      expect(mockSpawnReqs.create).toHaveBeenCalledOnce();
    });
  });

  describe('depth check', () => {
    it('should allow spawn within depth limit', async () => {
      vi.mocked(mockTree.getDepth).mockResolvedValue(2);
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        maxDepth: 5,
      }, defaultInput);
      expect(result.allowed).toBe(true);
    });

    it('should reject spawn at max depth', async () => {
      vi.mocked(mockTree.getDepth).mockResolvedValue(5);
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        maxDepth: 5,
      }, defaultInput);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('depth');
    });

    it('should reject spawn exceeding max depth', async () => {
      vi.mocked(mockTree.getDepth).mockResolvedValue(10);
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        maxDepth: 3,
      }, defaultInput);
      expect(result.allowed).toBe(false);
    });
  });

  describe('descendant count check', () => {
    it('should allow spawn within descendant limit', async () => {
      vi.mocked(mockTree.countDescendants).mockResolvedValue(10);
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        maxDescendants: 50,
      }, defaultInput);
      expect(result.allowed).toBe(true);
    });

    it('should reject spawn at max descendants', async () => {
      vi.mocked(mockTree.countDescendants).mockResolvedValue(50);
      const result = await validator.validateSpawn('parent', 'default', {
        ...defaultRecursion,
        maxDescendants: 50,
      }, defaultInput);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('descendants');
    });
  });

  describe('budget check', () => {
    it('should allow spawn with sufficient budget', async () => {
      vi.mocked(mockBudget.getBalance).mockResolvedValue({
        cellId: 'parent',
        allocated: 100,
        spent: 10,
        delegated: 20,
        available: 70,
      });
      const result = await validator.validateSpawn('parent', 'default', defaultRecursion, {
        ...defaultInput,
        budget: 50,
      });
      expect(result.allowed).toBe(true);
    });

    it('should reject spawn with insufficient budget', async () => {
      vi.mocked(mockBudget.getBalance).mockResolvedValue({
        cellId: 'parent',
        allocated: 100,
        spent: 80,
        delegated: 15,
        available: 5,
      });
      const result = await validator.validateSpawn('parent', 'default', defaultRecursion, {
        ...defaultInput,
        budget: 10,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('budget');
    });

    it('should skip budget check when no budget specified', async () => {
      const result = await validator.validateSpawn('parent', 'default', defaultRecursion, {
        name: 'child',
        systemPrompt: 'test',
        // no budget specified
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('platform limit', () => {
    it('should reject when platform cell limit reached', async () => {
      const manyNodes = Array.from({ length: 500 }, (_, i) => ({
        cellId: `cell-${i}`,
        parentId: i === 0 ? null : `cell-${i - 1}`,
        rootId: 'cell-0',
        depth: i,
        path: `cell-${i}`,
        descendantCount: 0,
        namespace: 'default',
      }));
      vi.mocked(mockTree.getTree).mockResolvedValue(manyNodes);

      const result = await validator.validateSpawn('parent', 'default', defaultRecursion, defaultInput);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Platform limit');
    });
  });

  describe('default recursion spec', () => {
    it('should use defaults when recursion spec is undefined', async () => {
      const result = await validator.validateSpawn('parent', 'default', undefined, defaultInput);
      expect(result.allowed).toBe(true);
    });
  });
});
