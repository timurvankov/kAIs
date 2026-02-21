import * as k8s from '@kubernetes/client-node';

import { buildCellPod } from './pod-builder.js';
import { specChanged } from './spec-changed.js';
import type { CellResource, KubeClient } from './types.js';

/** Extract HTTP status code from @kubernetes/client-node errors. */
function httpStatus(err: unknown): number | undefined {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e.code ?? e.statusCode ?? e.response?.statusCode;
}

const RECONCILE_RETRY_DELAY_MS = 5_000;
const MAX_RECONCILE_RETRIES = 3;

/**
 * CellController watches Cell CRDs and managed Cell Pods.
 *
 * It uses the K8s informer/watch API to react to Cell lifecycle events
 * and ensures each Cell has a corresponding Pod running.
 *
 * It also watches Pods with label `kais.io/role=cell` so that externally
 * deleted or failed Pods trigger reconciliation of their owning Cell.
 */
export class CellController {
  private cellInformer: k8s.Informer<k8s.KubernetesObject> | null = null;
  private podInformer: k8s.Informer<k8s.KubernetesObject> | null = null;
  private stopped = false;

  constructor(
    private readonly kc: k8s.KubeConfig,
    private readonly client: KubeClient,
  ) {}

  /**
   * Start watching Cell CRDs and managed Pods.
   */
  async start(): Promise<void> {
    this.stopped = false;

    await this.startCellInformer();
    await this.startPodInformer();

    console.log('[CellController] started watching Cell CRDs and Pods');
  }

  /**
   * Start the Cell CRD informer.
   */
  private async startCellInformer(): Promise<void> {
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

    this.cellInformer = k8s.makeInformer(this.kc, path, listFn);

    this.cellInformer.on('add', (obj: k8s.KubernetesObject) => {
      void this.handleCellEvent('add', obj);
    });

    this.cellInformer.on('update', (obj: k8s.KubernetesObject) => {
      void this.handleCellEvent('update', obj);
    });

    this.cellInformer.on('delete', (obj: k8s.KubernetesObject) => {
      void this.handleCellEvent('delete', obj);
    });

    this.cellInformer.on('error', (err: unknown) => {
      if (!this.stopped) {
        console.error('[CellController] cell watch error:', err);
        setTimeout(() => {
          if (!this.stopped) {
            console.log('[CellController] restarting cell informer...');
            void this.cellInformer?.start();
          }
        }, RECONCILE_RETRY_DELAY_MS);
      }
    });

    await this.cellInformer.start();
  }

  /**
   * Start the Pod informer, watching Pods with label kais.io/role=cell.
   */
  private async startPodInformer(): Promise<void> {
    const coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    const path = '/api/v1/pods';

    const listFn = async (): Promise<
      k8s.KubernetesListObject<k8s.KubernetesObject>
    > => {
      const response = await coreApi.listPodForAllNamespaces({
        labelSelector: 'kais.io/role=cell',
      });

      return response as unknown as k8s.KubernetesListObject<k8s.KubernetesObject>;
    };

    this.podInformer = k8s.makeInformer(this.kc, path, listFn);

    this.podInformer.on('update', (obj: k8s.KubernetesObject) => {
      void this.handlePodEvent('update', obj);
    });

    this.podInformer.on('delete', (obj: k8s.KubernetesObject) => {
      void this.handlePodEvent('delete', obj);
    });

    this.podInformer.on('error', (err: unknown) => {
      if (!this.stopped) {
        console.error('[CellController] pod watch error:', err);
        setTimeout(() => {
          if (!this.stopped) {
            console.log('[CellController] restarting pod informer...');
            void this.podInformer?.start();
          }
        }, RECONCILE_RETRY_DELAY_MS);
      }
    });

    await this.podInformer.start();
  }

  /**
   * Stop watching Cell CRDs and Pods.
   */
  stop(): void {
    this.stopped = true;
    if (this.cellInformer) {
      void this.cellInformer.stop();
      this.cellInformer = null;
    }
    if (this.podInformer) {
      void this.podInformer.stop();
      this.podInformer = null;
    }
    console.log('[CellController] stopped');
  }

  /**
   * Handle a Cell CRD informer event. Runs reconciliation with retry.
   */
  private async handleCellEvent(
    event: 'add' | 'update' | 'delete',
    obj: k8s.KubernetesObject,
  ): Promise<void> {
    const cell = obj as unknown as CellResource;
    const cellId = `${cell.metadata.namespace}/${cell.metadata.name}`;

    console.log(`[CellController] cell ${event} event for ${cellId}`);

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
   * Handle a Pod informer event. When a managed Pod is deleted or enters
   * Failed/Unknown phase, look up the owning Cell CRD and reconcile it.
   */
  async handlePodEvent(
    event: 'update' | 'delete',
    obj: k8s.KubernetesObject,
  ): Promise<void> {
    const pod = obj as k8s.V1Pod;
    const labels = pod.metadata?.labels ?? {};
    const cellName = labels['kais.io/cell'];
    const namespace = pod.metadata?.namespace ?? 'default';

    if (!cellName) {
      // Pod doesn't have the cell label — skip
      return;
    }

    const podId = `${namespace}/${pod.metadata?.name ?? 'unknown'}`;

    if (event === 'delete') {
      console.log(`[CellController] pod ${podId} deleted, reconciling cell ${cellName}`);
      await this.reconcileCellByName(cellName, namespace);
      return;
    }

    // event === 'update': reconcile when pod phase changes to Running, Failed, or Unknown
    // Running: sync cell status from Pending → Running
    // Failed/Unknown: restart the pod
    const phase = pod.status?.phase;
    if (phase === 'Running' || phase === 'Failed' || phase === 'Unknown') {
      console.log(`[CellController] pod ${podId} phase=${phase}, reconciling cell ${cellName}`);
      await this.reconcileCellByName(cellName, namespace);
    }
  }

  /**
   * Look up a Cell CRD by name and namespace, then reconcile it.
   */
  private async reconcileCellByName(name: string, namespace: string): Promise<void> {
    try {
      const cell = await this.client.getCell(name, namespace);
      if (cell) {
        await this.reconcileCell(cell);
      } else {
        console.log(
          `[CellController] cell ${namespace}/${name} not found (may have been deleted)`,
        );
      }
    } catch (err) {
      console.error(
        `[CellController] failed to reconcile cell ${namespace}/${name} from pod event:`,
        err,
      );
    }
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
      try {
        await this.client.createPod(newPod);
      } catch (err: unknown) {
        if (httpStatus(err) === 409) {
          // Pod already exists (race condition) — proceed to sync status
          console.log(`[CellController] pod ${podName} already exists, skipping create`);
        } else {
          throw err;
        }
      }
      await this.client.updateCellStatus(
        cell.metadata.name,
        cell.metadata.namespace,
        { phase: 'Pending', podName },
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
   * Only updates if the phase actually changed to avoid infinite reconciliation loops.
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

    // Skip update if phase hasn't changed — avoids status update → cell update event → reconcile loop
    if (cell.status?.phase === phase) {
      return;
    }

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
