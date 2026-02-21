import type { ChannelStatus } from '@kais/core';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChannelController } from '../channel-controller.js';
import type { ChannelResource } from '../types.js';

interface StatusUpdate {
  name: string;
  namespace: string;
  status: ChannelStatus;
}

function createMockKube() {
  const updates: StatusUpdate[] = [];
  return {
    updates,
    async updateChannelStatus(
      name: string,
      namespace: string,
      status: ChannelStatus,
    ): Promise<void> {
      updates.push({ name, namespace, status });
    },
  };
}

function makeChannel(
  formations: string[] = ['form-a', 'form-b'],
  status?: ChannelStatus,
): ChannelResource {
  return {
    apiVersion: 'kais.io/v1',
    kind: 'Channel',
    metadata: {
      name: 'test-channel',
      namespace: 'default',
      uid: 'ch-uid-1',
      resourceVersion: '1',
    },
    spec: {
      formations,
      maxMessageSize: 65536,
      retentionMinutes: 60,
    },
    status,
  };
}

describe('ChannelController', () => {
  let controller: ChannelController;
  let kube: ReturnType<typeof createMockKube>;

  beforeEach(() => {
    kube = createMockKube();
    controller = new ChannelController(kube);
  });

  it('transitions from no status to Active', async () => {
    const ch = makeChannel();
    await controller.reconcileChannel(ch);

    expect(kube.updates).toHaveLength(1);
    expect(kube.updates[0]!.status.phase).toBe('Active');
    expect(kube.updates[0]!.status.subscriberCount).toBe(2);
  });

  it('sets Error when fewer than 2 formations', async () => {
    const ch = makeChannel(['only-one']);
    await controller.reconcileChannel(ch);

    expect(kube.updates).toHaveLength(1);
    expect(kube.updates[0]!.status.phase).toBe('Error');
  });

  it('does nothing when paused', async () => {
    const ch = makeChannel(['a', 'b'], {
      phase: 'Paused',
      messageCount: 5,
      subscriberCount: 2,
    });

    await controller.reconcileChannel(ch);
    expect(kube.updates).toHaveLength(0);
  });

  it('refreshes subscriber count on Active reconcile', async () => {
    const ch = makeChannel(['a', 'b', 'c'], {
      phase: 'Active',
      messageCount: 10,
      subscriberCount: 2,
    });

    await controller.reconcileChannel(ch);

    expect(kube.updates).toHaveLength(1);
    expect(kube.updates[0]!.status.subscriberCount).toBe(3);
    expect(kube.updates[0]!.status.messageCount).toBe(10);
  });

  it('recovers from Error when formations are valid', async () => {
    const ch = makeChannel(['a', 'b'], {
      phase: 'Error',
      messageCount: 0,
      subscriberCount: 0,
    });

    await controller.reconcileChannel(ch);

    expect(kube.updates).toHaveLength(1);
    expect(kube.updates[0]!.status.phase).toBe('Active');
  });

  it('stop() does not throw', () => {
    expect(() => controller.stop()).not.toThrow();
  });
});
