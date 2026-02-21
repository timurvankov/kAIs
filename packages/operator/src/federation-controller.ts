import type { FederationStatus } from '@kais/core';
import { getTracer } from '@kais/core';

import type { FederationResource } from './types.js';

const tracer = getTracer('kais-operator');

/**
 * FederationController reconciles Federation CRDs for multi-cluster scheduling.
 *
 * It tracks cluster health via heartbeats, counts ready clusters, and
 * schedules cells to remote clusters based on label-matching rules.
 *
 * Phase lifecycle: Pending → Active → (Degraded | Error)
 */
export class FederationController {
  private readonly kube: {
    updateFederationStatus(
      name: string,
      namespace: string,
      status: FederationStatus,
    ): Promise<void>;
  };

  /** Per-cluster last heartbeat timestamps. */
  private readonly clusterHeartbeats = new Map<string, number>();

  constructor(kube: {
    updateFederationStatus(
      name: string,
      namespace: string,
      status: FederationStatus,
    ): Promise<void>;
  }) {
    this.kube = kube;
  }

  /**
   * Reconcile a Federation resource.
   */
  async reconcileFederation(federation: FederationResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_federation', {
      attributes: {
        'resource.name': federation.metadata.name,
        'resource.namespace': federation.metadata.namespace ?? 'default',
      },
    });

    try {
      const clusters = federation.spec.clusters ?? [];
      const totalClusters = clusters.length;

      if (totalClusters === 0) {
        await this.kube.updateFederationStatus(
          federation.metadata.name,
          federation.metadata.namespace ?? 'default',
          {
            phase: 'Error',
            readyClusters: 0,
            totalClusters: 0,
            scheduledCells: 0,
            message: 'No clusters defined',
          },
        );
        return;
      }

      // Simulate heartbeat check: clusters with available capacity are "ready"
      const now = Date.now();
      const heartbeatTimeoutMs = 60_000; // 60s
      let readyClusters = 0;

      for (const cluster of clusters) {
        const key = `${federation.metadata.name}/${cluster.name}`;
        const lastBeat = this.clusterHeartbeats.get(key);

        // First reconcile: assume all clusters are alive
        if (lastBeat === undefined) {
          this.clusterHeartbeats.set(key, now);
          readyClusters++;
        } else if (now - lastBeat < heartbeatTimeoutMs) {
          readyClusters++;
        }
        // else: cluster heartbeat expired, not ready
      }

      const phase =
        readyClusters === 0
          ? 'Error'
          : readyClusters < totalClusters
            ? 'Degraded'
            : 'Active';

      await this.kube.updateFederationStatus(
        federation.metadata.name,
        federation.metadata.namespace ?? 'default',
        {
          phase,
          readyClusters,
          totalClusters,
          scheduledCells: federation.status?.scheduledCells ?? 0,
          message:
            phase === 'Active'
              ? undefined
              : phase === 'Degraded'
                ? `${totalClusters - readyClusters} cluster(s) unreachable`
                : 'All clusters unreachable',
        },
      );
    } finally {
      span.end();
    }
  }

  /** Record a heartbeat from a cluster. */
  recordHeartbeat(federationName: string, clusterName: string): void {
    const key = `${federationName}/${clusterName}`;
    this.clusterHeartbeats.set(key, Date.now());
  }

  /** No-op stop for consistency with other controllers. */
  stop(): void {
    this.clusterHeartbeats.clear();
  }
}
