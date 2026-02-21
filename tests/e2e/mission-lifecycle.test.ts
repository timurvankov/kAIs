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
    await deleteMission('e2e-test-mission');
    await deleteCell('e2e-mission-cell');
  });

  it('creates a Mission CRD and transitions to Running', async () => {
    await applyCell(MISSION_CELL);

    // Wait for cell to be ready
    await waitFor(
      async () => {
        const cell = await getCustomResource('cells', 'e2e-mission-cell');
        if (!cell) return false;
        const status = cell.status as { phase?: string } | undefined;
        return status?.phase === 'Running';
      },
      { timeoutMs: 90_000, label: 'mission cell running' },
    );

    // Apply mission
    await applyMission(TEST_MISSION);

    // Mission should transition from Pending to Running
    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        if (!mission) return false;
        const status = mission.status as { phase?: string } | undefined;
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
  });

  it('Mission status includes attempt counter', async () => {
    await applyCell(MISSION_CELL);

    await waitFor(
      async () => {
        const cell = await getCustomResource('cells', 'e2e-mission-cell');
        const status = cell?.status as { phase?: string } | undefined;
        return status?.phase === 'Running';
      },
      { timeoutMs: 90_000, label: 'mission cell running' },
    );

    await applyMission(TEST_MISSION);

    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        if (!mission) return false;
        const status = mission.status as { attempt?: number } | undefined;
        return (status?.attempt ?? 0) >= 1;
      },
      { timeoutMs: 60_000, label: 'mission attempt set' },
    );

    const mission = await getCustomResource('missions', 'e2e-test-mission');
    const status = (mission as Record<string, unknown>).status as { attempt: number };
    expect(status.attempt).toBeGreaterThanOrEqual(1);
  });

  it('cleans up Mission CRD on delete', async () => {
    await applyCell(MISSION_CELL);
    await applyMission(TEST_MISSION);

    // Wait for mission to exist
    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        return mission !== null;
      },
      { timeoutMs: 30_000, label: 'mission exists' },
    );

    // Delete mission
    await deleteMission('e2e-test-mission');

    // Verify mission is gone
    await waitFor(
      async () => {
        const mission = await getCustomResource('missions', 'e2e-test-mission');
        return mission === null;
      },
      { timeoutMs: 30_000, label: 'mission deleted' },
    );

    const mission = await getCustomResource('missions', 'e2e-test-mission');
    expect(mission).toBeNull();
  });
});
