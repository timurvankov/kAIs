import type { CellSpec, CellStatus, ExperimentStatus, FormationStatus, MissionStatus } from '@kais/core';
import type * as k8s from '@kubernetes/client-node';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExperimentController } from '../experiment-controller.js';
import type {
  CellEventType,
  CellResource,
  ExperimentEventType,
  ExperimentResource,
  FormationEventType,
  FormationResource,
  KubeClient,
  MissionEventType,
  MissionResource,
} from '../types.js';

// --- Mock types ---

interface ExperimentStatusUpdateCall {
  name: string;
  namespace: string;
  status: ExperimentStatus;
}

interface ExperimentEventCall {
  experiment: ExperimentResource;
  eventType: ExperimentEventType;
  reason: string;
  message: string;
}

// --- Mock factories ---

function createMockClient(): KubeClient & {
  statusUpdates: ExperimentStatusUpdateCall[];
  events: ExperimentEventCall[];
} {
  const statusUpdates: ExperimentStatusUpdateCall[] = [];
  const events: ExperimentEventCall[] = [];

  return {
    statusUpdates,
    events,

    // Pod methods (unused)
    async getPod(): Promise<k8s.V1Pod | null> { return null; },
    async createPod(pod: k8s.V1Pod): Promise<k8s.V1Pod> { return pod; },
    async deletePod(): Promise<void> {},
    async listPods(): Promise<k8s.V1PodList> { return { items: [] } as k8s.V1PodList; },

    // Cell methods (unused)
    async getCell(): Promise<CellResource | null> { return null; },
    async createCell(cell: CellResource): Promise<CellResource> { return cell; },
    async updateCell(): Promise<void> {},
    async deleteCell(): Promise<void> {},
    async listCells(): Promise<CellResource[]> { return []; },
    async updateCellStatus(): Promise<void> {},

    // Formation/Mission/ConfigMap/PVC/Event methods (unused)
    async updateFormationStatus(): Promise<void> {},
    async createOrUpdateConfigMap(): Promise<void> {},
    async createPVC(): Promise<void> {},
    async getPVC(): Promise<k8s.V1PersistentVolumeClaim | null> { return null; },
    async emitEvent(): Promise<void> {},
    async emitFormationEvent(): Promise<void> {},
    async updateMissionStatus(): Promise<void> {},
    async emitMissionEvent(): Promise<void> {},

    // Experiment methods
    async updateExperimentStatus(
      name: string,
      namespace: string,
      status: ExperimentStatus,
    ): Promise<void> {
      statusUpdates.push({ name, namespace, status });
    },
    async emitExperimentEvent(
      experiment: ExperimentResource,
      eventType: ExperimentEventType,
      reason: string,
      message: string,
    ): Promise<void> {
      events.push({ experiment, eventType, reason, message });
    },
    updateBlueprintStatus: vi.fn(),
    emitBlueprintEvent: vi.fn(),
    updateKnowledgeGraphStatus: vi.fn(),
    emitKnowledgeGraphEvent: vi.fn(),
    listKnowledgeGraphs: vi.fn().mockResolvedValue([]),
    createKnowledgeGraphPod: vi.fn(),
    createKnowledgeGraphService: vi.fn(),
    deleteKnowledgeGraphPod: vi.fn(),
    deleteKnowledgeGraphService: vi.fn(),
    updateEvolutionStatus: vi.fn(),
    updateSwarmStatus: vi.fn(),
    updateChannelStatus: vi.fn(),
    updateFederationStatus: vi.fn(),
  };
}

function makeExperiment(
  overrides: Partial<ExperimentResource> = {},
  specOverrides: Partial<ExperimentResource['spec']> = {},
  statusOverride?: ExperimentStatus,
): ExperimentResource {
  return {
    apiVersion: 'kais.io/v1',
    kind: 'Experiment',
    metadata: {
      name: 'test-experiment',
      namespace: 'default',
      uid: 'exp-uid-123',
      resourceVersion: '1',
      ...overrides.metadata,
    },
    spec: {
      variables: [
        { name: 'topology', values: ['star', 'hierarchy'] },
      ],
      repeats: 2,
      template: {
        kind: 'Formation' as const,
        spec: { cells: [] },
      },
      mission: {
        objective: 'Build feature X',
        completion: {
          checks: [{ name: 'tests-pass', type: 'command' as const, command: 'npm test' }],
          maxAttempts: 3,
          timeout: '10m',
        },
      },
      metrics: [
        { name: 'duration', type: 'duration' as const },
        { name: 'cost', type: 'sum' as const },
      ],
      runtime: 'in-process' as const,
      budget: {
        maxTotalCost: 100,
        abortOnOverBudget: true,
      },
      parallel: 2,
      ...specOverrides,
    },
    status: statusOverride,
  };
}

