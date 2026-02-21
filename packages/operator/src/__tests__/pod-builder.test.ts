import { describe, expect, it } from 'vitest';

import { buildCellPod } from '../pod-builder.js';
import type { CellResource } from '../types.js';

function makeCell(overrides: Partial<CellResource> = {}): CellResource {
  return {
    apiVersion: 'kais.io/v1',
    kind: 'Cell',
    metadata: {
      name: 'researcher',
      namespace: 'default',
      uid: 'abc-123-def',
      resourceVersion: '1',
    },
    spec: {
      mind: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a helpful assistant.',
      },
    },
    ...overrides,
  };
}

describe('buildCellPod', () => {
  it('builds a Pod with correct name from Cell name', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);

    expect(pod.metadata?.name).toBe('cell-researcher');
    expect(pod.metadata?.namespace).toBe('default');
  });

  it('sets correct labels', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);

    expect(pod.metadata?.labels).toEqual({
      'kais.io/cell': 'researcher',
      'kais.io/role': 'cell',
    });
  });

  it('sets ownerReferences for cascade deletion', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const ownerRefs = pod.metadata?.ownerReferences;

    expect(ownerRefs).toHaveLength(1);
    expect(ownerRefs![0]).toEqual({
      apiVersion: 'kais.io/v1',
      kind: 'Cell',
      name: 'researcher',
      uid: 'abc-123-def',
      controller: true,
      blockOwnerDeletion: true,
    });
  });

  it('uses resource limits from spec when provided', () => {
    const cell = makeCell({
      spec: {
        mind: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          systemPrompt: 'You are a helpful assistant.',
        },
        resources: {
          memoryLimit: '512Mi',
          cpuLimit: '1000m',
        },
      },
    });
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];

    expect(container?.resources?.limits).toEqual({
      memory: '512Mi',
      cpu: '1000m',
    });
  });

  it('uses default resource limits when not specified', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];

    expect(container?.resources?.limits).toEqual({
      memory: '256Mi',
      cpu: '500m',
    });
  });

  it('sets resource requests', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];

    expect(container?.resources?.requests).toEqual({
      memory: '128Mi',
      cpu: '100m',
    });
  });

  it('sets CELL_SPEC env var with serialized spec', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];
    const cellSpecEnv = container?.env?.find((e) => e.name === 'CELL_SPEC');

    expect(cellSpecEnv).toBeDefined();
    const parsed = JSON.parse(cellSpecEnv!.value!) as unknown;
    expect(parsed).toEqual(cell.spec);
  });

  it('sets CELL_NAME env var', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];
    const env = container?.env?.find((e) => e.name === 'CELL_NAME');

    expect(env?.value).toBe('researcher');
  });

  it('sets CELL_NAMESPACE env var', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];
    const env = container?.env?.find((e) => e.name === 'CELL_NAMESPACE');

    expect(env?.value).toBe('default');
  });

  it('sets NATS_URL env var', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];
    const env = container?.env?.find((e) => e.name === 'NATS_URL');

    expect(env?.value).toBe('nats://nats.kais-system:4222');
  });

  it('sets POSTGRES_URL env var', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];
    const env = container?.env?.find((e) => e.name === 'POSTGRES_URL');

    expect(env?.value).toBe(
      'postgresql://postgres:kais@postgres-postgresql.kais-system:5432/kais',
    );
  });

  it('includes secret reference for LLM credentials', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];

    expect(container?.envFrom).toEqual([
      { secretRef: { name: 'llm-credentials' } },
    ]);
  });

  it('sets restartPolicy to Never (operator handles restarts)', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);

    expect(pod.spec?.restartPolicy).toBe('Never');
  });

  it('names the container "mind"', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);

    expect(pod.spec?.containers?.[0]?.name).toBe('mind');
  });

  it('uses kais-cell:latest image', () => {
    const cell = makeCell();
    const pod = buildCellPod(cell);

    expect(pod.spec?.containers?.[0]?.image).toBe('kais-cell:latest');
  });

  it('serializes spec with tools in CELL_SPEC', () => {
    const cell = makeCell({
      spec: {
        mind: {
          provider: 'openai',
          model: 'gpt-4o',
          systemPrompt: 'You are a writer.',
        },
        tools: [
          { name: 'web_search' },
          { name: 'send_message', config: { target: 'cell.default.editor' } },
        ],
      },
    });
    const pod = buildCellPod(cell);
    const container = pod.spec?.containers?.[0];
    const cellSpecEnv = container?.env?.find((e) => e.name === 'CELL_SPEC');
    const parsed = JSON.parse(cellSpecEnv!.value!) as unknown;

    expect(parsed).toEqual(cell.spec);
  });

  it('handles different namespaces', () => {
    const cell = makeCell({
      metadata: {
        name: 'writer',
        namespace: 'production',
        uid: 'xyz-789',
        resourceVersion: '5',
      },
    });
    const pod = buildCellPod(cell);

    expect(pod.metadata?.name).toBe('cell-writer');
    expect(pod.metadata?.namespace).toBe('production');
    expect(pod.metadata?.ownerReferences![0]?.uid).toBe('xyz-789');
  });
});
