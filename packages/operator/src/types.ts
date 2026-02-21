import type {
  BlueprintSpec,
  BlueprintStatus,
  CellSpec,
  CellStatus,
  ChannelSpec,
  ChannelStatus,
  EvolutionSpec,
  EvolutionStatus,
  ExperimentSpec,
  ExperimentStatus,
  FederationSpec,
  FederationStatus,
  FormationSpec,
  FormationStatus,
  KnowledgeGraphSpec,
  KnowledgeGraphStatus,
  MissionSpec,
  MissionStatus,
  SwarmSpec,
  SwarmStatus,
} from '@kais/core';
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
    uid?: string;
    resourceVersion?: string;
    ownerReferences?: k8s.V1OwnerReference[];
    labels?: Record<string, string>;
  };
  spec: CellSpec;
  status?: CellStatus;
}

/**
 * Kubernetes custom resource representing a Formation.
 * Matches the Formation CRD defined in crds/formation-crd.yaml.
 */
export interface FormationResource {
  apiVersion: 'kais.io/v1';
  kind: 'Formation';
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
  };
  spec: FormationSpec;
  status?: FormationStatus;
}

/**
 * Kubernetes custom resource representing a Mission.
 * Matches the Mission CRD defined in crds/mission-crd.yaml.
 */
export interface MissionResource {
  apiVersion: 'kais.io/v1';
  kind: 'Mission';
  metadata: {
    name: string;
    namespace: string;
    uid: string;
    resourceVersion: string;
  };
  spec: MissionSpec;
  status?: MissionStatus;
}

/**
 * Event types emitted by the CellController.
 */
export type CellEventType = 'CellCreated' | 'CellRunning' | 'CellFailed' | 'CellDeleted';

/**
 * Event types emitted by the FormationController.
 */
export type FormationEventType =
  | 'FormationReconciled'
  | 'FormationScaled'
  | 'FormationPaused'
  | 'FormationFailed'
  | 'CellCreated'
  | 'CellDeleted'
  | 'CellUpdated';

/**
 * Event types emitted by the MissionController.
 */
export type MissionEventType =
  | 'MissionStarted'
  | 'MissionTimeout'
  | 'MissionRetry'
  | 'MissionCompleted'
  | 'MissionFailed'
  | 'MissionReviewRequested';

/**
 * Kubernetes custom resource representing an Experiment.
 * Matches the Experiment CRD defined in crds/experiment-crd.yaml.
 */
export interface ExperimentResource {
  apiVersion: 'kais.io/v1';
  kind: 'Experiment';
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
  };
  spec: ExperimentSpec;
  status?: ExperimentStatus;
}

/**
 * Event types emitted by the ExperimentController.
 */
export type ExperimentEventType =
  | 'ExperimentStarted'
  | 'ExperimentRunCompleted'
  | 'ExperimentAnalyzing'
  | 'ExperimentCompleted'
  | 'ExperimentFailed'
  | 'ExperimentAborted'
  | 'ExperimentOverBudget';

/**
 * Kubernetes custom resource representing a Blueprint.
 * Matches the Blueprint CRD defined in crds/blueprint-crd.yaml.
 */
export interface BlueprintResource {
  apiVersion: 'kais.io/v1';
  kind: 'Blueprint';
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
  };
  spec: BlueprintSpec;
  status?: BlueprintStatus;
}

/**
 * Event types emitted by the BlueprintController.
 */
export type BlueprintEventType =
  | 'BlueprintCreated'
  | 'BlueprintUpdated'
  | 'BlueprintVersioned';

/** KnowledgeGraph custom resource shape. */
export interface KnowledgeGraphResource {
  apiVersion: 'kais.io/v1';
  kind: 'KnowledgeGraph';
  metadata: {
    name: string;
    namespace: string;
    resourceVersion?: string;
    uid?: string;
  };
  spec: KnowledgeGraphSpec;
  status?: KnowledgeGraphStatus;
}

export type KnowledgeGraphEventType = 'Created' | 'Provisioning' | 'Ready' | 'Error' | 'Deleted';

