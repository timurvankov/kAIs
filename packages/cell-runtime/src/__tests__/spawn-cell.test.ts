import { describe, expect, it } from 'vitest';

import type { CellSpec } from '@kais/core';

import { createSpawnCellTool } from '../tools/spawn-cell.js';
import type { KubeClientLite, CellResourceLite, SpawnCellConfig } from '../tools/spawn-cell.js';

class MockKubeClient implements KubeClientLite {
  public createdCells: CellResourceLite[] = [];

  async createCell(cell: CellResourceLite): Promise<void> {
    this.createdCells.push(cell);
  }
}

const parentSpec: CellSpec = {
  mind: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are a parent cell.',
  },
  tools: [{ name: 'bash' }, { name: 'send_message' }],
  resources: {
    maxTotalCost: 10.0,
  },
};

function makeConfig(overrides: Partial<SpawnCellConfig> = {}): SpawnCellConfig & { kubeClient: MockKubeClient } {
  const kubeClient = new MockKubeClient();
  let budgetUsed = 0;
  const totalBudget = 10.0;
  return {
    kubeClient,
    parentCellName: 'parent-cell',
    parentNamespace: 'default',
    parentUid: 'uid-1234-5678',
    parentSpec,
    remainingBudget: () => totalBudget - budgetUsed,
    deductBudget: (amount: number) => { budgetUsed += amount; },
    ...overrides,
  };
}

