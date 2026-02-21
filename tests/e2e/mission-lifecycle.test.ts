/**
 * E2E: Mission CRD lifecycle — create, verify status transitions, check execution.
 */
import { describe, it, afterEach, expect } from 'vitest';
import {
  applyCell,
  applyMission,
  deleteCell,
  deleteMission,
  waitFor,
  getCustomResource,
  dumpClusterState,
  dumpOperatorLogs,
} from './helpers.js';

const MISSION_CELL = {
  apiVersion: 'kais.io/v1',
  kind: 'Cell',
  metadata: {
    name: 'e2e-mission-cell',
    namespace: 'default',
  },
  spec: {
    mind: {
      provider: 'ollama',
      model: 'qwen2.5:0.5b',
      systemPrompt: 'You are a test cell. Reply with "ok" to any message.',
      temperature: 0,
    },
    tools: [],
    resources: {
      maxTokensPerTurn: 256,
      maxCostPerHour: 0,
      memoryLimit: '128Mi',
      cpuLimit: '250m',
    },
  },
};

const TEST_MISSION = {
  apiVersion: 'kais.io/v1',
  kind: 'Mission',
  metadata: {
    name: 'e2e-test-mission',
    namespace: 'default',
  },
  spec: {
    cellRef: 'e2e-mission-cell',
    objective: 'Reply with the word "done".',
    entrypoint: {
      cell: 'e2e-mission-cell',
      message: 'Please reply with the word "done".',
    },
    completion: {
      checks: [
        {
          name: 'basic-check',
          type: 'command',
          command: 'echo ok',
          successPattern: 'ok',
        },
      ],
      maxAttempts: 2,
      timeout: '2m',
    },
  },
};

describe('Mission CRD Lifecycle', () => {
  afterEach(async () => {
    await dumpOperatorLogs(80);
    console.log('[mission-lifecycle] Cleaning up...');
    await deleteMission('e2e-test-mission');
    await deleteCell('e2e-mission-cell');
  });

  it('creates a Mission CRD and transitions to Running', async () => {
    console.log('[test] === Mission transitions to Running ===');
    await applyCell(MISSION_CELL);

    console.log('[test] Waiting for cell to be Running...');
    await waitFor(
      async () => {
        const cell = await getCustomResource('cells', 'e2e-mission-cell');
        if (!cell) return false;
        const status = cell.status as { phase?: string } | undefined;
        console.log(`[test] Cell status: phase=${status?.phase ?? 'none'}`);
        return status?.phase === 'Running';
      },
      { timeoutMs: 90_000, label: 'mission cell running' },
    );

    console.log('[test] Cell is Running. Applying Mission...');
    await applyMission(TEST_MISSION);

    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        if (!mission) return false;
        const status = mission.status as { phase?: string; attempt?: number } | undefined;
        console.log(`[test] Mission status: phase=${status?.phase ?? 'none'}, attempt=${status?.attempt ?? 0}`);
        return status?.phase === 'Running' || status?.phase === 'Succeeded';
      },
      { timeoutMs: 60_000, label: 'mission running' },
    );

    const mission = await getCustomResource('missions', 'e2e-test-mission');
    expect(mission).not.toBeNull();
    const status = (mission as Record<string, unknown>).status as {
      phase: string;
      attempt?: number;
    };
    expect(['Running', 'Succeeded']).toContain(status.phase);
    console.log(`[test] PASSED: Mission phase=${status.phase}`);
  });

  it('Mission status includes attempt counter', async () => {
    console.log('[test] === Mission attempt counter ===');
    await applyCell(MISSION_CELL);

    await waitFor(
      async () => {
        const cell = await getCustomResource('cells', 'e2e-mission-cell');
        const status = cell?.status as { phase?: string } | undefined;
        return status?.phase === 'Running';
      },
      { timeoutMs: 90_000, label: 'mission cell running' },
    );

    console.log('[test] Cell ready. Applying Mission...');
    await applyMission(TEST_MISSION);

    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        if (!mission) return false;
        const status = mission.status as { phase?: string; attempt?: number } | undefined;
        console.log(`[test] Mission: phase=${status?.phase ?? 'none'}, attempt=${status?.attempt ?? 0}`);
        return (status?.attempt ?? 0) >= 1;
      },
      { timeoutMs: 60_000, label: 'mission attempt set' },
    );

    const mission = await getCustomResource('missions', 'e2e-test-mission');
    const status = (mission as Record<string, unknown>).status as { attempt: number };
    expect(status.attempt).toBeGreaterThanOrEqual(1);
    console.log(`[test] PASSED: attempt=${status.attempt}`);
  });

  it('completes a Mission with passing checks (Succeeded)', async () => {
    console.log('[test] === Mission completes with Succeeded ===');
    await applyCell(MISSION_CELL);

    await waitFor(
      async () => {
        const cell = await getCustomResource('cells', 'e2e-mission-cell');
        const status = cell?.status as { phase?: string } | undefined;
        return status?.phase === 'Running';
      },
      { timeoutMs: 90_000, label: 'mission cell running' },
    );

    console.log('[test] Cell is Running. Applying Mission...');
    await applyMission(TEST_MISSION);

    // Wait for Mission to reach Succeeded — checks (echo ok) should pass
    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        if (!mission) return false;
        const status = mission.status as {
          phase?: string;
          attempt?: number;
          checks?: { name: string; status: string }[];
        } | undefined;
        console.log(
          `[test] Mission: phase=${status?.phase ?? 'none'}, attempt=${status?.attempt ?? 0}, checks=${JSON.stringify(status?.checks ?? [])}`,
        );
        return status?.phase === 'Succeeded' || status?.phase === 'Failed';
      },
      { timeoutMs: 120_000, intervalMs: 3_000, label: 'mission completion' },
    );

    const mission = await getCustomResource('missions', 'e2e-test-mission');
    expect(mission).not.toBeNull();
    const status = (mission as Record<string, unknown>).status as {
      phase: string;
      attempt: number;
      checks?: { name: string; status: string }[];
    };
    expect(status.phase).toBe('Succeeded');
    expect(status.checks).toBeDefined();
    expect(status.checks!.every((c) => c.status === 'Passed')).toBe(true);
    console.log(`[test] PASSED: Mission Succeeded on attempt ${status.attempt}`);
  });

  it('cleans up Mission CRD on delete', async () => {
    console.log('[test] === Mission cleanup on delete ===');
    await applyCell(MISSION_CELL);
    await applyMission(TEST_MISSION);

    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        return mission !== null;
      },
      { timeoutMs: 30_000, label: 'mission exists' },
    );

    console.log('[test] Deleting Mission...');
    await deleteMission('e2e-test-mission');

    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        const exists = mission !== null;
        console.log(`[test] Mission still exists: ${exists}`);
        return !exists;
      },
      { timeoutMs: 30_000, label: 'mission deleted' },
    );

    const mission = await getCustomResource('missions', 'e2e-test-mission');
    expect(mission).toBeNull();
    console.log('[test] PASSED: Mission deleted');
  });
});
