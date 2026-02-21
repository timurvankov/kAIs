import type * as k8s from '@kubernetes/client-node';

import type { CellResource } from './types.js';

/**
 * Recursive deep-equal comparison that is key-order independent.
 * Handles primitives, arrays, and plain objects.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(k =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    );
  }
  return false;
}

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

  // Compare the parsed spec using deep equality (key-order independent).
  try {
    const podSpec: unknown = JSON.parse(cellSpecEnv.value);
    return !deepEqual(podSpec, cell.spec);
  } catch {
    // Parse error — treat as changed
    return true;
  }
}
