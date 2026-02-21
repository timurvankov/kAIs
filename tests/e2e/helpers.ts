/**
 * E2E test helpers — K8s cluster utilities.
 */
import * as k8s from '@kubernetes/client-node';

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const coreApi = kc.makeApiClient(k8s.CoreV1Api);
export const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

const CRD_GROUP = 'kais.io';
const CRD_VERSION = 'v1';
const NAMESPACE = 'default';

/** Extract HTTP status code from @kubernetes/client-node errors (v0.x and v1.x). */
function httpStatus(err: unknown): number | undefined {
  const e = err as { statusCode?: number; response?: { statusCode?: number } };
  return e.statusCode ?? e.response?.statusCode;
}

/**
 * Apply a Cell CRD to the cluster.
 */
export async function applyCell(cell: Record<string, unknown>): Promise<void> {
  const name = (cell as { metadata: { name: string } }).metadata.name;
  console.log(`[applyCell] Creating Cell "${name}"...`);
  try {
    await customApi.createNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'cells',
      body: cell,
    });
    console.log(`[applyCell] Cell "${name}" created`);
  } catch (err: unknown) {
    if (httpStatus(err) === 409) {
      console.log(`[applyCell] Cell "${name}" already exists, replacing...`);
      await customApi.replaceNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace: NAMESPACE,
        plural: 'cells',
        name,
        body: cell,
      });
      console.log(`[applyCell] Cell "${name}" replaced`);
    } else {
      console.log(`[applyCell] Cell "${name}" failed: ${(err as Error).message}`);
      throw err;
    }
  }
}

/**
 * Apply a Formation CRD to the cluster.
 */
export async function applyFormation(formation: Record<string, unknown>): Promise<void> {
  const name = (formation as { metadata: { name: string } }).metadata.name;
  console.log(`[applyFormation] Creating Formation "${name}"...`);
  try {
    await customApi.createNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'formations',
      body: formation,
    });
    console.log(`[applyFormation] Formation "${name}" created`);
  } catch (err: unknown) {
    if (httpStatus(err) === 409) {
      console.log(`[applyFormation] Formation "${name}" already exists, replacing...`);
      await customApi.replaceNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace: NAMESPACE,
        plural: 'formations',
        name,
        body: formation,
      });
      console.log(`[applyFormation] Formation "${name}" replaced`);
    } else {
      console.log(`[applyFormation] Formation "${name}" failed: ${(err as Error).message}`);
      throw err;
    }
  }
}

/**
 * Delete a Cell CRD. Ignores 404.
 */
export async function deleteCell(name: string): Promise<void> {
  console.log(`[deleteCell] Deleting Cell "${name}"...`);
  try {
    await customApi.deleteNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'cells',
      name,
    });
    console.log(`[deleteCell] Cell "${name}" deleted`);
  } catch (err: unknown) {
    if (httpStatus(err) === 404) {
      console.log(`[deleteCell] Cell "${name}" not found (already deleted)`);
    } else {
      throw err;
    }
  }
}

/**
 * Delete a Formation CRD. Ignores 404.
 */
export async function deleteFormation(name: string): Promise<void> {
  console.log(`[deleteFormation] Deleting Formation "${name}"...`);
  try {
    await customApi.deleteNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'formations',
      name,
    });
    console.log(`[deleteFormation] Formation "${name}" deleted`);
  } catch (err: unknown) {
    if (httpStatus(err) === 404) {
      console.log(`[deleteFormation] Formation "${name}" not found (already deleted)`);
    } else {
      throw err;
    }
  }
}

/**
 * Get a custom resource. Returns null if not found.
 */
export async function getCustomResource(
  plural: string,
  name: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await customApi.getNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural,
      name,
    });
    return res as Record<string, unknown>;
  } catch (err: unknown) {
    if (httpStatus(err) === 404) return null;
    throw err;
  }
}

