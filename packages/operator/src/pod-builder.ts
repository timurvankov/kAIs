import type * as k8s from '@kubernetes/client-node';

import type { CellResource } from './types.js';

/**
 * Build a K8s Pod spec from a Cell CRD.
 *
 * The Pod runs the cell-runtime container with environment variables
 * that configure the Cell's mind, tools, and resource limits.
 */
export function buildCellPod(cell: CellResource): k8s.V1Pod {
  const podName = `cell-${cell.metadata.name}`;

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: podName,
      namespace: cell.metadata.namespace,
      labels: {
        'kais.io/cell': cell.metadata.name,
        'kais.io/role': 'cell',
      },
      ownerReferences: [
        {
          apiVersion: 'kais.io/v1',
          kind: 'Cell',
          name: cell.metadata.name,
          uid: cell.metadata.uid,
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    spec: {
      containers: [
        {
          name: 'mind',
          image: 'kais-cell:latest',
          env: [
            { name: 'CELL_NAME', value: cell.metadata.name },
            { name: 'CELL_NAMESPACE', value: cell.metadata.namespace },
            { name: 'CELL_SPEC', value: JSON.stringify(cell.spec) },
            { name: 'NATS_URL', value: 'nats://nats.kais-system:4222' },
            {
              name: 'POSTGRES_URL',
              value:
                'postgresql://postgres:kais@postgres-postgresql.kais-system:5432/kais',
            },
          ],
          envFrom: [{ secretRef: { name: 'llm-credentials' } }],
          resources: {
            requests: { memory: '128Mi', cpu: '100m' },
            limits: {
              memory: cell.spec.resources?.memoryLimit ?? '256Mi',
              cpu: cell.spec.resources?.cpuLimit ?? '500m',
            },
          },
        },
      ],
      restartPolicy: 'Never', // operator handles restarts
    },
  };
}
