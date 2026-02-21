import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { formatMissionStatus } from '../mission-formatter.js';
import type { MissionResource } from '../mission-formatter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseMission(overrides?: Partial<MissionResource>): MissionResource {
  return {
    metadata: { name: 'build-feature', namespace: 'default' },
    spec: {
      formationRef: 'dev-team',
      objective: 'Build the login feature',
      completion: {
        checks: [
          { name: 'tests-pass', type: 'command' },
          { name: 'lint-clean', type: 'command' },
        ],
        maxAttempts: 3,
        timeout: '30m',
      },
      entrypoint: { cell: 'architect', message: 'Start building' },
      budget: { maxCost: 5.0 },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatMissionStatus', () => {
  // Use a fake timer so duration calculations are deterministic
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:05:23Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats Pending phase (no status)', () => {
    const mission = baseMission();
    // No status at all
    const output = formatMissionStatus(mission);

    expect(output).toContain('Name:      build-feature');
    expect(output).toContain('Namespace: default');
    expect(output).toContain('Status:    Unknown (no status reported)');
    expect(output).toContain('Objective: Build the login feature');
    expect(output).toContain('Formation: dev-team');
    expect(output).toContain('Timeout:   30m');
    expect(output).toContain('Budget:    $5.00');
  });

  it('formats Running phase with checks', () => {
    const mission = baseMission({
      status: {
        phase: 'Running',
        attempt: 1,
        startedAt: '2025-06-15T12:00:00Z',
        cost: 0.1234,
        checks: [
          { name: 'tests-pass', status: 'Passed' },
          { name: 'lint-clean', status: 'Pending' },
        ],
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('Status:    Running');
    expect(output).toContain('Attempt:   1/3');
    expect(output).toContain('Duration:  5m 23s');
    expect(output).toContain('Cost:      $0.1234');
    expect(output).toContain('Checks:');
    expect(output).toContain('tests-pass');
    expect(output).toContain('\u2713');  // checkmark for Passed
    expect(output).toContain('lint-clean');
    expect(output).toContain('\u23F3'); // hourglass for Pending
  });

  it('formats Succeeded phase', () => {
    const mission = baseMission({
      status: {
        phase: 'Succeeded',
        attempt: 2,
        startedAt: '2025-06-15T11:00:00Z',
        cost: 1.5678,
        checks: [
          { name: 'tests-pass', status: 'Passed' },
          { name: 'lint-clean', status: 'Passed' },
        ],
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('Status:    Succeeded');
    expect(output).toContain('Attempt:   2/3');
    expect(output).toContain('Cost:      $1.5678');
    // Both checks should have checkmarks
    const lines = output.split('\n');
    const checkLines = lines.filter((l) => l.includes('Passed'));
    expect(checkLines).toHaveLength(2);
  });

  it('formats Failed phase with message', () => {
    const mission = baseMission({
      status: {
        phase: 'Failed',
        attempt: 3,
        startedAt: '2025-06-15T12:04:00Z',
        cost: 2.5,
        checks: [
          { name: 'tests-pass', status: 'Failed' },
          { name: 'lint-clean', status: 'Error' },
        ],
        message: 'Max attempts exceeded',
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('Status:    Failed');
    expect(output).toContain('Attempt:   3/3');
    expect(output).toContain('Message:   Max attempts exceeded');
    // Both checks should have X marks
    const lines = output.split('\n');
    const failedLines = lines.filter((l) => l.includes('\u2717'));
    expect(failedLines.length).toBeGreaterThanOrEqual(2);
  });

  it('formats review status when enabled', () => {
    const mission = baseMission({
      spec: {
        ...baseMission().spec,
        completion: {
          ...baseMission().spec.completion,
          review: { enabled: true, reviewer: 'senior-dev', criteria: 'Code quality' },
        },
      },
      status: {
        phase: 'Running',
        attempt: 1,
        startedAt: '2025-06-15T12:00:00Z',
        cost: 0.5,
        checks: [{ name: 'tests-pass', status: 'Passed' }],
        review: { status: 'Approved', feedback: 'Looks good!' },
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('Review:');
    expect(output).toContain('\u2713');  // checkmark for Approved
    expect(output).toContain('Approved');
    expect(output).toContain('Looks good!');
  });

  it('formats review as Pending when not yet completed', () => {
    const mission = baseMission({
      spec: {
        ...baseMission().spec,
        completion: {
          ...baseMission().spec.completion,
          review: { enabled: true, reviewer: 'senior-dev', criteria: 'Code quality' },
        },
      },
      status: {
        phase: 'Running',
        attempt: 1,
        startedAt: '2025-06-15T12:00:00Z',
        cost: 0.3,
        checks: [{ name: 'tests-pass', status: 'Passed' }],
        // No review status yet
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('Review:');
    expect(output).toContain('\u23F3'); // hourglass for Pending
    expect(output).toContain('Pending');
  });

  it('formats review Rejected status', () => {
    const mission = baseMission({
      spec: {
        ...baseMission().spec,
        completion: {
          ...baseMission().spec.completion,
          review: { enabled: true, reviewer: 'senior-dev', criteria: 'Code quality' },
        },
      },
      status: {
        phase: 'Running',
        attempt: 2,
        startedAt: '2025-06-15T12:00:00Z',
        cost: 0.8,
        checks: [{ name: 'tests-pass', status: 'Passed' }],
        review: { status: 'Rejected', feedback: 'Missing error handling' },
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('\u2717'); // X mark for Rejected
    expect(output).toContain('Rejected');
    expect(output).toContain('Missing error handling');
  });

  it('formats cellRef instead of formationRef', () => {
    const mission = baseMission({
      spec: {
        cellRef: 'standalone-agent',
        objective: 'Do something',
        completion: {
          checks: [{ name: 'check', type: 'fileExists' }],
          maxAttempts: 1,
          timeout: '10m',
        },
        entrypoint: { cell: 'standalone-agent', message: 'Go' },
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('Cell:      standalone-agent');
    expect(output).not.toContain('Formation:');
  });

  it('formats duration in hours for long-running missions', () => {
    const mission = baseMission({
      status: {
        phase: 'Running',
        attempt: 1,
        startedAt: '2025-06-15T10:00:00Z', // 2h 5m ago
        cost: 3.0,
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('Duration:  2h 5m');
  });

  it('formats duration in seconds for short-running missions', () => {
    const mission = baseMission({
      status: {
        phase: 'Running',
        attempt: 1,
        startedAt: '2025-06-15T12:05:00Z', // 23s ago
        cost: 0.01,
      },
    });

    const output = formatMissionStatus(mission);

    expect(output).toContain('Duration:  23s');
  });
});
