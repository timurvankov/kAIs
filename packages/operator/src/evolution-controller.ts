import type * as k8s from '@kubernetes/client-node';
import * as k8sLib from '@kubernetes/client-node';
import type {
  EvolutionStatus,
  EvolutionIndividual,
  EvolutionSelection,
  EvolutionCrossover,
} from '@kais/core';
import { getTracer } from '@kais/core';
import { SpanStatusCode, trace, context } from '@opentelemetry/api';

import type { EvolutionResource, KubeClient } from './types.js';

const tracer = getTracer('kais-operator');

const RECONCILE_RETRY_DELAY_MS = 5_000;
const MAX_RECONCILE_RETRIES = 3;

function httpStatus(err: unknown): number | undefined {
  const e = err as { code?: number; statusCode?: number; response?: { statusCode?: number } };
  return e.code ?? e.statusCode ?? e.response?.statusCode;
}

/** Pick a random element from an array. */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Generate a random gene value from a gene definition. */
function randomGeneValue(gene: {
  name: string;
  type: 'enum' | 'numeric' | 'string';
  values?: unknown[];
  min?: number;
  max?: number;
}): unknown {
  switch (gene.type) {
    case 'enum':
      return gene.values && gene.values.length > 0
        ? pickRandom(gene.values)
        : null;
    case 'numeric': {
      const lo = gene.min ?? 0;
      const hi = gene.max ?? 1;
      return lo + Math.random() * (hi - lo);
    }
    case 'string':
      return gene.values && gene.values.length > 0
        ? pickRandom(gene.values)
        : '';
    default:
      return null;
  }
}

/** Mutate a single gene value. */
function mutateGene(
  gene: {
    name: string;
    type: 'enum' | 'numeric' | 'string';
    values?: unknown[];
    min?: number;
    max?: number;
  },
  current: unknown,
): unknown {
  switch (gene.type) {
    case 'enum': {
      if (!gene.values || gene.values.length <= 1) return current;
      let next: unknown;
      do {
        next = pickRandom(gene.values);
      } while (next === current && gene.values.length > 1);
      return next;
    }
    case 'numeric': {
      const lo = gene.min ?? 0;
      const hi = gene.max ?? 1;
      const range = hi - lo;
      // Gaussian-like perturbation (Box-Muller simplified)
      const perturbation = (Math.random() - 0.5) * range * 0.2;
      return Math.max(lo, Math.min(hi, (current as number) + perturbation));
    }
    case 'string':
      return gene.values && gene.values.length > 1
        ? pickRandom(gene.values.filter((v) => v !== current))
        : current;
    default:
      return current;
  }
}

/** In-memory population state for an evolution run. */
interface PopulationState {
  individuals: EvolutionIndividual[];
  generation: number;
  bestFitness: number | undefined;
  bestIndividual: EvolutionIndividual | undefined;
  totalCost: number;
  fitnessHistory: number[]; // best fitness per generation for stagnation detection
}

/**
 * EvolutionController watches Evolution CRDs and drives evolutionary lifecycle.
 *
 * Lifecycle: Pending -> Running -> Analyzing -> Completed / Failed / Aborted
 *
 * In Pending phase:
 *   - Initialize population with random genes from spec.genes
 *   - Transition to Running
 *
 * In Running phase:
 *   - Evaluate fitness using experiment-like runs
 *   - Apply GA operators (selection, crossover, mutation) each generation
 *   - Check stopping conditions
 *   - When stopped -> transition to Analyzing
 *
 * In Analyzing phase:
 *   - Compute gene importance via ANOVA-like variance analysis
 *   - Transition to Completed
 */
export class EvolutionController {
  private evolutionInformer: k8s.Informer<k8s.KubernetesObject> | null = null;
  private stopped = false;

  /** In-memory population state, keyed by evolution UID. */
  private populations = new Map<string, PopulationState>();

  constructor(
    private readonly kc: k8s.KubeConfig,
    private readonly client: KubeClient,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.startEvolutionInformer();
    console.log('[EvolutionController] started watching Evolution CRDs');
  }

