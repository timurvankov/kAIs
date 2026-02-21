import { describe, it, expect } from 'vitest';
import {
  RecursionSpecSchema,
  SpawnPolicySchema,
  BudgetBalanceSchema,
  BudgetOperationSchema,
  CellTreeNodeSchema,
  SpawnRequestPhaseSchema,
  RequestedCellSpecSchema,
  SpawnRequestSchema,
  SpawnValidationResultSchema,
} from '../recursion-schemas.js';

describe('RecursionSpec schema', () => {
  it('should parse valid recursion spec', () => {
    const result = RecursionSpecSchema.parse({
      maxDepth: 5,
      maxDescendants: 50,
      spawnPolicy: 'open',
    });
    expect(result.maxDepth).toBe(5);
    expect(result.maxDescendants).toBe(50);
    expect(result.spawnPolicy).toBe('open');
  });

  it('should apply defaults', () => {
    const result = RecursionSpecSchema.parse({});
    expect(result.maxDepth).toBe(5);
    expect(result.maxDescendants).toBe(50);
    expect(result.spawnPolicy).toBe('open');
  });

  it('should reject invalid spawn policy', () => {
    expect(() => RecursionSpecSchema.parse({
      spawnPolicy: 'invalid',
    })).toThrow();
  });

  it('should reject non-positive maxDepth', () => {
    expect(() => RecursionSpecSchema.parse({
      maxDepth: 0,
    })).toThrow();
    expect(() => RecursionSpecSchema.parse({
      maxDepth: -1,
    })).toThrow();
  });
});

describe('SpawnPolicy schema', () => {
  it('should accept all valid policies', () => {
    expect(SpawnPolicySchema.parse('open')).toBe('open');
    expect(SpawnPolicySchema.parse('approval_required')).toBe('approval_required');
    expect(SpawnPolicySchema.parse('blueprint_only')).toBe('blueprint_only');
    expect(SpawnPolicySchema.parse('disabled')).toBe('disabled');
  });
});

describe('BudgetOperation schema', () => {
  it('should accept all valid operations', () => {
    expect(BudgetOperationSchema.parse('allocate')).toBe('allocate');
    expect(BudgetOperationSchema.parse('spend')).toBe('spend');
    expect(BudgetOperationSchema.parse('reclaim')).toBe('reclaim');
    expect(BudgetOperationSchema.parse('top_up')).toBe('top_up');
  });
});

describe('BudgetBalance schema', () => {
  it('should parse valid balance', () => {
    const result = BudgetBalanceSchema.parse({
      cellId: 'root-cell',
      allocated: 100,
      spent: 30,
      delegated: 40,
      available: 30,
    });
    expect(result.cellId).toBe('root-cell');
    expect(result.available).toBe(30);
  });
});

describe('CellTreeNode schema', () => {
  it('should parse valid tree node', () => {
    const result = CellTreeNodeSchema.parse({
      cellId: 'child-cell',
      parentId: 'parent-cell',
      rootId: 'root-cell',
      depth: 2,
      path: 'root-cell/parent-cell/child-cell',
      descendantCount: 0,
      namespace: 'default',
    });
    expect(result.depth).toBe(2);
    expect(result.path).toBe('root-cell/parent-cell/child-cell');
  });

  it('should accept null parentId for root nodes', () => {
    const result = CellTreeNodeSchema.parse({
      cellId: 'root',
      parentId: null,
      rootId: 'root',
      depth: 0,
      path: 'root',
      descendantCount: 3,
      namespace: 'default',
    });
    expect(result.parentId).toBeNull();
  });
});

describe('SpawnRequestPhase schema', () => {
  it('should accept all valid phases', () => {
    expect(SpawnRequestPhaseSchema.parse('Pending')).toBe('Pending');
    expect(SpawnRequestPhaseSchema.parse('Approved')).toBe('Approved');
    expect(SpawnRequestPhaseSchema.parse('Rejected')).toBe('Rejected');
  });
});

describe('RequestedCellSpec schema', () => {
  it('should parse minimal spec', () => {
    const result = RequestedCellSpecSchema.parse({
      name: 'auditor',
      systemPrompt: 'Audit code',
    });
    expect(result.name).toBe('auditor');
    expect(result.canSpawnChildren).toBeUndefined();
  });

  it('should parse full spec', () => {
    const result = RequestedCellSpecSchema.parse({
      name: 'coordinator',
      systemPrompt: 'Coordinate the team',
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      tools: ['spawn_cell', 'send_message'],
      budget: 25,
      canSpawnChildren: true,
      maxDepth: 3,
    });
    expect(result.canSpawnChildren).toBe(true);
    expect(result.maxDepth).toBe(3);
    expect(result.budget).toBe(25);
  });
});

describe('SpawnValidationResult schema', () => {
  it('should parse allowed result', () => {
    const result = SpawnValidationResultSchema.parse({ allowed: true });
    expect(result.allowed).toBe(true);
  });

  it('should parse rejected result', () => {
    const result = SpawnValidationResultSchema.parse({
      allowed: false,
      reason: 'Max depth reached',
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Max depth reached');
  });

  it('should parse pending result', () => {
    const result = SpawnValidationResultSchema.parse({
      allowed: false,
      reason: 'Queued for approval',
      pending: true,
    });
    expect(result.pending).toBe(true);
  });
});
