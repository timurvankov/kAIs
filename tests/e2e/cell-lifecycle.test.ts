/**
 * E2E: Cell CRD lifecycle — create, verify Pod, delete, verify cleanup.
 */
import { describe, it, afterEach, expect, beforeAll } from 'vitest';
import { applyCell, deleteCell, listPods, waitFor, getCustomResource, dumpClusterState } from './helpers.js';

const TEST_CELL = {
  apiVersion: 'kais.io/v1',
  kind: 'Cell',
  metadata: {
    name: 'e2e-test-cell',
    namespace: 'default',
  },
  spec: {
    mind: {
      provider: 'ollama',
      model: 'qwen2.5:0.5b',
      systemPrompt: 'You are a test cell. Reply with "ok".',
      temperature: 0,
    },
    tools: [],
    resources: {
      maxTokensPerTurn: 256,
      maxCostPerHour: 0,
      memoryLimit: '128Mi',
      cpuLimit: '250m',
    },
  },
};

describe('Cell CRD Lifecycle', () => {
  beforeAll(async () => {
    console.log('[cell-lifecycle] Starting test suite');
    await dumpClusterState('before cell-lifecycle tests');
  });

  afterEach(async () => {
    console.log('[cell-lifecycle] Cleaning up...');
    await deleteCell('e2e-test-cell');
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-test-cell');
        return pods.length === 0;
      },
      { timeoutMs: 30_000, label: 'pod deletion' },
    );
  });

  it('creates a Pod when Cell CRD is applied', async () => {
    console.log('[test] === creates a Pod when Cell CRD is applied ===');
    await applyCell(TEST_CELL);

    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-test-cell');
        if (pods.length > 0) {
          const pod = pods[0]!;
          console.log(`[test] Pod ${pod.metadata?.name}: phase=${pod.status?.phase ?? '?'}`);
        }
        return pods.length === 1;
      },
      { timeoutMs: 60_000, label: 'pod creation' },
    );

    const pods = await listPods('kais.io/cell=e2e-test-cell');
    expect(pods).toHaveLength(1);

    const pod = pods[0]!;
    expect(pod.metadata?.name).toBe('cell-e2e-test-cell');
    expect(pod.spec?.containers).toBeDefined();

    const container = pod.spec!.containers[0]!;
    expect(container.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'CELL_NAME', value: 'e2e-test-cell' }),
      ]),
    );
    console.log('[test] PASSED: Pod created with correct spec');
  });

  it('updates Cell status to Running when Pod is ready', async () => {
    console.log('[test] === updates Cell status to Running ===');
    await applyCell(TEST_CELL);

    await waitFor(
      async () => {
        const cell = await getCustomResource('cells', 'e2e-test-cell');
        if (!cell) {
          console.log('[test] Cell resource not found yet');
          return false;
        }
        const status = cell.status as { phase?: string } | undefined;
        console.log(`[test] Cell status: phase=${status?.phase ?? 'none'}`);
        return status?.phase === 'Running';
      },
      { timeoutMs: 90_000, label: 'cell running' },
    );

    const cell = await getCustomResource('cells', 'e2e-test-cell');
    expect(cell).not.toBeNull();
    const status = (cell as Record<string, unknown>).status as { phase: string };
    expect(status.phase).toBe('Running');
    console.log('[test] PASSED: Cell status is Running');
  });

  it('cleans up Pod when Cell CRD is deleted', async () => {
    console.log('[test] === cleans up Pod when Cell CRD is deleted ===');
    await applyCell(TEST_CELL);

    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-test-cell');
        return pods.length === 1;
      },
      { timeoutMs: 60_000, label: 'pod creation for delete test' },
    );

    console.log('[test] Deleting Cell CRD...');
    await deleteCell('e2e-test-cell');

    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-test-cell');
        console.log(`[test] Pods remaining after delete: ${pods.length}`);
        return pods.length === 0;
      },
      { timeoutMs: 30_000, label: 'pod cleanup after cell delete' },
    );

    const pods = await listPods('kais.io/cell=e2e-test-cell');
    expect(pods).toHaveLength(0);
    console.log('[test] PASSED: Pod cleaned up');
  });
});