  private async startEvolutionInformer(): Promise<void> {
    const customApi = this.kc.makeApiClient(k8sLib.CustomObjectsApi);
    const path = '/apis/kais.io/v1/evolutions';

    const listFn = async (): Promise<
      k8s.KubernetesListObject<k8s.KubernetesObject>
    > => {
      const response = await customApi.listClusterCustomObject({
        group: 'kais.io',
        version: 'v1',
        plural: 'evolutions',
      });
      return response as k8s.KubernetesListObject<k8s.KubernetesObject>;
    };

    this.evolutionInformer = k8sLib.makeInformer(this.kc, path, listFn);

    this.evolutionInformer.on('add', (obj: k8s.KubernetesObject) => {
      void this.handleEvolutionEvent('add', obj);
    });

    this.evolutionInformer.on('update', (obj: k8s.KubernetesObject) => {
      void this.handleEvolutionEvent('update', obj);
    });

    this.evolutionInformer.on('delete', (obj: k8s.KubernetesObject) => {
      void this.handleEvolutionEvent('delete', obj);
    });

    this.evolutionInformer.on('error', (err: unknown) => {
      if (!this.stopped) {
        console.error('[EvolutionController] watch error:', err);
        setTimeout(() => {
          if (!this.stopped) {
            console.log('[EvolutionController] restarting informer...');
            void this.evolutionInformer?.start();
          }
        }, RECONCILE_RETRY_DELAY_MS);
      }
    });

    await this.evolutionInformer.start();
  }

  stop(): void {
    this.stopped = true;
    if (this.evolutionInformer) {
      void this.evolutionInformer.stop();
      this.evolutionInformer = null;
    }
    this.populations.clear();
    console.log('[EvolutionController] stopped');
  }

