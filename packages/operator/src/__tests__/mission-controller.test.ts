import type { CellSpec, CellStatus, FormationStatus, MissionStatus } from '@kais/core';
import type * as k8s from '@kubernetes/client-node';
import { beforeEach, describe, expect, it } from 'vitest';

import { MissionController } from '../mission-controller.js';
import type {
  CellEventType,
  CellResource,
  CommandExecutor,
  FileSystem,
  FormationEventType,
  FormationResource,
  KubeClient,
  MissionEventType,
  MissionResource,
  NatsClient,
} from '../types.js';

// --- Mock types ---

interface MissionStatusUpdateCall {
  name: string;
  namespace: string;
  status: MissionStatus;
}

interface MissionEventCall {
  mission: MissionResource;
  eventType: MissionEventType;
  reason: string;
  message: string;
}

interface NatsSendCall {
  cellName: string;
  namespace: string;
  message: string;
}

// --- Mock factories ---

function createMockClient(): KubeClient & {
  missionStatusUpdates: MissionStatusUpdateCall[];
  missionEvents: MissionEventCall[];
} {
  const missionStatusUpdates: MissionStatusUpdateCall[] = [];
  const missionEvents: MissionEventCall[] = [];

  return {
    missionStatusUpdates,
    missionEvents,

    // Pod methods (not used by MissionController)
    async getPod(): Promise<k8s.V1Pod | null> { return null; },
    async createPod(pod: k8s.V1Pod): Promise<k8s.V1Pod> { return pod; },
    async deletePod(): Promise<void> {},
    async listPods(): Promise<k8s.V1PodList> { return { items: [] } as k8s.V1PodList; },

    // Cell methods (not used by MissionController)
    async getCell(): Promise<CellResource | null> { return null; },
    async createCell(cell: CellResource): Promise<CellResource> { return cell; },
    async updateCell(): Promise<void> {},
    async deleteCell(): Promise<void> {},
    async listCells(): Promise<CellResource[]> { return []; },
    async updateCellStatus(): Promise<void> {},

    // Formation methods (not used by MissionController)
    async updateFormationStatus(): Promise<void> {},
    async createOrUpdateConfigMap(): Promise<void> {},
    async createPVC(): Promise<void> {},
    async getPVC(): Promise<k8s.V1PersistentVolumeClaim | null> { return null; },
    async emitEvent(): Promise<void> {},
    async emitFormationEvent(): Promise<void> {},

    // Mission methods
    async updateMissionStatus(
      name: string,
      namespace: string,
      status: MissionStatus,
    ): Promise<void> {
      missionStatusUpdates.push({ name, namespace, status });
    },
    async emitMissionEvent(
      mission: MissionResource,
      eventType: MissionEventType,
      reason: string,
      message: string,
    ): Promise<void> {
      missionEvents.push({ mission, eventType, reason, message });
    },
  };
}

function createMockNats(): NatsClient & { sends: NatsSendCall[] } {
  const sends: NatsSendCall[] = [];
  return {
    sends,
    async sendMessageToCell(cellName: string, namespace: string, message: string): Promise<void> {
      sends.push({ cellName, namespace, message });
    },
    async waitForMessage(): Promise<string[]> {
      return [];
    },
  };
}

function createMockExecutor(
  results: Record<string, { stdout: string; stderr: string; exitCode: number }> = {},
): CommandExecutor {
  return {
    async exec(command: string) {
      const result = results[command];
      if (!result) {
        return { stdout: '', stderr: 'command not found', exitCode: 127 };
      }
      return result;
    },
  };
}

function createMockFs(existingPaths: Set<string> = new Set()): FileSystem {
  return {
    async exists(p: string) {
      return existingPaths.has(p);
    },
  };
}

function makeMission(
  overrides: Partial<MissionResource> = {},
  specOverrides: Partial<MissionResource['spec']> = {},
  statusOverride?: MissionStatus,
): MissionResource {
  const result: MissionResource = {
    apiVersion: 'kais.io/v1',
    kind: 'Mission',
    metadata: {
      name: 'test-mission',
      namespace: 'default',
      uid: 'mission-uid-123',
      resourceVersion: '1',
      ...overrides.metadata,
    },
    spec: {
      formationRef: 'test-formation',
      objective: 'Implement feature X',
      completion: {
        checks: [
          {
            name: 'tests-pass',
            type: 'command',
            command: 'npm test',
            successPattern: 'passed',
          },
        ],
        maxAttempts: 3,
        timeout: '30m',
      },
      entrypoint: {
        cell: 'researcher',
        message: 'Please implement feature X',
      },
      ...specOverrides,
    },
  };
  if (statusOverride !== undefined) {
    result.status = statusOverride;
  }
  return result;
}

