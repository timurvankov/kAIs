import type * as k8s from '@kubernetes/client-node';
import * as k8sLib from '@kubernetes/client-node';
import type { ExperimentStatus } from '@kais/core';
import { analyzeExperiment, type RunDataPoint } from '@kais/core';
import { getTracer } from '@kais/core';
import { SpanStatusCode, trace, context } from '@opentelemetry/api';

import type { ExperimentResource, KubeClient } from './types.js';

const tracer = getTracer('kais-operator');

const RECONCILE_RETRY_DELAY_MS = 5_000;
const MAX_RECONCILE_RETRIES = 3;

function httpStatus(err: unknown): number | undefined {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e.code ?? e.statusCode ?? e.response?.statusCode;
}

/** Generate cartesian product of variable arrays. */
function cartesianProduct(
  variables: Array<{ name: string; values: unknown[] }>,
): Array<Record<string, unknown>> {
  if (variables.length === 0) return [{}];
  const [first, ...rest] = variables;
  const restProduct = cartesianProduct(rest);
  const result: Array<Record<string, unknown>> = [];
  for (const value of first!.values) {
    for (const combo of restProduct) {
      result.push({ [first!.name]: value, ...combo });
    }
  }
  return result;
}

/** Build a human-readable variant key from variable assignments. */
function variantKey(variables: Record<string, unknown>): string {
  return Object.entries(variables)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(', ');
}

/** In-memory run queue entry. */
interface QueuedRun {
  id: string;
  variables: Record<string, unknown>;
  repeat: number;
  phase: 'pending' | 'running' | 'succeeded' | 'failed';
  cost?: number;
  metrics?: Record<string, number>;
}

/**
 * ExperimentController watches Experiment CRDs and drives experiment lifecycle.
 *
 * Lifecycle: Pending → Running → Analyzing → Completed / Failed / Aborted
 *
 * In Pending phase:
 *   - Generate run matrix (cartesian product of variables × repeats)
 *   - Estimate cost and validate against budget
 *   - Transition to Running
 *
 * In Running phase:
 *   - Launch runs up to parallel limit
 *   - Track completion
 *   - Enforce budget limits
 *   - When all runs complete → transition to Analyzing
 *
 * In Analyzing phase:
 *   - Run statistical analysis on collected metrics
 *   - Store results in status.analysis
 *   - Transition to Completed
 */
export class ExperimentController {
  private experimentInformer: k8s.Informer<k8s.KubernetesObject> | null = null;
  private stopped = false;

  /** In-memory run queues, keyed by experiment UID. */
  private runQueues = new Map<string, QueuedRun[]>();

  constructor(
    private readonly kc: k8s.KubeConfig,
    private readonly client: KubeClient,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.startExperimentInformer();
    console.log('[ExperimentController] started watching Experiment CRDs');
  }

  private async startExperimentInformer(): Promise<void> {
    const customApi = this.kc.makeApiClient(k8sLib.CustomObjectsApi);
    const path = '/apis/kais.io/v1/experiments';

    const listFn = async (): Promise<
      k8s.KubernetesListObject<k8s.KubernetesObject>
    > => {
      const response = await customApi.listClusterCustomObject({
        group: 'kais.io',
        version: 'v1',
        plural: 'experiments',
      });
      return response as k8s.KubernetesListObject<k8s.KubernetesObject>;
    };

    this.experimentInformer = k8sLib.makeInformer(this.kc, path, listFn);

    this.experimentInformer.on('add', (obj: k8s.KubernetesObject) => {
      void this.handleExperimentEvent('add', obj);
    });

    this.experimentInformer.on('update', (obj: k8s.KubernetesObject) => {
      void this.handleExperimentEvent('update', obj);
    });

    this.experimentInformer.on('delete', (obj: k8s.KubernetesObject) => {
      void this.handleExperimentEvent('delete', obj);
    });

    this.experimentInformer.on('error', (err: unknown) => {
      if (!this.stopped) {
        console.error('[ExperimentController] watch error:', err);
        setTimeout(() => {
          if (!this.stopped) {
            console.log('[ExperimentController] restarting informer...');
            void this.experimentInformer?.start();
          }
        }, RECONCILE_RETRY_DELAY_MS);
      }
    });

    await this.experimentInformer.start();
  }