// Phase 6: Evolution
export interface EvolutionResource {
  apiVersion: 'kais.io/v1';
  kind: 'Evolution';
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
  };
  spec: EvolutionSpec;
  status?: EvolutionStatus;
}

export type EvolutionEventType =
  | 'EvolutionStarted'
  | 'GenerationCompleted'
  | 'EvolutionCompleted'
  | 'EvolutionFailed'
  | 'EvolutionAborted';

// Phase 6: Swarm
export interface SwarmResource {
  apiVersion: 'kais.io/v1';
  kind: 'Swarm';
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
  };
  spec: SwarmSpec;
  status?: SwarmStatus;
}

export type SwarmEventType =
  | 'SwarmScaleUp'
  | 'SwarmScaleDown'
  | 'SwarmSuspended'
  | 'SwarmError';

// Phase 9: Channel
export interface ChannelResource {
  apiVersion: 'kais.io/v1';
  kind: 'Channel';
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
  };
  spec: ChannelSpec;
  status?: ChannelStatus;
}

export type ChannelEventType = 'ChannelCreated' | 'ChannelPaused' | 'ChannelError';

// Phase 9: Federation
export interface FederationResource {
  apiVersion: 'kais.io/v1';
  kind: 'Federation';
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
  };
  spec: FederationSpec;
  status?: FederationStatus;
}

export type FederationEventType =
  | 'FederationActive'
  | 'FederationDegraded'
  | 'ClusterJoined'
  | 'ClusterLost';

/**
 * Abstraction over the K8s API calls used by CellController and FormationController.
 * Makes the controllers testable by allowing mocks.
 */
export interface KubeClient {
  // --- Pod management ---

  /** Get a Pod by name and namespace. Returns null if not found. */
  getPod(name: string, namespace: string): Promise<k8s.V1Pod | null>;

  /** Create a Pod. */
  createPod(pod: k8s.V1Pod): Promise<k8s.V1Pod>;

  /** Delete a Pod by name and namespace. */
  deletePod(name: string, namespace: string): Promise<void>;

  /** List Pods matching a label selector. */
  listPods(namespace: string, labelSelector: string): Promise<k8s.V1PodList>;

  // --- Cell management ---

  /** Get a Cell CRD by name and namespace. Returns null if not found. */
  getCell(name: string, namespace: string): Promise<CellResource | null>;

  /** Create a Cell CRD. */
  createCell(cell: CellResource): Promise<CellResource>;

  /** Update the spec of a Cell CRD. */
  updateCell(name: string, namespace: string, spec: CellSpec): Promise<void>;

  /** Delete a Cell CRD by name and namespace. */
  deleteCell(name: string, namespace: string): Promise<void>;

  /** List Cell CRDs matching a label selector. */
  listCells(namespace: string, labelSelector: string): Promise<CellResource[]>;

  /** Update the status subresource of a Cell CRD. */
  updateCellStatus(
    name: string,
    namespace: string,
    status: CellStatus,
  ): Promise<void>;

  // --- Formation management ---

  /** Update the status subresource of a Formation CRD. */
  updateFormationStatus(
    name: string,
    namespace: string,
    status: FormationStatus,
  ): Promise<void>;

  // --- ConfigMap management ---

  /** Create or update a ConfigMap. */
  createOrUpdateConfigMap(
    name: string,
    namespace: string,
    data: Record<string, string>,
    ownerRef?: k8s.V1OwnerReference,
  ): Promise<void>;

  // --- PVC management ---

  /** Create a PersistentVolumeClaim. */
  createPVC(pvc: k8s.V1PersistentVolumeClaim): Promise<void>;

  /** Get a PersistentVolumeClaim by name. Returns null if not found. */
  getPVC(name: string, namespace: string): Promise<k8s.V1PersistentVolumeClaim | null>;

  // --- Events ---

  /** Create a K8s Event for a Cell. */
  emitEvent(
    cell: CellResource,
    eventType: CellEventType,
    reason: string,
    message: string,
  ): Promise<void>;

  /** Create a K8s Event for a Formation. */
  emitFormationEvent(
    formation: FormationResource,
    eventType: FormationEventType,
    reason: string,
    message: string,
  ): Promise<void>;

