/**
 * Operator daemon entry point.
 *
 * Creates real K8s and NATS clients, instantiates all controllers,
 * and starts watching CRDs.
 */
import * as k8s from '@kubernetes/client-node';

import { CellController } from './controller.js';
import { FormationController } from './formation-controller.js';
import { MissionController } from './mission-controller.js';
import { startHealthServer } from './health.js';
import type {
  CellResource,
  CommandExecutor,
  FileSystem,
  FormationResource,
  KubeClient,
  MissionResource,
  NatsClient,
} from './types.js';

const CRD_GROUP = 'kais.io';
const CRD_VERSION = 'v1';

// ---------------------------------------------------------------------------
// Helper: extract HTTP status code from @kubernetes/client-node errors.
// v1.x puts statusCode directly on the error; v0.x nests under response.
// ---------------------------------------------------------------------------

function httpStatus(err: unknown): number | undefined {
  const e = err as { statusCode?: number; response?: { statusCode?: number } };
  return e.statusCode ?? e.response?.statusCode;
}

// ---------------------------------------------------------------------------
// Real KubeClient implementation using @kubernetes/client-node
// ---------------------------------------------------------------------------

function createKubeClient(kc: k8s.KubeConfig): KubeClient {
  const coreApi = kc.makeApiClient(k8s.CoreV1Api);
  const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

  return {
    // --- Pods ---

    async getPod(name, namespace) {
      try {
        return await coreApi.readNamespacedPod({ name, namespace });
      } catch (err: unknown) {
        if (httpStatus(err) === 404) return null;
        throw err;
      }
    },

    async createPod(pod) {
      return await coreApi.createNamespacedPod({
        namespace: pod.metadata!.namespace!,
        body: pod,
      });
    },

    async deletePod(name, namespace) {
      try {
        await coreApi.deleteNamespacedPod({ name, namespace });
      } catch (err: unknown) {
        if (httpStatus(err) !== 404) throw err;
      }
    },

    async listPods(namespace, labelSelector) {
      return await coreApi.listNamespacedPod({ namespace, labelSelector });
    },

    // --- Cells ---

    async getCell(name, namespace) {
      try {
        const res = await customApi.getNamespacedCustomObject({
          group: CRD_GROUP,
          version: CRD_VERSION,
          namespace,
          plural: 'cells',
          name,
        });
        return res as unknown as CellResource;
      } catch (err: unknown) {
        if (httpStatus(err) === 404) return null;
        throw err;
      }
    },

    async createCell(cell) {
      const res = await customApi.createNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace: cell.metadata.namespace,
        plural: 'cells',
        body: cell,
      });
      return res as unknown as CellResource;
    },

    async updateCell(name, namespace, spec) {
      const existing = await customApi.getNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'cells',
        name,
      });
      (existing as Record<string, unknown>).spec = spec;
      await customApi.replaceNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'cells',
        name,
        body: existing,
      });
    },

    async deleteCell(name, namespace) {
      try {
        await customApi.deleteNamespacedCustomObject({
          group: CRD_GROUP,
          version: CRD_VERSION,
          namespace,
          plural: 'cells',
          name,
        });
      } catch (err: unknown) {
        if (httpStatus(err) !== 404) throw err;
      }
    },

    async listCells(namespace, labelSelector) {
      const res = await customApi.listNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'cells',
        labelSelector,
      });
      return ((res as Record<string, unknown>).items as CellResource[]) ?? [];
    },

    async updateCellStatus(name, namespace, status) {
      const existing = await customApi.getNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'cells',
        name,
      });
      (existing as Record<string, unknown>).status = status;
      await customApi.replaceNamespacedCustomObjectStatus({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'cells',
        name,
        body: existing,
      });
    },

    // --- Formations ---

    async updateFormationStatus(name, namespace, status) {
      const existing = await customApi.getNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'formations',
        name,
      });
      (existing as Record<string, unknown>).status = status;
      await customApi.replaceNamespacedCustomObjectStatus({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'formations',
        name,
        body: existing,
      });
    },

    // --- ConfigMaps ---

    async createOrUpdateConfigMap(name, namespace, data, ownerRef) {
      const cm: k8s.V1ConfigMap = {
        metadata: {
          name,
          namespace,
          ...(ownerRef ? { ownerReferences: [ownerRef] } : {}),
        },
        data,
      };
      try {
        await coreApi.readNamespacedConfigMap({ name, namespace });
        await coreApi.replaceNamespacedConfigMap({ name, namespace, body: cm });
      } catch {
        await coreApi.createNamespacedConfigMap({ namespace, body: cm });
      }
    },

    // --- PVCs ---

    async createPVC(pvc) {
      try {
        await coreApi.createNamespacedPersistentVolumeClaim({
          namespace: pvc.metadata!.namespace!,
          body: pvc,
        });
      } catch (err: unknown) {
        if (httpStatus(err) !== 409) throw err;
        // Already exists — fine
      }
    },

    async getPVC(name, namespace) {
      try {
        return await coreApi.readNamespacedPersistentVolumeClaim({ name, namespace });
      } catch (err: unknown) {
        if (httpStatus(err) === 404) return null;
        throw err;
      }
    },

    // --- Events ---

    async emitEvent(cell, eventType, reason, message) {
      const event: k8s.CoreV1Event = {
        metadata: {
          generateName: `${cell.metadata.name}-`,
          namespace: cell.metadata.namespace,
        },
        involvedObject: {
          apiVersion: 'kais.io/v1',
          kind: 'Cell',
          name: cell.metadata.name,
          namespace: cell.metadata.namespace,
          uid: cell.metadata.uid!,
        },
        reason,
        message,
        type: eventType.includes('Failed') ? 'Warning' : 'Normal',
        firstTimestamp: new Date(),
        lastTimestamp: new Date(),
      };
      try {
        await coreApi.createNamespacedEvent({ namespace: cell.metadata.namespace, body: event });
      } catch {
        // Best effort
      }
    },

    async emitFormationEvent(formation, eventType, reason, message) {
      const event: k8s.CoreV1Event = {
        metadata: {
          generateName: `${formation.metadata.name}-`,
          namespace: formation.metadata.namespace,
        },
        involvedObject: {
          apiVersion: 'kais.io/v1',
          kind: 'Formation',
          name: formation.metadata.name,
          namespace: formation.metadata.namespace,
          uid: formation.metadata.uid,
        },
        reason,
        message,
        type: eventType.includes('Failed') ? 'Warning' : 'Normal',
        firstTimestamp: new Date(),
        lastTimestamp: new Date(),
      };
      try {
        await coreApi.createNamespacedEvent({ namespace: formation.metadata.namespace, body: event });
      } catch {
        // Best effort
      }
    },

    // --- Missions ---

    async updateMissionStatus(name, namespace, status) {
      const existing = await customApi.getNamespacedCustomObject({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'missions',
        name,
      });
      (existing as Record<string, unknown>).status = status;
      await customApi.replaceNamespacedCustomObjectStatus({
        group: CRD_GROUP,
        version: CRD_VERSION,
        namespace,
        plural: 'missions',
        name,
        body: existing,
      });
    },

    async emitMissionEvent(mission, eventType, reason, message) {
      const event: k8s.CoreV1Event = {
        metadata: {
          generateName: `${mission.metadata.name}-`,
          namespace: mission.metadata.namespace,
        },
        involvedObject: {
          apiVersion: 'kais.io/v1',
          kind: 'Mission',
          name: mission.metadata.name,
          namespace: mission.metadata.namespace,
          uid: mission.metadata.uid,
        },
        reason,
        message,
        type: eventType.includes('Failed') ? 'Warning' : 'Normal',
        firstTimestamp: new Date(),
        lastTimestamp: new Date(),
      };
      try {
        await coreApi.createNamespacedEvent({ namespace: mission.metadata.namespace, body: event });
      } catch {
        // Best effort
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Stub NatsClient — operator doesn't need real NATS for Cell/Formation work.
// MissionController will use it for sending objectives if enabled.
// ---------------------------------------------------------------------------

function createNatsStub(): NatsClient {
  return {
    async sendMessageToCell(cellName, namespace, message) {
      console.log(`[NATS stub] Would send to cell.${namespace}.${cellName}.inbox: ${message.slice(0, 100)}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Real CommandExecutor using child_process
// ---------------------------------------------------------------------------

function createCommandExecutor(): CommandExecutor {
  return {
    async exec(command, cwd) {
      const { execSync } = await import('node:child_process');
      try {
        const stdout = execSync(command, { cwd, encoding: 'utf-8', timeout: 30_000 });
        return { stdout, stderr: '', exitCode: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return {
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? '',
          exitCode: e.status ?? 1,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Real FileSystem
// ---------------------------------------------------------------------------

function createFileSystem(): FileSystem {
  return {
    async exists(path) {
      const { access } = await import('node:fs/promises');
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[kais-operator] Starting...');

  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();

  const kubeClient = createKubeClient(kc);
  const natsClient = createNatsStub();
  const executor = createCommandExecutor();
  const fs = createFileSystem();

  // Start health check server
  startHealthServer(8080);

  // Create controllers
  const cellController = new CellController(kc, kubeClient);
  const formationController = new FormationController(kc, kubeClient);
  const missionController = new MissionController(kc, kubeClient, natsClient, executor, fs, '/workspace');

  // Start watching
  await cellController.start();
  console.log('[kais-operator] CellController started');

  await formationController.start();
  console.log('[kais-operator] FormationController started');

  await missionController.start();
  console.log('[kais-operator] MissionController started');

  console.log('[kais-operator] All controllers running');

  // Keep process alive
  process.on('SIGTERM', () => {
    console.log('[kais-operator] Received SIGTERM, shutting down...');
    cellController.stop();
    formationController.stop();
    missionController.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[kais-operator] Received SIGINT, shutting down...');
    cellController.stop();
    formationController.stop();
    missionController.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[kais-operator] Fatal error:', err);
  process.exit(1);
});
