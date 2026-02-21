import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvolutionSpecSchema,
  SwarmSpecSchema,
  CollectiveImmunityEntrySchema,
  NeuroplasticityEntrySchema,
  EpigeneticConfigSchema,
  TopologyAdaptationRuleSchema,
} from '../schemas.js';

// ========== Evolution Schema Tests ==========

describe('EvolutionSpec schema', () => {
  it('validates a valid evolution spec', () => {
    const spec = {
      populationSize: 10,
      selection: 'tournament',
      crossover: 'uniform',
      mutation: { rate: 0.1, perGene: true },
      elitism: 1,
      stopping: { maxGenerations: 50, stagnationLimit: 10 },
      genes: [
        { name: 'topology', type: 'enum', values: ['star', 'ring', 'mesh'] },
        { name: 'temperature', type: 'numeric', min: 0.1, max: 1.0 },
      ],
      fitness: { metrics: ['success_rate', 'cost'], weights: { success_rate: 0.7, cost: 0.3 } },
      template: { kind: 'Formation' as const, spec: {} },
      mission: {
        objective: 'test objective',
        completion: { checks: [{ name: 'done', type: 'command' as const, command: 'true' }], maxAttempts: 1, timeout: '5m' },
      },
      runtime: 'in-process' as const,
      budget: { maxTotalCost: 10, abortOnOverBudget: true },
      parallel: 2,
    };
    const result = EvolutionSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('rejects population size < 2', () => {
    const result = EvolutionSpecSchema.safeParse({
      populationSize: 1,
      mutation: { rate: 0.1 },
      stopping: { maxGenerations: 10 },
      genes: [{ name: 'x', type: 'enum', values: [1, 2] }],
      fitness: { metrics: ['m'] },
      template: { kind: 'Formation', spec: {} },
      mission: { objective: 'x', completion: { checks: [{ name: 'c', type: 'command', command: 'true' }], timeout: '1m' } },
      budget: { maxTotalCost: 1 },
    });
    expect(result.success).toBe(false);
  });

  it('requires at least one gene', () => {
    const result = EvolutionSpecSchema.safeParse({
      populationSize: 5,
      mutation: { rate: 0.1 },
      stopping: { maxGenerations: 10 },
      genes: [],
      fitness: { metrics: ['m'] },
      template: { kind: 'Formation', spec: {} },
      mission: { objective: 'x', completion: { checks: [{ name: 'c', type: 'command', command: 'true' }], timeout: '1m' } },
      budget: { maxTotalCost: 1 },
    });
    expect(result.success).toBe(false);
  });
});

// ========== Swarm Schema Tests ==========

describe('SwarmSpec schema', () => {
  it('validates a valid swarm spec', () => {
    const spec = {
      cellTemplate: 'worker',
      formationRef: 'my-formation',
      trigger: { type: 'queue_depth' as const, threshold: 10, above: 10 },
      scaling: { minReplicas: 1, maxReplicas: 10, step: 2, cooldownSeconds: 60, stabilizationSeconds: 120 },
      budget: { maxCostPerHour: 5.0 },
      drainGracePeriodSeconds: 30,
    };
    const result = SwarmSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('rejects maxReplicas <= 0', () => {
    const result = SwarmSpecSchema.safeParse({
      cellTemplate: 'worker',
      formationRef: 'f',
      trigger: { type: 'queue_depth' },
      scaling: { maxReplicas: 0 },
    });
    expect(result.success).toBe(false);
  });
});

// ========== Collective Immunity Tests ==========

describe('CollectiveImmunityEntry schema', () => {
  it('validates an immunity entry', () => {
    const entry = {
      fingerprint: 'hash-123',
      solution: 'Use retry with backoff',
      contributor: 'cell-a',
      confidence: 0.9,
      hits: 5,
      createdAt: '2024-01-01T00:00:00Z',
    };
    const result = CollectiveImmunityEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });
});

// ========== Neuroplasticity Tests ==========

describe('NeuroplasticityEntry schema', () => {
  it('validates a neuroplasticity entry', () => {
    const entry = {
      toolName: 'web_search',
      usageCount: 42,
      successCount: 38,
      lastUsed: '2024-06-15T12:00:00Z',
      pruned: false,
    };
    const result = NeuroplasticityEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });
});

// ========== Epigenetic Config Tests ==========

describe('EpigeneticConfig schema', () => {
  it('validates an epigenetic config', () => {
    const config = {
      realm: 'production',
      modifiers: {
        promptPrefix: 'SAFETY: Be conservative and verify all outputs.',
        temperatureMultiplier: 0.7,
      },
      description: 'Production realm — conservative settings',
    };
    const result = EpigeneticConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});

// ========== Topology Adaptation Tests ==========

describe('TopologyAdaptationRule schema', () => {
  it('validates a topology rule', () => {
    const rule = {
      fromCell: 'lead',
      toCell: 'worker-1',
      weight: 0.85,
      messageCount: 150,
      avgLatencyMs: 12.5,
    };
    const result = TopologyAdaptationRuleSchema.safeParse(rule);
    expect(result.success).toBe(true);
  });

  it('rejects weight > 1', () => {
    const result = TopologyAdaptationRuleSchema.safeParse({
      fromCell: 'a', toCell: 'b', weight: 1.5, messageCount: 0, avgLatencyMs: 0,
    });
    expect(result.success).toBe(false);
  });
});