/**
 * List Pods matching a label selector.
 */
export async function listPods(labelSelector: string): Promise<k8s.V1Pod[]> {
  const res = await coreApi.listNamespacedPod({
    namespace: NAMESPACE,
    labelSelector,
  });
  return res.items;
}

/**
 * Wait for a condition to become true, polling at interval.
 * Logs progress on each poll for debug visibility.
 */
export async function waitFor(
  fn: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const { timeoutMs = 60_000, intervalMs = 2_000, label = 'condition' } = opts;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  console.log(`[waitFor] START: "${label}" (timeout: ${timeoutMs / 1000}s, interval: ${intervalMs / 1000}s)`);

  while (Date.now() < deadline) {
    attempt++;
    try {
      if (await fn()) {
        console.log(`[waitFor] OK: "${label}" satisfied after ${attempt} polls (${((Date.now() - deadline + timeoutMs) / 1000).toFixed(1)}s)`);
        return;
      }
    } catch (err) {
      console.log(`[waitFor] "${label}" poll #${attempt} error: ${(err as Error).message}`);
    }
    const remaining = Math.round((deadline - Date.now()) / 1000);
    if (attempt <= 5 || attempt % 5 === 0) {
      console.log(`[waitFor] "${label}" — not ready (poll #${attempt}, ${remaining}s left)`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  console.log(`[waitFor] TIMEOUT: "${label}" after ${attempt} polls (${timeoutMs / 1000}s)`);
  throw new Error(`Timed out waiting for: ${label} (after ${attempt} polls, ${timeoutMs / 1000}s)`);
}

/**
 * List PVCs matching a label selector.
 */
export async function listPVCs(labelSelector: string): Promise<k8s.V1PersistentVolumeClaim[]> {
  const res = await coreApi.listNamespacedPersistentVolumeClaim({
    namespace: NAMESPACE,
    labelSelector,
  });
  return res.items;
}

/**
 * Apply a Mission CRD to the cluster.
 */
export async function applyMission(mission: Record<string, unknown>): Promise<void> {
  const name = (mission as { metadata: { name: string } }).metadata.name;
  console.log(`[applyMission] Creating Mission "${name}"...`);
  try {
    await customApi.createNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'missions',
      body: mission,
    });
    console.log(`[applyMission] Mission "${name}" created`);
  } catch (err: unknown) {
    if (httpStatus(err) === 409) {
      console.log(`[applyMission] Mission "${name}" already exists, replacing...`);
      await customApi.replaceNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace: NAMESPACE,
        plural: 'missions',
        name,
        body: mission,
      });
      console.log(`[applyMission] Mission "${name}" replaced`);
    } else {
      console.log(`[applyMission] Mission "${name}" failed: ${(err as Error).message}`);
      throw err;
    }
  }
}

/**
 * Delete a Mission CRD. Ignores 404.
 */
export async function deleteMission(name: string): Promise<void> {
  console.log(`[deleteMission] Deleting Mission "${name}"...`);
  try {
    await customApi.deleteNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'missions',
      name,
    });
    console.log(`[deleteMission] Mission "${name}" deleted`);
  } catch (err: unknown) {
    if (httpStatus(err) === 404) {
      console.log(`[deleteMission] Mission "${name}" not found (already deleted)`);
    } else {
      throw err;
    }
  }
}

/**
 * List custom resources matching a label selector.
 */
export async function listCustomResources(
  plural: string,
  labelSelector: string,
): Promise<unknown[]> {
  const res = await customApi.listNamespacedCustomObject({
    group: CRD_GROUP,
    version: CRD_VERSION,
    namespace: NAMESPACE,
    plural,
    labelSelector,
  });
  return ((res as Record<string, unknown>).items as unknown[]) ?? [];
}

/**
 * Dump cluster state for debugging — pods, cells, formations, events.
 */
