import type * as k8s from '@kubernetes/client-node';
import * as k8sLib from '@kubernetes/client-node';
import type { SwarmStatus } from '@kais/core';
import { getTracer } from '@kais/core';
import { SpanStatusCode, trace, context } from '@opentelemetry/api';

import type { SwarmResource, CellResource, KubeClient, NatsClient } from './types.js';

const tracer = getTracer('kais-operator');

const RECONCILE_RETRY_DELAY_MS = 5_000;
const MAX_RECONCILE_RETRIES = 3;

/** Default interval for trigger evaluation (ms). */
const TRIGGER_EVAL_INTERVAL_MS = 10_000;

function httpStatus(err: unknown): number | undefined {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e.code ?? e.statusCode ?? e.response?.statusCode;
}

/** Simple cron-like matcher: supports "* /N" minute patterns and "*". */
function cronMatches(schedule: string, now: Date): boolean {
  // Minimal cron support: "*/5 * * * *" (every 5 min), "* * * * *" (every min)
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const minutePart = parts[0]!;
  const currentMinute = now.getMinutes();

  if (minutePart === '*') return true;

  // Handle */N
  const stepMatch = minutePart.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1]!, 10);
    return step > 0 && currentMinute % step === 0;
  }

  // Handle exact minute
  const exact = parseInt(minutePart, 10);
  if (!isNaN(exact)) return currentMinute === exact;

  return false;
}

/** In-memory tracking state for a single Swarm. */
interface SwarmState {
  currentReplicas: number;
  desiredReplicas: number;
  lastScaleTime: Date | undefined;
  lastTriggerValue: number | undefined;
  /** Timestamp when the current desired replica count was first computed (for stabilization). */
  desiredSince: Date | undefined;
  /** Managed cell names for tracking scale-down. */
  managedCells: Set<string>;
}

/**
 * SwarmController watches Swarm CRDs and provides auto-scaling for Cell replicas.
 *
 * It evaluates triggers periodically:
 *   - queue_depth: message count on a NATS subject
 *   - metric: value from an external metric source
 *   - schedule: cron-based scaling
 *
 * Scaling behavior:
 *   - Scale up: create Cell CRDs through KubeClient
 *   - Scale down: send drain signal via NATS, then delete Cell CRDs
 *   - Respects: minReplicas, maxReplicas, step, cooldownSeconds, stabilizationSeconds
 *   - Budget-aware: skip scale-up if budget is exceeded
 *
 * Tracks: currentReplicas, desiredReplicas, lastScaleTime
 */
export class SwarmController {
  private swarmInformer: k8s.Informer<k8s.KubernetesObject> | null = null;
  private stopped = false;

  /** In-memory state per Swarm, keyed by UID. */
  private swarmStates = new Map<string, SwarmState>();

  /** Periodic trigger evaluation timer. */
  private triggerTimer: ReturnType<typeof setInterval> | null = null;

  /** Cache of known swarm resources for periodic evaluation. */
  private knownSwarms = new Map<string, SwarmResource>();

  constructor(
    private readonly kc: k8s.KubeConfig,
    private readonly client: KubeClient,
    private readonly nats: NatsClient,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.startSwarmInformer();

    // Start periodic trigger evaluation
    this.triggerTimer = setInterval(() => {
      if (!this.stopped) {
        void this.evaluateAllTriggers();
      }
    }, TRIGGER_EVAL_INTERVAL_MS);

    console.log('[SwarmController] started watching Swarm CRDs');
  }

  private async startSwarmInformer(): Promise<void> {
    const customApi = this.kc.makeApiClient(k8sLib.CustomObjectsApi);
    const path = '/apis/kais.io/v1/swarms';

    const listFn = async (): Promise<
      k8s.KubernetesListObject<k8s.KubernetesObject>
    > => {
      const response = await customApi.listClusterCustomObject({
        group: 'kais.io',
        version: 'v1',
        plural: 'swarms',
      });
      return response as k8s.KubernetesListObject<k8s.KubernetesObject>;
    };

    this.swarmInformer = k8sLib.makeInformer(this.kc, path, listFn);

    this.swarmInformer.on('add', (obj: k8s.KubernetesObject) => {
      void this.handleSwarmEvent('add', obj);
    });

    this.swarmInformer.on('update', (obj: k8s.KubernetesObject) => {
      void this.handleSwarmEvent('update', obj);
    });

    this.swarmInformer.on('delete', (obj: k8s.KubernetesObject) => {
      void this.handleSwarmEvent('delete', obj);
    });

    this.swarmInformer.on('error', (err: unknown) => {
      if (!this.stopped) {
        console.error('[SwarmController] watch error:', err);
        setTimeout(() => {
          if (!this.stopped) {
            console.log('[SwarmController] restarting informer...');
            void this.swarmInformer?.start();
          }
        }, RECONCILE_RETRY_DELAY_MS);
      }
    });

    await this.swarmInformer.start();
  }

