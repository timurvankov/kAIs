import type { FederationStatus } from '@kais/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { FederationController } from '../federation-controller.js';
import type { FederationResource } from '../types.js';

interface StatusUpdate {
  name: string;
  namespace: string;
  status: FederationStatus;
}

function createMockKube() {
  const updates: StatusUpdate[] = [];
  return {
    updates,
    async updateFederationStatus(
      name: string,
      namespace: string,
      status: FederationStatus,
    ): Promise<void> {
      updates.push({ name, namespace, status });
    },
  };
}

function makeFederation(
  clusterCount = 2,
  status?: FederationStatus,
): FederationResource {
  const clusters = Array.from({ length: clusterCount }, (_, i) => ({
    name: `cluster-${i}`,
    endpoint: `https://cluster-${i}.example.com`,
    capacity: {
      maxCells: 100,
      availableCells: 50,
    },
  }));

  return {
    apiVersion: 'kais.io/v1',
    kind: 'Federation',
    metadata: {
      name: 'test-federation',
      namespace: 'default',
      uid: 'fed-uid-1',
      resourceVersion: '1',
    },
    spec: {
      clusters,
      scheduling: {
        strategy: 'round_robin',
      },
      natsLeafnodePort: 7422,
    },
    status,
  };
}

describe('FederationController', () => {
  let controller: FederationController;
  let kube: ReturnType<typeof createMockKube>;

  beforeEach(() => {
    kube = createMockKube();
    controller = new FederationController(kube);
  });

  it('sets Active when all clusters are reachable', async () => {
    const fed = makeFederation(3);
    await controller.reconcileFederation(fed);

    expect(kube.updates).toHaveLength(1);
    expect(kube.updates[0]!.status.phase).toBe('Active');
    expect(kube.updates[0]!.status.readyClusters).toBe(3);
    expect(kube.updates[0]!.status.totalClusters).toBe(3);
  });

  it('sets Error when no clusters defined', async () => {
    const fed = makeFederation(0);
    await controller.reconcileFederation(fed);

    expect(kube.updates).toHaveLength(1);
    expect(kube.updates[0]!.status.phase).toBe('Error');
    expect(kube.updates[0]!.status.message).toBe('No clusters defined');
  });

  it('records heartbeat for clusters', async () => {
    const fed = makeFederation(2);

    // First reconcile: all alive
    await controller.reconcileFederation(fed);
    expect(kube.updates[0]!.status.phase).toBe('Active');

    // Record heartbeat to ensure cluster stays alive
    controller.recordHeartbeat('test-federation', 'cluster-0');
    controller.recordHeartbeat('test-federation', 'cluster-1');

    await controller.reconcileFederation(fed);
    expect(kube.updates[1]!.status.phase).toBe('Active');
    expect(kube.updates[1]!.status.readyClusters).toBe(2);
  });

  it('preserves scheduledCells from existing status', async () => {
    const fed = makeFederation(1, {
      phase: 'Active',
      readyClusters: 1,
      totalClusters: 1,
      scheduledCells: 42,
    });

    await controller.reconcileFederation(fed);

    expect(kube.updates[0]!.status.scheduledCells).toBe(42);
  });

  it('stop() clears heartbeats without error', () => {
    controller.recordHeartbeat('test', 'cluster-0');
    expect(() => controller.stop()).not.toThrow();
  });
});
