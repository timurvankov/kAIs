import type * as k8s from '@kubernetes/client-node';

import type { CellResource } from './types.js';

// Configurable via environment variables on the operator deployment
const CELL_IMAGE = process.env['CELL_IMAGE'] ?? 'kais-cell:latest';
const CELL_IMAGE_PULL_POLICY = (process.env['CELL_IMAGE_PULL_POLICY'] ?? 'IfNotPresent') as 'Always' | 'Never' | 'IfNotPresent';
const NATS_URL = process.env['NATS_URL'] ?? 'nats://kais-nats:4222';
const POSTGRES_URL = process.env['POSTGRES_URL'] ?? 'postgresql://postgres:kais@kais-postgres-postgresql:5432/kais';
const OLLAMA_URL = process.env['OLLAMA_URL'] ?? 'http://ollama:11434';

/**
 * Build a K8s Pod spec from a Cell CRD.
 *
 * The Pod runs the cell-runtime container with environment variables
 * that configure the Cell's mind, tools, and resource limits.
 *
 * When the Cell belongs to a Formation (has formationRef), additional
 * volumes are mounted:
 *   - workspace PVC at /workspace/shared and /workspace/private/{cellName}
 *   - topology ConfigMap at /etc/kais/topology
 */
export function buildCellPod(cell: CellResource): k8s.V1Pod {
  const podName = `cell-${cell.metadata.name}`;
  const formationRef = cell.spec.formationRef;

  const volumeMounts: k8s.V1VolumeMount[] = [];
  const volumes: k8s.V1Volume[] = [];

  // If this cell belongs to a formation, mount workspace and topology volumes
  if (formationRef) {
    volumeMounts.push(
      {
        name: 'workspace',
        mountPath: '/workspace/shared',
        subPath: 'shared',
      },
      {
        name: 'workspace',
        mountPath: `/workspace/private/${cell.metadata.name}`,
        subPath: `private/${cell.metadata.name}`,
      },
      {
        name: 'topology',
        mountPath: '/etc/kais/topology',
        readOnly: true,
      },
    );

    volumes.push(
      {
        name: 'workspace',
        persistentVolumeClaim: {
          claimName: `workspace-${formationRef}`,
        },
      },
      {
        name: 'topology',
        configMap: {
          name: `topology-${formationRef}`,
        },
      },
    );
  }

  const labels: Record<string, string> = {
    'kais.io/cell': cell.metadata.name,
    'kais.io/role': 'cell',
  };

  // Add formation label if this cell belongs to a formation
  if (formationRef) {
    labels['kais.io/formation'] = formationRef;
  }

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: cell.metadata.namespace,
      labels,
      ownerReferences: [
        {
          apiVersion: 'kais.io/v1',
          kind: 'Cell',
          name: cell.metadata.name,
          uid: cell.metadata.uid!, // Assigned by K8s API server before reconcile
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    spec: {
      containers: [
        {
          name: 'mind',
          image: CELL_IMAGE,
          imagePullPolicy: CELL_IMAGE_PULL_POLICY,
          env: [
            { name: 'CELL_NAME', value: cell.metadata.name },
            { name: 'CELL_NAMESPACE', value: cell.metadata.namespace },
            { name: 'CELL_SPEC', value: JSON.stringify(cell.spec) },
            { name: 'NATS_URL', value: NATS_URL },
            { name: 'POSTGRES_URL', value: POSTGRES_URL },
            { name: 'OLLAMA_URL', value: OLLAMA_URL },
            {
              name: 'OTEL_EXPORTER_OTLP_ENDPOINT',
              value: 'http://otel-collector-opentelemetry-collector.kais-system:4317',
            },
            {
              name: 'KNOWLEDGE_SERVICE_URL',
              value: 'http://kais-knowledge.kais-system:8000',
            },
          ],
          envFrom: [{ secretRef: { name: 'llm-credentials', optional: true } }],
          resources: {
            requests: { memory: '128Mi', cpu: '100m' },
            limits: {
              memory: cell.spec.resources?.memoryLimit ?? '256Mi',
              cpu: cell.spec.resources?.cpuLimit ?? '500m',
            },
          },
          ...(volumeMounts.length > 0 ? { volumeMounts } : {}),
        },
      ],
      ...(volumes.length > 0 ? { volumes } : {}),
      restartPolicy: 'Never', // operator handles restarts
    },
  };
}
