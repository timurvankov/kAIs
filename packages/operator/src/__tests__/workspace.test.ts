import { describe, expect, it } from 'vitest';

import { buildWorkspacePVC } from '../workspace.js';

describe('buildWorkspacePVC', () => {
  it('creates a PVC with correct name', () => {
    const pvc = buildWorkspacePVC('my-formation', 'default', {
      name: 'my-formation',
      uid: 'uid-123',
    });

    expect(pvc.metadata?.name).toBe('workspace-my-formation');
    expect(pvc.metadata?.namespace).toBe('default');
  });

  it('sets ReadWriteMany access mode', () => {
    const pvc = buildWorkspacePVC('my-formation', 'default', {
      name: 'my-formation',
      uid: 'uid-123',
    });

    expect(pvc.spec?.accessModes).toEqual(['ReadWriteMany']);
  });

  it('defaults storage size to 1Gi', () => {
    const pvc = buildWorkspacePVC('my-formation', 'default', {
      name: 'my-formation',
      uid: 'uid-123',
    });

    expect(pvc.spec?.resources?.requests?.['storage']).toBe('1Gi');
  });

  it('accepts custom storage size', () => {
    const pvc = buildWorkspacePVC('my-formation', 'default', {
      name: 'my-formation',
      uid: 'uid-123',
    }, '5Gi');

    expect(pvc.spec?.resources?.requests?.['storage']).toBe('5Gi');
  });

  it('sets ownerReferences to the Formation', () => {
    const pvc = buildWorkspacePVC('my-formation', 'default', {
      name: 'my-formation',
      uid: 'uid-123',
    });

    const ref = pvc.metadata?.ownerReferences?.[0];
    expect(ref).toBeDefined();
    expect(ref?.apiVersion).toBe('kais.io/v1');
    expect(ref?.kind).toBe('Formation');
    expect(ref?.name).toBe('my-formation');
    expect(ref?.uid).toBe('uid-123');
    expect(ref?.controller).toBe(true);
    expect(ref?.blockOwnerDeletion).toBe(true);
  });

  it('uses correct namespace', () => {
    const pvc = buildWorkspacePVC('test', 'production', {
      name: 'test',
      uid: 'uid-456',
    });

    expect(pvc.metadata?.namespace).toBe('production');
  });

  it('generates correct apiVersion and kind', () => {
    const pvc = buildWorkspacePVC('my-formation', 'default', {
      name: 'my-formation',
      uid: 'uid-123',
    });

    expect(pvc.apiVersion).toBe('v1');
    expect(pvc.kind).toBe('PersistentVolumeClaim');
  });
});