  // --- Mission management ---

  /** Update the status subresource of a Mission CRD. */
  updateMissionStatus(
    name: string,
    namespace: string,
    status: MissionStatus,
  ): Promise<void>;

  /** Create a K8s Event for a Mission. */
  emitMissionEvent(
    mission: MissionResource,
    eventType: MissionEventType,
    reason: string,
    message: string,
  ): Promise<void>;

  // --- Experiment management ---

  /** Update the status subresource of an Experiment CRD. */
  updateExperimentStatus(
    name: string,
    namespace: string,
    status: ExperimentStatus,
  ): Promise<void>;

  /** Create a K8s Event for an Experiment. */
  emitExperimentEvent(
    experiment: ExperimentResource,
    eventType: ExperimentEventType,
    reason: string,
    message: string,
  ): Promise<void>;

  // --- Blueprint management ---

  /** Update the status subresource of a Blueprint CRD. */
  updateBlueprintStatus(
    name: string,
    namespace: string,
    status: BlueprintStatus,
  ): Promise<void>;

  /** Create a K8s Event for a Blueprint. */
  emitBlueprintEvent(
    blueprint: BlueprintResource,
    eventType: BlueprintEventType,
    reason: string,
    message: string,
  ): Promise<void>;

  // --- KnowledgeGraph management ---

  /** Update the status subresource of a KnowledgeGraph CRD. */
  updateKnowledgeGraphStatus(
    name: string,
    namespace: string,
    status: KnowledgeGraphStatus,
  ): Promise<void>;

  /** Create a K8s Event for a KnowledgeGraph. */
  emitKnowledgeGraphEvent(
    resource: KnowledgeGraphResource,
    type: KnowledgeGraphEventType,
    message: string,
  ): Promise<void>;

  /** List KnowledgeGraph CRDs in a namespace. */
  listKnowledgeGraphs(namespace: string): Promise<KnowledgeGraphResource[]>;

  /** Create a Pod (simplified, for KnowledgeGraph dedicated mode). */
  createKnowledgeGraphPod(namespace: string, pod: unknown): Promise<void>;

  /** Create a Service (simplified, for KnowledgeGraph dedicated mode). */
  createKnowledgeGraphService(namespace: string, service: unknown): Promise<void>;

  /** Delete a Pod by name (simplified, for KnowledgeGraph cleanup). */
  deleteKnowledgeGraphPod(name: string, namespace: string): Promise<void>;

  /** Delete a Service by name (simplified, for KnowledgeGraph cleanup). */
  deleteKnowledgeGraphService(name: string, namespace: string): Promise<void>;

  // --- Evolution management ---
  updateEvolutionStatus(name: string, namespace: string, status: EvolutionStatus): Promise<void>;

  // --- Swarm management ---
  updateSwarmStatus(name: string, namespace: string, status: SwarmStatus): Promise<void>;

  // --- Channel management ---
  updateChannelStatus(name: string, namespace: string, status: ChannelStatus): Promise<void>;

  // --- Federation management ---
  updateFederationStatus(name: string, namespace: string, status: FederationStatus): Promise<void>;
}

/**
 * Abstraction over NATS messaging used by MissionController.
 * Publishes envelopes to cell inboxes.
 */
export interface NatsClient {
  /** Send a message to a cell's inbox via NATS. */
  sendMessageToCell(
    cellName: string,
    namespace: string,
    message: string,
  ): Promise<void>;

  /** Read messages on a subject from JetStream. Returns array of payload strings.
   *  @param since - Optional ISO timestamp. Only messages published after this time are returned. */
  waitForMessage(
    subject: string,
    timeoutMs: number,
    since?: string,
  ): Promise<string[]>;
}

/**
 * Abstraction over command execution for check-runner testability.
 */
export interface CommandExecutor {
  /** Execute a command in the given working directory. Returns { stdout, stderr, exitCode }. */
  exec(
    command: string,
    cwd: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/**
 * Abstraction over filesystem operations for check-runner testability.
 */
export interface FileSystem {
  /** Check if a file or directory exists at the given path. */
  exists(path: string): Promise<boolean>;
}
