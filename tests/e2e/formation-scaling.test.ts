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
  dumpOperatorLogs,
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
    await dumpOperatorLogs(80);
    console.log('[scaling] Cleaning up...');
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
    console.log('[test] === scale up ===');
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

    console.log('[test] Waiting for initial cell...');
    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        console.log(`[test] Cells: ${cells.length} (need 1)`);
        return cells.length === 1;
      },
      { timeoutMs: 60_000, label: 'initial cell creation' },
    );

    console.log('[test] Scaling from 1 to 3 replicas...');
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

    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        const names = cells.map(
          (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
        );
        console.log(`[test] Cells after scale up: [${names.join(', ')}] (need 3)`);
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
    console.log('[test] PASSED: scaled up to 3');
  });

  it('scales down when replicas are decreased', async () => {
    console.log('[test] === scale down ===');
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

    console.log('[test] Waiting for initial 3 cells...');
    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        console.log(`[test] Cells: ${cells.length} (need 3)`);
        return cells.length === 3;
      },
      { timeoutMs: 60_000, label: 'initial 3 cells creation' },
    );

    console.log('[test] Scaling from 3 to 1 replica...');
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

    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
        const names = cells.map(
          (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
        );
        console.log(`[test] Cells after scale down: [${names.join(', ')}] (need 1)`);
        return cells.length === 1;
      },
      { timeoutMs: 60_000, label: 'scale down to 1 cell' },
    );

    const cells = await listCustomResources('cells', 'kais.io/formation=e2e-scale-formation');
    expect(cells).toHaveLength(1);
    const cellName = ((cells[0] as Record<string, unknown>).metadata as { name: string }).name;
    expect(cellName).toBe('worker-0');
    console.log('[test] PASSED: scaled down to 1');
  });
});
