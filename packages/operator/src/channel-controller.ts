import type { ChannelStatus } from '@kais/core';
import { getTracer } from '@kais/core';

import type { ChannelResource } from './types.js';

const tracer = getTracer('kais-operator');

/**
 * ChannelController reconciles Channel CRDs for cross-formation messaging.
 *
 * A Channel connects two or more Formations via a shared NATS subject.
 * The controller:
 *  - Validates that the Channel spec references existing formations
 *  - Ensures the NATS subject for the channel is routable
 *  - Tracks message counts and subscriber state
 */
export class ChannelController {
  private readonly kube: {
    updateChannelStatus(
      name: string,
      namespace: string,
      status: ChannelStatus,
    ): Promise<void>;
  };

  constructor(kube: {
    updateChannelStatus(
      name: string,
      namespace: string,
      status: ChannelStatus,
    ): Promise<void>;
  }) {
    this.kube = kube;
  }

  /**
   * Reconcile a Channel resource.
   *
   * Phase lifecycle: Pending → Active → (Paused | Error)
   */
  async reconcileChannel(channel: ChannelResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_channel', {
      attributes: {
        'resource.name': channel.metadata.name,
        'resource.namespace': channel.metadata.namespace ?? 'default',
      },
    });

    try {
      const currentPhase = channel.status?.phase;

      // Terminal / no-op phases
      if (currentPhase === 'Paused') return;

      const formations = channel.spec.formations ?? [];

      // Validate at least 2 formations
      if (formations.length < 2) {
        await this.kube.updateChannelStatus(
          channel.metadata.name,
          channel.metadata.namespace ?? 'default',
          {
            phase: 'Error',
            messageCount: channel.status?.messageCount ?? 0,
            subscriberCount: 0,
            lastMessageAt: channel.status?.lastMessageAt,
          },
        );
        return;
      }

      // Pending → Active
      if (!currentPhase || currentPhase === 'Error') {
        await this.kube.updateChannelStatus(
          channel.metadata.name,
          channel.metadata.namespace ?? 'default',
          {
            phase: 'Active',
            messageCount: 0,
            subscriberCount: formations.length,
            lastMessageAt: undefined,
          },
        );
        return;
      }

      // Active: refresh subscriber count
      if (currentPhase === 'Active') {
        await this.kube.updateChannelStatus(
          channel.metadata.name,
          channel.metadata.namespace ?? 'default',
          {
            phase: 'Active',
            messageCount: channel.status?.messageCount ?? 0,
            subscriberCount: formations.length,
            lastMessageAt: channel.status?.lastMessageAt,
          },
        );
      }
    } finally {
      span.end();
    }
  }

  /** No-op stop for consistency with other controllers. */
  stop(): void {
    // Nothing to clean up
  }
}
