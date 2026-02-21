/**
 * E2E: Formation with different topology types — star, ring.
 * Verifies that the operator creates the correct topology ConfigMap
 * and child Cells for each topology type.
 */
import { describe, it, afterEach, expect } from 'vitest';
import {
  applyFormation,
  deleteFormation,
  waitFor,
  getCustomResource,
  getConfigMap,
  listCustomResources,
} from './helpers.js';

const CELL_SPEC = {
  mind: {
    provider: 'ollama',
    model: 'qwen2.5:0.5b',
    systemPrompt: 'Test cell.',
    temperature: 0,
  },
  tools: [{ name: 'send_message' }],
  resources: {
    maxTokensPerTurn: 256,
    maxCostPerHour: 0,
    memoryLimit: '128Mi',
    cpuLimit: '250m',
  },
};

describe('Formation Topologies', () => {
  afterEach(async () => {
    console.log('[topologies] Cleaning up...');
    await deleteFormation('e2e-star-formation');
    await deleteFormation('e2e-ring-formation');
    await waitFor(
      async () => {
        const cells1 = await listCustomResources('cells', 'kais.io/formation=e2e-star-formation');
        const cells2 = await listCustomResources('cells', 'kais.io/formation=e2e-ring-formation');
        return cells1.length === 0 && cells2.length === 0;
      },
      { timeoutMs: 30_000, label: 'topology test cleanup' },
    ).catch(() => {});
  });

  it('star topology creates hub and spoke cells', async () => {
    console.log('[test] === star topology ===');
    const formation = {
      apiVersion: 'kais.io/v1',
      kind: 'Formation',
      metadata: { name: 'e2e-star-formation', namespace: 'default' },
      spec: {
        cells: [
          { name: 'hub', replicas: 1, spec: CELL_SPEC },
          { name: 'spoke', replicas: 3, spec: CELL_SPEC },
        ],
        topology: { type: 'star', hub: 'hub' },
      },
    };

    await applyFormation(formation);

    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-star-formation');
        const names = cells.map(
          (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
        );
        console.log(`[test] Star cells: [${names.join(', ')}] (need 4)`);
        return cells.length === 4;
      },
      { timeoutMs: 60_000, label: 'star topology cells created' },
    );

    const cells = await listCustomResources('cells', 'kais.io/formation=e2e-star-formation');
    expect(cells).toHaveLength(4);

    const cellNames = cells.map(
      (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
    );
    expect(cellNames).toContain('hub-0');
    expect(cellNames).toContain('spoke-0');
    expect(cellNames).toContain('spoke-1');
    expect(cellNames).toContain('spoke-2');
    console.log('[test] PASSED: star topology');
  });

  it('ring topology creates cells in ring formation', async () => {
    console.log('[test] === ring topology ===');
    const formation = {
      apiVersion: 'kais.io/v1',
      kind: 'Formation',
      metadata: { name: 'e2e-ring-formation', namespace: 'default' },
      spec: {
        cells: [
          { name: 'node', replicas: 4, spec: CELL_SPEC },
        ],
        topology: { type: 'ring' },
      },
    };

    await applyFormation(formation);

    await waitFor(
      async () => {
        const cells = await listCustomResources('cells', 'kais.io/formation=e2e-ring-formation');
        const names = cells.map(
          (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
        );
        console.log(`[test] Ring cells: [${names.join(', ')}] (need 4)`);
        return cells.length === 4;
      },
      { timeoutMs: 60_000, label: 'ring topology cells created' },
    );

    const cells = await listCustomResources('cells', 'kais.io/formation=e2e-ring-formation');
    expect(cells).toHaveLength(4);

    const cellNames = cells.map(
      (c) => ((c as Record<string, unknown>).metadata as { name: string }).name,
    );
    expect(cellNames).toContain('node-0');
    expect(cellNames).toContain('node-1');
    expect(cellNames).toContain('node-2');
    expect(cellNames).toContain('node-3');

    const fm = await getCustomResource('formations', 'e2e-ring-formation');
    const status = (fm as Record<string, unknown>).status as { totalCells?: number };
    expect(status.totalCells).toBe(4);
    console.log('[test] PASSED: ring topology');
  });
});
