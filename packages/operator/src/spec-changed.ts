import type * as k8s from '@kubernetes/client-node';

import type { CellResource } from './types.js';

/**
 * Detect whether the Cell spec has changed compared to the running Pod.
 *
 * We compare the serialized CellSpec stored in the Pod's CELL_SPEC
 * environment variable with the current Cell spec. If they differ,
 * the Pod needs to be recreated.
 */
export function specChanged(cell: CellResource, pod: k8s.V1Pod): boolean {
  const container = pod.spec?.containers?.find((c) => c.name === 'mind');
  if (!container) {
    // No mind container found — treat as changed
    return true;
  }

  const cellSpecEnv = container.env?.find((e) => e.name === 'CELL_SPEC');
  if (!cellSpecEnv?.value) {
    // No CELL_SPEC env var — treat as changed
    return true;
  }

  // Compare the serialized spec. We normalize by re-serializing
  // both sides to handle key ordering differences.
  try {
    const podSpec: unknown = JSON.parse(cellSpecEnv.value);
    const currentSpec = JSON.parse(JSON.stringify(cell.spec)) as unknown;

    return JSON.stringify(podSpec) !== JSON.stringify(currentSpec);
  } catch {
    // Parse error — treat as changed
    return true;
  }
}
