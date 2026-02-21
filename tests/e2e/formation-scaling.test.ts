/**
 * E2E: Formation scaling — scale up and down by patching replicas.
 */
import { describe, it, afterEach, expect } from 'vitest';
import {
  applyFormation,
  deleteFormation,
  waitFor,
  getCustomResource,
  listCustomResources,
  customApi,
} from './helpers.js';

const CELL_SPEC = {
  mind: {
    provider: 'ollama',
    model: 'qwen2.5:0.5b',
    systemPrompt: 'Scale test cell.',
    temperature: 0,
  },
  tools: [],
  resources: {
    maxTokensPerTurn: 256,
    maxCostPerHour: 0,
    memoryLimit: '128Mi',
    cpuLimit: '250m',
  },
};

describe('Formation Scaling', () => {
  afterEach(async () => {
    await deleteFormation('e2e-scale-formation');
    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        return cells.length === 0;
      },
      { timeoutMs: 30_000, label: 'scale test cleanup' },
    ).catch(() => {});
  });

  it('scales up when replicas are increased', async () => {
    const formation = {
      apiVersion: 'kais.io/v1',
      kind: 'Formation',
      metadata: { name: 'e2e-scale-formation', namespace: 'default' },
      spec: {
        cells: [{ name: 'worker', replicas: 1, spec: CELL_SPEC }],
        topology: { type: 'full_mesh' as const },
      },
    };

    await applyFormation(formation);

    // Wait for initial cell
    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        return cells.length === 1;
      },
      { timeoutMs: 60_000, label: 'initial cell creation' },
    );

    // Scale up to 3 replicas by patching the formation
    const currentFormation = await getCustomResource('formations', 'e2e-scale-formation');
    const spec = (currentFormation as Record<string, unknown>).spec as {
      cells: Array<{ name: string; replicas: number; spec: unknown }>;
      topology: unknown;
    };
    spec.cells[0].replicas = 3;

    await customApi.replaceNamespacedCustomObject({
      group: 'kais.io',
      version: 'v1',
      namespace: 'default',
      plural: 'formations',
      name: 'e2e-scale-formation',
      body: {
        apiVersion: 'kais.io/v1',
        kind: 'Formation',
        metadata: (currentFormation as Record<string, unknown>).metadata,
        spec,
      },
    });

    // Wait for 3 cells
    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        return cells.length === 3;
      },
      { timeoutMs: 60_000, label: 'scale up to 3 cells' },
    );

    const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
    expect(cells).toHaveLength(3);

    const cellNames = cells.map(
      (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
    );
    expect(cellNames).toContain('worker-0');
    expect(cellNames).toContain('worker-1');
    expect(cellNames).toContain('worker-2');
  });

  it('scales down when replicas are decreased', async () => {
    const formation = {
      apiVersion: 'kais.io/v1',
      kind: 'Formation',
      metadata: { name: 'e2e-scale-formation', namespace: 'default' },
      spec: {
        cells: [{ name: 'worker', replicas: 3, spec: CELL_SPEC }],
        topology: { type: 'full_mesh' as const },
      },
    };

    await applyFormation(formation);

    // Wait for all 3 cells
    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        return cells.length === 3;
      },
      { timeoutMs: 60_000, label: 'initial 3 cells creation' },
    );

    // Scale down to 1 replica
    const currentFormation = await getCustomResource('formations', 'e2e-scale-formation');
    const spec = (currentFormation as Record<string, unknown>).spec as {
      cells: Array<{ name: string; replicas: number; spec: unknown }>;
      topology: unknown;
    };
    spec.cells[0].replicas = 1;

    await customApi.replaceNamespacedCustomObject({
      group: 'kais.io',
      version: 'v1',
      namespace: 'default',
      plural: 'formations',
      name: 'e2e-scale-formation',
      body: {
        apiVersion: 'kais.io/v1',
        kind: 'Formation',
        metadata: (currentFormation as Record<string, unknown>).metadata,
        spec,
      },
    });

    // Wait for cells to be reduced to 1
    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        return cells.length === 1;
      },
      { timeoutMs: 60_000, label: 'scale down to 1 cell' },
    );

    const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
    expect(cells).toHaveLength(1);
    const cellName = ((cells[0] as Record<string, unknown>).metadata as { name: string }).name;
    expect(cellName).toBe('worker-0');
  });
});