  stop(): void {
    this.stopped = true;
    if (this.triggerTimer) {
      clearInterval(this.triggerTimer);
      this.triggerTimer = null;
    }
    if (this.swarmInformer) {
      void this.swarmInformer.stop();
      this.swarmInformer = null;
    }
    this.swarmStates.clear();
    this.knownSwarms.clear();
    console.log('[SwarmController] stopped');
  }

  private async handleSwarmEvent(
    event: 'add' | 'update' | 'delete',
    obj: k8s.KubernetesObject,
  ): Promise<void> {
    const swarm = obj as unknown as SwarmResource;
    const swarmId = `${swarm.metadata.namespace}/${swarm.metadata.name}`;
    const uid = swarm.metadata.uid ?? swarm.metadata.name;

    console.log(`[SwarmController] swarm ${event} event for ${swarmId}`);

    if (event === 'delete') {
      this.swarmStates.delete(uid);
      this.knownSwarms.delete(uid);
      return;
    }

    // Cache the resource for periodic evaluation
    this.knownSwarms.set(uid, swarm);

    for (let attempt = 0; attempt <= MAX_RECONCILE_RETRIES; attempt++) {
      try {
        await this.reconcileSwarm(swarm);
        return;
      } catch (err) {
        if (httpStatus(err) === 404) {
          console.log(`[SwarmController] swarm ${swarmId} not found, skipping`);
          return;
        }
        console.error(
          `[SwarmController] reconcile attempt ${attempt + 1} failed for ${swarmId}:`,
          err,
        );
        if (attempt < MAX_RECONCILE_RETRIES) {
          const delay = RECONCILE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.error(`[SwarmController] exhausted retries for ${swarmId}`);

    try {
      await this.client.updateSwarmStatus(
        swarm.metadata.name,
        swarm.metadata.namespace,
        {
          phase: 'Error',
          currentReplicas: swarm.status?.currentReplicas ?? 0,
          desiredReplicas: swarm.status?.desiredReplicas ?? 0,
          message: `Reconciliation failed after ${MAX_RECONCILE_RETRIES + 1} attempts`,
        },
      );
    } catch (statusErr) {
      console.error(`[SwarmController] failed to update status for ${swarmId}:`, statusErr);
    }
  }

  async reconcileSwarm(swarm: SwarmResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_swarm', {
      attributes: {
        'resource.name': swarm.metadata.name,
        'resource.namespace': swarm.metadata.namespace ?? 'default',
        'resource.phase': swarm.status?.phase ?? 'Unknown',
      },
    });

    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        const phase = swarm.status?.phase;

        if (phase === 'Suspended') {
          // Suspended — do not evaluate triggers or scale
          return;
        }

        // Initialize state if needed
        const uid = swarm.metadata.uid ?? swarm.metadata.name;
        if (!this.swarmStates.has(uid)) {
          this.swarmStates.set(uid, {
            currentReplicas: swarm.status?.currentReplicas ?? 0,
            desiredReplicas: swarm.status?.desiredReplicas ?? 0,
            lastScaleTime: swarm.status?.lastScaleTime
              ? new Date(swarm.status.lastScaleTime)
              : undefined,
            lastTriggerValue: swarm.status?.lastTriggerValue,
            desiredSince: undefined,
            managedCells: new Set(),
          });
        }

        // Discover existing managed cells
        await this.syncManagedCells(swarm);

        // Evaluate trigger and compute desired replicas
        const triggerValue = await this.evaluateTrigger(swarm);
        const desired = this.computeDesiredReplicas(swarm, triggerValue);

        // Apply scaling decision
        await this.applyScaling(swarm, desired, triggerValue);
      });
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  // ---------------------------------------------------------------------------
  // Periodic trigger evaluation
  // ---------------------------------------------------------------------------

