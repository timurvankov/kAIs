import type * as k8s from '@kubernetes/client-node';
import * as k8sLib from '@kubernetes/client-node';
import type { MissionStatus } from '@kais/core';

import { runCheck } from './check-runner.js';
import { parseTimeout } from './timeout.js';
import type {
  CommandExecutor,
  FileSystem,
  KubeClient,
  MissionResource,
  NatsClient,
} from './types.js';

const RECONCILE_RETRY_DELAY_MS = 5_000;
const MAX_RECONCILE_RETRIES = 3;

function httpStatus(err: unknown): number | undefined {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e.code ?? e.statusCode ?? e.response?.statusCode;
}

/**
 * MissionController watches Mission CRDs and manages mission lifecycle.
 *
 * It uses the K8s informer/watch API to react to Mission lifecycle events,
 * driving missions through their phases: Pending → Running → Succeeded/Failed.
 *
 * The controller handles:
 *   - Sending objectives to entrypoint cells via NATS
 *   - Running completion checks (fileExists, command, coverage)
 *   - Timeout enforcement with retry logic
 *   - Budget enforcement
 *   - Review flows (request → approved/rejected → retry/succeed)
 *   - Status updates and event emission
 */
export class MissionController {
  private missionInformer: k8s.Informer<k8s.KubernetesObject> | null = null;
  private stopped = false;

  constructor(
    private readonly kc: k8s.KubeConfig,
    private readonly client: KubeClient,
    private readonly nats: NatsClient,
    private readonly executor: CommandExecutor,
    private readonly fs: FileSystem,
    private readonly workspacePath: string,
  ) {}

  /**
   * Start watching Mission CRDs.
   */
  async start(): Promise<void> {
    this.stopped = false;
    await this.startMissionInformer();
    console.log('[MissionController] started watching Mission CRDs');
  }

  /**
   * Start the Mission CRD informer.
   */
  private async startMissionInformer(): Promise<void> {
    const customApi = this.kc.makeApiClient(k8sLib.CustomObjectsApi);
    const path = '/apis/kais.io/v1/missions';

    const listFn = async (): Promise<
      k8s.KubernetesListObject<k8s.KubernetesObject>
    > => {
      const response = await customApi.listClusterCustomObject({
        group: 'kais.io',
        version: 'v1',
        plural: 'missions',
      });

      return response as k8s.KubernetesListObject<k8s.KubernetesObject>;
    };

    this.missionInformer = k8sLib.makeInformer(this.kc, path, listFn);

    this.missionInformer.on('add', (obj: k8s.KubernetesObject) => {
      void this.handleMissionEvent('add', obj);
    });

    this.missionInformer.on('update', (obj: k8s.KubernetesObject) => {
      void this.handleMissionEvent('update', obj);
    });

    this.missionInformer.on('delete', (obj: k8s.KubernetesObject) => {
      void this.handleMissionEvent('delete', obj);
    });

    this.missionInformer.on('error', (err: unknown) => {
      if (!this.stopped) {
        console.error('[MissionController] watch error:', err);
        setTimeout(() => {
          if (!this.stopped) {
            console.log('[MissionController] restarting informer...');
            void this.missionInformer?.start();
          }
        }, RECONCILE_RETRY_DELAY_MS);
      }
    });

    await this.missionInformer.start();
  }

  /**
   * Stop watching Mission CRDs.
   */
  stop(): void {
    this.stopped = true;
    if (this.missionInformer) {
      void this.missionInformer.stop();
      this.missionInformer = null;
    }
    console.log('[MissionController] stopped');
  }

