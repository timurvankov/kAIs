import { describe, expect, it } from 'vitest';

import {
  CellSpecSchema,
  CellStatusSchema,
  EnvelopeSchema,
  MindSpecSchema,
  ResourceSpecSchema,
  ToolSpecSchema,
} from '../schemas.js';

describe('MindSpecSchema', () => {
  const validMind = {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'You are a helpful assistant.',
  };

  it('accepts a valid minimal MindSpec', () => {
    const result = MindSpecSchema.parse(validMind);
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
  });

  it('accepts MindSpec with all optional fields', () => {
    const full = {
      ...validMind,
      temperature: 0.7,
      maxTokens: 4096,
      localBrain: {
        enabled: true,
        provider: 'ollama',
        model: 'llama3',
        preThink: true,
        postFilter: false,
      },
      selfModel: { enabled: false },
      cognitiveModulation: { enabled: true },
      workingMemory: { maxMessages: 100, summarizeAfter: 50 },
    };
    const result = MindSpecSchema.parse(full);
    expect(result.temperature).toBe(0.7);
    expect(result.localBrain?.enabled).toBe(true);
    expect(result.workingMemory?.maxMessages).toBe(100);
  });

  it('rejects invalid provider', () => {
    expect(() =>
      MindSpecSchema.parse({ ...validMind, provider: 'invalid' }),
    ).toThrow();
  });

  it('rejects empty model', () => {
    expect(() =>
      MindSpecSchema.parse({ ...validMind, model: '' }),
    ).toThrow();
  });

  it('rejects empty systemPrompt', () => {
    expect(() =>
      MindSpecSchema.parse({ ...validMind, systemPrompt: '' }),
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => MindSpecSchema.parse({})).toThrow();
    expect(() =>
      MindSpecSchema.parse({ provider: 'anthropic' }),
    ).toThrow();
  });

  it('rejects temperature out of range', () => {
    expect(() =>
      MindSpecSchema.parse({ ...validMind, temperature: -0.1 }),
    ).toThrow();
    expect(() =>
      MindSpecSchema.parse({ ...validMind, temperature: 2.1 }),
    ).toThrow();
  });

  it('rejects negative maxTokens', () => {
    expect(() =>
      MindSpecSchema.parse({ ...validMind, maxTokens: -1 }),
    ).toThrow();
  });
});

describe('ToolSpecSchema', () => {
  it('accepts a tool with just a name', () => {
    const result = ToolSpecSchema.parse({ name: 'web_search' });
    expect(result.name).toBe('web_search');
    expect(result.config).toBeUndefined();
  });

  it('accepts a tool with config', () => {
    const result = ToolSpecSchema.parse({
      name: 'send_message',
      config: { target: 'cell.default.writer' },
    });
    expect(result.config?.['target']).toBe('cell.default.writer');
  });

  it('rejects empty name', () => {
    expect(() => ToolSpecSchema.parse({ name: '' })).toThrow();
  });
});

describe('ResourceSpecSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = ResourceSpecSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts full resource spec', () => {
    const result = ResourceSpecSchema.parse({
      maxTokensPerTurn: 4096,
      maxCostPerHour: 0.5,
      maxTotalCost: 10.0,
      cpuLimit: '500m',
      memoryLimit: '256Mi',
    });
    expect(result.maxTokensPerTurn).toBe(4096);
    expect(result.cpuLimit).toBe('500m');
  });

  it('rejects non-positive maxTokensPerTurn', () => {
    expect(() =>
      ResourceSpecSchema.parse({ maxTokensPerTurn: 0 }),
    ).toThrow();
    expect(() =>
      ResourceSpecSchema.parse({ maxTokensPerTurn: -1 }),
    ).toThrow();
  });
});

describe('CellSpecSchema', () => {
  const validCellSpec = {
    mind: {
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-20250514',
      systemPrompt: 'You are helpful.',
    },
  };

  it('accepts a minimal CellSpec', () => {
    const result = CellSpecSchema.parse(validCellSpec);
    expect(result.mind.provider).toBe('anthropic');
    expect(result.tools).toBeUndefined();
    expect(result.resources).toBeUndefined();
  });

  it('accepts a full CellSpec', () => {
    const result = CellSpecSchema.parse({
      ...validCellSpec,
      tools: [
        { name: 'web_search' },
        { name: 'send_message', config: { target: 'cell.default.writer' } },
      ],
      resources: {
        maxTokensPerTurn: 4096,
        maxCostPerHour: 0.5,
        memoryLimit: '256Mi',
      },
    });
    expect(result.tools).toHaveLength(2);
    expect(result.resources?.maxCostPerHour).toBe(0.5);
  });

  it('rejects CellSpec without mind', () => {
    expect(() => CellSpecSchema.parse({})).toThrow();
    expect(() => CellSpecSchema.parse({ tools: [] })).toThrow();
  });
});

describe('CellStatusSchema', () => {
  it('accepts a valid status', () => {
    const result = CellStatusSchema.parse({
      phase: 'Running',
      podName: 'researcher-abc123',
      totalCost: 0.05,
      totalTokens: 1500,
      lastActive: '2025-01-15T10:30:00Z',
    });
    expect(result.phase).toBe('Running');
    expect(result.podName).toBe('researcher-abc123');
  });

  it('accepts minimal status (only phase)', () => {
    const result = CellStatusSchema.parse({ phase: 'Pending' });
    expect(result.phase).toBe('Pending');
  });

  it('rejects invalid phase', () => {
    expect(() =>
      CellStatusSchema.parse({ phase: 'Unknown' }),
    ).toThrow();
  });

  it('rejects invalid lastActive format', () => {
    expect(() =>
      CellStatusSchema.parse({ phase: 'Running', lastActive: 'not-a-date' }),
    ).toThrow();
  });
});

describe('EnvelopeSchema', () => {
  const validEnvelope = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    from: 'cell.default.researcher',
    to: 'cell.default.writer',
    type: 'message' as const,
    payload: { text: 'Hello' },
    timestamp: '2025-01-15T10:30:00Z',
  };

  it('accepts a valid envelope', () => {
    const result = EnvelopeSchema.parse(validEnvelope);
    expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(result.type).toBe('message');
  });

  it('accepts envelope with optional fields', () => {
    const result = EnvelopeSchema.parse({
      ...validEnvelope,
      traceId: 'trace-123',
      replyTo: 'cell.default.coordinator',
    });
    expect(result.traceId).toBe('trace-123');
  });

  it('accepts all envelope types', () => {
    for (const type of ['message', 'tool_result', 'system', 'control'] as const) {
      const result = EnvelopeSchema.parse({ ...validEnvelope, type });
      expect(result.type).toBe(type);
    }
  });

  it('rejects invalid UUID', () => {
    expect(() =>
      EnvelopeSchema.parse({ ...validEnvelope, id: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects invalid timestamp', () => {
    expect(() =>
      EnvelopeSchema.parse({ ...validEnvelope, timestamp: 'not-a-timestamp' }),
    ).toThrow();
  });

  it('rejects empty from/to', () => {
    expect(() =>
      EnvelopeSchema.parse({ ...validEnvelope, from: '' }),
    ).toThrow();
    expect(() =>
      EnvelopeSchema.parse({ ...validEnvelope, to: '' }),
    ).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() =>
      EnvelopeSchema.parse({ ...validEnvelope, type: 'invalid' }),
    ).toThrow();
  });

  it('accepts null payload', () => {
    const result = EnvelopeSchema.parse({ ...validEnvelope, payload: null });
    expect(result.payload).toBeNull();
  });
});
