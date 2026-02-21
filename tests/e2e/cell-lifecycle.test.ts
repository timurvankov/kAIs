/**
 * E2E: Cell CRD lifecycle — create, verify Pod, delete, verify cleanup.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { applyCell, deleteCell, listPods, waitFor, getCustomResource } from './helpers.js';

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
  afterEach(async () => {
    await deleteCell('e2e-test-cell');
    // Wait for Pod cleanup
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-test-cell');
        return pods.length === 0;
      },
      { timeoutMs: 30_000, label: 'pod deletion' },
    );
  });

  it('creates a Pod when Cell CRD is applied', async () => {
    await applyCell(TEST_CELL);

    // Wait for Pod to be created by the operator
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-test-cell');
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
  });

  it('updates Cell status to Running when Pod is ready', async () => {
    await applyCell(TEST_CELL);

    // Wait for Cell status to be updated
    await waitFor(
      async () => {
        const cell = await getCustomResource('cells', 'e2e-test-cell');
        if (!cell) return false;
        const status = cell.status as { phase?: string } | undefined;
        return status?.phase === 'Running';
      },
      { timeoutMs: 90_000, label: 'cell running' },
    );

    const cell = await getCustomResource('cells', 'e2e-test-cell');
    expect(cell).not.toBeNull();
    const status = (cell as Record<string, unknown>).status as { phase: string };
    expect(status.phase).toBe('Running');
  });

  it('cleans up Pod when Cell CRD is deleted', async () => {
    await applyCell(TEST_CELL);

    // Wait for Pod to exist
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-test-cell');
        return pods.length === 1;
      },
      { timeoutMs: 60_000, label: 'pod creation for delete test' },
    );

    // Delete the Cell CRD
    await deleteCell('e2e-test-cell');

    // Wait for Pod to be cleaned up via ownerReferences cascade
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-test-cell');
        return pods.length === 0;
      },
      { timeoutMs: 30_000, label: 'pod cleanup after cell delete' },
    );

    const pods = await listPods('kais.io/cell=e2e-test-cell');
    expect(pods).toHaveLength(0);
  });
});
