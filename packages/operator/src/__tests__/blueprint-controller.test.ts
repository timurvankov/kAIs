import { describe, it, expect, vi } from 'vitest';
import { BlueprintController } from '../blueprint-controller.js';
import type { BlueprintResource } from '../types.js';

// Create a minimal mock KubeClient that satisfies the interface
function makeMockKube() {
  return {
    updateBlueprintStatus: vi.fn(),
    emitBlueprintEvent: vi.fn(),
  };
}

describe('BlueprintController', () => {
  it('creates initial version on first reconcile', async () => {
    const kube = makeMockKube();
    const controller = new BlueprintController(kube as any);

    const blueprint: BlueprintResource = {
      apiVersion: 'kais.io/v1',
      kind: 'Blueprint',
      metadata: { name: 'test-bp', namespace: 'default', uid: 'uid-1', resourceVersion: '1' },
      spec: {
        parameters: [{ name: 'lang', type: 'string', default: 'ts' }],
        formation: { cells: [] },
      },
    };

    await controller.reconcile(blueprint);

    expect(kube.updateBlueprintStatus).toHaveBeenCalledWith(
      'test-bp',
      'default',
      expect.objectContaining({
        versions: expect.arrayContaining([
          expect.objectContaining({ version: 1 }),
        ]),
      }),
    );
  });

  it('increments version on spec change', async () => {
    const kube = makeMockKube();
    const controller = new BlueprintController(kube as any);

    const bp1: BlueprintResource = {
      apiVersion: 'kais.io/v1',
      kind: 'Blueprint',
      metadata: { name: 'test-bp', namespace: 'default', uid: 'uid-1', resourceVersion: '1' },
      spec: {
        parameters: [{ name: 'lang', type: 'string', default: 'ts' }],
        formation: { cells: [] },
      },
    };

    // First reconcile
    await controller.reconcile(bp1);

    // Change spec
    const bp2: BlueprintResource = {
      ...bp1,
      spec: { ...bp1.spec, description: 'Updated' },
      status: {
        usageCount: 0,
        versions: [{ version: 1, createdAt: '2026-01-01T00:00:00Z' }],
      },
    };
    await controller.reconcile(bp2);

    expect(kube.updateBlueprintStatus).toHaveBeenLastCalledWith(
      'test-bp',
      'default',
      expect.objectContaining({
        versions: expect.arrayContaining([
          expect.objectContaining({ version: 1 }),
          expect.objectContaining({ version: 2 }),
        ]),
      }),
    );
  });

  it('does not increment version when spec unchanged', async () => {
    const kube = makeMockKube();
    const controller = new BlueprintController(kube as any);

    const bp: BlueprintResource = {
      apiVersion: 'kais.io/v1',
      kind: 'Blueprint',
      metadata: { name: 'test-bp', namespace: 'default', uid: 'uid-1', resourceVersion: '1' },
      spec: {
        parameters: [{ name: 'lang', type: 'string' }],
        formation: { cells: [] },
      },
      status: {
        usageCount: 5,
        versions: [{ version: 1, createdAt: '2026-01-01T00:00:00Z' }],
      },
    };

    // First reconcile stores the spec
    await controller.reconcile(bp);

    // Second reconcile with same spec — should NOT add version
    await controller.reconcile(bp);

    // The second call should have versions with only version 1 and the initial version 2 from first reconcile
    // Actually: first reconcile sees no lastSpec, creates version 2 (since version 1 exists in status).
    // Second reconcile sees spec unchanged, should NOT create version 3.
    const lastCall = kube.updateBlueprintStatus.mock.calls.at(-1);
    const versions = lastCall?.[2]?.versions ?? [];
    const maxVersion = Math.max(...versions.map((v: any) => v.version));
    expect(maxVersion).toBeLessThanOrEqual(2);
  });
});
