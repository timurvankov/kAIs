import type * as k8s from '@kubernetes/client-node';

/**
 * Build a ReadWriteMany PersistentVolumeClaim for a Formation's shared workspace.
 *
 * The PVC is owned by the Formation (via ownerReferences) so it is garbage
 * collected when the Formation is deleted.
 *
 * Cells mount two sub-paths:
 *   /workspace/shared    — shared across all cells (subPath: shared)
 *   /workspace/private/{cellName} — per-cell private storage (subPath: private/{cellName})
 */
export function buildWorkspacePVC(
  formationName: string,
  namespace: string,
  ownerRef: { name: string; uid: string },
  storageSize: string = '1Gi',
): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: {
      name: `workspace-${formationName}`,
      namespace,
      ownerReferences: [
        {
          apiVersion: 'kais.io/v1',
          kind: 'Formation',
          name: ownerRef.name,
          uid: ownerRef.uid,
          controller: true,
          blockOwnerDeletion: true,
        },
      ],
    },
    spec: {
      accessModes: ['ReadWriteMany'],
      resources: {
        requests: {
          storage: storageSize,
        },
      },
    },
  };
}
