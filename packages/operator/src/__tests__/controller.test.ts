import type * as k8s from '@kubernetes/client-node';
import type { CellStatus } from '@kais/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CellController } from '../controller.js';
import type { CellEventType, CellResource, KubeClient } from '../types.js';

// --- Mock KubeClient ---

interface EmitEventCall {
  cell: CellResource;
  eventType: CellEventType;
  reason: string;
  message: string;
}

interface StatusUpdateCall {
  name: string;
  namespace: string;
  status: CellStatus;
}

function createMockClient(): KubeClient & {
  pods: Map<string, k8s.V1Pod>;
  cells: Map<string, CellResource>;
  statusUpdates: StatusUpdateCall[];
  emittedEvents: EmitEventCall[];
  createPodCalls: k8s.V1Pod[];
  deletePodCalls: { name: string; namespace: string }[];
} {
  const pods = new Map<string, k8s.V1Pod>();
  const cells = new Map<string, CellResource>();
  const statusUpdates: StatusUpdateCall[] = [];
  const emittedEvents: EmitEventCall[] = [];
  const createPodCalls: k8s.V1Pod[] = [];
  const deletePodCalls: { name: string; namespace: string }[] = [];

  return {
    pods,
    cells,
    statusUpdates,
    emittedEvents,
    createPodCalls,
    deletePodCalls,

    async getPod(name: string, namespace: string): Promise<k8s.V1Pod | null> {
      return pods.get(`${namespace}/${name}`) ?? null;
    },

    async createPod(pod: k8s.V1Pod): Promise<k8s.V1Pod> {
      createPodCalls.push(pod);
      const key = `${pod.metadata?.namespace}/${pod.metadata?.name}`;
      pods.set(key, pod);
      return pod;
    },

    async deletePod(name: string, namespace: string): Promise<void> {
      deletePodCalls.push({ name, namespace });
      pods.delete(`${namespace}/${name}`);
    },

    async listPods(_namespace: string, _labelSelector: string): Promise<k8s.V1PodList> {
      const items: k8s.V1Pod[] = [];
      for (const pod of pods.values()) {
        if (pod.metadata?.labels?.['kais.io/role'] === 'cell') {
          items.push(pod);
        }
      }
      return { items } as k8s.V1PodList;
    },

    async getCell(name: string, namespace: string): Promise<CellResource | null> {
      return cells.get(`${namespace}/${name}`) ?? null;
    },

    async updateCellStatus(
      name: string,
      namespace: string,
      status: CellStatus,
    ): Promise<void> {
      statusUpdates.push({ name, namespace, status });
    },

    async emitEvent(
      cell: CellResource,
      eventType: CellEventType,
      reason: string,
      message: string,
    ): Promise<void> {
      emittedEvents.push({ cell, eventType, reason, message });
    },

    // Stub methods required by KubeClient interface but not used by CellController
    async createCell(cell: CellResource): Promise<CellResource> { return cell; },
    async updateCell(): Promise<void> {},
    async deleteCell(): Promise<void> {},
    async listCells(): Promise<CellResource[]> { return []; },
    async updateFormationStatus(): Promise<void> {},
    async createOrUpdateConfigMap(): Promise<void> {},
    async createPVC(): Promise<void> {},
    async getPVC(): Promise<k8s.V1PersistentVolumeClaim | null> { return null; },
    async emitFormationEvent(): Promise<void> {},
    async updateMissionStatus(): Promise<void> {},
    async emitMissionEvent(): Promise<void> {},
    async updateExperimentStatus(): Promise<void> {},
    async emitExperimentEvent(): Promise<void> {},
    updateBlueprintStatus: vi.fn(),
    emitBlueprintEvent: vi.fn(),
    updateKnowledgeGraphStatus: vi.fn(),
    emitKnowledgeGraphEvent: vi.fn(),
    listKnowledgeGraphs: vi.fn().mockResolvedValue([]),
    createKnowledgeGraphPod: vi.fn(),
    createKnowledgeGraphService: vi.fn(),
    deleteKnowledgeGraphPod: vi.fn(),
    deleteKnowledgeGraphService: vi.fn(),
    updateEvolutionStatus: vi.fn(),
    updateSwarmStatus: vi.fn(),
    updateChannelStatus: vi.fn(),
    updateFederationStatus: vi.fn(),
  };
}

