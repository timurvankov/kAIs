/**
 * E2E: Formation CRD lifecycle — create, verify child Cells, scale, delete cascade.
 */
import { describe, it, afterEach, expect } from 'vitest';
import {
  applyFormation,
  deleteFormation,
  deleteCell,
  listPods,
  waitFor,
  getCustomResource,
  customApi,
} from './helpers.js';

const TEST_FORMATION = {
  apiVersion: 'kais.io/v1',
  kind: 'Formation',
  metadata: {
    name: 'e2e-test-formation',
    namespace: 'default',
  },
  spec: {
    cells: [
      {
        name: 'worker',
        replicas: 2,
        spec: {
          mind: {
            provider: 'ollama',
            model: 'qwen2.5:0.5b',
            systemPrompt: 'You are a worker cell.',
            temperature: 0,
          },
          tools: [{ name: 'send_message' }],
          resources: {
            maxTokensPerTurn: 256,
            maxCostPerHour: 0,
            memoryLimit: '128Mi',
            cpuLimit: '250m',
          },
        },
      },
    ],
    topology: {
      type: 'full_mesh',
    },
    budget: {
      maxTotalCost: 1.0,
    },
  },
};

async function listCells(labelSelector: string): Promise<unknown[]> {
  const res = await customApi.listNamespacedCustomObject({
    group: 'kais.io',
    version: 'v1',
    namespace: 'default',
    plural: 'cells',
    labelSelector,
  });
  return ((res as Record<string, unknown>).items as unknown[]) ?? [];
}

describe('Formation CRD Lifecycle', () => {
  afterEach(async () => {
    await deleteFormation('e2e-test-formation');
    // Clean up any leftover cells
    await waitFor(
      async () => {
        const cells = await listCells('kais.io/formation=e2e-test-formation');
        return cells.length === 0;
      },
      { timeoutMs: 30_000, label: 'cell cleanup' },
    ).catch(() => {
      // Best effort cleanup
    });
  });

  it('creates child Cell CRDs when Formation is applied', async () => {
    await applyFormation(TEST_FORMATION);

    // Wait for child Cells to be created
    await waitFor(
      async () => {
        const cells = await listCells('kais.io/formation=e2e-test-formation');
        return cells.length === 2;
      },
      { timeoutMs: 60_000, label: 'child cell creation' },
    );

    const cells = await listCells('kais.io/formation=e2e-test-formation');
    expect(cells).toHaveLength(2);

    const cellNames = cells.map(
      (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
    );
    expect(cellNames).toContain('worker-0');
    expect(cellNames).toContain('worker-1');
  });

  it('creates Pods for each child Cell', async () => {
    await applyFormation(TEST_FORMATION);

    // Wait for Pods to appear
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/formation=e2e-test-formation');
        return pods.length === 2;
      },
      { timeoutMs: 90_000, label: 'pod creation for formation cells' },
    );

    const pods = await listPods('kais.io/formation=e2e-test-formation');
    expect(pods).toHaveLength(2);
  });

  it('updates Formation status with cell counts', async () => {
    await applyFormation(TEST_FORMATION);

    await waitFor(
      async () => {
        const formation = await getCustomResource('formations', 'e2e-test-formation');
        if (!formation) return false;
        const status = formation.status as { totalCells?: number } | undefined;
        return (status?.totalCells ?? 0) === 2;
      },
      { timeoutMs: 90_000, label: 'formation status update' },
    );

    const formation = await getCustomResource('formations', 'e2e-test-formation');
    const status = (formation as Record<string, unknown>).status as {
      phase: string;
      totalCells: number;
    };
    expect(status.totalCells).toBe(2);
  });

  it('cascade-deletes child Cells when Formation is deleted', async () => {
    await applyFormation(TEST_FORMATION);

    // Wait for cells to exist
    await waitFor(
      async () => {
        const cells = await listCells('kais.io/formation=e2e-test-formation');
        return cells.length === 2;
      },
      { timeoutMs: 60_000, label: 'cell creation for delete test' },
    );

    // Delete formation
    await deleteFormation('e2e-test-formation');

    // Verify cells are garbage collected
    await waitFor(
      async () => {
        const cells = await listCells('kais.io/formation=e2e-test-formation');
        return cells.length === 0;
      },
      { timeoutMs: 30_000, label: 'cascade deletion' },
    );

    const cells = await listCells('kais.io/formation=e2e-test-formation');
    expect(cells).toHaveLength(0);
  });
});
