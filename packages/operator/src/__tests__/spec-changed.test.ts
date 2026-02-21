import type * as k8s from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';

import { specChanged } from '../spec-changed.js';
import type { CellResource } from '../types.js';

function makeCell(specOverrides = {}): CellResource {
  return {
    apiVersion: 'kais.io/v1',
    kind: 'Cell',
    metadata: {
      name: 'researcher',
      namespace: 'default',
      uid: 'abc-123',
      resourceVersion: '1',
    },
    spec: {
      mind: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a helpful assistant.',
      },
      ...specOverrides,
    },
  };
}

function makePod(cellSpec: unknown): k8s.V1Pod {
  return {
    spec: {
      containers: [
        {
          name: 'mind',
          image: 'kais-cell:latest',
          env: [
            {
              name: 'CELL_SPEC',
              value: JSON.stringify(cellSpec),
            },
          ],
        },
      ],
    },
  };
}

describe('specChanged', () => {
  it('returns false when spec is the same', () => {
    const cell = makeCell();
    const pod = makePod(cell.spec);

    expect(specChanged(cell, pod)).toBe(false);
  });

  it('returns true when model is different', () => {
    const cell = makeCell();
    const pod = makePod({
      mind: {
        provider: 'anthropic',
        model: 'claude-opus-4-20250514', // different model
        systemPrompt: 'You are a helpful assistant.',
      },
    });

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when system prompt is different', () => {
    const cell = makeCell();
    const pod = makePod({
      mind: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a coding assistant.', // different prompt
      },
    });

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when provider is different', () => {
    const cell = makeCell();
    const pod = makePod({
      mind: {
        provider: 'openai', // different provider
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a helpful assistant.',
      },
    });

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when tools are added', () => {
    const cell = makeCell({
      tools: [{ name: 'web_search' }],
    });
    const pod = makePod({
      mind: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a helpful assistant.',
      },
    });

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when resources change', () => {
    const cell = makeCell({
      resources: { memoryLimit: '512Mi' },
    });
    const pod = makePod({
      mind: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are a helpful assistant.',
      },
    });

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when Pod has no mind container', () => {
    const cell = makeCell();
    const pod: k8s.V1Pod = {
      spec: {
        containers: [{ name: 'sidecar', image: 'other:latest' }],
      },
    };

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when Pod has no CELL_SPEC env var', () => {
    const cell = makeCell();
    const pod: k8s.V1Pod = {
      spec: {
        containers: [
          {
            name: 'mind',
            image: 'kais-cell:latest',
            env: [{ name: 'OTHER_VAR', value: 'test' }],
          },
        ],
      },
    };

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when CELL_SPEC env var has invalid JSON', () => {
    const cell = makeCell();
    const pod: k8s.V1Pod = {
      spec: {
        containers: [
          {
            name: 'mind',
            image: 'kais-cell:latest',
            env: [{ name: 'CELL_SPEC', value: 'not-json{{' }],
          },
        ],
      },
    };

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when Pod has no env vars', () => {
    const cell = makeCell();
    const pod: k8s.V1Pod = {
      spec: {
        containers: [
          {
            name: 'mind',
            image: 'kais-cell:latest',
          },
        ],
      },
    };

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when Pod has no containers', () => {
    const cell = makeCell();
    const pod: k8s.V1Pod = {
      spec: {
        containers: [],
      },
    };

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('returns true when Pod has no spec', () => {
    const cell = makeCell();
    const pod: k8s.V1Pod = {};

    expect(specChanged(cell, pod)).toBe(true);
  });

  it('handles matching spec with optional fields', () => {
    const spec = {
      mind: {
        provider: 'anthropic' as const,
        model: 'claude-sonnet-4-20250514',
        systemPrompt: 'You are helpful.',
        temperature: 0.7,
        maxTokens: 4096,
      },
      tools: [{ name: 'web_search' }],
      resources: { memoryLimit: '512Mi', cpuLimit: '1000m' },
    };
    const cell = makeCell();
    // Override the full spec
    (cell as { spec: typeof spec }).spec = spec;
    const pod = makePod(spec);

    expect(specChanged(cell, pod)).toBe(false);
  });
});
