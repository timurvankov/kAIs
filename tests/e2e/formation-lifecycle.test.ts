/**
 * E2E: Formation CRD lifecycle — create, verify child Cells, scale, delete cascade.
 */
import { describe, it, afterEach, expect, beforeAll } from 'vitest';
import {
  applyFormation,
  deleteFormation,
  deleteCell,
  listPods,
  waitFor,
  getCustomResource,
  customApi,
  dumpClusterState,
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
  beforeAll(async () => {
    console.log('[formation-lifecycle] Starting test suite');
    await dumpClusterState('before formation-lifecycle tests');
  });

  afterEach(async () => {
    console.log('[formation-lifecycle] Cleaning up...');
    await deleteFormation('e2e-test-formation');
    await waitFor(
      async () => {
        const cells = await listCells('kais.io/formation=e2e-test-formation');
        return cells.length === 0;
      },
      { timeoutMs: 30_000, label: 'cell cleanup' },
    ).catch(() => {
      console.log('[cleanup] Cell cleanup timed out (best effort)');
    });
  });

  it('creates child Cell CRDs when Formation is applied', async () => {
    console.log('[test] === creates child Cell CRDs ===');
    await applyFormation(TEST_FORMATION);

    await waitFor(
      async () => {
        const cells = await listCells('kais.io/formation=e2e-test-formation');
        if (cells.length > 0) {
          const names = cells.map(
            (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
          );
          console.log(`[test] Cells found: [${names.join(', ')}] (need 2)`);
        }
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
    console.log('[test] PASSED: child Cell CRDs created');
  });

  it('creates Pods for each child Cell', async () => {
    console.log('[test] === creates Pods for each child Cell ===');
    await applyFormation(TEST_FORMATION);

    await waitFor(
      async () => {
        const pods = await listPods('kais.io/formation=e2e-test-formation');
        for (const pod of pods) {
          const phase = pod.status?.phase ?? '?';
          console.log(`[test] Pod ${pod.metadata?.name}: phase=${phase}`);
        }
        return pods.length === 2;
      },
      { timeoutMs: 90_000, label: 'pod creation for formation cells' },
    );

    const pods = await listPods('kais.io/formation=e2e-test-formation');
    expect(pods).toHaveLength(2);
    console.log('[test] PASSED: Pods created for formation cells');
  });

  it('updates Formation status with cell counts', async () => {
    console.log('[test] === updates Formation status ===');
    await applyFormation(TEST_FORMATION);

    await waitFor(
      async () => {
        const formation = await getCustomResource('formations', 'e2e-test-formation');
        if (!formation) {
          console.log('[test] Formation resource not found');
          return false;
        }
        const status = formation.status as { phase?: string; totalCells?: number } | undefined;
        console.log(`[test] Formation status: phase=${status?.phase ?? 'none'}, totalCells=${status?.totalCells ?? 0}`);
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
    console.log('[test] PASSED: Formation status updated');
  });

  it('cascade-deletes child Cells when Formation is deleted', async () => {
    console.log('[test] === cascade-deletes child Cells ===');
    await applyFormation(TEST_FORMATION);

    await waitFor(
      async () => {
        const cells = await listCells('kais.io/formation=e2e-test-formation');
        console.log(`[test] Cells: ${cells.length} (waiting for 2)`);
        return cells.length === 2;
      },
      { timeoutMs: 60_000, label: 'cell creation for delete test' },
    );

    console.log('[test] Deleting Formation to test cascade...');
    await deleteFormation('e2e-test-formation');

    await waitFor(
      async () => {
        const cells = await listCells('kais.io/formation=e2e-test-formation');
        console.log(`[test] Remaining cells after delete: ${cells.length}`);
        return cells.length === 0;
      },
      { timeoutMs: 30_000, label: 'cascade deletion' },
    );

    const cells = await listCells('kais.io/formation=e2e-test-formation');
    expect(cells).toHaveLength(0);
    console.log('[test] PASSED: cascade deletion verified');
  });
});