function createController(
  client: KubeClient,
  nats: NatsClient,
  executor: CommandExecutor = createMockExecutor(),
  fs: FileSystem = createMockFs(),
  workspacePath = '/workspace',
): MissionController {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new MissionController(null as any, client, nats, executor, fs, workspacePath);
}

// --- Tests ---

describe('MissionController.reconcileMission', () => {
  let client: ReturnType<typeof createMockClient>;
  let nats: ReturnType<typeof createMockNats>;

  beforeEach(() => {
    client = createMockClient();
    nats = createMockNats();
  });

  // --- Pending → Running ---

  describe('Pending phase', () => {
    it('sends message to entrypoint cell and transitions to Running', async () => {
      const mission = makeMission();
      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      // Should send NATS message
      expect(nats.sends).toHaveLength(1);
      expect(nats.sends[0]!.cellName).toBe('researcher');
      expect(nats.sends[0]!.namespace).toBe('default');
      expect(nats.sends[0]!.message).toBe('Please implement feature X');

      // Should update status to Running
      expect(client.missionStatusUpdates).toHaveLength(1);
      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Running');
      expect(status.attempt).toBe(1);
      expect(status.startedAt).toBeDefined();

      // Should emit MissionStarted event
      const startEvent = client.missionEvents.find((e) => e.eventType === 'MissionStarted');
      expect(startEvent).toBeDefined();
    });

    it('handles undefined status as Pending', async () => {
      const mission = makeMission();
      // mission.status is undefined
      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      expect(nats.sends).toHaveLength(1);
      expect(client.missionStatusUpdates[0]!.status.phase).toBe('Running');
      expect(client.missionStatusUpdates[0]!.status.attempt).toBe(1);
    });

    it('increments attempt on retry', async () => {
      const mission = makeMission({}, {}, {
        phase: 'Pending',
        attempt: 2,
        cost: 5.0,
        startedAt: '2025-06-15T09:00:00.000Z',
        message: 'Timed out, retrying',
      });
      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.attempt).toBe(3);
      expect(status.cost).toBe(5.0);
      // Previous attempt should be recorded in history
      expect(status.history).toBeDefined();
      expect(status.history!.length).toBeGreaterThan(0);
    });
  });

  // --- Running → Succeeded (checks pass, no review) ---

  describe('Running → Succeeded (checks pass)', () => {
    it('succeeds when all checks pass and no review is required', async () => {
      const mission = makeMission({}, {}, {
        phase: 'Running',
        attempt: 1,
        startedAt: new Date().toISOString(),
        cost: 1.0,
      });

      const executor = createMockExecutor({
        'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Succeeded');
      expect(status.checks).toBeDefined();
      expect(status.checks![0]!.status).toBe('Passed');

      const completedEvent = client.missionEvents.find((e) => e.eventType === 'MissionCompleted');
      expect(completedEvent).toBeDefined();
    });
  });

  // --- Running → Failed (timeout, no retries left) ---

  describe('Running → Failed (timeout)', () => {
    it('fails when timed out and max attempts reached', async () => {
      const startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min ago
      const mission = makeMission({}, {}, {
        phase: 'Running',
        attempt: 3,
        startedAt,
        cost: 2.0,
      });

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Failed');
      expect(status.message).toBe('Timed out after max attempts');

      const failEvent = client.missionEvents.find((e) => e.eventType === 'MissionFailed');
      expect(failEvent).toBeDefined();
    });

    it('retries when timed out but attempts remain', async () => {
      const startedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min ago
      const mission = makeMission({}, {}, {
        phase: 'Running',
        attempt: 1,
        startedAt,
        cost: 1.0,
      });

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Pending');
      expect(status.message).toBe('Timed out, retrying');

      const timeoutEvent = client.missionEvents.find((e) => e.eventType === 'MissionTimeout');
      expect(timeoutEvent).toBeDefined();
    });
  });

  // --- Running → Failed (budget) ---

  describe('Running → Failed (budget)', () => {
    it('fails when budget is exhausted', async () => {
      const mission = makeMission(
        {},
        {
          budget: { maxCost: 10.0 },
        },
        {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date().toISOString(),
          cost: 15.0,
        },
      );

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Failed');
      expect(status.message).toBe('Budget exhausted');

      const failEvent = client.missionEvents.find((e) => e.eventType === 'MissionFailed');
      expect(failEvent).toBeDefined();
      expect(failEvent!.message).toContain('budget exhausted');
    });

    it('does not fail when cost is under budget', async () => {
      const mission = makeMission(
        {},
        {
          budget: { maxCost: 100.0 },
        },
        {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date().toISOString(),
          cost: 5.0,
        },
      );

      const executor = createMockExecutor({
        'npm test': { stdout: 'passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Succeeded');
    });

    it('does not check budget when no budget is set', async () => {
      const mission = makeMission({}, {}, {
        phase: 'Running',
        attempt: 1,
        startedAt: new Date().toISOString(),
        cost: 999.0,
      });

      const executor = createMockExecutor({
        'npm test': { stdout: 'passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Succeeded');
    });
  });

  // --- Retry logic ---

  describe('Retry logic', () => {
    it('retries on timeout with attempts remaining', async () => {
      const startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      const mission = makeMission(
        {},
        {
          completion: {
            checks: [{ name: 'test', type: 'command', command: 'npm test' }],
            maxAttempts: 5,
            timeout: '30m',
          },
        },
        {
          phase: 'Running',
          attempt: 2,
          startedAt,
          cost: 3.0,
        },
      );

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Pending');
      expect(status.message).toContain('Timed out');
    });

    it('fails after max attempts on timeout', async () => {
      const startedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const mission = makeMission(
        {},
        {
          completion: {
            checks: [{ name: 'test', type: 'command', command: 'npm test' }],
            maxAttempts: 3,
            timeout: '30m',
          },
        },
        {
          phase: 'Running',
          attempt: 3,
          startedAt,
          cost: 10.0,
        },
      );

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Failed');
      expect(status.message).toBe('Timed out after max attempts');
    });
  });

  // --- Check results (still Running when checks fail) ---

  describe('Checks failing', () => {
    it('stays Running when checks fail', async () => {
      const mission = makeMission({}, {}, {
        phase: 'Running',
        attempt: 1,
        startedAt: new Date().toISOString(),
        cost: 0,
      });

      const executor = createMockExecutor({
        'npm test': { stdout: 'FAIL', stderr: '', exitCode: 1 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Running');
      expect(status.checks).toBeDefined();
      expect(status.checks![0]!.status).toBe('Failed');
    });

    it('reports multiple check results', async () => {
      const mission = makeMission(
        {},
        {
          completion: {
            checks: [
              { name: 'build', type: 'command', command: 'npm run build' },
              { name: 'test', type: 'command', command: 'npm test', successPattern: 'passed' },
              { name: 'output', type: 'fileExists', paths: ['dist/index.js'] },
            ],
            maxAttempts: 3,
            timeout: '30m',
          },
        },
        {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date().toISOString(),
          cost: 0,
        },
      );

      const executor = createMockExecutor({
        'npm run build': { stdout: 'Build complete', stderr: '', exitCode: 0 },
        'npm test': { stdout: 'FAIL', stderr: '', exitCode: 1 },
      });
      const fs = createMockFs(new Set(['/workspace/dist/index.js']));
      const controller = createController(client, nats, executor, fs);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Running');
      expect(status.checks).toHaveLength(3);

      const buildCheck = status.checks!.find((c) => c.name === 'build');
      const testCheck = status.checks!.find((c) => c.name === 'test');
      const outputCheck = status.checks!.find((c) => c.name === 'output');

      expect(buildCheck!.status).toBe('Passed');
      expect(testCheck!.status).toBe('Failed');
      expect(outputCheck!.status).toBe('Passed');
    });
  });

  // --- Review flow ---

  describe('Review flow', () => {
    it('requests review when all checks pass and review is enabled', async () => {
      const mission = makeMission(
        {},
        {
          completion: {
            checks: [{ name: 'test', type: 'command', command: 'npm test', successPattern: 'passed' }],
            maxAttempts: 3,
            timeout: '30m',
            review: {
              enabled: true,
              reviewer: 'senior-dev',
              criteria: 'Code quality',
            },
          },
        },
        {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date().toISOString(),
          cost: 1.0,
        },
      );

      const executor = createMockExecutor({
        'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Running');
      expect(status.review).toEqual({ status: 'Pending' });

      const reviewEvent = client.missionEvents.find((e) => e.eventType === 'MissionReviewRequested');
      expect(reviewEvent).toBeDefined();
    });

    it('succeeds when review is approved', async () => {
      const mission = makeMission(
        {},
        {
          completion: {
            checks: [{ name: 'test', type: 'command', command: 'npm test', successPattern: 'passed' }],
            maxAttempts: 3,
            timeout: '30m',
            review: {
              enabled: true,
              reviewer: 'senior-dev',
              criteria: 'Code quality',
            },
          },
        },
        {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date().toISOString(),
          cost: 1.0,
          review: { status: 'Approved', feedback: 'Looks great!' },
        },
      );

      const executor = createMockExecutor({
        'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Succeeded');
      expect(status.review?.status).toBe('Approved');

      const completedEvent = client.missionEvents.find((e) => e.eventType === 'MissionCompleted');
      expect(completedEvent).toBeDefined();
    });

    it('retries when review is rejected and attempts remain', async () => {
      const mission = makeMission(
        {},
        {
          completion: {
            checks: [{ name: 'test', type: 'command', command: 'npm test', successPattern: 'passed' }],
            maxAttempts: 3,
            timeout: '30m',
            review: {
              enabled: true,
              reviewer: 'senior-dev',
              criteria: 'Code quality',
            },
          },
        },
        {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date().toISOString(),
          cost: 1.0,
          review: { status: 'Rejected', feedback: 'Needs more tests' },
        },
      );

      const executor = createMockExecutor({
        'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Pending');
      expect(status.message).toContain('Review rejected');
      expect(status.message).toContain('Needs more tests');

      const retryEvent = client.missionEvents.find((e) => e.eventType === 'MissionRetry');
      expect(retryEvent).toBeDefined();
    });

    it('fails when review is rejected and no attempts remain', async () => {
      const mission = makeMission(
        {},
        {
          completion: {
            checks: [{ name: 'test', type: 'command', command: 'npm test', successPattern: 'passed' }],
            maxAttempts: 2,
            timeout: '30m',
            review: {
              enabled: true,
              reviewer: 'senior-dev',
              criteria: 'Code quality',
            },
          },
        },
        {
          phase: 'Running',
          attempt: 2,
          startedAt: new Date().toISOString(),
          cost: 5.0,
          review: { status: 'Rejected', feedback: 'Still not good enough' },
        },
      );

      const executor = createMockExecutor({
        'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Failed');
      expect(status.message).toContain('Review rejected after max attempts');

      const failEvent = client.missionEvents.find((e) => e.eventType === 'MissionFailed');
      expect(failEvent).toBeDefined();
    });

    it('keeps review Pending when already pending', async () => {
      const mission = makeMission(
        {},
        {
          completion: {
            checks: [{ name: 'test', type: 'command', command: 'npm test', successPattern: 'passed' }],
            maxAttempts: 3,
            timeout: '30m',
            review: {
              enabled: true,
              reviewer: 'senior-dev',
              criteria: 'Code quality',
            },
          },
        },
        {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date().toISOString(),
          cost: 1.0,
          review: { status: 'Pending' },
        },
      );

      const executor = createMockExecutor({
        'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(mission);

      const status = client.missionStatusUpdates[0]!.status;
      expect(status.phase).toBe('Running');
      expect(status.review).toEqual({ status: 'Pending' });

      // Should NOT emit another review request event
      const reviewEvents = client.missionEvents.filter((e) => e.eventType === 'MissionReviewRequested');
      expect(reviewEvents).toHaveLength(0);
    });
  });

  // --- Terminal phases ---

  describe('Terminal phases', () => {
    it('does not emit events for already-Succeeded missions', async () => {
      const mission = makeMission({}, {}, {
        phase: 'Succeeded',
        attempt: 1,
        cost: 2.0,
      });

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      // Should not update status
      expect(client.missionStatusUpdates).toHaveLength(0);

      // Should NOT emit any events (transition events were already emitted)
      expect(client.missionEvents).toHaveLength(0);
    });

    it('does not emit events for already-Failed missions', async () => {
      const mission = makeMission({}, {}, {
        phase: 'Failed',
        attempt: 3,
        cost: 15.0,
        message: 'Timed out after max attempts',
      });

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      // Should not update status
      expect(client.missionStatusUpdates).toHaveLength(0);

      // Should NOT emit any events (transition events were already emitted)
      expect(client.missionEvents).toHaveLength(0);
    });
  });

  // --- Full lifecycle: Pending → Running → Succeeded ---

  describe('Full lifecycle', () => {
    it('completes full Pending → Running → Succeeded lifecycle', async () => {
      // Step 1: Pending → Running
      const pendingMission = makeMission();
      const executor = createMockExecutor({
        'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      await controller.reconcileMission(pendingMission);

      // Should transition to Running
      const runningStatus = client.missionStatusUpdates[0]!.status;
      expect(runningStatus.phase).toBe('Running');
      expect(runningStatus.attempt).toBe(1);

      // Step 2: Running → Succeeded
      // Create a Running mission with the status from step 1
      const runningMission = makeMission({}, {}, runningStatus);
      await controller.reconcileMission(runningMission);

      // Should transition to Succeeded
      const succeededStatus = client.missionStatusUpdates[1]!.status;
      expect(succeededStatus.phase).toBe('Succeeded');
      expect(succeededStatus.checks).toBeDefined();
      expect(succeededStatus.checks![0]!.status).toBe('Passed');
    });

    it('completes Pending → Running → timeout → Pending → Running → Succeeded', async () => {
      const executor = createMockExecutor({
        'npm test': { stdout: 'All tests passed', stderr: '', exitCode: 0 },
      });
      const controller = createController(client, nats, executor);

      // Step 1: Pending → Running
      const pendingMission = makeMission();
      await controller.reconcileMission(pendingMission);
      expect(client.missionStatusUpdates[0]!.status.phase).toBe('Running');

      // Step 2: Running → Pending (timeout)
      const timedOutMission = makeMission({}, {}, {
        phase: 'Running',
        attempt: 1,
        startedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
        cost: 1.0,
      });
      await controller.reconcileMission(timedOutMission);
      expect(client.missionStatusUpdates[1]!.status.phase).toBe('Pending');

      // Step 3: Pending → Running (retry)
      const retryMission = makeMission({}, {}, client.missionStatusUpdates[1]!.status);
      await controller.reconcileMission(retryMission);
      expect(client.missionStatusUpdates[2]!.status.phase).toBe('Running');
      expect(client.missionStatusUpdates[2]!.status.attempt).toBe(2);

      // Step 4: Running → Succeeded
      const runningMission = makeMission({}, {}, client.missionStatusUpdates[2]!.status);
      await controller.reconcileMission(runningMission);
      expect(client.missionStatusUpdates[3]!.status.phase).toBe('Succeeded');
    });
  });

  // --- Namespace handling ---

  describe('Namespace handling', () => {
    it('uses correct namespace from mission metadata', async () => {
      const mission = makeMission({
        metadata: {
          name: 'prod-mission',
          namespace: 'production',
          uid: 'prod-uid',
          resourceVersion: '1',
        },
      });

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      // NATS message should use production namespace
      expect(nats.sends[0]!.namespace).toBe('production');

      // Status update should use production namespace
      expect(client.missionStatusUpdates[0]!.namespace).toBe('production');
      expect(client.missionStatusUpdates[0]!.name).toBe('prod-mission');
    });
  });

  // --- Budget at boundary ---

  describe('Budget edge cases', () => {
    it('fails when cost exactly equals maxCost', async () => {
      const mission = makeMission(
        {},
        { budget: { maxCost: 10.0 } },
        {
          phase: 'Running',
          attempt: 1,
          startedAt: new Date().toISOString(),
          cost: 10.0,
        },
      );

      const controller = createController(client, nats);

      await controller.reconcileMission(mission);

      expect(client.missionStatusUpdates[0]!.status.phase).toBe('Failed');
      expect(client.missionStatusUpdates[0]!.status.message).toBe('Budget exhausted');
    });
  });
});
