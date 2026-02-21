import * as k8s from '@kubernetes/client-node';

import { buildCellPod } from './pod-builder.js';
import { specChanged } from './spec-changed.js';
import type { CellResource, KubeClient } from './types.js';

const RECONCILE_RETRY_DELAY_MS = 5_000;
const MAX_RECONCILE_RETRIES = 3;

/**
 * CellController watches Cell CRDs and manages Cell Pods.
 *
 * It uses the K8s informer/watch API to react to Cell lifecycle events
 * and ensures each Cell has a corresponding Pod running.
 */
export class CellController {
  private informer: k8s.Informer<k8s.KubernetesObject> | null = null;
  private stopped = false;

  constructor(
    private readonly kc: k8s.KubeConfig,
    private readonly client: KubeClient,
  ) {}

  /**
   * Start watching Cell CRDs across all namespaces.
   */
  async start(): Promise<void> {
    this.stopped = false;

    const customApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    const path = '/apis/kais.io/v1/cells';

    const listFn = async (): Promise<
      k8s.KubernetesListObject<k8s.KubernetesObject>
    > => {
      const response = await customApi.listClusterCustomObject({
        group: 'kais.io',
        version: 'v1',
        plural: 'cells',
      });

      return response as k8s.KubernetesListObject<k8s.KubernetesObject>;
    };

    this.informer = k8s.makeInformer(this.kc, path, listFn);

    this.informer.on('add', (obj: k8s.KubernetesObject) => {
      void this.handleEvent('add', obj);
    });

    this.informer.on('update', (obj: k8s.KubernetesObject) => {
      void this.handleEvent('update', obj);
    });

    this.informer.on('delete', (obj: k8s.KubernetesObject) => {
      void this.handleEvent('delete', obj);
    });

    this.informer.on('error', (err: unknown) => {
      if (!this.stopped) {
        console.error('[CellController] watch error:', err);
        // Restart the informer after a delay
        setTimeout(() => {
          if (!this.stopped) {
            console.log('[CellController] restarting informer...');
            void this.informer?.start();
          }
        }, RECONCILE_RETRY_DELAY_MS);
      }
    });

    await this.informer.start();
    console.log('[CellController] started watching Cell CRDs');
  }

  /**
   * Stop watching Cell CRDs.
   */
  stop(): void {
    this.stopped = true;
    if (this.informer) {
      void this.informer.stop();
      this.informer = null;
    }
    console.log('[CellController] stopped');
  }

  /**
   * Handle an informer event. Runs reconciliation with retry.
   */
  private async handleEvent(
    event: 'add' | 'update' | 'delete',
    obj: k8s.KubernetesObject,
  ): Promise<void> {
    const cell = obj as unknown as CellResource;
    const cellId = `${cell.metadata.namespace}/${cell.metadata.name}`;

    console.log(`[CellController] ${event} event for cell ${cellId}`);

    if (event === 'delete') {
      // ownerReferences handle Pod cleanup automatically
      console.log(
        `[CellController] cell ${cellId} deleted — Pods will be GC'd via ownerReferences`,
      );
      return;
    }

    // Reconcile with retry and backoff
    for (let attempt = 0; attempt <= MAX_RECONCILE_RETRIES; attempt++) {
      try {
        await this.reconcileCell(cell);
        return;
      } catch (err) {
        console.error(
          `[CellController] reconcile attempt ${attempt + 1} failed for ${cellId}:`,
          err,
        );
        if (attempt < MAX_RECONCILE_RETRIES) {
          const delay = RECONCILE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.error(
      `[CellController] exhausted retries for ${cellId}, will retry on next event`,
    );
  }

  /**
   * Reconcile a single Cell — ensure its Pod exists and is healthy.
   */
  async reconcileCell(cell: CellResource): Promise<void> {
    const podName = `cell-${cell.metadata.name}`;
    const pod = await this.client.getPod(podName, cell.metadata.namespace);

    if (!pod) {
      // No Pod exists — create one
      const newPod = buildCellPod(cell);
      await this.client.createPod(newPod);
      await this.client.updateCellStatus(
        cell.metadata.name,
        cell.metadata.namespace,
        { phase: 'Running', podName },
      );
      await this.client.emitEvent(
        cell,
        'CellCreated',
        'PodCreated',
        `Created Pod ${podName} for Cell ${cell.metadata.name}`,
      );
      return;
    }

    // Pod exists — check its health
    const podPhase = pod.status?.phase;

    if (podPhase === 'Failed' || podPhase === 'Unknown') {
      // Pod crashed — delete it, next reconcile will recreate
      await this.client.deletePod(podName, cell.metadata.namespace);
      await this.client.updateCellStatus(
        cell.metadata.name,
        cell.metadata.namespace,
        {
          phase: 'Failed',
          podName,
          message: `Pod ${podName} entered ${podPhase} phase, restarting`,
        },
      );
      await this.client.emitEvent(
        cell,
        'CellFailed',
        'PodFailed',
        `Pod ${podName} entered ${podPhase} phase, deleted for recreation`,
      );
      return;
    }

    if (specChanged(cell, pod)) {
      // Spec updated — rolling restart
      await this.client.deletePod(podName, cell.metadata.namespace);
      await this.client.emitEvent(
        cell,
        'CellCreated',
        'SpecChanged',
        `Cell spec changed, restarting Pod ${podName}`,
      );
      return;
    }

    // Running and healthy — sync status
    await this.syncCellStatus(cell, pod);
  }

  /**
   * Sync the Cell's status from the running Pod.
   */
  private async syncCellStatus(
    cell: CellResource,
    pod: k8s.V1Pod,
  ): Promise<void> {
    const phase =
      pod.status?.phase === 'Running'
        ? ('Running' as const)
        : pod.status?.phase === 'Succeeded'
          ? ('Completed' as const)
          : ('Pending' as const);

    await this.client.updateCellStatus(
      cell.metadata.name,
      cell.metadata.namespace,
      {
        phase,
        podName: pod.metadata?.name,
        totalCost: cell.status?.totalCost ?? 0,
        totalTokens: cell.status?.totalTokens ?? 0,
        lastActive: new Date().toISOString(),
      },
    );
  }
}
