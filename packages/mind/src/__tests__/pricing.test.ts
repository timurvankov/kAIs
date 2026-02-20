import { describe, expect, it } from 'vitest';

import { computeCost, MODEL_PRICING } from '../pricing.js';

describe('computeCost', () => {
  it('computes correct cost for claude-sonnet-4-20250514', () => {
    // 1M input tokens at $3/1M + 500K output tokens at $15/1M
    const cost = computeCost('claude-sonnet-4-20250514', 1_000_000, 500_000);
    expect(cost).toBeCloseTo(3 + 7.5, 6);
  });

  it('computes correct cost for claude-haiku-4-5-20251001', () => {
    // 2M input tokens at $0.80/1M + 1M output tokens at $4/1M
    const cost = computeCost('claude-haiku-4-5-20251001', 2_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.6 + 4, 6);
  });

  it('computes correct cost for gpt-4o', () => {
    // 100K input at $2.50/1M + 200K output at $10/1M
    const cost = computeCost('gpt-4o', 100_000, 200_000);
    expect(cost).toBeCloseTo(0.25 + 2, 6);
  });

  it('computes correct cost for gpt-4o-mini', () => {
    // 500K input at $0.15/1M + 300K output at $0.60/1M
    const cost = computeCost('gpt-4o-mini', 500_000, 300_000);
    expect(cost).toBeCloseTo(0.075 + 0.18, 6);
  });

  it('returns 0 for unknown models', () => {
    expect(computeCost('unknown-model', 1_000_000, 1_000_000)).toBe(0);
  });

  it('returns 0 for ollama models', () => {
    expect(computeCost('llama3.2', 1_000_000, 1_000_000)).toBe(0);
  });

  it('returns 0 when tokens are 0', () => {
    expect(computeCost('gpt-4o', 0, 0)).toBe(0);
  });

  it('handles small token counts precisely', () => {
    // 1000 input tokens at $3/1M = $0.003
    const cost = computeCost('claude-sonnet-4-20250514', 1000, 0);
    expect(cost).toBeCloseTo(0.003, 8);
  });

  it('MODEL_PRICING has expected models', () => {
    expect(Object.keys(MODEL_PRICING)).toContain('claude-sonnet-4-20250514');
    expect(Object.keys(MODEL_PRICING)).toContain('claude-haiku-4-5-20251001');
    expect(Object.keys(MODEL_PRICING)).toContain('gpt-4o');
    expect(Object.keys(MODEL_PRICING)).toContain('gpt-4o-mini');
  });
});