function makeCell(overrides: Partial<CellResource> = {}): CellResource {
  return {
    apiVersion: 'kais.io/v1',
    kind: 'Cell',
    metadata: {
      name: 'researcher',
      namespace: 'default',
      uid: 'abc-123-def',
      resourceVersion: '1',
    },
    spec: {
      mind: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a helpful assistant.',
      },
    },
    ...overrides,
  };
}

function makeRunningPod(cell: CellResource): k8s.V1Pod {
  return {
    metadata: {
      name: `cell-${cell.metadata.name}`,
      namespace: cell.metadata.namespace,
      labels: {
        'kais.io/cell': cell.metadata.name,
        'kais.io/role': 'cell',
      },
    },
    spec: {
      containers: [
        {
          name: 'mind',
          image: 'kais-cell:latest',
          env: [
            { name: 'CELL_SPEC', value: JSON.stringify(cell.spec) },
            { name: 'CELL_NAME', value: cell.metadata.name },
            { name: 'CELL_NAMESPACE', value: cell.metadata.namespace },
          ],
        },
      ],
    },
    status: {
      phase: 'Running',
    },
  };
}

// We construct CellController without a real KubeConfig since we only
// test reconcileCell which uses the KubeClient abstraction.
// The informer/watch functionality requires a real cluster.
function createController(client: KubeClient): CellController {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new CellController(null as any, client);
}

