/**
 * Mission status formatter for the kAIs CLI.
 *
 * Formats a Mission CRD (as JSON from kubectl) into a human-readable
 * terminal display.
 */

export interface MissionCheckResult {
  name: string;
  status: 'Pending' | 'Passed' | 'Failed' | 'Error';
}

export interface MissionReviewStatus {
  status: 'Pending' | 'Approved' | 'Rejected';
  feedback?: string;
}

export interface MissionStatus {
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed';
  attempt: number;
  startedAt?: string;
  cost: number;
  checks?: MissionCheckResult[];
  review?: MissionReviewStatus;
  message?: string;
}

export interface MissionCompletion {
  checks: Array<{ name: string; type: string }>;
  review?: { enabled: boolean; reviewer: string; criteria: string };
  maxAttempts: number;
  timeout: string;
}

export interface MissionResource {
  metadata: {
    name: string;
    namespace: string;
  };
  spec: {
    formationRef?: string;
    cellRef?: string;
    objective: string;
    completion: MissionCompletion;
    entrypoint: { cell: string; message: string };
    budget?: { maxCost: number };
  };
  status?: MissionStatus;
}

function statusIcon(status: string): string {
  switch (status) {
    case 'Passed':
    case 'Approved':
    case 'Succeeded':
      return '\u2713'; // checkmark
    case 'Failed':
    case 'Rejected':
    case 'Error':
      return '\u2717'; // X mark
    case 'Pending':
    case 'Running':
      return '\u23F3'; // hourglass
    default:
      return '?';
  }
}

/**
 * Format elapsed duration between two dates as a human-readable string.
 */
function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsedMs = now - start;

  if (elapsedMs < 0) return '0s';

  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSec}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}

/**
 * Format a Mission resource as a human-readable terminal display.
 *
 * Example output:
 *   Name:      build-feature
 *   Namespace: default
 *   Status:    Running
 *   Attempt:   1/3
 *   Duration:  5m 23s
 *   Cost:      $0.1234
 *   Objective: Build the login feature
 *
 *   Checks:
 *     tests-pass    ✓  Passed
 *     lint-clean    ✗  Failed
 *     build-ok      ⏳  Pending
 *
 *   Review:         ⏳  Pending
 */
export function formatMissionStatus(mission: MissionResource): string {
  const lines: string[] = [];
  const status = mission.status;
  const spec = mission.spec;

  // Basic info
  lines.push(`Name:      ${mission.metadata.name}`);
  lines.push(`Namespace: ${mission.metadata.namespace}`);

  if (status) {
    lines.push(`Status:    ${status.phase}`);
    lines.push(`Attempt:   ${status.attempt}/${spec.completion.maxAttempts}`);

    if (status.startedAt) {
      lines.push(`Duration:  ${formatDuration(status.startedAt)}`);
    }

    lines.push(`Cost:      $${status.cost.toFixed(4)}`);
  } else {
    lines.push(`Status:    Unknown (no status reported)`);
  }

  // Objective
  lines.push(`Objective: ${spec.objective}`);

  // Target
  if (spec.formationRef) {
    lines.push(`Formation: ${spec.formationRef}`);
  }
  if (spec.cellRef) {
    lines.push(`Cell:      ${spec.cellRef}`);
  }

  lines.push(`Timeout:   ${spec.completion.timeout}`);

  if (spec.budget) {
    lines.push(`Budget:    $${spec.budget.maxCost.toFixed(2)}`);
  }

  // Checks
  if (status?.checks && status.checks.length > 0) {
    lines.push('');
    lines.push('Checks:');
    const maxCheckName = Math.max(...status.checks.map((c) => c.name.length));
    for (const check of status.checks) {
      const icon = statusIcon(check.status);
      lines.push(`  ${check.name.padEnd(maxCheckName)}  ${icon}  ${check.status}`);
    }
  }

  // Review
  if (spec.completion.review?.enabled) {
    lines.push('');
    if (status?.review) {
      const icon = statusIcon(status.review.status);
      lines.push(`Review:    ${icon}  ${status.review.status}`);
      if (status.review.feedback) {
        lines.push(`           ${status.review.feedback}`);
      }
    } else {
      lines.push(`Review:    ${statusIcon('Pending')}  Pending`);
    }
  }

  // Message (if any)
  if (status?.message) {
    lines.push('');
    lines.push(`Message:   ${status.message}`);
  }

  return lines.join('\n');
}