describe('spawn_cell tool', () => {
  it('spawns a child cell with default settings', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    const resultStr = await tool.execute({
      name: 'worker',
      systemPrompt: 'You are a worker cell.',
    });
    const result = JSON.parse(resultStr);

    expect(result.status).toBe('spawned');
    expect(result.name).toBe('parent-cell-worker');
    // Default budget = 10% of remaining (10.0) = 1.0
    expect(result.budget).toBe(1.0);

    // Verify CRD was created
    expect(config.kubeClient.createdCells).toHaveLength(1);
    const cell = config.kubeClient.createdCells[0]!;
    expect(cell.apiVersion).toBe('kais.io/v1');
    expect(cell.kind).toBe('Cell');
    expect(cell.metadata.name).toBe('parent-cell-worker');
    expect(cell.metadata.namespace).toBe('default');
  });

  it('prefixes child name with parent name', async () => {
    const config = makeConfig({ parentCellName: 'architect-0' });
    const tool = createSpawnCellTool(config);

    const resultStr = await tool.execute({
      name: 'dev',
      systemPrompt: 'You are a developer.',
    });
    const result = JSON.parse(resultStr);

    expect(result.name).toBe('architect-0-dev');
  });

  it('sets ownerReferences to parent cell', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    await tool.execute({ name: 'child', systemPrompt: 'Hello' });

    const cell = config.kubeClient.createdCells[0]!;
    expect(cell.metadata.ownerReferences).toHaveLength(1);

    const ownerRef = cell.metadata.ownerReferences[0]!;
    expect(ownerRef.apiVersion).toBe('kais.io/v1');
    expect(ownerRef.kind).toBe('Cell');
    expect(ownerRef.name).toBe('parent-cell');
    expect(ownerRef.uid).toBe('uid-1234-5678');
    expect(ownerRef.controller).toBe(true);
    expect(ownerRef.blockOwnerDeletion).toBe(true);
  });

  it('uses parent model and provider as defaults', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    await tool.execute({ name: 'child', systemPrompt: 'You work.' });

    const cell = config.kubeClient.createdCells[0]!;
    expect(cell.spec.mind.model).toBe('claude-sonnet-4-20250514');
    expect(cell.spec.mind.provider).toBe('anthropic');
  });

  it('allows overriding model and provider', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    await tool.execute({
      name: 'child',
      systemPrompt: 'You work.',
      model: 'gpt-4o',
      provider: 'openai',
    });

    const cell = config.kubeClient.createdCells[0]!;
    expect(cell.spec.mind.model).toBe('gpt-4o');
    expect(cell.spec.mind.provider).toBe('openai');
  });

  it('uses the provided system prompt', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    await tool.execute({ name: 'child', systemPrompt: 'Do the thing.' });

    const cell = config.kubeClient.createdCells[0]!;
    expect(cell.spec.mind.systemPrompt).toBe('Do the thing.');
  });

  it('passes tools to child spec', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    await tool.execute({
      name: 'child',
      systemPrompt: 'You work.',
      tools: ['bash', 'read_file'],
    });

    const cell = config.kubeClient.createdCells[0]!;
    expect(cell.spec.tools).toEqual([{ name: 'bash' }, { name: 'read_file' }]);
  });

  it('uses explicit budget when provided', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    const resultStr = await tool.execute({
      name: 'child',
      systemPrompt: 'You work.',
      budget: 2.5,
    });
    const result = JSON.parse(resultStr);

    expect(result.budget).toBe(2.5);

    const cell = config.kubeClient.createdCells[0]!;
    expect(cell.spec.resources?.maxTotalCost).toBe(2.5);
  });

  it('defaults budget to 10% of remaining', async () => {
    let budgetUsed = 4.0;
    const config = makeConfig({
      remainingBudget: () => 10.0 - budgetUsed,
      deductBudget: (amount: number) => { budgetUsed += amount; },
    });
    const tool = createSpawnCellTool(config);

    const resultStr = await tool.execute({
      name: 'child',
      systemPrompt: 'You work.',
    });
    const result = JSON.parse(resultStr);

    // 10% of remaining 6.0 = 0.6
    expect(result.budget).toBeCloseTo(0.6, 10);
  });

  it('throws when budget exceeds remaining', async () => {
    const config = makeConfig({
      remainingBudget: () => 1.0,
    });
    const tool = createSpawnCellTool(config);

    await expect(
      tool.execute({ name: 'child', systemPrompt: 'You work.', budget: 5.0 }),
    ).rejects.toThrow('Insufficient budget');

    // No cell should have been created
    expect(config.kubeClient.createdCells).toHaveLength(0);
  });

  it('deducts budget from parent after spawning', async () => {
    let deducted = 0;
    const config = makeConfig({
      remainingBudget: () => 10.0,
      deductBudget: (amount: number) => { deducted += amount; },
    });
    const tool = createSpawnCellTool(config);

    await tool.execute({ name: 'child', systemPrompt: 'You work.', budget: 3.0 });

    expect(deducted).toBe(3.0);
  });

  it('sets parentRef on child spec', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    await tool.execute({ name: 'child', systemPrompt: 'You work.' });

    const cell = config.kubeClient.createdCells[0]!;
    expect(cell.spec.parentRef).toBe('parent-cell');
  });

  it('does not deduct budget when createCell throws', async () => {
    let deducted = 0;
    const failingKubeClient: KubeClientLite = {
      async createCell(): Promise<void> {
        throw new Error('K8s API unavailable');
      },
    };
    const config = makeConfig({
      kubeClient: failingKubeClient,
      remainingBudget: () => 10.0,
      deductBudget: (amount: number) => { deducted += amount; },
    });
    const tool = createSpawnCellTool(config);

    await expect(
      tool.execute({ name: 'child', systemPrompt: 'You work.', budget: 3.0 }),
    ).rejects.toThrow('K8s API unavailable');

    expect(deducted).toBe(0);
  });

  it('throws on malformed input', async () => {
    const config = makeConfig();
    const tool = createSpawnCellTool(config);

    await expect(tool.execute(null)).rejects.toThrow();
    await expect(tool.execute({})).rejects.toThrow();
    await expect(tool.execute({ name: '' })).rejects.toThrow();
    await expect(tool.execute({ name: 'x' })).rejects.toThrow(); // missing systemPrompt
    await expect(tool.execute(undefined)).rejects.toThrow();
  });
});