describe('CellController.reconcileCell', () => {
  let client: ReturnType<typeof createMockClient>;
  let controller: CellController;

  beforeEach(() => {
    client = createMockClient();
    controller = createController(client);
  });

  it('creates a Pod when Cell is added and no Pod exists', async () => {
    const cell = makeCell();

    await controller.reconcileCell(cell);

    // Pod should be created
    expect(client.createPodCalls).toHaveLength(1);
    const createdPod = client.createPodCalls[0]!;
    expect(createdPod.metadata?.name).toBe('cell-researcher');
    expect(createdPod.metadata?.namespace).toBe('default');

    // Status should be updated to Pending (Pod is not yet running)
    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.phase).toBe('Pending');
    expect(client.statusUpdates[0]!.status.podName).toBe('cell-researcher');

    // Event should be emitted
    expect(client.emittedEvents).toHaveLength(1);
    expect(client.emittedEvents[0]!.eventType).toBe('CellCreated');
    expect(client.emittedEvents[0]!.reason).toBe('PodCreated');
  });

  it('syncs status when Pod exists and is running with same spec', async () => {
    const cell = makeCell();
    const pod = makeRunningPod(cell);
    client.pods.set(`${cell.metadata.namespace}/cell-${cell.metadata.name}`, pod);

    await controller.reconcileCell(cell);

    // No Pod created or deleted
    expect(client.createPodCalls).toHaveLength(0);
    expect(client.deletePodCalls).toHaveLength(0);

    // Status should be synced
    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.phase).toBe('Running');
  });

  it('deletes Pod when it has Failed phase', async () => {
    const cell = makeCell();
    const pod = makeRunningPod(cell);
    pod.status = { phase: 'Failed' };
    client.pods.set(`${cell.metadata.namespace}/cell-${cell.metadata.name}`, pod);

    await controller.reconcileCell(cell);

    // Pod should be deleted
    expect(client.deletePodCalls).toHaveLength(1);
    expect(client.deletePodCalls[0]!.name).toBe('cell-researcher');

    // Status should be updated to Failed
    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.phase).toBe('Failed');
    expect(client.statusUpdates[0]!.status.message).toContain('Failed');

    // Event emitted
    expect(client.emittedEvents).toHaveLength(1);
    expect(client.emittedEvents[0]!.eventType).toBe('CellFailed');
  });

  it('deletes Pod when it has Unknown phase', async () => {
    const cell = makeCell();
    const pod = makeRunningPod(cell);
    pod.status = { phase: 'Unknown' };
    client.pods.set(`${cell.metadata.namespace}/cell-${cell.metadata.name}`, pod);

    await controller.reconcileCell(cell);

    // Pod should be deleted
    expect(client.deletePodCalls).toHaveLength(1);

    // Status updated to Failed
    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.phase).toBe('Failed');
    expect(client.statusUpdates[0]!.status.message).toContain('Unknown');
  });

  it('deletes Pod when spec has changed (rolling restart)', async () => {
    const cell = makeCell();
    // Pod has old spec with different model
    const pod = makeRunningPod(cell);
    const container = pod.spec!.containers![0]!;
    container.env = [
      {
        name: 'CELL_SPEC',
        value: JSON.stringify({
          mind: {
            provider: 'anthropic',
            model: 'claude-opus-4-20250514', // different model
            systemPrompt: 'You are a helpful assistant.',
          },
        }),
      },
    ];
    client.pods.set(`${cell.metadata.namespace}/cell-${cell.metadata.name}`, pod);

    await controller.reconcileCell(cell);

    // Pod should be deleted for recreation
    expect(client.deletePodCalls).toHaveLength(1);
    expect(client.deletePodCalls[0]!.name).toBe('cell-researcher');

    // No new Pod created yet (will happen on next reconcile)
    expect(client.createPodCalls).toHaveLength(0);

    // Event emitted about spec change
    expect(client.emittedEvents).toHaveLength(1);
    expect(client.emittedEvents[0]!.reason).toBe('SpecChanged');
  });

  it('syncs status with Completed phase for Succeeded pod', async () => {
    const cell = makeCell();
    const pod = makeRunningPod(cell);
    pod.status = { phase: 'Succeeded' };
    client.pods.set(`${cell.metadata.namespace}/cell-${cell.metadata.name}`, pod);

    await controller.reconcileCell(cell);

    // Status synced as Completed
    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.phase).toBe('Completed');
  });

  it('syncs status with Pending phase for Pending pod', async () => {
    const cell = makeCell();
    const pod = makeRunningPod(cell);
    pod.status = { phase: 'Pending' };
    client.pods.set(`${cell.metadata.namespace}/cell-${cell.metadata.name}`, pod);

    await controller.reconcileCell(cell);

    // Status synced as Pending
    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.phase).toBe('Pending');
  });

  it('preserves existing cost/token counters during status sync', async () => {
    const cell = makeCell({
      status: {
        phase: 'Pending',
        totalCost: 1.5,
        totalTokens: 5000,
      },
    });
    const pod = makeRunningPod(cell);
    client.pods.set(`${cell.metadata.namespace}/cell-${cell.metadata.name}`, pod);

    await controller.reconcileCell(cell);

    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.totalCost).toBe(1.5);
    expect(client.statusUpdates[0]!.status.totalTokens).toBe(5000);
  });

  it('defaults cost/token counters to 0 when no existing status', async () => {
    const cell = makeCell();
    const pod = makeRunningPod(cell);
    client.pods.set(`${cell.metadata.namespace}/cell-${cell.metadata.name}`, pod);

    await controller.reconcileCell(cell);

    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.totalCost).toBe(0);
    expect(client.statusUpdates[0]!.status.totalTokens).toBe(0);
  });

  it('status update writes correct cell name and namespace', async () => {
    const cell = makeCell({
      metadata: {
        name: 'writer',
        namespace: 'production',
        uid: 'xyz-789',
        resourceVersion: '3',
      },
    });

    await controller.reconcileCell(cell);

    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.name).toBe('writer');
    expect(client.statusUpdates[0]!.namespace).toBe('production');
  });

  it('Pod has correct ownerReferences linking back to Cell', async () => {
    const cell = makeCell();

    await controller.reconcileCell(cell);

    const createdPod = client.createPodCalls[0]!;
    const ownerRef = createdPod.metadata?.ownerReferences?.[0];

    expect(ownerRef).toBeDefined();
    expect(ownerRef!.apiVersion).toBe('kais.io/v1');
    expect(ownerRef!.kind).toBe('Cell');
    expect(ownerRef!.name).toBe('researcher');
    expect(ownerRef!.uid).toBe('abc-123-def');
    expect(ownerRef!.controller).toBe(true);
    expect(ownerRef!.blockOwnerDeletion).toBe(true);
  });

  it('handles reconcile after Pod deletion (recreates on next call)', async () => {
    const cell = makeCell();

    // First reconcile: create Pod
    await controller.reconcileCell(cell);
    expect(client.createPodCalls).toHaveLength(1);

    // Simulate Pod failure
    const key = `${cell.metadata.namespace}/cell-${cell.metadata.name}`;
    const pod = client.pods.get(key)!;
    pod.status = { phase: 'Failed' };

    // Second reconcile: delete failed Pod
    await controller.reconcileCell(cell);
    expect(client.deletePodCalls).toHaveLength(1);

    // Third reconcile: Pod is gone, recreate it
    await controller.reconcileCell(cell);
    expect(client.createPodCalls).toHaveLength(2);
  });

  it('handles errors in getPod gracefully', async () => {
    const cell = makeCell();
    const errorClient = createMockClient();
    const errorController = createController(errorClient);

    // Override getPod to throw
    vi.spyOn(errorClient, 'getPod').mockRejectedValue(new Error('API error'));

    await expect(errorController.reconcileCell(cell)).rejects.toThrow(
      'API error',
    );
  });
});

