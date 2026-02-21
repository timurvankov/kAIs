import {
  mean,
  median,
  standardDeviation,
  min,
  max,
  tTestTwoSample,
  zScore,
} from 'simple-statistics';

/** Per-variant descriptive statistics for a single metric. */
export interface VariantStats {
  mean: number;
  median: number;
  stddev: number;
  min: number;
  max: number;
  n: number;
  ci95: [number, number];
}

/** Pairwise comparison result between two variants. */
export interface PairwiseComparison {
  variantA: string;
  variantB: string;
  difference: number;
  pValue: number;
  significant: boolean;
  effectSize: number;
  winner: string | 'tie';
}

/** Per-metric analysis result. */
export interface MetricAnalysis {
  variants: Record<string, VariantStats>;
  comparisons: PairwiseComparison[];
  best: {
    variant: string;
    mean: number;
    significantlyBetter: boolean;
  };
}

/** A point on the Pareto front. */
export interface ParetoPoint {
  variant: string;
  values: Record<string, number>;
}

/** Full experiment analysis result. */
export interface ExperimentAnalysis {
  metrics: Record<string, MetricAnalysis>;
  pareto: {
    metrics: string[];
    front: ParetoPoint[];
  };
  summary: string;
}

/** A single data point from an experiment run. */
export interface RunDataPoint {
  variantKey: string;
  metrics: Record<string, number>;
}

/**
 * Compute 95% confidence interval for the mean.
 * Uses z=1.96 approximation (valid for n >= 30, good enough for n >= 5).
 */
function computeCI95(data: number[]): [number, number] {
  const m = mean(data);
  const sd = standardDeviation(data);
  const n = data.length;
  if (n < 2) return [m, m];
  const se = sd / Math.sqrt(n);
  const margin = 1.96 * se;
  return [m - margin, m + margin];
}

/**
 * Compute Cohen's d effect size between two samples.
 * Uses pooled standard deviation.
 */
function cohensD(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  const sdA = standardDeviation(a);
  const sdB = standardDeviation(b);
  const nA = a.length;
  const nB = b.length;
  if (nA < 2 && nB < 2) return 0;
  const pooledVar = ((nA - 1) * sdA * sdA + (nB - 1) * sdB * sdB) / (nA + nB - 2);
  const pooledSD = Math.sqrt(pooledVar);
  if (pooledSD === 0) return 0;
  return (ma - mb) / pooledSD;
}

/**
 * Convert a t-statistic to an approximate two-tailed p-value.
 * Uses normal approximation (accurate for df > 30, reasonable for df > 5).
 */
function tStatToPValue(tStat: number): number {
  // Use the complementary CDF of the standard normal as approximation
  const z = Math.abs(tStat);
  // Abramowitz and Stegun approximation for normal CDF
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1.0 / (1.0 + p * z);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;
  const cdf = 1.0 - (a1 * t + a2 * t2 + a3 * t3 + a4 * t4 + a5 * t5) * Math.exp(-z * z / 2);
  return 2 * (1 - cdf);
}

/**
 * Compute descriptive statistics for a single variant's metric values.
 */
function computeVariantStats(values: number[]): VariantStats {
  return {
    mean: mean(values),
    median: median(values),
    stddev: standardDeviation(values),
    min: min(values),
    max: max(values),
    n: values.length,
    ci95: computeCI95(values),
  };
}

/**
 * Compare two variants using Welch's t-test.
 */
function compareVariants(
  nameA: string,
  valuesA: number[],
  nameB: string,
  valuesB: number[],
): PairwiseComparison {
  const tStat = tTestTwoSample(valuesA, valuesB);
  const pValue = tStat !== null ? tStatToPValue(tStat) : 1;
  const significant = pValue < 0.05;
  const effectSize = Math.abs(cohensD(valuesA, valuesB));
  const diff = mean(valuesA) - mean(valuesB);

  let winner: string | 'tie' = 'tie';
  if (significant) {
    winner = diff < 0 ? nameA : nameB;
  }

  return {
    variantA: nameA,
    variantB: nameB,
    difference: diff,
    pValue,
    significant,
    effectSize,
    winner,
  };
}

/**
 * Compute whether a point is dominated by another in multi-objective optimization.
 * A point is dominated if another point is better or equal on all metrics and strictly better on at least one.
 * Lower values are considered better (for cost, time, etc.)
 */