export async function dumpClusterState(context?: string): Promise<void> {
  console.log(`\n[dumpClusterState] === ${context ?? 'Cluster State'} ===`);
  try {
    const pods = await coreApi.listNamespacedPod({ namespace: NAMESPACE });
    console.log(`[dumpClusterState] Pods (${pods.items.length}):`);
    for (const pod of pods.items) {
      const phase = pod.status?.phase ?? 'Unknown';
      const ready = pod.status?.containerStatuses?.every((cs) => cs.ready) ?? false;
      console.log(`  - ${pod.metadata?.name}: phase=${phase}, ready=${ready}`);
    }
  } catch { /* ignore */ }
  try {
    const cells = await customApi.listNamespacedCustomObject({
      group: CRD_GROUP, version: CRD_VERSION, namespace: NAMESPACE, plural: 'cells',
    });
    const items = ((cells as Record<string, unknown>).items as unknown[]) ?? [];
    console.log(`[dumpClusterState] Cells (${items.length}):`);
    for (const c of items) {
      const cr = c as Record<string, unknown>;
      const meta = cr.metadata as { name: string };
      const status = cr.status as { phase?: string } | undefined;
      console.log(`  - ${meta.name}: phase=${status?.phase ?? 'none'}`);
    }
  } catch { /* ignore */ }
  try {
    const formations = await customApi.listNamespacedCustomObject({
      group: CRD_GROUP, version: CRD_VERSION, namespace: NAMESPACE, plural: 'formations',
    });
    const items = ((formations as Record<string, unknown>).items as unknown[]) ?? [];
    console.log(`[dumpClusterState] Formations (${items.length}):`);
    for (const f of items) {
      const fr = f as Record<string, unknown>;
      const meta = fr.metadata as { name: string };
      const status = fr.status as { phase?: string; totalCells?: number } | undefined;
      console.log(`  - ${meta.name}: phase=${status?.phase ?? 'none'}, totalCells=${status?.totalCells ?? 0}`);
    }
  } catch { /* ignore */ }
  try {
    const events = await coreApi.listNamespacedEvent({ namespace: NAMESPACE });
    const recent = events.items
      .sort((a, b) => (b.lastTimestamp?.getTime() ?? 0) - (a.lastTimestamp?.getTime() ?? 0))
      .slice(0, 10);
    console.log(`[dumpClusterState] Recent events (${events.items.length} total, showing last 10):`);
    for (const ev of recent) {
      console.log(`  - [${ev.type}] ${ev.involvedObject?.kind}/${ev.involvedObject?.name}: ${ev.reason} — ${ev.message}`);
    }
  } catch { /* ignore */ }
  console.log(`[dumpClusterState] === end ===\n`);
}

/**
 * Dump operator pod logs for debugging.
 */
export async function dumpOperatorLogs(tailLines = 100): Promise<void> {
  try {
    const pods = await coreApi.listNamespacedPod({
      namespace: NAMESPACE,
      labelSelector: 'app=kais-operator',
    });
    if (pods.items.length === 0) {
      console.log('[operatorLogs] No operator pods found');
      return;
    }
    const podName = pods.items[0].metadata!.name!;
    const log = await coreApi.readNamespacedPodLog({
      name: podName,
      namespace: NAMESPACE,
      tailLines,
    });
    console.log(`\n[operatorLogs] === Operator pod ${podName} (last ${tailLines} lines) ===`);
    console.log(log);
    console.log('[operatorLogs] === end ===\n');
  } catch (err) {
    console.log(`[operatorLogs] Failed to fetch operator logs: ${(err as Error).message}`);
  }
}

/**
 * Get ConfigMap by name. Returns null if not found.
 */
export async function getConfigMap(name: string): Promise<k8s.V1ConfigMap | null> {
  try {
    return await coreApi.readNamespacedConfigMap({ namespace: NAMESPACE, name });
  } catch (err: unknown) {
    if (httpStatus(err) === 404) return null;
    throw err;
  }
}
