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

/**
 * Apply a Cell CRD to the cluster.
 */
export async function applyCell(cell: Record<string, unknown>): Promise<void> {
  try {
    await customApi.createNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'cells',
      body: cell,
    });
  } catch (err: unknown) {
    const e = err as { response?: { statusCode?: number } };
    if (e.response?.statusCode === 409) {
      // Already exists — replace
      const name = (cell as { metadata: { name: string } }).metadata.name;
      await customApi.replaceNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace: NAMESPACE,
        plural: 'cells',
        name,
        body: cell,
      });
    } else {
      throw err;
    }
  }
}

/**
 * Apply a Formation CRD to the cluster.
 */
export async function applyFormation(formation: Record<string, unknown>): Promise<void> {
  try {
    await customApi.createNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'formations',
      body: formation,
    });
  } catch (err: unknown) {
    const e = err as { response?: { statusCode?: number } };
    if (e.response?.statusCode === 409) {
      const name = (formation as { metadata: { name: string } }).metadata.name;
      await customApi.replaceNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace: NAMESPACE,
        plural: 'formations',
        name,
        body: formation,
      });
    } else {
      throw err;
    }
  }
}

/**
 * Delete a Cell CRD. Ignores 404.
 */
export async function deleteCell(name: string): Promise<void> {
  try {
    await customApi.deleteNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'cells',
      name,
    });
  } catch (err: unknown) {
    const e = err as { response?: { statusCode?: number } };
    if (e.response?.statusCode !== 404) throw err;
  }
}

/**
 * Delete a Formation CRD. Ignores 404.
 */
export async function deleteFormation(name: string): Promise<void> {
  try {
    await customApi.deleteNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'formations',
      name,
    });
  } catch (err: unknown) {
    const e = err as { response?: { statusCode?: number } };
    if (e.response?.statusCode !== 404) throw err;
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
    const e = err as { response?: { statusCode?: number } };
    if (e.response?.statusCode === 404) return null;
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
 */
export async function waitFor(
  fn: () => Promise<boolean>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const { timeoutMs = 60_000, intervalMs = 2_000, label = 'condition' } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Timed out waiting for: ${label}`);
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
  try {
    await customApi.createNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'missions',
      body: mission,
    });
  } catch (err: unknown) {
    const e = err as { response?: { statusCode?: number } };
    if (e.response?.statusCode === 409) {
      const name = (mission as { metadata: { name: string } }).metadata.name;
      await customApi.replaceNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace: NAMESPACE,
        plural: 'missions',
        name,
        body: mission,
      });
    } else {
      throw err;
    }
  }
}

/**
 * Delete a Mission CRD. Ignores 404.
 */
export async function deleteMission(name: string): Promise<void> {
  try {
    await customApi.deleteNamespacedCustomObject({
      group: CRD_GROUP,
      version: CRD_VERSION,
      namespace: NAMESPACE,
      plural: 'missions',
      name,
    });
  } catch (err: unknown) {
    const e = err as { response?: { statusCode?: number } };
    if (e.response?.statusCode !== 404) throw err;
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
 * Get ConfigMap by name. Returns null if not found.
 */
export async function getConfigMap(name: string): Promise<k8s.V1ConfigMap | null> {
  try {
    return await coreApi.readNamespacedConfigMap({ namespace: NAMESPACE, name });
  } catch (err: unknown) {
    const e = err as { response?: { statusCode?: number } };
    if (e.response?.statusCode === 404) return null;
    throw err;
  }
}
