import { describe, it, expect } from 'vitest';
import {
  KnowledgeScopeSchema,
  FactSchema,
  SearchOptionsSchema,
  BlueprintParameterSchema,
  BlueprintSpecSchema,
  BlueprintStatusSchema,
} from '../schemas.js';

describe('Knowledge schemas', () => {
  it('validates KnowledgeScope', () => {
    const result = KnowledgeScopeSchema.safeParse({
      level: 'cell',
      realmId: 'default',
      formationId: 'review-team',
      cellId: 'architect-0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects KnowledgeScope with invalid level', () => {
    const result = KnowledgeScopeSchema.safeParse({ level: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('validates Fact', () => {
    const result = FactSchema.safeParse({
      id: 'fact-123',
      content: 'TypeScript projects should use strict mode',
      scope: { level: 'platform' },
      source: { type: 'user_input' },
      confidence: 0.95,
      validFrom: '2026-02-21T00:00:00Z',
      tags: ['typescript', 'config'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects Fact with confidence > 1', () => {
    const result = FactSchema.safeParse({
      id: 'f1',
      content: 'test',
      scope: { level: 'platform' },
      source: { type: 'user_input' },
      confidence: 1.5,
      validFrom: '2026-02-21T00:00:00Z',
      tags: [],
    });
    expect(result.success).toBe(false);
  });

  it('validates SearchOptions with defaults', () => {
    const result = SearchOptionsSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.maxResults).toBe(20);
    expect(result.data?.minConfidence).toBe(0);
    expect(result.data?.semantic).toBe(true);
  });
});

describe('Blueprint schemas', () => {
  it('validates BlueprintParameter', () => {
    const result = BlueprintParameterSchema.safeParse({
      name: 'developer_count',
      type: 'integer',
      default: 3,
      description: 'Number of developers',
    });
    expect(result.success).toBe(true);
  });

  it('validates BlueprintParameter with enum constraint', () => {
    const result = BlueprintParameterSchema.safeParse({
      name: 'model_tier',
      type: 'enum',
      values: ['budget', 'standard', 'premium'],
      default: 'standard',
    });
    expect(result.success).toBe(true);
  });

  it('validates BlueprintSpec', () => {
    const result = BlueprintSpecSchema.safeParse({
      description: 'A code review team',
      parameters: [
        { name: 'language', type: 'string', default: 'typescript' },
      ],
      formation: { cells: [], topology: { type: 'hierarchy', root: 'lead' } },
    });
    expect(result.success).toBe(true);
  });

  it('validates BlueprintStatus', () => {
    const result = BlueprintStatusSchema.safeParse({
      usageCount: 42,
      avgSuccessRate: 0.87,
      versions: [{ version: 1, createdAt: '2026-02-01T00:00:00Z' }],
    });
    expect(result.success).toBe(true);
  });
});