  stop(): void {
    this.stopped = true;
    if (this.experimentInformer) {
      void this.experimentInformer.stop();
      this.experimentInformer = null;
    }
    this.runQueues.clear();
    console.log('[ExperimentController] stopped');
  }

  private async handleExperimentEvent(
    event: 'add' | 'update' | 'delete',
    obj: k8s.KubernetesObject,
  ): Promise<void> {
    const experiment = obj as unknown as ExperimentResource;
    const expId = `${experiment.metadata.namespace}/${experiment.metadata.name}`;

    console.log(`[ExperimentController] experiment ${event} event for ${expId}`);

    if (event === 'delete') {
      // Clean up run queue
      if (experiment.metadata.uid) {
        this.runQueues.delete(experiment.metadata.uid);
      }
      return;
    }

    for (let attempt = 0; attempt <= MAX_RECONCILE_RETRIES; attempt++) {
      try {
        await this.reconcileExperiment(experiment);
        return;
      } catch (err) {
        if (httpStatus(err) === 404) {
          console.log(`[ExperimentController] experiment ${expId} not found, skipping`);
          return;
        }
        console.error(
          `[ExperimentController] reconcile attempt ${attempt + 1} failed for ${expId}:`,
          err,
        );
        if (attempt < MAX_RECONCILE_RETRIES) {
          const delay = RECONCILE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.error(`[ExperimentController] exhausted retries for ${expId}`);

    try {
      await this.client.updateExperimentStatus(
        experiment.metadata.name,
        experiment.metadata.namespace,
        {
          phase: 'Failed',
          totalRuns: experiment.status?.totalRuns ?? 0,
          completedRuns: experiment.status?.completedRuns ?? 0,
          failedRuns: experiment.status?.failedRuns ?? 0,
          actualCost: experiment.status?.actualCost ?? 0,
          message: `Reconciliation failed after ${MAX_RECONCILE_RETRIES + 1} attempts`,
        },
      );
    } catch (statusErr) {
      console.error(`[ExperimentController] failed to update status for ${expId}:`, statusErr);
    }
  }

  async reconcileExperiment(experiment: ExperimentResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_experiment', {
      attributes: {
        'resource.name': experiment.metadata.name,
        'resource.namespace': experiment.metadata.namespace ?? 'default',
        'resource.phase': experiment.status?.phase ?? 'Unknown',
      },
    });

    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        const phase = experiment.status?.phase;
        switch (phase) {
          case undefined:
          case 'Pending':
            await this.reconcilePending(experiment);
            break;
          case 'Running':
            await this.reconcileRunning(experiment);
            break;
          case 'Analyzing':
            await this.reconcileAnalyzing(experiment);
            break;
          case 'Completed':
          case 'Failed':
          case 'Aborted':
            // Terminal phases
            break;
        }
      });
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * Pending → Generate run matrix, estimate cost, transition to Running.
   */
  private async reconcilePending(experiment: ExperimentResource): Promise<void> {
    const { variables, repeats = 3, budget, parallel = 1 } = experiment.spec;

    // Generate variant matrix
    const matrix = cartesianProduct(variables);
    const runs: QueuedRun[] = [];
    let runNumber = 0;

    for (const variant of matrix) {
      for (let r = 1; r <= repeats; r++) {
        runNumber++;
        runs.push({
          id: `run-${String(runNumber).padStart(3, '0')}`,
          variables: variant,
          repeat: r,
          phase: 'pending',
        });
      }
    }

    const totalRuns = runs.length;

    // Simple cost estimation (placeholder — real estimation requires model cost tables)
    const estimatedCostPerRun = 2.0; // Conservative estimate
    const estimatedCost = totalRuns * estimatedCostPerRun;

    // Budget check
    if (estimatedCost > budget.maxTotalCost && budget.abortOnOverBudget) {
      const suggestedRepeats = Math.max(1, Math.floor(budget.maxTotalCost / (matrix.length * estimatedCostPerRun)));
      const status: ExperimentStatus = {
        phase: 'Failed',
        totalRuns,
        completedRuns: 0,
        failedRuns: 0,
        estimatedCost,
        actualCost: 0,
        message: `Estimated cost $${estimatedCost.toFixed(2)} exceeds budget $${budget.maxTotalCost.toFixed(2)}`,
        suggestions: [
          `Reduce repeats from ${repeats} to ${suggestedRepeats}`,
          `Reduce variables to fewer values`,
          `Increase budget to $${estimatedCost.toFixed(2)}`,
        ],
      };
      await this.client.updateExperimentStatus(
        experiment.metadata.name,
        experiment.metadata.namespace,
        status,
      );
      await this.client.emitExperimentEvent(
        experiment,
        'ExperimentOverBudget',
        'ExperimentOverBudget',
        `Experiment ${experiment.metadata.name}: estimated cost $${estimatedCost.toFixed(2)} exceeds budget`,
      );
      return;
    }

    // Store run queue
    const uid = experiment.metadata.uid ?? experiment.metadata.name;
    this.runQueues.set(uid, runs);

    // Transition to Running
    const status: ExperimentStatus = {
      phase: 'Running',
      totalRuns,
      completedRuns: 0,
      failedRuns: 0,
      estimatedCost,
      actualCost: 0,
      currentRuns: runs.slice(0, parallel).map((r) => ({
        id: r.id,
        variables: r.variables as Record<string, unknown>,
        repeat: r.repeat,
        phase: 'pending' as const,
      })),
    };

    await this.client.updateExperimentStatus(
      experiment.metadata.name,
      experiment.metadata.namespace,
      status,
    );
    await this.client.emitExperimentEvent(
      experiment,
      'ExperimentStarted',
      'ExperimentStarted',
      `Experiment ${experiment.metadata.name} started: ${totalRuns} runs planned`,
    );
  }

