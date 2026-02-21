import type * as k8s from '@kubernetes/client-node';
import * as k8sLib from '@kubernetes/client-node';
import type { CellSpec, FormationStatus } from '@kais/core';
import { getTracer } from '@kais/core';
import { SpanStatusCode } from '@opentelemetry/api';

import { generateTopologyConfigMap } from './topology.js';
import { deepEqual } from './spec-changed.js';
import { buildWorkspacePVC } from './workspace.js';
import type { CellResource, FormationResource, KubeClient } from './types.js';

const tracer = getTracer('kais-operator');

function httpStatus(err: unknown): number | undefined {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e.code ?? e.statusCode ?? e.response?.statusCode;
}

const RECONCILE_RETRY_DELAY_MS = 5_000;
const MAX_RECONCILE_RETRIES = 3;

/**
 * FormationController watches Formation CRDs and manages Cell CRDs.
 *
 * It uses the K8s informer/watch API to react to Formation lifecycle events,
 * creating, updating, and deleting child Cell CRDs based on the Formation's
 * cell templates. It also manages:
 *   - Topology ConfigMaps (routes.json)
 *   - Shared workspace PVCs
 *   - Budget enforcement (pauses cells when budget exceeded)
 *   - Status aggregation from child cells
 */
export class FormationController {
  private formationInformer: k8s.Informer<k8s.KubernetesObject> | null = null;
  private stopped = false;

  constructor(
    private readonly kc: k8s.KubeConfig,
    private readonly client: KubeClient,
  ) {}

  /**
   * Start watching Formation CRDs.
   */
  async start(): Promise<void> {
    this.stopped = false;
    await this.startFormationInformer();
    console.log('[FormationController] started watching Formation CRDs');
  }

  /**
   * Start the Formation CRD informer.
   */
  private async startFormationInformer(): Promise<void> {
    const customApi = this.kc.makeApiClient(k8sLib.CustomObjectsApi);
    const path = '/apis/kais.io/v1/formations';

    const listFn = async (): Promise<
      k8s.KubernetesListObject<k8s.KubernetesObject>
    > => {
      const response = await customApi.listClusterCustomObject({
        group: 'kais.io',
        version: 'v1',
        plural: 'formations',
      });

      return response as k8s.KubernetesListObject<k8s.KubernetesObject>;
    };

    this.formationInformer = k8sLib.makeInformer(this.kc, path, listFn);

    this.formationInformer.on('add', (obj: k8s.KubernetesObject) => {
      void this.handleFormationEvent('add', obj);
    });

    this.formationInformer.on('update', (obj: k8s.KubernetesObject) => {
      void this.handleFormationEvent('update', obj);
    });

    this.formationInformer.on('delete', (obj: k8s.KubernetesObject) => {
      void this.handleFormationEvent('delete', obj);
    });

    this.formationInformer.on('error', (err: unknown) => {
      if (!this.stopped) {
        console.error('[FormationController] watch error:', err);
        setTimeout(() => {
          if (!this.stopped) {
            console.log('[FormationController] restarting informer...');
            void this.formationInformer?.start();
          }
        }, RECONCILE_RETRY_DELAY_MS);
      }
    });

    await this.formationInformer.start();
  }

  /**
   * Stop watching Formation CRDs.
   */
  stop(): void {
    this.stopped = true;
    if (this.formationInformer) {
      void this.formationInformer.stop();
      this.formationInformer = null;
    }
    console.log('[FormationController] stopped');
  }