  /**
   * Handle a Mission CRD informer event. Runs reconciliation with retry.
   */
  private async handleMissionEvent(
    event: 'add' | 'update' | 'delete',
    obj: k8s.KubernetesObject,
  ): Promise<void> {
    const mission = obj as unknown as MissionResource;
    const missionId = `${mission.metadata.namespace}/${mission.metadata.name}`;

    console.log(`[MissionController] mission ${event} event for ${missionId}`);

    if (event === 'delete') {
      console.log(
        `[MissionController] mission ${missionId} deleted`,
      );
      return;
    }

    // Reconcile with retry and backoff
    for (let attempt = 0; attempt <= MAX_RECONCILE_RETRIES; attempt++) {
      try {
        await this.reconcileMission(mission);
        return;
      } catch (err) {
        // 404 means the mission was deleted — stop retrying
        if (httpStatus(err) === 404) {
          console.log(`[MissionController] mission ${missionId} not found, skipping reconcile`);
          return;
        }
        console.error(
          `[MissionController] reconcile attempt ${attempt + 1} failed for ${missionId}:`,
          err,
        );
        if (attempt < MAX_RECONCILE_RETRIES) {
          const delay = RECONCILE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.error(
      `[MissionController] exhausted retries for ${missionId}, will retry on next event`,
    );

    // Update mission status to Failed after all retries exhausted
    try {
      await this.client.updateMissionStatus(
        mission.metadata.name,
        mission.metadata.namespace,
        {
          phase: 'Failed',
          attempt: mission.status?.attempt ?? 0,
          cost: mission.status?.cost ?? 0,
          message: `Reconciliation failed after ${MAX_RECONCILE_RETRIES + 1} attempts`,
        },
      );
    } catch (statusErr) {
      console.error(
        `[MissionController] failed to update status for ${missionId}:`,
        statusErr,
      );
    }
  }

  /**
   * Reconcile a Mission — drive its lifecycle through phases.
   */
  async reconcileMission(mission: MissionResource): Promise<void> {
    const phase = mission.status?.phase;

    switch (phase) {
      case undefined:
      case 'Pending':
        await this.reconcilePending(mission);
        break;
      case 'Running':
        await this.reconcileRunning(mission);
        break;
      case 'Succeeded':
        // Terminal phase — transition events already emitted during Running→Succeeded
        break;
      case 'Failed':
        // Terminal phase — transition events already emitted during Running→Failed
        break;
    }
  }

  /**
   * Handle Pending phase: send objective to entrypoint cell, transition to Running.
   */
  private async reconcilePending(mission: MissionResource): Promise<void> {
    const { entrypoint } = mission.spec;

    // Send objective to the entrypoint cell via NATS
    await this.nats.sendMessageToCell(
      entrypoint.cell,
      mission.metadata.namespace,
      entrypoint.message,
    );

    const attempt = (mission.status?.attempt ?? 0) + 1;
    const now = new Date().toISOString();

    // Build history from prior attempts
    const history = [...(mission.status?.history ?? [])];
    if (mission.status?.startedAt && mission.status.attempt > 0) {
      history.push({
        attempt: mission.status.attempt,
        startedAt: mission.status.startedAt,
        result: mission.status.message ?? 'Retried',
      });
    }

    const status: MissionStatus = {
      phase: 'Running',
      attempt,
      startedAt: now,
      cost: mission.status?.cost ?? 0,
      history: history.length > 0 ? history : undefined,
    };

    await this.client.updateMissionStatus(
      mission.metadata.name,
      mission.metadata.namespace,
      status,
    );

    await this.client.emitMissionEvent(
      mission,
      'MissionStarted',
      'MissionStarted',
      `Mission ${mission.metadata.name} started (attempt ${attempt})`,
    );
  }

  /**
   * Handle Running phase: check timeout, budget, run checks, evaluate review.
   */
  private async reconcileRunning(mission: MissionResource): Promise<void> {
    const status: MissionStatus = {
      phase: 'Running',
      attempt: mission.status?.attempt ?? 1,
      startedAt: mission.status?.startedAt,
      cost: mission.status?.cost ?? 0,
      checks: mission.status?.checks,
      review: mission.status?.review,
      history: mission.status?.history,
      message: mission.status?.message,
    };

    const maxAttempts = mission.spec.completion.maxAttempts;

    // 1. Check timeout
    if (status.startedAt) {
      const elapsed = Date.now() - new Date(status.startedAt).getTime();
      const timeoutMs = parseTimeout(mission.spec.completion.timeout);

      if (elapsed > timeoutMs) {
        if (status.attempt < maxAttempts) {
          // Retry
          status.phase = 'Pending';
          status.message = 'Timed out, retrying';
          await this.client.updateMissionStatus(
            mission.metadata.name,
            mission.metadata.namespace,
            status,
          );
          await this.client.emitMissionEvent(
            mission,
            'MissionTimeout',
            'MissionTimeout',
            `Mission ${mission.metadata.name} timed out on attempt ${status.attempt}, will retry`,
          );
          return;
        } else {
          // Failed
          status.phase = 'Failed';
          status.message = 'Timed out after max attempts';
          await this.client.updateMissionStatus(
            mission.metadata.name,
            mission.metadata.namespace,
            status,
          );
          await this.client.emitMissionEvent(
            mission,
            'MissionFailed',
            'MissionFailed',
            `Mission ${mission.metadata.name} timed out after ${maxAttempts} attempts`,
          );
          return;
        }
      }
    }

    // 2. Check budget
    const maxCost = mission.spec.budget?.maxCost;
    if (maxCost !== undefined && status.cost >= maxCost) {
      status.phase = 'Failed';
      status.message = 'Budget exhausted';
      await this.client.updateMissionStatus(
        mission.metadata.name,
        mission.metadata.namespace,
        status,
      );
      await this.client.emitMissionEvent(
        mission,
        'MissionFailed',
        'MissionFailed',
        `Mission ${mission.metadata.name} budget exhausted: ${status.cost} >= ${maxCost}`,
      );
      return;
    }

    // 3. Run completion checks
    let allPassed = true;
    const checkResults: MissionStatus['checks'] = [];

    for (const check of mission.spec.completion.checks) {
      const result = await runCheck(check, this.workspacePath, this.executor, this.fs, this.nats);
      checkResults.push({
        name: result.name,
        status: result.status === 'Passed' ? 'Passed' : result.status === 'Error' ? 'Error' : 'Failed',
      });
      if (result.status !== 'Passed') {
        allPassed = false;
      }
    }

    status.checks = checkResults;

    // 4. If all checks pass, handle review or succeed
    if (allPassed) {
      const reviewSpec = mission.spec.completion.review;
      if (reviewSpec?.enabled) {
        // Review is enabled
        const currentReview = mission.status?.review;

        if (!currentReview || currentReview.status === 'Pending') {
          // Request review (or it's already pending)
          if (!currentReview) {
            status.review = { status: 'Pending' };
            await this.client.emitMissionEvent(
              mission,
              'MissionReviewRequested',
              'MissionReviewRequested',
              `Mission ${mission.metadata.name} checks passed, review requested`,
            );
          } else {
            status.review = currentReview;
          }
        } else if (currentReview.status === 'Approved') {
          status.phase = 'Succeeded';
          status.review = currentReview;
          await this.client.updateMissionStatus(
            mission.metadata.name,
            mission.metadata.namespace,
            status,
          );
          await this.client.emitMissionEvent(
            mission,
            'MissionCompleted',
            'MissionCompleted',
            `Mission ${mission.metadata.name} completed: review approved`,
          );
          return;
        } else if (currentReview.status === 'Rejected') {
          if (status.attempt < maxAttempts) {
            // Send feedback and retry
            status.phase = 'Pending';
            status.message = `Review rejected: ${currentReview.feedback ?? 'no feedback'}`;
            status.review = undefined;
            await this.client.updateMissionStatus(
              mission.metadata.name,
              mission.metadata.namespace,
              status,
            );
            await this.client.emitMissionEvent(
              mission,
              'MissionRetry',
              'MissionRetry',
              `Mission ${mission.metadata.name} review rejected, retrying`,
            );
            return;
          } else {
            status.phase = 'Failed';
            status.message = `Review rejected after max attempts: ${currentReview.feedback ?? 'no feedback'}`;
            status.review = currentReview;
            await this.client.updateMissionStatus(
              mission.metadata.name,
              mission.metadata.namespace,
              status,
            );
            await this.client.emitMissionEvent(
              mission,
              'MissionFailed',
              'MissionFailed',
              `Mission ${mission.metadata.name} failed: review rejected after ${maxAttempts} attempts`,
            );
            return;
          }
        }
      } else {
        // No review, succeed immediately
        status.phase = 'Succeeded';
        await this.client.updateMissionStatus(
          mission.metadata.name,
          mission.metadata.namespace,
          status,
        );
        await this.client.emitMissionEvent(
          mission,
          'MissionCompleted',
          'MissionCompleted',
          `Mission ${mission.metadata.name} completed: all checks passed`,
        );
        return;
      }
    }

    // Update status with check results (still Running)
    await this.client.updateMissionStatus(
      mission.metadata.name,
      mission.metadata.namespace,
      status,
    );
  }
}