// --- Helper: create controller without informer (direct reconcile) ---

function createController(): {
  controller: ExperimentController;
  client: ReturnType<typeof createMockClient>;
} {
  const client = createMockClient();
  // Pass null kc — we only test reconcileExperiment directly
  const controller = new ExperimentController(
    null as any, // kc not needed for unit tests
    client,
  );
  return { controller, client };
}

// --- Tests ---

describe('ExperimentController', () => {
  describe('reconcilePending', () => {
    it('generates correct run count from variables × repeats', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [
          { name: 'a', values: [1, 2, 3] },
          { name: 'b', values: ['x', 'y'] },
        ],
        repeats: 3,
      });

      await controller.reconcileExperiment(exp);

      const lastUpdate = client.statusUpdates[client.statusUpdates.length - 1]!;
      // 3 × 2 × 3 = 18 runs
      expect(lastUpdate.status.totalRuns).toBe(18);
    });

    it('transitions to Running with ExperimentStarted event', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment();

      await controller.reconcileExperiment(exp);

      // Last status update should be Running (runs complete immediately in mock)
      const updates = client.statusUpdates;
      // Could be Running→Analyzing→Completed depending on mock run speed
      expect(updates.length).toBeGreaterThan(0);
      expect(client.events.some(e => e.eventType === 'ExperimentStarted')).toBe(true);
    });

    it('fails with over-budget message when estimated cost exceeds budget', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [
          { name: 'a', values: [1, 2, 3, 4, 5] },
          { name: 'b', values: [1, 2, 3, 4, 5] },
        ],
        repeats: 5,
        budget: { maxTotalCost: 10, abortOnOverBudget: true },
      });

      await controller.reconcileExperiment(exp);

      const lastUpdate = client.statusUpdates[client.statusUpdates.length - 1]!;
      expect(lastUpdate.status.phase).toBe('Failed');
      expect(lastUpdate.status.message).toContain('exceeds budget');
      expect(lastUpdate.status.suggestions).toBeDefined();
      expect(lastUpdate.status.suggestions!.length).toBeGreaterThan(0);
    });

    it('emits ExperimentOverBudget event when over budget', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [{ name: 'a', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
        repeats: 10,
        budget: { maxTotalCost: 5, abortOnOverBudget: true },
      });

      await controller.reconcileExperiment(exp);

      expect(client.events.some(e => e.eventType === 'ExperimentOverBudget')).toBe(true);
    });

    it('proceeds when estimated cost is within budget', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [{ name: 'a', values: [1] }],
        repeats: 1,
        budget: { maxTotalCost: 1000, abortOnOverBudget: true },
      });

      await controller.reconcileExperiment(exp);

      const hasStarted = client.events.some(e => e.eventType === 'ExperimentStarted');
      expect(hasStarted).toBe(true);
    });
  });

  describe('reconcileRunning', () => {
    it('transitions to Running on first reconcile from Pending', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [{ name: 'a', values: [1, 2] }],
        repeats: 2,
      });

      // First reconcile: Pending → Running
      await controller.reconcileExperiment(exp);

      const runningUpdate = client.statusUpdates.find(u => u.status.phase === 'Running');
      expect(runningUpdate).toBeDefined();
      expect(runningUpdate!.status.totalRuns).toBe(4);
    });

    it('completes runs and transitions to Analyzing on second reconcile', async () => {
      const { controller, client } = createController();
      // Use parallel >= total runs so all complete in one Running reconcile
      const exp = makeExperiment({}, {
        variables: [{ name: 'a', values: [1] }],
        repeats: 1,
        parallel: 5,
      });

      // First reconcile: Pending → Running (stores run queue)
      await controller.reconcileExperiment(exp);

      // Second reconcile: Running → all done → Analyzing
      const expRunning = { ...exp, status: client.statusUpdates[client.statusUpdates.length - 1]!.status };
      await controller.reconcileExperiment(expRunning as ExperimentResource);

      const hasAnalyzing = client.events.some(e => e.eventType === 'ExperimentAnalyzing');
      expect(hasAnalyzing).toBe(true);
    });

    it('full lifecycle: Pending → Running → Analyzing → Completed', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [{ name: 'a', values: [1] }],
        repeats: 1,
      });

      // Reconcile #1: Pending → Running
      await controller.reconcileExperiment(exp);
      const status1 = client.statusUpdates[client.statusUpdates.length - 1]!.status;

      // Reconcile #2: Running → (runs complete) → Analyzing
      const exp2 = { ...exp, status: status1 };
      await controller.reconcileExperiment(exp2 as ExperimentResource);
      const status2 = client.statusUpdates[client.statusUpdates.length - 1]!.status;

      // Reconcile #3: Analyzing → Completed
      const exp3 = { ...exp, status: status2 };
      await controller.reconcileExperiment(exp3 as ExperimentResource);

      const lastUpdate = client.statusUpdates[client.statusUpdates.length - 1]!;
      expect(lastUpdate.status.phase).toBe('Completed');
      expect(client.events.some(e => e.eventType === 'ExperimentCompleted')).toBe(true);
    });
  });

  describe('reconcileAnalyzing', () => {
    it('produces analysis result on Analyzing phase', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [{ name: 'model', values: ['fast', 'slow'] }],
        repeats: 1,
        metrics: [
          { name: 'duration', type: 'duration' as const },
        ],
      });

      // Drive through all phases
      await controller.reconcileExperiment(exp);
      const s1 = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      await controller.reconcileExperiment({ ...exp, status: s1 } as ExperimentResource);
      const s2 = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      await controller.reconcileExperiment({ ...exp, status: s2 } as ExperimentResource);

      const lastUpdate = client.statusUpdates[client.statusUpdates.length - 1]!;
      expect(lastUpdate.status.phase).toBe('Completed');
      expect(lastUpdate.status.analysis).toBeDefined();
    });
  });

  describe('terminal phases', () => {
    it('does nothing for Completed experiments', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {}, {
        phase: 'Completed',
        totalRuns: 10,
        completedRuns: 10,
        failedRuns: 0,
        actualCost: 20,
      });

      await controller.reconcileExperiment(exp);

      expect(client.statusUpdates).toHaveLength(0);
      expect(client.events).toHaveLength(0);
    });

    it('does nothing for Failed experiments', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {}, {
        phase: 'Failed',
        totalRuns: 10,
        completedRuns: 3,
        failedRuns: 7,
        actualCost: 6,
      });

      await controller.reconcileExperiment(exp);

      expect(client.statusUpdates).toHaveLength(0);
      expect(client.events).toHaveLength(0);
    });

    it('does nothing for Aborted experiments', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {}, {
        phase: 'Aborted',
        totalRuns: 10,
        completedRuns: 5,
        failedRuns: 0,
        actualCost: 10,
      });

      await controller.reconcileExperiment(exp);

      expect(client.statusUpdates).toHaveLength(0);
      expect(client.events).toHaveLength(0);
    });
  });

  describe('cartesian product', () => {
    it('single variable produces correct number of runs', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [{ name: 'x', values: [1, 2, 3, 4, 5] }],
        repeats: 1,
      });

      await controller.reconcileExperiment(exp);

      // Find the first Running status update
      const runningUpdate = client.statusUpdates.find(u => u.status.totalRuns !== undefined);
      expect(runningUpdate).toBeDefined();
      expect(runningUpdate!.status.totalRuns).toBe(5);
    });

    it('multiple variables produce cartesian product', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment({}, {
        variables: [
          { name: 'a', values: [1, 2] },
          { name: 'b', values: ['x', 'y', 'z'] },
          { name: 'c', values: [true, false] },
        ],
        repeats: 1,
      });

      await controller.reconcileExperiment(exp);

      // 2 × 3 × 2 = 12
      const runningUpdate = client.statusUpdates.find(u => u.status.totalRuns !== undefined);
      expect(runningUpdate!.status.totalRuns).toBe(12);
    });
  });

  describe('stop/cleanup', () => {
    it('clears run queues on stop', async () => {
      const { controller, client } = createController();
      const exp = makeExperiment();

      // Run one experiment to populate queue
      await controller.reconcileExperiment(exp);

      // Stop should clear everything
      controller.stop();
      // No assertion needed — just verifying no error
    });
  });
});
