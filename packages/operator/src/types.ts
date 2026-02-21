import type { CellSpec, CellStatus } from '@kais/core';
import type * as k8s from '@kubernetes/client-node';

/**
 * Kubernetes custom resource representing a Cell.
 * Matches the Cell CRD defined in crds/cell-crd.yaml.
 */
export interface CellResource {
  apiVersion: 'kais.io/v1';
  kind: 'Cell';
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
  };
  spec: CellSpec;
  status?: CellStatus;
}

/**
 * Event types emitted by the CellController.
 */
export type CellEventType = 'CellCreated' | 'CellRunning' | 'CellFailed' | 'CellDeleted';

/**
 * Abstraction over the K8s API calls used by CellController.
 * Makes the controller testable by allowing mocks.
 */
export interface KubeClient {
  /** Get a Pod by name and namespace. Returns null if not found. */
  getPod(name: string, namespace: string): Promise<k8s.V1Pod | null>;

  /** Create a Pod. */
  createPod(pod: k8s.V1Pod): Promise<k8s.V1Pod>;

  /** Delete a Pod by name and namespace. */
  deletePod(name: string, namespace: string): Promise<void>;

  /** Update the status subresource of a Cell CRD. */
  updateCellStatus(
    name: string,
    namespace: string,
    status: CellStatus,
  ): Promise<void>;

  /** Create a K8s Event for a Cell. */
  emitEvent(
    cell: CellResource,
    eventType: CellEventType,
    reason: string,
    message: string,
  ): Promise<void>;
}