describe('CellController.handlePodEvent', () => {
  let client: ReturnType<typeof createMockClient>;
  let controller: CellController;

  beforeEach(() => {
    client = createMockClient();
    controller = createController(client);
  });

  it('reconciles owning Cell when Pod is deleted', async () => {
    const cell = makeCell();
    client.cells.set(`${cell.metadata.namespace}/${cell.metadata.name}`, cell);

    // Simulate a Pod delete event
    const podObj = {
      metadata: {
        name: 'cell-researcher',
        namespace: 'default',
        labels: {
          'kais.io/cell': 'researcher',
          'kais.io/role': 'cell',
        },
      },
    } as k8s.V1Pod;

    await controller.handlePodEvent('delete', podObj);

    // Should have tried to create a Pod (since no Pod exists)
    expect(client.createPodCalls).toHaveLength(1);
    expect(client.createPodCalls[0]!.metadata?.name).toBe('cell-researcher');
  });

  it('reconciles owning Cell when Pod enters Failed phase', async () => {
    const cell = makeCell();
    client.cells.set(`${cell.metadata.namespace}/${cell.metadata.name}`, cell);

    // Add the failed Pod to the client
    const pod: k8s.V1Pod = {
      metadata: {
        name: 'cell-researcher',
        namespace: 'default',
        labels: {
          'kais.io/cell': 'researcher',
          'kais.io/role': 'cell',
        },
      },
      status: { phase: 'Failed' },
    };
    client.pods.set('default/cell-researcher', pod);

    await controller.handlePodEvent('update', pod);

    // Should delete the failed Pod (reconcileCell logic)
    expect(client.deletePodCalls).toHaveLength(1);
    expect(client.deletePodCalls[0]!.name).toBe('cell-researcher');
  });

  it('reconciles owning Cell when Pod enters Unknown phase', async () => {
    const cell = makeCell();
    client.cells.set(`${cell.metadata.namespace}/${cell.metadata.name}`, cell);

    const pod: k8s.V1Pod = {
      metadata: {
        name: 'cell-researcher',
        namespace: 'default',
        labels: {
          'kais.io/cell': 'researcher',
          'kais.io/role': 'cell',
        },
      },
      status: { phase: 'Unknown' },
    };
    client.pods.set('default/cell-researcher', pod);

    await controller.handlePodEvent('update', pod);

    // Should delete the Unknown Pod
    expect(client.deletePodCalls).toHaveLength(1);
  });

  it('reconciles cell status when Pod enters Running phase', async () => {
    const cell = makeCell();
    cell.status = { phase: 'Pending', podName: 'cell-researcher' };
    client.cells.set(`${cell.metadata.namespace}/${cell.metadata.name}`, cell);

    const pod: k8s.V1Pod = {
      metadata: {
        name: 'cell-researcher',
        namespace: 'default',
        labels: {
          'kais.io/cell': 'researcher',
          'kais.io/role': 'cell',
        },
      },
      spec: { containers: [{ name: 'mind', image: 'kais-cell:test', env: [{ name: 'CELL_SPEC', value: JSON.stringify(cell.spec) }] }] },
      status: { phase: 'Running' },
    };
    client.pods.set('default/cell-researcher', pod);

    await controller.handlePodEvent('update', pod);

    // Should trigger reconciliation → sync cell status to Running
    expect(client.statusUpdates).toHaveLength(1);
    expect(client.statusUpdates[0]!.status.phase).toBe('Running');
  });

  it('ignores Pods without kais.io/cell label', async () => {
    const pod: k8s.V1Pod = {
      metadata: {
        name: 'some-other-pod',
        namespace: 'default',
        labels: {},
      },
      status: { phase: 'Failed' },
    };

    await controller.handlePodEvent('update', pod);

    // Should not do anything
    expect(client.createPodCalls).toHaveLength(0);
    expect(client.deletePodCalls).toHaveLength(0);
  });

  it('handles missing Cell gracefully on Pod delete', async () => {
    // Cell does not exist in the client
    const pod: k8s.V1Pod = {
      metadata: {
        name: 'cell-ghost',
        namespace: 'default',
        labels: {
          'kais.io/cell': 'ghost',
          'kais.io/role': 'cell',
        },
      },
    };

    // Should not throw
    await controller.handlePodEvent('delete', pod);

    expect(client.createPodCalls).toHaveLength(0);
  });
});