  /**
   * Running → Launch runs, track completion, enforce budget.
   */
  private async reconcileRunning(experiment: ExperimentResource): Promise<void> {
    const uid = experiment.metadata.uid ?? experiment.metadata.name;
    const runs = this.runQueues.get(uid);

    if (!runs) {
      // Run queue lost (controller restart) — transition to Analyzing with what we have
      console.log(`[ExperimentController] no run queue for ${uid}, transitioning to Analyzing`);
      await this.transitionToAnalyzing(experiment);
      return;
    }

    const { parallel = 1, budget } = experiment.spec;

    // Count states
    const pending = runs.filter((r) => r.phase === 'pending');
    const running = runs.filter((r) => r.phase === 'running');
    const completed = runs.filter((r) => r.phase === 'succeeded');
    const failed = runs.filter((r) => r.phase === 'failed');
    const actualCost = runs.reduce((sum, r) => sum + (r.cost ?? 0), 0);

    // Budget enforcement
    if (actualCost >= budget.maxTotalCost) {
      // Abort remaining runs, analyze what we have
      for (const r of [...pending, ...running]) {
        r.phase = 'failed';
      }
      await this.client.emitExperimentEvent(
        experiment,
        'ExperimentOverBudget',
        'ExperimentOverBudget',
        `Experiment ${experiment.metadata.name}: cost $${actualCost.toFixed(2)} exceeded budget`,
      );
      await this.transitionToAnalyzing(experiment);
      return;
    }

    // Launch pending runs up to parallel limit
    const slotsAvailable = parallel - running.length;
    const toStart = pending.slice(0, slotsAvailable);

    for (const run of toStart) {
      run.phase = 'running';
      // In a real implementation, this would launch a Formation + Mission.
      // For now, mark as succeeded immediately with mock metrics.
      // The actual runner logic will be in Phase 3.4 (In-Process Runtime).
      run.phase = 'succeeded';
      run.cost = 0;
      run.metrics = { duration: 0 };
    }

    // Check if all done
    const allDone = runs.every((r) => r.phase === 'succeeded' || r.phase === 'failed');
    if (allDone) {
      await this.transitionToAnalyzing(experiment);
      return;
    }

    // Update status with current progress
    const activeRuns = runs.filter((r) => r.phase === 'running' || r.phase === 'pending');
    const status: ExperimentStatus = {
      phase: 'Running',
      totalRuns: runs.length,
      completedRuns: completed.length + toStart.length,
      failedRuns: failed.length,
      actualCost,
      currentRuns: activeRuns.slice(0, 10).map((r) => ({
        id: r.id,
        variables: r.variables as Record<string, unknown>,
        repeat: r.repeat,
        phase: r.phase as 'pending' | 'running',
        cost: r.cost,
      })),
    };

    await this.client.updateExperimentStatus(
      experiment.metadata.name,
      experiment.metadata.namespace,
      status,
    );
  }

