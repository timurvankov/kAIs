/**
 * Experiment Engine E2E Tests
 *
 * Tests the full experiment lifecycle with all Phase 3 components working together:
 * - ExperimentController (lifecycle management)
 * - analyzeExperiment (statistical analysis)
 * - ProtocolEnforcer + ProtocolSession (protocol-enforced messaging)
 * - InProcessRuntime + InMemoryBus (cell communication)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type * as k8s from '@kubernetes/client-node';
import {
  analyzeExperiment,
  createEnvelope,
  InMemoryBus,
  InProcessRuntime,
  ProtocolEnforcer,
  CONTRACT_PROTOCOL,
  DELIBERATION_PROTOCOL,
  type Envelope,
  type ExperimentStatus,
  type RunDataPoint,
} from '@kais/core';
import {
  ExperimentController,
  type ExperimentResource,
  type ExperimentEventType,
  type KubeClient,
  type CellResource,
} from '@kais/operator';

// ---------------------------------------------------------------------------
// Mock KubeClient — tracks all status updates and events
// ---------------------------------------------------------------------------

interface StatusUpdate {
  name: string;
  namespace: string;
  status: ExperimentStatus;
}

interface EventRecord {
  eventType: string;
  reason: string;
  message: string;
}

function createMockClient(): KubeClient & {
  statusUpdates: StatusUpdate[];
  events: EventRecord[];
} {
  const statusUpdates: StatusUpdate[] = [];
  const events: EventRecord[] = [];

  return {
    statusUpdates,
    events,

    // Pod methods (unused)
    async getPod(): Promise<k8s.V1Pod | null> { return null; },
    async createPod(pod: k8s.V1Pod): Promise<k8s.V1Pod> { return pod; },
    async deletePod(): Promise<void> {},
    async listPods(): Promise<k8s.V1PodList> { return { items: [] } as k8s.V1PodList; },

    // Cell methods (unused)
    async getCell(): Promise<CellResource | null> { return null; },
    async createCell(cell: CellResource): Promise<CellResource> { return cell; },
    async updateCell(): Promise<void> {},
    async deleteCell(): Promise<void> {},
    async listCells(): Promise<CellResource[]> { return []; },
    async updateCellStatus(): Promise<void> {},

    // Formation/Mission/ConfigMap/PVC/Event methods (unused)
    async updateFormationStatus(): Promise<void> {},
    async createOrUpdateConfigMap(): Promise<void> {},
    async createPVC(): Promise<void> {},
    async getPVC(): Promise<k8s.V1PersistentVolumeClaim | null> { return null; },
    async emitEvent(): Promise<void> {},
    async emitFormationEvent(): Promise<void> {},
    async updateMissionStatus(): Promise<void> {},
    async emitMissionEvent(): Promise<void> {},

    // Experiment methods — record calls
    async updateExperimentStatus(
      name: string,
      namespace: string,
      status: ExperimentStatus,
    ): Promise<void> {
      statusUpdates.push({ name, namespace, status });
    },
    async emitExperimentEvent(
      _experiment: ExperimentResource,
      eventType: ExperimentEventType,
      reason: string,
      message: string,
    ): Promise<void> {
      events.push({ eventType, reason, message });
    },
  };
}

function makeExperiment(
  specOverrides: Partial<ExperimentResource['spec']> = {},
  statusOverride?: ExperimentStatus,
): ExperimentResource {
  return {
    apiVersion: 'kais.io/v1',
    kind: 'Experiment',
    metadata: {
      name: 'e2e-experiment',
      namespace: 'default',
      uid: 'e2e-uid-' + Date.now(),
      resourceVersion: '1',
    },
    spec: {
      variables: [
        { name: 'topology', values: ['star', 'hierarchy', 'mesh'] },
        { name: 'model', values: ['fast', 'slow'] },
      ],
      repeats: 3,
      template: {
        kind: 'Formation' as const,
        spec: { cells: [] },
      },
      mission: {
        objective: 'Build feature X',
        completion: {
          checks: [{ name: 'tests-pass', type: 'command' as const, command: 'npm test' }],
          maxAttempts: 3,
          timeout: '10m',
        },
      },
      metrics: [
        { name: 'duration', type: 'duration' as const },
        { name: 'cost', type: 'sum' as const },
      ],
      runtime: 'in-process' as const,
      budget: {
        maxTotalCost: 500,
        abortOnOverBudget: true,
      },
      parallel: 4,
      ...specOverrides,
    },
    status: statusOverride,
  };
}

function makeTestEnvelope(from: string, to: string, content: string): Envelope {
  return createEnvelope({
    type: 'message',
    from,
    to,
    payload: { content },
  });
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('Experiment Engine E2E', () => {

  // =========================================================================
  // 1. Full Experiment Lifecycle
  // =========================================================================

  describe('Full experiment lifecycle', () => {
    it('drives experiment through Pending → Running → Analyzing → Completed', async () => {
      const client = createMockClient();
      const controller = new ExperimentController(null as any, client);

      const exp = makeExperiment({
        variables: [
          { name: 'topology', values: ['star', 'hierarchy'] },
          { name: 'model', values: ['fast', 'slow'] },
        ],
        repeats: 2,
        parallel: 10, // high enough to process all 8 runs in one cycle
      });

      // Reconcile #1: Pending → Running
      await controller.reconcileExperiment(exp);
      const status1 = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      expect(status1.phase).toBe('Running');
      expect(status1.totalRuns).toBe(8); // 2 × 2 × 2 = 8

      // Reconcile #2: Running → all runs complete → Analyzing
      const exp2 = { ...exp, status: status1 };
      await controller.reconcileExperiment(exp2 as ExperimentResource);
      const status2 = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      expect(status2.phase).toBe('Analyzing');

      // Reconcile #3: Analyzing → Completed
      const exp3 = { ...exp, status: status2 };
      await controller.reconcileExperiment(exp3 as ExperimentResource);
      const status3 = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      expect(status3.phase).toBe('Completed');
      expect(status3.completedRuns).toBe(8);
      expect(status3.failedRuns).toBe(0);
      expect(status3.analysis).toBeDefined();

      // Verify events were emitted
      const eventTypes = client.events.map(e => e.eventType);
      expect(eventTypes).toContain('ExperimentStarted');
      expect(eventTypes).toContain('ExperimentAnalyzing');
      expect(eventTypes).toContain('ExperimentCompleted');
    });

    it('fails experiment when budget exceeded', async () => {
      const client = createMockClient();
      const controller = new ExperimentController(null as any, client);

      // 10 × 5 × 5 = 250 runs × $2/run = $500 > $50 budget
      const exp = makeExperiment({
        variables: [
          { name: 'a', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        ],
        repeats: 5,
        budget: { maxTotalCost: 50, abortOnOverBudget: true },
      });

      await controller.reconcileExperiment(exp);

      const lastStatus = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      expect(lastStatus.phase).toBe('Failed');
      expect(lastStatus.message).toContain('exceeds budget');
      expect(lastStatus.suggestions).toBeDefined();
      expect(lastStatus.suggestions!.length).toBeGreaterThan(0);

      // Should have budget event
      expect(client.events.some(e => e.eventType === 'ExperimentOverBudget')).toBe(true);
    });

    it('handles single-variant experiment', async () => {
      const client = createMockClient();
      const controller = new ExperimentController(null as any, client);

      const exp = makeExperiment({
        variables: [{ name: 'x', values: ['only'] }],
        repeats: 1,
      });

      // Drive through all phases
      await controller.reconcileExperiment(exp);
      const s1 = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      expect(s1.totalRuns).toBe(1);

      await controller.reconcileExperiment({ ...exp, status: s1 } as ExperimentResource);
      const s2 = client.statusUpdates[client.statusUpdates.length - 1]!.status;

      await controller.reconcileExperiment({ ...exp, status: s2 } as ExperimentResource);
      const s3 = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      expect(s3.phase).toBe('Completed');
    });

    it('no-ops on terminal phases (idempotent reconciliation)', async () => {
      const client = createMockClient();
      const controller = new ExperimentController(null as any, client);

      for (const phase of ['Completed', 'Failed', 'Aborted'] as const) {
        const exp = makeExperiment({}, {
          phase,
          totalRuns: 10,
          completedRuns: 10,
          failedRuns: 0,
          actualCost: 20,
        });

        await controller.reconcileExperiment(exp);
        expect(client.statusUpdates).toHaveLength(0);
        expect(client.events).toHaveLength(0);
      }
    });
  });

  // =========================================================================
  // 2. Statistical Analysis Pipeline
  // =========================================================================

  describe('Statistical analysis pipeline', () => {
    it('detects significant winner across variants', () => {
      // Simulate experiment with clearly different variants
      const data: RunDataPoint[] = [];

      // "fast" variant — low duration
      for (let i = 0; i < 10; i++) {
        data.push({
          variantKey: 'topology=star, model=fast',
          metrics: { duration: 100 + Math.random() * 10, cost: 1.5 + Math.random() * 0.2 },
        });
      }

      // "slow" variant — high duration
      for (let i = 0; i < 10; i++) {
        data.push({
          variantKey: 'topology=hierarchy, model=slow',
          metrics: { duration: 500 + Math.random() * 10, cost: 5.0 + Math.random() * 0.2 },
        });
      }

      const result = analyzeExperiment(data, ['duration', 'cost']);

      // Duration analysis
      const durationMetric = result.metrics['duration']!;
      expect(durationMetric.best.variant).toBe('topology=star, model=fast');
      expect(durationMetric.best.significantlyBetter).toBe(true);
      expect(durationMetric.comparisons).toHaveLength(1);
      expect(durationMetric.comparisons[0]!.significant).toBe(true);
      expect(durationMetric.comparisons[0]!.pValue).toBeLessThan(0.001);

      // Cost analysis
      const costMetric = result.metrics['cost']!;
      expect(costMetric.best.variant).toBe('topology=star, model=fast');
      expect(costMetric.best.significantlyBetter).toBe(true);

      // Pareto front — fast variant dominates on both metrics
      expect(result.pareto.front.length).toBeGreaterThanOrEqual(1);
      const frontVariants = result.pareto.front.map(p => p.variant);
      expect(frontVariants).toContain('topology=star, model=fast');
    });

    it('multi-variant analysis with pareto front', () => {
      const data: RunDataPoint[] = [];

      // Variant A: fast but expensive (deterministic)
      for (const d of [50, 52, 51, 53, 50, 52, 51, 53]) {
        data.push({
          variantKey: 'fast-expensive',
          metrics: { duration: d, cost: 10 },
        });
      }

      // Variant B: slow but cheap (deterministic)
      for (const d of [200, 202, 201, 203, 200, 202, 201, 203]) {
        data.push({
          variantKey: 'slow-cheap',
          metrics: { duration: d, cost: 1 },
        });
      }

      // Variant C: dominated — slower than A AND more expensive than B
      for (const d of [210, 212, 211, 213, 210, 212, 211, 213]) {
        data.push({
          variantKey: 'dominated',
          metrics: { duration: d, cost: 11 },
        });
      }

      const result = analyzeExperiment(data, ['duration', 'cost']);

      // Should have 3 choose 2 = 3 pairwise comparisons per metric
      expect(result.metrics['duration']!.comparisons).toHaveLength(3);
      expect(result.metrics['cost']!.comparisons).toHaveLength(3);

      // Pareto front should exclude dominated variant
      const frontVariants = result.pareto.front.map(p => p.variant).sort();
      expect(frontVariants).toContain('fast-expensive');
      expect(frontVariants).toContain('slow-cheap');
      expect(frontVariants).not.toContain('dominated');
    });

    it('confidence intervals bracket the true mean', () => {
      // Seeded PRNG (mulberry32) so the test is deterministic
      let seed = 42;
      const rand = () => {
        seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };

      // Generate data with known mean around 100
      const data: RunDataPoint[] = [];
      for (let i = 0; i < 30; i++) {
        data.push({
          variantKey: 'control',
          metrics: { score: 100 + (rand() - 0.5) * 10 },
        });
      }

      const result = analyzeExperiment(data, ['score']);
      const ci = result.metrics['score']!.variants['control']!.ci95;
      expect(ci[0]).toBeLessThan(100);
      expect(ci[1]).toBeGreaterThan(100);
      expect(ci[1] - ci[0]).toBeLessThan(10); // CI should be narrow with 30 samples
    });
  });

  // =========================================================================
  // 3. Protocol-Enforced Cell Communication
  // =========================================================================

  describe('Protocol-enforced cell communication', () => {
    let bus: InMemoryBus;
    let runtime: InProcessRuntime;
    let enforcer: ProtocolEnforcer;

    beforeEach(() => {
      bus = new InMemoryBus();
      runtime = new InProcessRuntime(bus);
      enforcer = new ProtocolEnforcer();
      enforcer.registerProtocol(CONTRACT_PROTOCOL);
      enforcer.registerProtocol(DELIBERATION_PROTOCOL);
    });

    it('enforces contract protocol during cell-to-cell messaging', async () => {
      // Spawn requester and provider cells
      const requester = await runtime.spawn('architect', {});
      const provider = await runtime.spawn('developer', {});

      const messages: Envelope[] = [];
      bus.subscribe('cell.*.developer.inbox', (msg) => { messages.push(msg); });

      // Step 1: propose (valid)
      const r1 = enforcer.validateMessage('architect', 'developer', 'propose', 'contract');
      expect(r1.allowed).toBe(true);
      expect(r1.protocolState).toBe('proposed');

      if (r1.allowed) {
        const env = makeTestEnvelope('architect', 'developer', 'Please implement login API');
        await runtime.send(provider.id, env);
      }
      expect(messages).toHaveLength(1);

      // Step 2: accept (valid)
      const r2 = enforcer.validateMessage('architect', 'developer', 'accept', 'contract');
      expect(r2.allowed).toBe(true);
      expect(r2.protocolState).toBe('accepted');

      // Step 3: try to deliver before confirming (invalid!)
      const r3 = enforcer.validateMessage('architect', 'developer', 'deliver', 'contract');
      expect(r3.allowed).toBe(false);
      expect(r3.reason).toContain('does not allow');
      expect(r3.reason).toContain("'deliver'");

      // Step 4: confirm then deliver (valid sequence)
      const r4 = enforcer.validateMessage('architect', 'developer', 'confirm', 'contract');
      expect(r4.allowed).toBe(true);
      expect(r4.protocolState).toBe('executing');

      const r5 = enforcer.validateMessage('architect', 'developer', 'deliver', 'contract');
      expect(r5.allowed).toBe(true);
      expect(r5.protocolState).toBe('delivered');

      const r6 = enforcer.validateMessage('architect', 'developer', 'evaluate', 'contract');
      expect(r6.allowed).toBe(true);
      expect(r6.protocolState).toBe('evaluated');

      // Session should be complete now
      const session = enforcer.getSession('architect', 'developer');
      expect(session!.isComplete()).toBe(true);
      expect(session!.history).toHaveLength(5);

      await runtime.shutdown();
    });

    it('independent protocol sessions per cell pair', async () => {
      await runtime.spawn('alice', {});
      await runtime.spawn('bob', {});
      await runtime.spawn('charlie', {});
      await runtime.spawn('dave', {});

      // Alice → Bob: start contract
      const r1 = enforcer.validateMessage('alice', 'bob', 'propose', 'contract');
      expect(r1.allowed).toBe(true);

      // Charlie → Dave: independent contract session
      const r2 = enforcer.validateMessage('charlie', 'dave', 'propose', 'contract');
      expect(r2.allowed).toBe(true);

      // Alice → Bob session is in 'proposed' state
      const r3 = enforcer.validateMessage('alice', 'bob', 'accept', 'contract');
      expect(r3.allowed).toBe(true);

      // Charlie → Dave session is also in 'proposed' state — independent
      const r4 = enforcer.validateMessage('charlie', 'dave', 'reject', 'contract');
      expect(r4.allowed).toBe(true);

      expect(enforcer.getActiveSessions()).toHaveLength(1); // alice→bob (not terminal)
      // charlie→dave reached terminal 'rejected'

      await runtime.shutdown();
    });

    it('rejects messages for unknown protocols', async () => {
      const result = enforcer.validateMessage('a', 'b', 'start', 'nonexistent');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Unknown protocol');
    });

    it('starts new session after protocol completion', async () => {
      // Complete a contract: propose → reject
      enforcer.validateMessage('a', 'b', 'propose', 'contract');
      enforcer.validateMessage('a', 'b', 'reject', 'contract');

      // New session should start
      const r = enforcer.validateMessage('a', 'b', 'propose', 'contract');
      expect(r.allowed).toBe(true);
      expect(r.protocolState).toBe('proposed');
    });

    it('enforces deliberation protocol flow', async () => {
      // Full deliberation: propose → open_discussion → argue → call_vote → vote → resolve
      const steps: Array<{ trigger: string; expectedState: string }> = [
        { trigger: 'propose', expectedState: 'proposing' },
        { trigger: 'open_discussion', expectedState: 'discussing' },
        { trigger: 'argument', expectedState: 'discussing' },
        { trigger: 'argument', expectedState: 'discussing' },
        { trigger: 'call_vote', expectedState: 'voting' },
        { trigger: 'vote', expectedState: 'voting' },
        { trigger: 'vote', expectedState: 'voting' },
        { trigger: 'resolve', expectedState: 'resolved' },
      ];

      for (const step of steps) {
        const result = enforcer.validateMessage('facilitator', 'panel', step.trigger, 'deliberation');
        expect(result.allowed).toBe(true);
        expect(result.protocolState).toBe(step.expectedState);
      }

      // Session should be complete
      const session = enforcer.getSession('facilitator', 'panel');
      expect(session!.isComplete()).toBe(true);
      expect(session!.history).toHaveLength(8);
    });
  });

  // =========================================================================
  // 4. InProcessRuntime Multi-Cell Communication
  // =========================================================================

  describe('InProcessRuntime multi-cell communication', () => {
    let bus: InMemoryBus;
    let runtime: InProcessRuntime;

    beforeEach(() => {
      bus = new InMemoryBus();
      runtime = new InProcessRuntime(bus);
    });

    it('routes messages between cells via bus', async () => {
      const received: Envelope[] = [];
      bus.subscribe('cell.>', (msg) => { received.push(msg); });

      const architect = await runtime.spawn('architect', {});
      const developer = await runtime.spawn('developer', {});
      const reviewer = await runtime.spawn('reviewer', {});

      // Send messages to different cells
      await runtime.send(architect.id, makeTestEnvelope('user', 'architect', 'build login'));
      await runtime.send(developer.id, makeTestEnvelope('architect', 'developer', 'implement handler'));
      await runtime.send(reviewer.id, makeTestEnvelope('architect', 'reviewer', 'review PR'));

      expect(received).toHaveLength(3);
      expect(received.map(e => (e.payload as { content: string }).content).sort()).toEqual([
        'build login',
        'implement handler',
        'review PR',
      ]);

      expect(bus.getMessageCount()).toBe(3);
      await runtime.shutdown();
    });

    it('cell subscription is cleaned up on kill', async () => {
      const cell = await runtime.spawn('worker', {});
      expect(bus.getSubscriptionCount()).toBe(1);

      await runtime.kill(cell.id);
      expect(bus.getSubscriptionCount()).toBe(0);

      // Listing should reflect removal
      const cells = await runtime.list();
      expect(cells).toHaveLength(0);
    });

    it('shutdown cleans up all cells and subscriptions', async () => {
      await runtime.spawn('a', {});
      await runtime.spawn('b', {});
      await runtime.spawn('c', {});
      expect(bus.getSubscriptionCount()).toBe(3);

      await runtime.shutdown();
      expect(bus.getSubscriptionCount()).toBe(0);
      expect(await runtime.list()).toHaveLength(0);
    });

    it('throws when sending to non-existent cell', async () => {
      const env = makeTestEnvelope('a', 'b', 'hello');
      await expect(runtime.send('nonexistent', env)).rejects.toThrow('not found');
    });

    it('wildcard subscription receives messages for all cells', async () => {
      const allMessages: Envelope[] = [];
      bus.subscribe('cell.>', (msg) => { allMessages.push(msg); });

      const specificMessages: Envelope[] = [];
      bus.subscribe('cell.default.architect.inbox', (msg) => { specificMessages.push(msg); });

      const cell = await runtime.spawn('architect', {});
      await runtime.send(cell.id, makeTestEnvelope('user', 'architect', 'hello'));

      expect(allMessages).toHaveLength(1);
      expect(specificMessages).toHaveLength(1);

      await runtime.shutdown();
    });

    it('supports many cells communicating concurrently', async () => {
      const cellCount = 20;

      // Track all messages via a manual subscription
      let messageCount = 0;
      const tracker = bus.subscribe('cell.>', () => { messageCount++; });

      const cells = [];
      for (let i = 0; i < cellCount; i++) {
        const cell = await runtime.spawn(`worker-${i}`, {});
        cells.push(cell);
      }

      expect(await runtime.list()).toHaveLength(cellCount);
      // cellCount cell subscriptions + 1 tracker
      expect(bus.getSubscriptionCount()).toBe(cellCount + 1);

      // Send a message to each cell concurrently
      const sends = cells.map(cell =>
        runtime.send(cell.id, makeTestEnvelope('coordinator', cell.name, `task for ${cell.name}`))
      );
      await Promise.all(sends);

      expect(bus.getMessageCount()).toBe(cellCount);
      expect(messageCount).toBe(cellCount);

      // Clean up tracker, then shutdown
      tracker.unsubscribe();
      await runtime.shutdown();
      expect(bus.getSubscriptionCount()).toBe(0);
    });
  });

  // =========================================================================
  // 5. Combined: Experiment + Protocol + Runtime
  // =========================================================================

  describe('Combined experiment with protocol-enforced runtime', () => {
    it('simulates experiment where cells communicate via protocols', async () => {
      const bus = new InMemoryBus();
      const runtime = new InProcessRuntime(bus);
      const enforcer = new ProtocolEnforcer();
      enforcer.registerProtocol(CONTRACT_PROTOCOL);

      // Spawn cells for the experiment
      const architect = await runtime.spawn('architect', {});
      const developer = await runtime.spawn('developer', {});

      // Track delivered messages
      const delivered: Envelope[] = [];
      bus.subscribe('cell.default.developer.inbox', (msg) => { delivered.push(msg); });

      // Simulate a contract-based interaction
      const steps = [
        { trigger: 'propose', content: 'Implement user auth' },
        { trigger: 'accept', content: 'Accepted, starting work' },
        { trigger: 'confirm', content: 'Confirmed, proceeding' },
        { trigger: 'progress_update', content: '50% complete' },
        { trigger: 'deliver', content: 'Auth module delivered' },
        { trigger: 'evaluate', content: 'Looks good, approved' },
      ];

      for (const step of steps) {
        const validation = enforcer.validateMessage(
          'architect', 'developer', step.trigger, 'contract',
        );
        expect(validation.allowed).toBe(true);

        // Send the actual message through runtime
        await runtime.send(
          developer.id,
          makeTestEnvelope('architect', 'developer', step.content),
        );
      }

      // All 6 messages should have been delivered
      expect(delivered).toHaveLength(6);
      expect(bus.getMessageCount()).toBe(6);

      // Protocol should be in terminal state
      const session = enforcer.getSession('architect', 'developer');
      expect(session!.isComplete()).toBe(true);
      expect(session!.currentState).toBe('evaluated');

      // Now run analysis on the simulated experiment metrics
      const data: RunDataPoint[] = [
        { variantKey: 'contract-flow', metrics: { duration: 120, cost: 2.5 } },
        { variantKey: 'contract-flow', metrics: { duration: 115, cost: 2.3 } },
        { variantKey: 'contract-flow', metrics: { duration: 125, cost: 2.7 } },
        { variantKey: 'free-form', metrics: { duration: 180, cost: 3.5 } },
        { variantKey: 'free-form', metrics: { duration: 190, cost: 3.8 } },
        { variantKey: 'free-form', metrics: { duration: 170, cost: 3.2 } },
      ];

      const analysis = analyzeExperiment(data, ['duration', 'cost']);
      expect(analysis.metrics['duration']!.best.variant).toBe('contract-flow');
      expect(analysis.metrics['cost']!.best.variant).toBe('contract-flow');

      await runtime.shutdown();
    });

    it('experiment controller lifecycle produces valid analysis structure', async () => {
      const client = createMockClient();
      const controller = new ExperimentController(null as any, client);

      const exp = makeExperiment({
        variables: [
          { name: 'protocol', values: ['contract', 'free-form'] },
          { name: 'topology', values: ['star', 'hierarchy'] },
        ],
        repeats: 3,
        parallel: 20, // ensure all 12 runs complete in one cycle
        metrics: [{ name: 'duration', type: 'duration' as const }],
      });

      // Drive full lifecycle
      await controller.reconcileExperiment(exp);
      const s1 = client.statusUpdates[client.statusUpdates.length - 1]!.status;
      expect(s1.phase).toBe('Running');
      expect(s1.totalRuns).toBe(12); // 2 × 2 × 3

      await controller.reconcileExperiment({ ...exp, status: s1 } as ExperimentResource);
      const s2 = client.statusUpdates[client.statusUpdates.length - 1]!.status;

      await controller.reconcileExperiment({ ...exp, status: s2 } as ExperimentResource);
      const s3 = client.statusUpdates[client.statusUpdates.length - 1]!.status;

      expect(s3.phase).toBe('Completed');
      expect(s3.analysis).toBeDefined();
      expect(s3.analysis!.pareto).toBeDefined();
      expect(s3.analysis!.pareto.metrics).toEqual(['duration']);

      // Clean up
      controller.stop();
    });
  });
});
