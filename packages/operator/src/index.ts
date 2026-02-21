// Controller
export { CellController } from './controller.js';

// Health server for K8s probes
export { startHealthServer } from './health.js';

// Pod template builder
export { buildCellPod } from './pod-builder.js';

// Spec change detection
export { specChanged } from './spec-changed.js';

// Types
export type { CellResource, CellEventType, KubeClient } from './types.js';