  private async handleEvolutionEvent(
    event: 'add' | 'update' | 'delete',
    obj: k8s.KubernetesObject,
  ): Promise<void> {
    const evolution = obj as unknown as EvolutionResource;
    const evoId = `${evolution.metadata.namespace}/${evolution.metadata.name}`;

    console.log(`[EvolutionController] evolution ${event} event for ${evoId}`);

    if (event === 'delete') {
      if (evolution.metadata.uid) {
        this.populations.delete(evolution.metadata.uid);
      }
      return;
    }

    for (let attempt = 0; attempt <= MAX_RECONCILE_RETRIES; attempt++) {
      try {
        await this.reconcileEvolution(evolution);
        return;
      } catch (err) {
        if (httpStatus(err) === 404) {
          console.log(`[EvolutionController] evolution ${evoId} not found, skipping`);
          return;
        }
        console.error(
          `[EvolutionController] reconcile attempt ${attempt + 1} failed for ${evoId}:`,
          err,
        );
        if (attempt < MAX_RECONCILE_RETRIES) {
          const delay = RECONCILE_RETRY_DELAY_MS * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    console.error(`[EvolutionController] exhausted retries for ${evoId}`);

    try {
      await this.client.updateEvolutionStatus(
        evolution.metadata.name,
        evolution.metadata.namespace,
        {
          phase: 'Failed',
          generation: evolution.status?.generation ?? 0,
          populationSize: evolution.status?.populationSize ?? 0,
          totalCost: evolution.status?.totalCost ?? 0,
          message: `Reconciliation failed after ${MAX_RECONCILE_RETRIES + 1} attempts`,
        },
      );
    } catch (statusErr) {
      console.error(`[EvolutionController] failed to update status for ${evoId}:`, statusErr);
    }
  }

  async reconcileEvolution(evolution: EvolutionResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_evolution', {
      attributes: {
        'resource.name': evolution.metadata.name,
        'resource.namespace': evolution.metadata.namespace ?? 'default',
        'resource.phase': evolution.status?.phase ?? 'Unknown',
      },
    });

    try {
      await context.with(trace.setSpan(context.active(), span), async () => {
        const phase = evolution.status?.phase;
        switch (phase) {
          case undefined:
          case 'Pending':
            await this.reconcilePending(evolution);
            break;
          case 'Running':
            await this.reconcileRunning(evolution);
            break;
          case 'Analyzing':
            await this.reconcileAnalyzing(evolution);
            break;
          case 'Completed':
          case 'Failed':
          case 'Aborted':
            // Terminal phases — no-op
            break;
        }
      });
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  // ---------------------------------------------------------------------------
  // Pending -> Initialize population, transition to Running
  // ---------------------------------------------------------------------------

  private async reconcilePending(evolution: EvolutionResource): Promise<void> {
    const { populationSize, genes, budget } = evolution.spec;

    // Create initial population with random genes
    const individuals: EvolutionIndividual[] = [];
    for (let i = 0; i < populationSize; i++) {
      const geneValues: Record<string, unknown> = {};
      for (const gene of genes) {
        geneValues[gene.name] = randomGeneValue(gene);
      }
      individuals.push({
        id: `ind-${String(i).padStart(4, '0')}`,
        genes: geneValues,
        generation: 0,
      });
    }

    // Simple cost estimation: each individual needs a fitness evaluation
    const estimatedCostPerEval = 1.0;
    const estimatedTotalCost =
      populationSize * evolution.spec.stopping.maxGenerations * estimatedCostPerEval;

    // Budget check
    if (budget.abortOnOverBudget && estimatedTotalCost > budget.maxTotalCost) {
      const status: EvolutionStatus = {
        phase: 'Failed',
        generation: 0,
        populationSize,
        totalCost: 0,
        message: `Estimated cost $${estimatedTotalCost.toFixed(2)} exceeds budget $${budget.maxTotalCost.toFixed(2)}`,
      };
      await this.client.updateEvolutionStatus(
        evolution.metadata.name,
        evolution.metadata.namespace,
        status,
      );
      return;
    }

    // Store population state
    const uid = evolution.metadata.uid ?? evolution.metadata.name;
    this.populations.set(uid, {
      individuals,
      generation: 0,
      bestFitness: undefined,
      bestIndividual: undefined,
      totalCost: 0,
      fitnessHistory: [],
    });

    // Transition to Running
    const status: EvolutionStatus = {
      phase: 'Running',
      generation: 0,
      populationSize,
      totalCost: 0,
    };

    await this.client.updateEvolutionStatus(
      evolution.metadata.name,
      evolution.metadata.namespace,
      status,
    );
  }

  // ---------------------------------------------------------------------------
  // Running -> Evaluate fitness, apply GA operators, check stopping conditions
  // ---------------------------------------------------------------------------

  private async reconcileRunning(evolution: EvolutionResource): Promise<void> {
    const uid = evolution.metadata.uid ?? evolution.metadata.name;
    let state = this.populations.get(uid);

    if (!state) {
      // State lost (controller restart) — transition to Analyzing with what we have
      console.log(`[EvolutionController] no population state for ${uid}, transitioning to Analyzing`);
      await this.transitionToAnalyzing(evolution);
      return;
    }

    const { selection, crossover, mutation, elitism, stopping, fitness, budget } = evolution.spec;

    // --- Step 1: Evaluate fitness for individuals that lack it ---
    const costPerEval = 1.0; // Placeholder cost per fitness evaluation
    for (const ind of state.individuals) {
      if (ind.fitness === undefined) {
        // In a real implementation, this would launch a Formation + Mission for this
        // individual's gene configuration and measure the fitness metrics.
        // For now, simulate a fitness evaluation with a mock score.
        ind.fitness = this.evaluateFitness(ind, fitness);
        state.totalCost += costPerEval;
      }
    }

    // --- Step 2: Budget enforcement ---
    if (budget.maxTotalCost > 0 && state.totalCost >= budget.maxTotalCost) {
      console.log(`[EvolutionController] budget exceeded for ${uid}, stopping`);
      await this.transitionToAnalyzing(evolution);
      return;
    }

    // --- Step 3: Track best individual ---
    const sortedByFitness = [...state.individuals]
      .filter((ind) => ind.fitness !== undefined)
      .sort((a, b) => (b.fitness ?? 0) - (a.fitness ?? 0));

    if (sortedByFitness.length > 0) {
      const best = sortedByFitness[0]!;
      if (state.bestFitness === undefined || (best.fitness ?? 0) > state.bestFitness) {
        state.bestFitness = best.fitness;
        state.bestIndividual = { ...best };
      }
    }

    state.fitnessHistory.push(state.bestFitness ?? 0);

    // --- Step 4: Check stopping conditions ---
    if (this.shouldStop(state, stopping)) {
      await this.transitionToAnalyzing(evolution);
      return;
    }

    // --- Step 5: GA operators — produce next generation ---
    const nextGen: EvolutionIndividual[] = [];
    const elitismCount = Math.min(elitism, sortedByFitness.length);

    // Elitism: keep top N individuals
    for (let i = 0; i < elitismCount; i++) {
      const elite = sortedByFitness[i]!;
      nextGen.push({
        id: elite.id,
        genes: { ...elite.genes },
        fitness: elite.fitness,
        generation: state.generation + 1,
      });
    }

    // Fill remaining population via selection + crossover + mutation
    const targetSize = evolution.spec.populationSize;
    const genes = evolution.spec.genes;
    let childIndex = elitismCount;

    while (nextGen.length < targetSize) {
      // Selection
      const parent1 = this.select(sortedByFitness, selection);
      const parent2 = this.select(sortedByFitness, selection);

      // Crossover
      const childGenes = this.crossoverGenes(parent1.genes, parent2.genes, genes, crossover);

      // Mutation
      for (const gene of genes) {
        if (Math.random() < mutation.rate) {
          childGenes[gene.name] = mutateGene(gene, childGenes[gene.name]);
        }
      }

      nextGen.push({
        id: `ind-${String(childIndex).padStart(4, '0')}`,
        genes: childGenes,
        fitness: undefined, // needs evaluation next reconcile
        generation: state.generation + 1,
      });
      childIndex++;
    }

    // Update state
    state.generation += 1;
    state.individuals = nextGen;

    // Persist status
    const status: EvolutionStatus = {
      phase: 'Running',
      generation: state.generation,
      bestFitness: state.bestFitness,
      bestIndividual: state.bestIndividual,
      populationSize: state.individuals.length,
      totalCost: state.totalCost,
    };

    await this.client.updateEvolutionStatus(
      evolution.metadata.name,
      evolution.metadata.namespace,
      status,
    );
  }

  // ---------------------------------------------------------------------------
  // Analyzing -> Compute gene importance, transition to Completed
  // ---------------------------------------------------------------------------

  private async reconcileAnalyzing(evolution: EvolutionResource): Promise<void> {
    const uid = evolution.metadata.uid ?? evolution.metadata.name;
    const state = this.populations.get(uid);

    // Compute gene importance via ANOVA-like analysis:
    // For each gene, compute the fraction of total fitness variance explained
    // by grouping individuals by that gene's value.
    const geneImportance: Record<string, number> = {};

    if (state && state.individuals.length > 0) {
      const evaluated = state.individuals.filter((ind) => ind.fitness !== undefined);
      if (evaluated.length > 1) {
        const fitnessValues = evaluated.map((ind) => ind.fitness!);
        const totalVariance = this.computeVariance(fitnessValues);

        if (totalVariance > 0) {
          for (const gene of evolution.spec.genes) {
            // Group by gene value and compute between-group variance
            const groups = new Map<string, number[]>();
            for (const ind of evaluated) {
              const geneVal = String(ind.genes[gene.name]);
              if (!groups.has(geneVal)) groups.set(geneVal, []);
              groups.get(geneVal)!.push(ind.fitness!);
            }

            // Between-group sum of squares (SSB)
            const grandMean = fitnessValues.reduce((a, b) => a + b, 0) / fitnessValues.length;
            let ssb = 0;
            for (const [, groupFitness] of groups) {
              const groupMean = groupFitness.reduce((a, b) => a + b, 0) / groupFitness.length;
              ssb += groupFitness.length * Math.pow(groupMean - grandMean, 2);
            }

            // Total sum of squares (SST)
            const sst = totalVariance * fitnessValues.length;

            // Eta-squared: proportion of variance explained
            geneImportance[gene.name] = sst > 0 ? ssb / sst : 0;
          }
        }
      }
    }

    const status: EvolutionStatus = {
      phase: 'Completed',
      generation: state?.generation ?? evolution.status?.generation ?? 0,
      bestFitness: state?.bestFitness ?? evolution.status?.bestFitness,
      bestIndividual: state?.bestIndividual ?? evolution.status?.bestIndividual,
      populationSize: state?.individuals.length ?? evolution.status?.populationSize ?? 0,
      totalCost: state?.totalCost ?? evolution.status?.totalCost ?? 0,
      geneImportance:
        Object.keys(geneImportance).length > 0 ? geneImportance : undefined,
    };

    await this.client.updateEvolutionStatus(
      evolution.metadata.name,
      evolution.metadata.namespace,
      status,
    );

    // Clean up
    if (uid) this.populations.delete(uid);
  }

  private async transitionToAnalyzing(evolution: EvolutionResource): Promise<void> {
    const uid = evolution.metadata.uid ?? evolution.metadata.name;
    const state = this.populations.get(uid);

    const status: EvolutionStatus = {
      phase: 'Analyzing',
      generation: state?.generation ?? evolution.status?.generation ?? 0,
      bestFitness: state?.bestFitness ?? evolution.status?.bestFitness,
      bestIndividual: state?.bestIndividual ?? evolution.status?.bestIndividual,
      populationSize: state?.individuals.length ?? evolution.status?.populationSize ?? 0,
      totalCost: state?.totalCost ?? evolution.status?.totalCost ?? 0,
    };

    await this.client.updateEvolutionStatus(
      evolution.metadata.name,
      evolution.metadata.namespace,
      status,
    );
  }

  // ---------------------------------------------------------------------------
  // Genetic Algorithm Operators
  // ---------------------------------------------------------------------------

  /** Evaluate fitness for an individual (mock implementation). */
  private evaluateFitness(
    individual: EvolutionIndividual,
    fitnessConfig: { metrics: string[]; weights?: Record<string, number> },
  ): number {
    // In a real implementation, this would:
    // 1. Create a Formation from the evolution's template with the individual's genes
    // 2. Launch a Mission against it
    // 3. Collect metric results
    // 4. Compute weighted fitness score
    //
    // For now, return a deterministic mock based on gene hash so the GA can actually
    // converge (pure random would prevent meaningful testing).
    let score = 0;
    const weights = fitnessConfig.weights ?? {};
    for (const metric of fitnessConfig.metrics) {
      const weight = weights[metric] ?? 1.0;
      // Hash-like score from genes: sum of numeric gene values, hash of string genes
      let geneScore = 0;
      for (const [, val] of Object.entries(individual.genes)) {
        if (typeof val === 'number') {
          geneScore += val;
        } else if (typeof val === 'string') {
          geneScore += val.length * 0.1;
        }
      }
      score += (geneScore % 100) * weight;
    }
    return score;
  }

  /**
   * Selection operator: choose a parent from the population.
   */
  private select(
    sorted: EvolutionIndividual[],
    method: EvolutionSelection,
  ): EvolutionIndividual {
    if (sorted.length === 0) {
      throw new Error('Cannot select from empty population');
    }

    switch (method) {
      case 'tournament': {
        // Tournament selection: pick 2 random individuals, keep the better one
        const a = pickRandom(sorted);
        const b = pickRandom(sorted);
        return (a.fitness ?? 0) >= (b.fitness ?? 0) ? a : b;
      }

      case 'roulette': {
        // Roulette wheel selection: probability weighted by fitness
        const minFitness = Math.min(...sorted.map((i) => i.fitness ?? 0));
        const offset = minFitness < 0 ? Math.abs(minFitness) + 1 : 0;
        const totalFitness = sorted.reduce((sum, i) => sum + (i.fitness ?? 0) + offset, 0);
        if (totalFitness === 0) return pickRandom(sorted);

        let spin = Math.random() * totalFitness;
        for (const ind of sorted) {
          spin -= (ind.fitness ?? 0) + offset;
          if (spin <= 0) return ind;
        }
        return sorted[sorted.length - 1]!;
      }

      case 'rank': {
        // Rank-based selection: probability proportional to rank (best = N, worst = 1)
        const n = sorted.length;
        const totalRank = (n * (n + 1)) / 2;
        let spin = Math.random() * totalRank;
        for (let rank = n; rank >= 1; rank--) {
          spin -= rank;
          if (spin <= 0) return sorted[n - rank]!;
        }
        return sorted[0]!;
      }

      default:
        return pickRandom(sorted);
    }
  }

  /**
   * Crossover operator: combine two parent gene sets into a child.
   */
  private crossoverGenes(
    parent1Genes: Record<string, unknown>,
    parent2Genes: Record<string, unknown>,
    geneDefinitions: Array<{ name: string; type: string }>,
    method: EvolutionCrossover,
  ): Record<string, unknown> {
    const childGenes: Record<string, unknown> = {};

    switch (method) {
      case 'uniform': {
        // Uniform crossover: 50/50 swap per gene
        for (const gene of geneDefinitions) {
          childGenes[gene.name] =
            Math.random() < 0.5 ? parent1Genes[gene.name] : parent2Genes[gene.name];
        }
        break;
      }

      case 'single_point': {
        // Single-point crossover: pick a random cut point
        const cutPoint = Math.floor(Math.random() * geneDefinitions.length);
        for (let i = 0; i < geneDefinitions.length; i++) {
          const gene = geneDefinitions[i]!;
          childGenes[gene.name] =
            i < cutPoint ? parent1Genes[gene.name] : parent2Genes[gene.name];
        }
        break;
      }

      case 'two_point': {
        // Two-point crossover: genes between two cut points come from parent2
        const len = geneDefinitions.length;
        let cp1 = Math.floor(Math.random() * len);
        let cp2 = Math.floor(Math.random() * len);
        if (cp1 > cp2) [cp1, cp2] = [cp2, cp1];

        for (let i = 0; i < len; i++) {
          const gene = geneDefinitions[i]!;
          childGenes[gene.name] =
            i >= cp1 && i <= cp2 ? parent2Genes[gene.name] : parent1Genes[gene.name];
        }
        break;
      }

      default: {
        // Fallback to uniform
        for (const gene of geneDefinitions) {
          childGenes[gene.name] =
            Math.random() < 0.5 ? parent1Genes[gene.name] : parent2Genes[gene.name];
        }
      }
    }

    return childGenes;
  }

  /**
   * Check whether the evolution should stop.
   */
  private shouldStop(
    state: PopulationState,
    stopping: {
      maxGenerations: number;
      stagnationLimit?: number;
      fitnessThreshold?: number;
      budgetLimit?: number;
    },
  ): boolean {
    // Max generations
    if (state.generation >= stopping.maxGenerations) {
      return true;
    }

    // Fitness threshold
    if (
      stopping.fitnessThreshold !== undefined &&
      state.bestFitness !== undefined &&
      state.bestFitness >= stopping.fitnessThreshold
    ) {
      return true;
    }

    // Budget limit
    if (stopping.budgetLimit !== undefined && state.totalCost >= stopping.budgetLimit) {
      return true;
    }

    // Stagnation: no improvement for N generations
    if (stopping.stagnationLimit !== undefined && state.fitnessHistory.length >= stopping.stagnationLimit) {
      const recent = state.fitnessHistory.slice(-stopping.stagnationLimit);
      const allSame = recent.every((f) => f === recent[0]);
      if (allSame) return true;
    }

    return false;
  }

  /**
   * Compute population variance of numeric array.
   */
  private computeVariance(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sumSquares = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0);
    return sumSquares / values.length;
  }
}
