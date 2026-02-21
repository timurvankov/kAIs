import { describe, it, expect } from 'vitest';
import {
  KnowledgeGraphSpecSchema,
  KnowledgeGraphStatusSchema,
  KnowledgeGraphRetentionSchema,
} from '../schemas.js';

describe('KnowledgeGraph Schemas', () => {
  it('validates a minimal shared KnowledgeGraph spec', () => {
    const spec = { scope: { level: 'platform' }, dedicated: false, inherit: true };
    expect(() => KnowledgeGraphSpecSchema.parse(spec)).not.toThrow();
  });

  it('validates a full dedicated KnowledgeGraph spec with parentRef', () => {
    const spec = {
      scope: { level: 'formation', realmId: 'trading', formationId: 'alpha' },
      parentRef: 'trading-knowledge',
      dedicated: true,
      inherit: true,
      retention: { maxFacts: 100000, ttlDays: 90 },
      resources: { memory: '1Gi', cpu: '500m', storage: '10Gi' },
    };
    expect(() => KnowledgeGraphSpecSchema.parse(spec)).not.toThrow();
  });

  it('rejects spec without scope', () => {
    const spec = { dedicated: false, inherit: true };
    expect(() => KnowledgeGraphSpecSchema.parse(spec)).toThrow();
  });

  it('defaults dedicated to false and inherit to true', () => {
    const spec = { scope: { level: 'realm', realmId: 'test' } };
    const parsed = KnowledgeGraphSpecSchema.parse(spec);
    expect(parsed.dedicated).toBe(false);
    expect(parsed.inherit).toBe(true);
  });

  it('validates KnowledgeGraph status', () => {
    const status = {
      phase: 'Ready',
      endpoint: 'bolt://neo4j.kais-system:7687',
      database: 'trading-knowledge',
      factCount: 1234,
      parentChain: ['platform-knowledge'],
    };
    expect(() => KnowledgeGraphStatusSchema.parse(status)).not.toThrow();
  });

  it('validates retention schema', () => {
    const retention = { maxFacts: 50000, ttlDays: 60 };
    expect(() => KnowledgeGraphRetentionSchema.parse(retention)).not.toThrow();
  });

  it('rejects invalid phase in status', () => {
    const status = { phase: 'InvalidPhase' };
    expect(() => KnowledgeGraphStatusSchema.parse(status)).toThrow();
  });
});
