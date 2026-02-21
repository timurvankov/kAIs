import { describe, it, expect } from 'vitest';
import { analyzeExperiment, type RunDataPoint } from '../analysis.js';

function makeData(variants: Record<string, Record<string, number[]>>): RunDataPoint[] {
  const points: RunDataPoint[] = [];
  for (const [variantKey, metrics] of Object.entries(variants)) {
    const metricNames = Object.keys(metrics);
    const n = metrics[metricNames[0]!]!.length;
    for (let i = 0; i < n; i++) {
      const metricsObj: Record<string, number> = {};
      for (const m of metricNames) {
        metricsObj[m] = metrics[m]![i]!;
      }
      points.push({ variantKey, metrics: metricsObj });
    }
  }
  return points;
}

describe('analyzeExperiment', () => {
  it('computes basic variant stats', () => {
    const data = makeData({
      'A': { time: [10, 12, 14, 11, 13] },
      'B': { time: [20, 22, 24, 21, 23] },
    });

    const result = analyzeExperiment(data, ['time']);

    expect(result.metrics['time']).toBeDefined();
    const timeMetric = result.metrics['time']!;

    // Variant A
    expect(timeMetric.variants['A']!.mean).toBeCloseTo(12, 1);
    expect(timeMetric.variants['A']!.n).toBe(5);
    expect(timeMetric.variants['A']!.min).toBe(10);
    expect(timeMetric.variants['A']!.max).toBe(14);

    // Variant B
    expect(timeMetric.variants['B']!.mean).toBeCloseTo(22, 1);
    expect(timeMetric.variants['B']!.n).toBe(5);
  });

  it('detects significant difference between clearly different groups', () => {
    // Large separation, should be highly significant
    const data = makeData({
      'fast': { time: [10, 11, 12, 10, 11, 12, 10, 11] },
      'slow': { time: [50, 52, 48, 51, 49, 50, 52, 48] },
    });

    const result = analyzeExperiment(data, ['time']);
    const comp = result.metrics['time']!.comparisons[0]!;

    expect(comp.significant).toBe(true);
    expect(comp.pValue).toBeLessThan(0.001);
    expect(comp.effectSize).toBeGreaterThan(1);
    expect(comp.winner).toBe('fast');
  });

  it('identifies best variant (lowest mean)', () => {
    const data = makeData({
      'A': { cost: [5, 6, 7, 5, 6] },
      'B': { cost: [2, 3, 2, 3, 2] },
      'C': { cost: [10, 11, 10, 11, 10] },
    });

    const result = analyzeExperiment(data, ['cost']);
    expect(result.metrics['cost']!.best.variant).toBe('B');
    expect(result.metrics['cost']!.best.significantlyBetter).toBe(true);
  });

  it('does not flag significance for similar groups', () => {
    const data = makeData({
      'X': { time: [10, 11, 12, 10, 11] },
      'Y': { time: [10, 12, 11, 10, 11] },
    });

    const result = analyzeExperiment(data, ['time']);
    const comp = result.metrics['time']!.comparisons[0]!;
    expect(comp.significant).toBe(false);
    expect(comp.winner).toBe('tie');
  });

  it('computes CI95 within expected bounds', () => {
    const data = makeData({
      'A': { val: [100, 102, 98, 101, 99, 100, 101, 99, 100, 100] },
    });

    const result = analyzeExperiment(data, ['val']);
    const ci = result.metrics['val']!.variants['A']!.ci95;
    expect(ci[0]).toBeLessThan(100);
    expect(ci[1]).toBeGreaterThan(100);
    expect(ci[1] - ci[0]).toBeLessThan(5);
  });

  it('handles multiple metrics', () => {
    const data = makeData({
      'cheap': { cost: [1, 2, 1, 2, 1], quality: [3, 4, 3, 4, 3] },
      'expensive': { cost: [10, 11, 10, 11, 10], quality: [8, 9, 8, 9, 8] },
    });

    const result = analyzeExperiment(data, ['cost', 'quality']);
    expect(result.metrics['cost']!.best.variant).toBe('cheap');
    expect(result.metrics['quality']!.best.variant).toBe('cheap');
  });

  it('generates all pairwise comparisons for 3 variants', () => {
    const data = makeData({
      'A': { m: [1, 2, 3, 1, 2] },
      'B': { m: [4, 5, 6, 4, 5] },
      'C': { m: [7, 8, 9, 7, 8] },
    });

    const result = analyzeExperiment(data, ['m']);
    // 3 choose 2 = 3 comparisons
    expect(result.metrics['m']!.comparisons).toHaveLength(3);
  });

  it('computes Pareto front correctly', () => {
    // cheap+low_quality dominates nothing, expensive+high_quality dominates nothing
    // medium is dominated if both metrics are worse
    const data = makeData({
      'cheap': { cost: [1, 1, 1], quality: [3, 3, 3] },
      'expensive': { cost: [10, 10, 10], quality: [1, 1, 1] },
      'dominated': { cost: [10, 10, 10], quality: [5, 5, 5] },
    });

    const result = analyzeExperiment(data, ['cost', 'quality']);
    const frontVariants = result.pareto.front.map((p) => p.variant).sort();
    // 'cheap' has cost=1, quality=3 -> not dominated
    // 'expensive' has cost=10, quality=1 -> dominated by cheap (cheap has lower cost AND lower quality)
    // 'dominated' has cost=10, quality=5 -> dominated by cheap
    // Actually, cheap dominates both since lower is better for both metrics
    expect(frontVariants).toContain('cheap');
    expect(frontVariants).not.toContain('dominated');
  });

  it('returns empty summary (to be filled by LLM)', () => {
    const data = makeData({ 'A': { m: [1, 2, 3] } });
    const result = analyzeExperiment(data, ['m']);
    expect(result.summary).toBe('');
  });

  it('handles single variant gracefully', () => {
    const data = makeData({ 'only': { speed: [5, 6, 7, 5, 6] } });
    const result = analyzeExperiment(data, ['speed']);
    expect(result.metrics['speed']!.variants['only']).toBeDefined();
    expect(result.metrics['speed']!.comparisons).toHaveLength(0);
    expect(result.metrics['speed']!.best.variant).toBe('only');
    expect(result.metrics['speed']!.best.significantlyBetter).toBe(false);
  });

  it('stddev is non-negative', () => {
    const data = makeData({ 'A': { m: [5, 5, 5, 5, 5] } });
    const result = analyzeExperiment(data, ['m']);
    expect(result.metrics['m']!.variants['A']!.stddev).toBeGreaterThanOrEqual(0);
  });
});