function isDominated(
  point: Record<string, number>,
  other: Record<string, number>,
  metricNames: string[],
): boolean {
  let dominated = true;
  let strictlyBetter = false;
  for (const m of metricNames) {
    if ((other[m] ?? 0) > (point[m] ?? 0)) {
      dominated = false;
      break;
    }
    if ((other[m] ?? 0) < (point[m] ?? 0)) {
      strictlyBetter = true;
    }
  }
  return dominated && strictlyBetter;
}

/**
 * Compute the Pareto front from variant means across multiple metrics.
 * Lower values are considered better for all metrics.
 */
function computeParetoFront(
  variantMeans: Record<string, Record<string, number>>,
  metricNames: string[],
): ParetoPoint[] {
  const variants = Object.keys(variantMeans);
  const front: ParetoPoint[] = [];

  for (const v of variants) {
    const point = variantMeans[v]!;
    let dominated = false;
    for (const other of variants) {
      if (other === v) continue;
      if (isDominated(point, variantMeans[other]!, metricNames)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      front.push({ variant: v, values: { ...point } });
    }
  }

  return front;
}

/**
 * Analyze experiment results.
 *
 * @param data - Array of run data points, each containing a variant key and metric values.
 * @param metricNames - Names of metrics to analyze.
 * @returns Full experiment analysis with per-metric stats, comparisons, and Pareto front.
 */
export function analyzeExperiment(
  data: RunDataPoint[],
  metricNames: string[],
): ExperimentAnalysis {
  // Group data by variant
  const byVariant = new Map<string, Record<string, number[]>>();
  for (const point of data) {
    if (!byVariant.has(point.variantKey)) {
      byVariant.set(point.variantKey, {});
    }
    const variantData = byVariant.get(point.variantKey)!;
    for (const metricName of metricNames) {
      if (point.metrics[metricName] !== undefined) {
        if (!variantData[metricName]) {
          variantData[metricName] = [];
        }
        variantData[metricName]!.push(point.metrics[metricName]!);
      }
    }
  }

  const variantNames = [...byVariant.keys()].sort();
  const metricsResult: Record<string, MetricAnalysis> = {};
  const variantMeansForPareto: Record<string, Record<string, number>> = {};

  // Initialize Pareto means
  for (const v of variantNames) {
    variantMeansForPareto[v] = {};
  }

  for (const metricName of metricNames) {
    // Compute per-variant stats
    const variants: Record<string, VariantStats> = {};
    for (const v of variantNames) {
      const values = byVariant.get(v)?.[metricName] ?? [];
      if (values.length > 0) {
        variants[v] = computeVariantStats(values);
        variantMeansForPareto[v]![metricName] = variants[v]!.mean;
      }
    }

    // Pairwise comparisons
    const comparisons: PairwiseComparison[] = [];
    for (let i = 0; i < variantNames.length; i++) {
      for (let j = i + 1; j < variantNames.length; j++) {
        const a = variantNames[i]!;
        const b = variantNames[j]!;
        const valuesA = byVariant.get(a)?.[metricName] ?? [];
        const valuesB = byVariant.get(b)?.[metricName] ?? [];
        if (valuesA.length >= 2 && valuesB.length >= 2) {
          comparisons.push(compareVariants(a, valuesA, b, valuesB));
        }
      }
    }

    // Find best variant (lowest mean — assumption: lower is better)
    let bestVariant = '';
    let bestMean = Infinity;
    for (const [v, stats] of Object.entries(variants)) {
      if (stats.mean < bestMean) {
        bestMean = stats.mean;
        bestVariant = v;
      }
    }

    // Check if best is significantly better than second best
    let significantlyBetter = false;
    const sortedByMean = Object.entries(variants)
      .sort((a, b) => a[1].mean - b[1].mean);
    if (sortedByMean.length >= 2) {
      const comp = comparisons.find(
        (c) =>
          (c.variantA === sortedByMean[0]![0] && c.variantB === sortedByMean[1]![0]) ||
          (c.variantA === sortedByMean[1]![0] && c.variantB === sortedByMean[0]![0]),
      );
      significantlyBetter = comp?.significant ?? false;
    }

    metricsResult[metricName] = {
      variants,
      comparisons,
      best: { variant: bestVariant, mean: bestMean, significantlyBetter },
    };
  }

  // Pareto front
  const pareto = {
    metrics: metricNames,
    front: computeParetoFront(variantMeansForPareto, metricNames),
  };

  return {
    metrics: metricsResult,
    pareto,
    summary: '', // Populated by LLM in ExperimentController
  };
}