  /**
   * Analyzing → Run statistical analysis, store results, transition to Completed.
   */
  private async reconcileAnalyzing(experiment: ExperimentResource): Promise<void> {
    const uid = experiment.metadata.uid ?? experiment.metadata.name;
    const runs = this.runQueues.get(uid) ?? [];

    // Collect data points for analysis
    const metricNames = experiment.spec.metrics.map((m) => m.name);
    const dataPoints: RunDataPoint[] = runs
      .filter((r) => r.phase === 'succeeded' && r.metrics)
      .map((r) => ({
        variantKey: variantKey(r.variables),
        metrics: r.metrics!,
      }));

    const analysis = dataPoints.length > 0
      ? analyzeExperiment(dataPoints, metricNames)
      : { metrics: {}, pareto: { metrics: metricNames, front: [] }, summary: '' };

    const actualCost = runs.reduce((sum, r) => sum + (r.cost ?? 0), 0);

    const status: ExperimentStatus = {
      phase: 'Completed',
      totalRuns: runs.length,
      completedRuns: runs.filter((r) => r.phase === 'succeeded').length,
      failedRuns: runs.filter((r) => r.phase === 'failed').length,
      actualCost,
      analysis,
    };

    await this.client.updateExperimentStatus(
      experiment.metadata.name,
      experiment.metadata.namespace,
      status,
    );
    await this.client.emitExperimentEvent(
      experiment,
      'ExperimentCompleted',
      'ExperimentCompleted',
      `Experiment ${experiment.metadata.name} completed: ${status.completedRuns}/${status.totalRuns} runs succeeded`,
    );

    // Clean up
    this.runQueues.delete(uid);
  }

  private async transitionToAnalyzing(experiment: ExperimentResource): Promise<void> {
    const uid = experiment.metadata.uid ?? experiment.metadata.name;
    const runs = this.runQueues.get(uid) ?? [];
    const actualCost = runs.reduce((sum, r) => sum + (r.cost ?? 0), 0);

    const status: ExperimentStatus = {
      phase: 'Analyzing',
      totalRuns: runs.length,
      completedRuns: runs.filter((r) => r.phase === 'succeeded').length,
      failedRuns: runs.filter((r) => r.phase === 'failed').length,
      actualCost,
    };

    await this.client.updateExperimentStatus(
      experiment.metadata.name,
      experiment.metadata.namespace,
      status,
    );
    await this.client.emitExperimentEvent(
      experiment,
      'ExperimentAnalyzing',
      'ExperimentAnalyzing',
      `Experiment ${experiment.metadata.name} analyzing results`,
    );
  }
}