  private async evaluateAllTriggers(): Promise<void> {
    for (const [, swarm] of this.knownSwarms) {
      if (swarm.status?.phase === 'Suspended') continue;
      try {
        await this.reconcileSwarm(swarm);
      } catch (err) {
        console.error(
          `[SwarmController] periodic eval failed for ${swarm.metadata.namespace}/${swarm.metadata.name}:`,
          err,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Trigger evaluation
  // ---------------------------------------------------------------------------

  /** Evaluate trigger and return a numeric value. */
  private async evaluateTrigger(swarm: SwarmResource): Promise<number | undefined> {
    const { trigger } = swarm.spec;

    switch (trigger.type) {
      case 'queue_depth': {
        // Read message count on NATS subject
        // The subject is derived from formationRef: kais.<namespace>.<formationRef>.inbox
        const subject = `kais.${swarm.metadata.namespace}.${swarm.spec.formationRef}.inbox`;
        try {
          const messages = await this.nats.waitForMessage(subject, 1_000);
          return messages.length;
        } catch {
          // No messages or timeout — treat as 0
          return 0;
        }
      }

      case 'metric': {
        // In a real implementation, this would query an external metrics source
        // (e.g., Prometheus, custom metrics API).
        // For now, return the last known value or 0.
        const uid = swarm.metadata.uid ?? swarm.metadata.name;
        const state = this.swarmStates.get(uid);
        return state?.lastTriggerValue ?? 0;
      }

      case 'schedule': {
        // Cron-based: returns 1 if the schedule matches now, 0 otherwise
        const now = new Date();
        return cronMatches(trigger.schedule ?? '* * * * *', now) ? 1 : 0;
      }

      case 'budget_efficiency': {
        // Placeholder: would compare cost vs. throughput
        return 0;
      }

      default:
        return undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Desired replica computation
  // ---------------------------------------------------------------------------

  /** Compute the desired replica count based on trigger value and scaling config. */
  private computeDesiredReplicas(
    swarm: SwarmResource,
    triggerValue: number | undefined,
  ): number {
    const { scaling, trigger } = swarm.spec;
    const uid = swarm.metadata.uid ?? swarm.metadata.name;
    const state = this.swarmStates.get(uid);
    const current = state?.currentReplicas ?? 0;

    if (triggerValue === undefined) return current;

    let desired = current;

    const scaleUpThreshold = trigger.above ?? trigger.threshold ?? Infinity;
    const scaleDownThreshold = trigger.below ?? 0;

    if (triggerValue > scaleUpThreshold) {
      // Scale up by step
      desired = current + scaling.step;
    } else if (triggerValue < scaleDownThreshold) {
      // Scale down by step
      desired = current - scaling.step;
    }

    // For schedule triggers: scale to max on match, min otherwise
    if (trigger.type === 'schedule') {
      desired = triggerValue > 0 ? scaling.maxReplicas : scaling.minReplicas;
    }

    // Clamp to min/max
    desired = Math.max(scaling.minReplicas, Math.min(scaling.maxReplicas, desired));

    return desired;
  }

  // ---------------------------------------------------------------------------
  // Scaling execution
  // ---------------------------------------------------------------------------

  /** Apply the scaling decision: create or delete Cells as needed. */
  private async applyScaling(
    swarm: SwarmResource,
    desired: number,
    triggerValue: number | undefined,
  ): Promise<void> {
    const uid = swarm.metadata.uid ?? swarm.metadata.name;
    const state = this.swarmStates.get(uid);
    if (!state) return;

    const now = new Date();
    const { scaling, budget } = swarm.spec;

    // Cooldown check: don't scale if we scaled recently
    if (state.lastScaleTime) {
      const elapsedSeconds = (now.getTime() - state.lastScaleTime.getTime()) / 1000;
      if (elapsedSeconds < scaling.cooldownSeconds) {
        // Still in cooldown — update status but don't scale
        await this.updateSwarmStatus(swarm, state, triggerValue);
        return;
      }
    }

    // Stabilization check: only act on a desired value if it has been stable
    if (desired !== state.currentReplicas) {
      if (desired !== state.desiredReplicas) {
        // New desired value — start stabilization timer
        state.desiredReplicas = desired;
        state.desiredSince = now;
        await this.updateSwarmStatus(swarm, state, triggerValue);
        return;
      }

      // Check if desired has been stable long enough
      if (state.desiredSince) {
        const stableSeconds = (now.getTime() - state.desiredSince.getTime()) / 1000;
        if (stableSeconds < scaling.stabilizationSeconds) {
          // Not yet stable — wait
          await this.updateSwarmStatus(swarm, state, triggerValue);
          return;
        }
      }
    } else {
      // No change needed
      state.desiredReplicas = desired;
      if (triggerValue !== undefined) state.lastTriggerValue = triggerValue;
      await this.updateSwarmStatus(swarm, state, triggerValue);
      return;
    }

    // Budget check for scale-up
    if (desired > state.currentReplicas && budget?.maxCostPerHour) {
      // Simple budget model: each replica has a fixed hourly cost
      const costPerReplica = 0.10; // Placeholder
      const projectedCost = desired * costPerReplica;
      if (projectedCost > budget.maxCostPerHour) {
        console.log(
          `[SwarmController] budget limit prevents scale-up for ${swarm.metadata.name}: ` +
            `projected $${projectedCost.toFixed(2)}/hr exceeds $${budget.maxCostPerHour.toFixed(2)}/hr`,
        );
        state.desiredReplicas = state.currentReplicas;
        await this.updateSwarmStatus(swarm, state, triggerValue);
        return;
      }
    }

    // Execute scaling
    if (desired > state.currentReplicas) {
      await this.scaleUp(swarm, state, desired - state.currentReplicas);
    } else if (desired < state.currentReplicas) {
      await this.scaleDown(swarm, state, state.currentReplicas - desired);
    }

    state.currentReplicas = desired;
    state.lastScaleTime = now;
    state.desiredReplicas = desired;
    state.desiredSince = undefined;
    if (triggerValue !== undefined) state.lastTriggerValue = triggerValue;

    await this.updateSwarmStatus(swarm, state, triggerValue);
  }

  /** Scale up by creating new Cell CRDs. */
  private async scaleUp(
    swarm: SwarmResource,
    state: SwarmState,
    count: number,
  ): Promise<void> {
    console.log(
      `[SwarmController] scaling up ${swarm.metadata.name}: creating ${count} cell(s)`,
    );

    for (let i = 0; i < count; i++) {
      const cellName = `${swarm.metadata.name}-cell-${Date.now()}-${i}`;
      const cell: CellResource = {
        apiVersion: 'kais.io/v1',
        kind: 'Cell',
        metadata: {
          name: cellName,
          namespace: swarm.metadata.namespace,
          labels: {
            'kais.io/swarm': swarm.metadata.name,
            'kais.io/formation': swarm.spec.formationRef,
            'kais.io/cell-template': swarm.spec.cellTemplate,
          },
        },
        spec: {
          mind: {
            provider: 'ollama' as const,
            model: 'qwen2.5:7b',
            systemPrompt: `Auto-scaled worker cell for swarm ${swarm.metadata.name}`,
          },
        },
      };

      try {
        await this.client.createCell(cell);
        state.managedCells.add(cellName);
      } catch (err) {
        console.error(
          `[SwarmController] failed to create cell ${cellName}:`,
          err,
        );
      }
    }
  }

  /** Scale down by draining and deleting Cell CRDs. */
  private async scaleDown(
    swarm: SwarmResource,
    state: SwarmState,
    count: number,
  ): Promise<void> {
    console.log(
      `[SwarmController] scaling down ${swarm.metadata.name}: removing ${count} cell(s)`,
    );

    // Pick cells to remove (LIFO — most recently created first)
    const cellsToRemove = [...state.managedCells].slice(-count);

    for (const cellName of cellsToRemove) {
      try {
        // Send drain signal via NATS control envelope before deletion
        const drainSubject = `kais.${swarm.metadata.namespace}.${cellName}.control`;
        const drainEnvelope = JSON.stringify({
          type: 'control',
          payload: {
            action: 'drain',
            gracePeriodSeconds: swarm.spec.drainGracePeriodSeconds,
          },
          sender: `swarm/${swarm.metadata.name}`,
          timestamp: new Date().toISOString(),
        });

        await this.nats.sendMessageToCell(cellName, swarm.metadata.namespace, drainEnvelope);
        console.log(`[SwarmController] sent drain signal to ${cellName}`);

        // Wait for drain grace period (in a real implementation, we would watch for
        // the cell to acknowledge drain. For now, use a brief delay.)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(swarm.spec.drainGracePeriodSeconds * 1000, 5000)),
        );

        // Delete the Cell CRD
        await this.client.deleteCell(cellName, swarm.metadata.namespace);
        state.managedCells.delete(cellName);
      } catch (err) {
        console.error(
          `[SwarmController] failed to remove cell ${cellName}:`,
          err,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cell discovery
  // ---------------------------------------------------------------------------

  /** Sync managed cells from the cluster to in-memory state. */
  private async syncManagedCells(swarm: SwarmResource): Promise<void> {
    const uid = swarm.metadata.uid ?? swarm.metadata.name;
    const state = this.swarmStates.get(uid);
    if (!state) return;

    try {
      const cells = await this.client.listCells(
        swarm.metadata.namespace,
        `kais.io/swarm=${swarm.metadata.name}`,
      );
      state.managedCells = new Set(cells.map((c) => c.metadata.name));
      state.currentReplicas = cells.length;
    } catch (err) {
      console.error(
        `[SwarmController] failed to list cells for swarm ${swarm.metadata.name}:`,
        err,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Status updates
  // ---------------------------------------------------------------------------

  /** Push current state to the Swarm status subresource. */
  private async updateSwarmStatus(
    swarm: SwarmResource,
    state: SwarmState,
    triggerValue: number | undefined,
  ): Promise<void> {
    const status: SwarmStatus = {
      phase: 'Active',
      currentReplicas: state.currentReplicas,
      desiredReplicas: state.desiredReplicas,
      lastScaleTime: state.lastScaleTime?.toISOString(),
      lastTriggerValue: triggerValue ?? state.lastTriggerValue,
    };

    await this.client.updateSwarmStatus(
      swarm.metadata.name,
      swarm.metadata.namespace,
      status,
    );
  }
}
