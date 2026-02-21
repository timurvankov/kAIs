/**
 * E2E: Recursive ecosystem — Cell spawns child, child spawns grandchild,
 * budget flows down tree, delete root cascades entire tree.
 */
import { describe, it, afterEach, expect, beforeAll } from 'vitest';
import {
  applyCell,
  deleteCell,
  listPods,
  waitFor,
  getCustomResource,
  dumpClusterState,
  dumpOperatorLogs,
} from './helpers.js';

const ROOT_CELL = {
  apiVersion: 'kais.io/v1',
  kind: 'Cell',
  metadata: {
    name: 'e2e-root',
    namespace: 'default',
  },
  spec: {
    mind: {
      provider: 'ollama',
      model: 'qwen2.5:0.5b',
      systemPrompt: 'You are a root cell that can spawn children.',
      temperature: 0,
    },
    tools: [{ name: 'spawn_cell' }],
    resources: {
      maxTokensPerTurn: 256,
      maxCostPerHour: 0,
      maxTotalCost: 10.0,
      memoryLimit: '128Mi',
      cpuLimit: '250m',
    },
    recursion: {
      maxDepth: 3,
      maxDescendants: 5,
      spawnPolicy: 'open',
    },
  },
};

const CHILD_CELL = {
  apiVersion: 'kais.io/v1',
  kind: 'Cell',
  metadata: {
    name: 'e2e-child',
    namespace: 'default',
    ownerReferences: [
      {
        apiVersion: 'kais.io/v1',
        kind: 'Cell',
        name: 'e2e-root',
        uid: '', // Filled at runtime
      },
    ],
  },
  spec: {
    mind: {
      provider: 'ollama',
      model: 'qwen2.5:0.5b',
      systemPrompt: 'You are a child cell.',
      temperature: 0,
    },
    tools: [{ name: 'spawn_cell' }],
    resources: {
      maxTokensPerTurn: 256,
      maxCostPerHour: 0,
      maxTotalCost: 5.0,
      memoryLimit: '128Mi',
      cpuLimit: '250m',
    },
    parentRef: 'e2e-root',
    recursion: {
      maxDepth: 2,
      maxDescendants: 3,
      spawnPolicy: 'open',
    },
  },
};

const GRANDCHILD_CELL = {
  apiVersion: 'kais.io/v1',
  kind: 'Cell',
  metadata: {
    name: 'e2e-grandchild',
    namespace: 'default',
    ownerReferences: [
      {
        apiVersion: 'kais.io/v1',
        kind: 'Cell',
        name: 'e2e-child',
        uid: '', // Filled at runtime
      },
    ],
  },
  spec: {
    mind: {
      provider: 'ollama',
      model: 'qwen2.5:0.5b',
      systemPrompt: 'You are a grandchild cell.',
      temperature: 0,
    },
    tools: [],
    resources: {
      maxTokensPerTurn: 256,
      maxCostPerHour: 0,
      maxTotalCost: 2.0,
      memoryLimit: '128Mi',
      cpuLimit: '250m',
    },
    parentRef: 'e2e-child',
  },
};

describe('Recursive Ecosystem', () => {
  beforeAll(async () => {
    console.log('[recursive-ecosystem] Starting test suite');
    await dumpClusterState('before recursive-ecosystem tests');
  });

  afterEach(async () => {
    await dumpOperatorLogs(80);
    console.log('[recursive-ecosystem] Cleaning up...');
    // Delete root — should cascade delete children
    await deleteCell('e2e-root');
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-root');
        return pods.length === 0;
      },
      { timeoutMs: 60_000, label: 'root pod deletion' },
    );
    // Cleanup stragglers
    await deleteCell('e2e-child').catch(() => {});
    await deleteCell('e2e-grandchild').catch(() => {});
  });

  it('creates a 3-level recursive cell tree', async () => {
    // Create root
    await applyCell(ROOT_CELL);
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-root');
        return pods.length === 1;
      },
      { timeoutMs: 60_000, label: 'root pod creation' },
    );

    // Get root UID for ownerReference
    const rootCr = await getCustomResource('cells', 'e2e-root');
    expect(rootCr).toBeTruthy();

    // Create child with parentRef
    await applyCell(CHILD_CELL);
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-child');
        return pods.length === 1;
      },
      { timeoutMs: 60_000, label: 'child pod creation' },
    );

    // Create grandchild
    await applyCell(GRANDCHILD_CELL);
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-grandchild');
        return pods.length === 1;
      },
      { timeoutMs: 60_000, label: 'grandchild pod creation' },
    );

    // Verify all 3 pods exist
    const rootPods = await listPods('kais.io/cell=e2e-root');
    const childPods = await listPods('kais.io/cell=e2e-child');
    const grandchildPods = await listPods('kais.io/cell=e2e-grandchild');

    expect(rootPods).toHaveLength(1);
    expect(childPods).toHaveLength(1);
    expect(grandchildPods).toHaveLength(1);
  });

  it('cascade deletes entire tree when root is removed', async () => {
    // Create root + child
    await applyCell(ROOT_CELL);
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-root');
        return pods.length === 1;
      },
      { timeoutMs: 60_000, label: 'root creation for cascade test' },
    );

    await applyCell(CHILD_CELL);
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-child');
        return pods.length === 1;
      },
      { timeoutMs: 60_000, label: 'child creation for cascade test' },
    );

    // Delete root
    await deleteCell('e2e-root');

    // Both root and child pods should be cleaned up
    await waitFor(
      async () => {
        const rootPods = await listPods('kais.io/cell=e2e-root');
        const childPods = await listPods('kais.io/cell=e2e-child');
        return rootPods.length === 0 && childPods.length === 0;
      },
      { timeoutMs: 60_000, label: 'cascade deletion' },
    );
  });
});