  /**
   * Handle a Formation CRD informer event. Runs reconciliation with retry.
   */
  private async handleFormationEvent(
    event: 'add' | 'update' | 'delete',
    obj: k8s.KubernetesObject,
  ): Promise<void> {
    const formation = obj as unknown as FormationResource;
    const formationId = `${formation.metadata.namespace}/${formation.metadata.name}`;

    console.log(`[FormationController] formation ${event} event for ${formationId}`);

    if (event === 'delete') {
      // ownerReferences handle Cell cleanup automatically
      console.log(
        `[FormationController] formation ${formationId} deleted — Cells will be GC'd via ownerReferences`,
      );
      return;
    }

    // Reconcile with retry and backoff
    for (let attempt = 0; attempt <= MAX_RECONCILE_RETRIES; attempt++) {
      try {
        await this.reconcileFormation(formation);
        return;
      } catch (err) {
        console.error(
          `[FormationController] reconcile attempt ${attempt + 1} failed for ${formationId}:`,
          err,
        );
        if (attempt < MAX_RECONCILE_RETRIES) {
          const delay = RECONCILE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.error(
      `[FormationController] exhausted retries for ${formationId}, will retry on next event`,
    );

    // Update formation status to Failed after all retries exhausted
    try {
      await this.client.updateFormationStatus(
        formation.metadata.name,
        formation.metadata.namespace,
        {
          phase: 'Failed',
          readyCells: 0,
          totalCells: 0,
          totalCost: 0,
          cells: [],
          message: `Reconciliation failed after ${MAX_RECONCILE_RETRIES + 1} attempts`,
        },
      );
    } catch (statusErr) {
      console.error(
        `[FormationController] failed to update status for ${formationId}:`,
        statusErr,
      );
    }
  }

  /**
   * Reconcile a Formation — ensure its Cells, topology ConfigMap, and workspace PVC exist.
   */
  async reconcileFormation(formation: FormationResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_formation', {
      attributes: {
        'resource.name': formation.metadata.name,
        'resource.namespace': formation.metadata.namespace ?? 'default',
      },
    });
    try {
    const { namespace } = formation.metadata;

    // 1. Ensure workspace PVC exists
    await this.ensureWorkspacePVC(formation);

    // 2. Generate and apply topology ConfigMap
    await this.ensureTopologyConfigMap(formation);

    // 3. Build the desired set of cell names
    const desiredCells = new Map<string, { templateName: string; spec: CellSpec }>();
    for (const tpl of formation.spec.cells) {
      for (let i = 0; i < tpl.replicas; i++) {
        const cellName = `${tpl.name}-${i}`;
        desiredCells.set(cellName, { templateName: tpl.name, spec: tpl.spec });
      }
    }

    // 4. Create/update/delete cells
    for (const [cellName, { spec }] of desiredCells) {
      const existingCell = await this.client.getCell(cellName, namespace);

      if (!existingCell) {
        // Create the Cell (handle race where another reconciler created it first)
        const cell = this.buildCellResource(cellName, namespace, spec, formation);
        try {
          await this.client.createCell(cell);
        } catch (err: unknown) {
          if (httpStatus(err) === 409) {
            console.log(`[FormationController] cell ${cellName} already exists, skipping create`);
            continue;
          }
          throw err;
        }
        await this.client.emitFormationEvent(
          formation,
          'CellCreated',
          'CellCreated',
          `Created Cell ${cellName} for Formation ${formation.metadata.name}`,
        );
      } else if (this.cellSpecChanged(existingCell, spec)) {
        // Rolling update: update the cell spec
        await this.client.updateCell(cellName, namespace, spec);
        await this.client.emitFormationEvent(
          formation,
          'CellUpdated',
          'CellUpdated',
          `Updated Cell ${cellName} spec for Formation ${formation.metadata.name}`,
        );
      } else if (existingCell.status?.phase === 'Failed') {
        // Delete failed cell — next reconcile will recreate it
        await this.client.deleteCell(cellName, namespace);
        await this.client.emitFormationEvent(
          formation,
          'CellDeleted',
          'CellFailed',
          `Deleted failed Cell ${cellName}, will recreate on next reconcile`,
        );
      }
    }

    // 5. Fetch all cells once for scale-down, budget enforcement, and status aggregation
    const allCells = await this.client.listCells(
      namespace,
      `kais.io/formation=${formation.metadata.name}`,
    );

    // 6. Scale down: delete cells that shouldn't exist
    for (const cell of allCells) {
      if (!desiredCells.has(cell.metadata.name)) {
        await this.client.deleteCell(cell.metadata.name, namespace);
        await this.client.emitFormationEvent(
          formation,
          'CellDeleted',
          'ScaleDown',
          `Deleted Cell ${cell.metadata.name} during scale down`,
        );
      }
    }

    // Filter to only cells that survived scale-down
    const liveCells = allCells.filter((c) => desiredCells.has(c.metadata.name));

    // 7. Budget enforcement
    let totalCost = 0;
    for (const cell of liveCells) {
      totalCost += cell.status?.totalCost ?? 0;
    }

    const maxTotalCost = formation.spec.budget?.maxTotalCost;
    let phase: FormationStatus['phase'] = 'Running';

    if (maxTotalCost !== undefined && totalCost >= maxTotalCost) {
      // Pause all cells
      for (const cell of liveCells) {
        if (cell.status?.phase !== 'Paused') {
          await this.client.updateCellStatus(cell.metadata.name, namespace, {
            phase: 'Paused',
            message: `Budget exceeded: ${totalCost} >= ${maxTotalCost}`,
          });
        }
      }
      phase = 'Paused';
      await this.client.emitFormationEvent(
        formation,
        'FormationPaused',
        'BudgetExceeded',
        `Formation paused: total cost ${totalCost} >= budget ${maxTotalCost}`,
      );
    }

    // 8. Aggregate status from liveCells (already reflects budget pausing above)
    const readyCells = liveCells.filter((c) => c.status?.phase === 'Running').length;
    const cellStatuses = liveCells.map((c) => ({
      name: c.metadata.name,
      phase: c.status?.phase ?? 'Pending',
      cost: c.status?.totalCost ?? 0,
    }));

    // If not paused, determine phase from cell states
    if (phase !== 'Paused') {
      const allCompleted = liveCells.length > 0 &&
        liveCells.every((c) => c.status?.phase === 'Completed');
      const anyFailed = liveCells.some((c) => c.status?.phase === 'Failed');

      if (allCompleted) {
        phase = 'Completed';
      } else if (anyFailed) {
        phase = 'Failed';
      } else if (readyCells > 0) {
        phase = 'Running';
      } else {
        phase = 'Pending';
      }
    }

    await this.client.updateFormationStatus(
      formation.metadata.name,
      namespace,
      {
        phase,
        readyCells,
        totalCells: desiredCells.size,
        totalCost,
        cells: cellStatuses,
      },
    );
    span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Ensure the shared workspace PVC exists for this formation.
   */
  private async ensureWorkspacePVC(formation: FormationResource): Promise<void> {
    const pvcName = `workspace-${formation.metadata.name}`;
    const existing = await this.client.getPVC(pvcName, formation.metadata.namespace);

    if (!existing) {
      const pvc = buildWorkspacePVC(
        formation.metadata.name,
        formation.metadata.namespace,
        { name: formation.metadata.name, uid: formation.metadata.uid },
      );
      await this.client.createPVC(pvc);
    }
  }

  /**
   * Ensure the topology ConfigMap exists and is up-to-date.
   */
  private async ensureTopologyConfigMap(formation: FormationResource): Promise<void> {
    const configMap = generateTopologyConfigMap(
      formation.metadata.name,
      formation.metadata.namespace,
      formation.spec.topology,
      formation.spec.cells,
      { name: formation.metadata.name, uid: formation.metadata.uid },
    );

    await this.client.createOrUpdateConfigMap(
      configMap.metadata!.name!,
      formation.metadata.namespace,
      configMap.data!,
      configMap.metadata!.ownerReferences![0],
    );
  }

  /**
   * Build a CellResource from a formation template.
   */
  private buildCellResource(
    cellName: string,
    namespace: string,
    spec: CellSpec,
    formation: FormationResource,
  ): CellResource {
    return {
      apiVersion: 'kais.io/v1',
      kind: 'Cell',
      metadata: {
        name: cellName,
        namespace,
        // uid and resourceVersion are assigned by K8s API server on creation
        ownerReferences: [
          {
            apiVersion: 'kais.io/v1',
            kind: 'Formation',
            name: formation.metadata.name,
            uid: formation.metadata.uid,
            controller: true,
            blockOwnerDeletion: true,
          },
        ],
        labels: {
          'kais.io/formation': formation.metadata.name,
          'kais.io/role': 'cell',
        },
      },
      spec: {
        ...spec,
        formationRef: formation.metadata.name,
      },
    };
  }

  /**
   * Check whether a Cell's spec has changed from the desired spec.
   */
  private cellSpecChanged(cell: CellResource, desiredSpec: CellSpec): boolean {
    // Compare using key-order independent deep equality
    const expected = {
      ...desiredSpec,
      formationRef: cell.spec.formationRef,
    };
    return !deepEqual(cell.spec, expected);
  }
}
