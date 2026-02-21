import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeGraphController } from '../knowledgegraph-controller.js';
import type { KnowledgeGraphResource } from '../types.js';

function makeMockKube() {
  return {
    updateKnowledgeGraphStatus: vi.fn(),
    emitKnowledgeGraphEvent: vi.fn(),
    listKnowledgeGraphs: vi.fn().mockResolvedValue([]),
    createPod: vi.fn(),
    createService: vi.fn(),
    deletePod: vi.fn(),
    deleteService: vi.fn(),
  };
}

function makeKG(overrides: Record<string, unknown> = {}): KnowledgeGraphResource {
  return {
    apiVersion: 'kais.io/v1',
    kind: 'KnowledgeGraph',
    metadata: { name: 'test-kg', namespace: 'default' },
    spec: { scope: { level: 'realm', realmId: 'trading' }, dedicated: false, inherit: true },
    ...overrides,
  } as KnowledgeGraphResource;
}

describe('KnowledgeGraphController', () => {
  let kube: ReturnType<typeof makeMockKube>;
  let controller: KnowledgeGraphController;

  beforeEach(() => {
    kube = makeMockKube();
    controller = new KnowledgeGraphController(kube);
  });

  it('sets phase to Ready for shared mode', async () => {
    await controller.reconcile(makeKG());
    expect(kube.updateKnowledgeGraphStatus).toHaveBeenCalledWith(
      'test-kg', 'default',
      expect.objectContaining({ phase: 'Ready', database: 'test-kg' }),
    );
  });

  it('creates Pod and Service for dedicated mode', async () => {
    const kg = makeKG({
      spec: {
        scope: { level: 'formation', realmId: 'trading', formationId: 'alpha' },
        dedicated: true, inherit: true,
        resources: { memory: '1Gi', cpu: '500m', storage: '10Gi' },
      },
    });
    await controller.reconcile(kg);
    expect(kube.createPod).toHaveBeenCalled();
    expect(kube.createService).toHaveBeenCalled();
    expect(kube.updateKnowledgeGraphStatus).toHaveBeenCalledWith(
      'test-kg', 'default',
      expect.objectContaining({ phase: 'Ready' }),
    );
  });

  it('resolves parentChain', async () => {
    const parent = makeKG({
      metadata: { name: 'platform-kg', namespace: 'default' },
      spec: { scope: { level: 'platform' }, dedicated: false, inherit: true },
    });
    const child = makeKG({
      spec: { scope: { level: 'realm', realmId: 'trading' }, parentRef: 'platform-kg', dedicated: false, inherit: true },
    });
    kube.listKnowledgeGraphs.mockResolvedValue([parent, child]);
    await controller.reconcile(child);
    expect(kube.updateKnowledgeGraphStatus).toHaveBeenCalledWith(
      'test-kg', 'default',
      expect.objectContaining({ parentChain: ['platform-kg'] }),
    );
  });

  it('handles missing parentRef (empty parentChain)', async () => {
    kube.listKnowledgeGraphs.mockResolvedValue([makeKG()]);
    await controller.reconcile(makeKG());
    expect(kube.updateKnowledgeGraphStatus).toHaveBeenCalledWith(
      'test-kg', 'default',
      expect.objectContaining({ parentChain: [] }),
    );
  });

  it('cleans up dedicated resources on delete', async () => {
    const kg = makeKG({
      spec: { scope: { level: 'realm', realmId: 'trading' }, dedicated: true, inherit: true },
    });
    await controller.reconcileDelete(kg);
    expect(kube.deletePod).toHaveBeenCalledWith('neo4j-test-kg', 'default');
    expect(kube.deleteService).toHaveBeenCalledWith('neo4j-test-kg', 'default');
  });
});
