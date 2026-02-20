# kAIs Roadmap — Deep Analysis & Optimized Plan

## 1. Abstraction Analysis

### 1.1 What works extremely well

**K8s-native mapping is brilliant.** The core abstractions map cleanly to K8s primitives:

| kAIs Concept | K8s Analog | Quality |
|---|---|---|
| Cell → Pod | Direct mapping, ownerReferences for lifecycle | Excellent |
| Formation → Deployment | Reconciliation loop, replica management | Excellent |
| Mission → Job | Completion criteria, retry logic | Excellent |
| Topology → NetworkPolicy | Subject-based routing via NATS | Excellent |
| Blueprint → Helm Chart | Parameterized templates with evidence | Excellent |
| Instinct → Operator | Event-driven CEL conditions → actions | Excellent |
| Ritual → CronJob | Cron schedule, concurrency policy | Excellent |
| Namespace → Realm | Isolation boundary, resource scoping | Natural |

**Budget-as-liquid model is the right abstraction.** Budget flowing down the tree with reclaim-on-death is both intuitive and mathematically sound. It naturally prevents runaway spawning without arbitrary depth limits.

**Additive migration between phases** — каждая фаза добавляет CRD + controller, ничего не ломает. Это правильно.

### 1.2 Contradictions and issues found

#### Issue 1: Graphiti is Python, project is TypeScript
Phase 4 proposes Graphiti for knowledge graph. Graphiti is a Python library. The project is TypeScript (pnpm workspaces, Turborepo, Vitest). Options:
- **Option A**: Knowledge Service Pod runs Python (Graphiti + FastAPI), Cell Pods remain TypeScript. Inter-process via NATS/gRPC. This is what Phase 4 describes — it works, but adds Python to the stack.
- **Option B**: Use Neo4j directly from TypeScript with `neo4j-driver` and implement temporal+embedding logic ourselves. More work, but single-language stack.
- **Recommendation**: Option A is fine. The Knowledge Service is an isolated microservice, not part of the core loop. Python dependency is contained.

#### Issue 2: Topology enforcement is client-side only
Phase 2 topology is enforced in cell-runtime, not at NATS level. A rogue Cell (or a bug) could publish directly to any NATS subject. For Phase 2 this is acceptable. But by Phase 8 (recursive ecosystems with arbitrary depth), this becomes a security concern.
- **Fix**: Phase 8 should add NATS authorization with per-Cell credentials that restrict which subjects each Cell can publish to. NATS supports this natively.

#### Issue 3: In-process mode shares NATS with production
Phase 3's in-process runtime connects worker_threads to the same NATS server. Experiment traffic could interfere with production.
- **Fix**: Use NATS accounts or separate JetStream domains for experiments. Or use InMemoryBus (already proposed) as default for experiments.

#### Issue 4: Missing explicit ContextAssembler
The layer map has ContextAssembler as a first-class component (Layer 4), but no phase defines it. Knowledge injection (Phase 4) does `buildCellContext()` which is part of context assembly, but it's ad-hoc. A proper ContextAssembler should:
- Manage working memory (sliding window of conversation)
- Inject relevant knowledge from KnowledgeStore
- Inject SelfModel awareness
- Apply epigenetic modifications
- Manage total token budget for context
- **Fix**: Add ContextAssembler as explicit module in cell-runtime, starting Phase 1 (simple) and growing through phases.

#### Issue 5: No explicit error model
The cross-cutting concern "Error Model (typed failures + recovery strategies)" isn't defined in any phase. Cells will fail. LLM calls will timeout. Tools will error. The system needs:
- Typed error hierarchy (TransientError, BudgetError, ToolError, LLMError, ProtocolViolation)
- Per-error recovery strategies (retry with backoff, switch model, escalate to parent, abort)
- **Fix**: Define error model in Phase 1 core types. It's foundational.

#### Issue 6: Working memory is implicit
No phase explicitly manages conversation history (working memory). LLM context windows are finite. With long-running Cells, the conversation will exceed context limits. Need:
- Sliding window with summarization
- Important message pinning
- Tool result compression
- **Fix**: Add WorkingMemoryManager to cell-runtime in Phase 1.

### 1.3 Achievability assessment

| Component | Achievability | Risk |
|---|---|---|
| Phase 1: Foundation | High | Standard K8s operator pattern |
| Phase 2: Formation + Mission | High | Extension of Phase 1 patterns |
| Phase 3: Experiments | High | Statistical analysis is well-understood |
| Phase 3: In-process mode | Medium | worker_threads + NATS coordination is tricky |
| Phase 3: Protocols | Medium | State machine enforcement adds complexity |
| Phase 4: Knowledge Graph | Medium | Graphiti integration needs Python service |
| Phase 4: Knowledge promotion | Medium-Low | LLM-based contradiction detection is fuzzy |
| Phase 5: Instinct (CEL) | High | CEL is well-documented, K8s uses it |
| Phase 5: Instinct (LLM judge) | Medium | LLM-as-condition needs careful rate limiting |
| Phase 5: Observability | High | Standard OTel stack |
| Phase 6: Evolution | Medium | GA is well-understood, but fitness evaluation is expensive |
| Phase 6: Swarm | Medium | Similar to K8s HPA, but LLM-specific metrics |
| Phase 7: Dashboard | High | Standard React app |
| Phase 7: ClickHouse | High | Standard analytics migration |
| Phase 7: Multi-node | Medium | NATS clustering works, but debugging is harder |
| Phase 8: Recursive | Medium | Budget tree + K8s ownerRef cascade works well |
| Phase 8: RBAC | High | Standard pattern |
| Phase 8: MCP Gateway | High | MCP SDK is mature |
| Phase 9: Human-as-Cell | Medium | Async human response loop needs careful UX |
| Phase 9: Marketplace | Medium | Package registry is well-understood |
| Phase 9: Federation | Medium-Low | Cross-cluster NATS needs careful ops |
| Phase 9: A2A | Medium | Protocol is new, spec may change |

**Overall: highly achievable.** The hardest parts are around LLM-powered automation (knowledge promotion, LLM judges in Instincts, SelfModel updates) — these are inherently fuzzy systems.

---

## 2. Biological Systems Gap Analysis

### What's missing from the roadmap

The user's architecture includes rich biological metaphors. Here's the coverage:

| Biological System | Status | What's Needed |
|---|---|---|
| **SelfModel** (meta-cognition) | ✗ MISSING | Cell tracks own strengths/weaknesses/biases. Local brain updates profile based on outcomes. Injected into every prompt. |
| **CognitiveModulation** | ✗ MISSING | Dynamic parameters: temperature (exploration↔exploitation), verification depth, delegation tendency, thoroughness. Adjusted by local brain based on task type + cognitive load. |
| **EpigeneticLayer** | ✗ MISSING | Environment-dependent prompt modification. "In production realm, be conservative. In experiment realm, be creative." Context modifies behavior without changing the genome (system prompt). |
| **Neuroplasticity** | ✗ MISSING | Tool pruning (remove tools Cell never uses), model selection optimization (track which model performs best for which task type), context window optimization. |
| **AttentionManager** | ✗ MISSING | When Cell has multiple pending messages, which to process first? Focus allocation across concurrent stimuli. |
| **Communication Adaptation** | ✗ MISSING | Cell maintains profiles of peers. Adapts message style to recipient. "developer-0 needs detailed specs, developer-1 works better with high-level goals." |
| **Apoptosis Check** | ◐ Partial via Instinct | Cell periodically self-evaluates: "Am I still contributing? Should I shut down?" Instinct can trigger externally, but self-initiated apoptosis isn't modeled. |
| **Circadian Rhythm** | ◐ Partial via Ritual | Active → light sleep (only process urgent messages) → deep sleep (consolidate memory, run self-reflection). Not just a cron schedule — it's a cell-internal state machine. |
| **Homeostasis** | ◐ Partial via Swarm | Internal feedback loops: if error rate ↑, increase verification. If cost ↑, switch to cheaper model. If latency ↑, simplify responses. Formation-level homeostasis (Swarm) exists, but cell-internal doesn't. |
| **Collective Immunity** | ✗ MISSING | When Cell A solves a problem (e.g., "how to handle CORS in Fastify"), the solution is cached and automatically available to Cell B facing the same problem. Different from Knowledge Graph — this is pattern-matched, not search-based. |
| **Observational Learning** | ✗ MISSING | Cell watches peer's traces and learns. "developer-0 always runs tests after each file — I should too." Emergent best practices. |
| **Topology Adaptation** (slime mold) | ✗ MISSING | Communication routes self-optimize. If architect↔developer-0 messages are 90% of traffic, strengthen that link. If reviewer↔developer-1 never communicate, prune that route. |
| **CommMetrics** | ✗ MISSING | Per-link metrics: messages_per_task, token_waste_ratio, information_propagation_delay, misunderstanding_rate, redundant_message_rate. Feeds into topology adaptation. |
| **Symbionts** (sidecars) | ✗ MISSING | Automatic sidecar processes: linter validates code before commit, type-checker runs in background, security scanner flags issues. Not LLM-based — lightweight, deterministic tools. |
| **PreThink / PostFilter** (local brain) | ✗ MISSING | Local brain (small/fast model like Ollama) pre-processes input before cloud brain and post-filters output. Saves cloud brain tokens, catches obvious errors. |
| **SimulationSandbox** | ✗ MISSING | Cell can dry-run actions before executing. "If I send this message, what's the likely outcome?" Uses cheap model to simulate. |
| **SubconsciousLoop** | ✗ MISSING | Background processing: periodically review pending tasks, consolidate learnings, update self-model. Not triggered by events — continuous low-priority loop. |

### Where to integrate biological systems

These systems naturally fit into the existing architecture:

**In cell-runtime (packages/cell-runtime):**
- SelfModel → stored in Postgres per Cell, injected into context by ContextAssembler
- CognitiveModulation → parameters in Cell spec, adjusted by local brain / Instinct
- EpigeneticLayer → realm-level config that modifies prompt generation
- AttentionManager → message prioritization in inbox processing loop
- PreThink/PostFilter → pipeline stages around Mind.think()
- WorkingMemory → conversation management with summarization
- SubconsciousLoop → background setInterval in cell-runtime
- Communication Adaptation → per-peer profiles stored locally
- Apoptosis → self-check before each idle period

**In operator (packages/operator):**
- Circadian Rhythm → Cell lifecycle state machine
- Homeostasis → feedback controller alongside Instinct
- Topology Adaptation → periodic topology optimization based on CommMetrics
- CommMetrics → collected from NATS message metadata

**As K8s resources:**
- Symbionts → sidecar containers defined in Cell Pod spec
- Collective Immunity → KV store in NATS or dedicated cache

---

## 3. Optimized Roadmap

### Key changes from original

1. **Observability moved to Phase 1** — you can't debug what you can't see
2. **ContextAssembler + WorkingMemory in Phase 1** — foundational for everything
3. **Error model defined in Phase 1** — errors will happen immediately
4. **Biological systems integrated incrementally** — not a separate phase, woven into existing phases
5. **SelfModel starts in Phase 3** — once we have enough data from experiments
6. **Phases restructured for testability** — each phase has explicit test categories
7. **Local brain (PreThink/PostFilter) in Phase 4** — after Mind abstraction is proven

### Dependency graph

```
Phase 1: Foundation
    │
    ├── Phase 2: Formation + Mission + Topology
    │       │
    │       ├── Phase 3: Experiments + Protocols + In-Process
    │       │       │
    │       │       ├── Phase 4: Knowledge + Blueprints + Local Brain
    │       │       │       │
    │       │       │       ├── Phase 5: Instinct + Ritual + Biological Core
    │       │       │       │       │
    │       │       │       │       ├── Phase 6: Evolution + Swarm + Adaptation
    │       │       │       │       │       │
    │       │       │       │       │       ├── Phase 7: Dashboard + ClickHouse + Multi-node
    │       │       │       │       │       │       │
    │       │       │       │       │       │       ├── Phase 8: Recursive + RBAC + MCP
    │       │       │       │       │       │       │       │
    │       │       │       │       │       │       │       └── Phase 9: Human + Marketplace + Federation
```

### Phase 1: Foundation (Enhanced)

**Added vs original:**
- ContextAssembler (basic) in cell-runtime
- WorkingMemoryManager in cell-runtime
- Error model (typed errors + basic retry)
- Basic OTel tracing in cell-runtime and operator (traces only, no Jaeger/Prometheus yet — write to stdout/NATS)
- Basic structured event logging to Postgres

**Modules:**
```
1.1  Project skeleton (pnpm, Turborepo, Vitest, Tilt)
1.2  Core types + error model (packages/core)
1.3  CRD definitions (crds/)
1.4  Infra Helm chart (Postgres, NATS, optional Ollama)
1.5  Mind abstraction (packages/mind) — Anthropic, OpenAI, Ollama
1.6  WorkingMemoryManager (packages/cell-runtime/memory)
1.7  ContextAssembler v1 (packages/cell-runtime/context)
1.8  Cell Runtime (packages/cell-runtime)
1.9  Operator — CellController (packages/operator)
1.10 API server (packages/api)
1.11 CLI (packages/cli)
```

**Tests:**
```
Unit:
  - Mind providers: mock LLM, verify tool extraction, token counting
  - WorkingMemory: sliding window, summarization trigger, message pinning
  - ContextAssembler: combines system prompt + working memory + injections
  - Error model: retry logic, error classification
  - CRD validation: Zod schemas match K8s OpenAPI schemas

Integration:
  - Cell runtime + NATS: send message → receive → process → respond
  - Cell runtime + Postgres: event logging, cost tracking
  - Operator + K8s: create Cell CRD → Pod appears → delete CRD → Pod removed
  - Mind + real LLM: basic think() with tool use (uses Ollama for CI)

E2E:
  - Full cycle: kais up → create cell → exec message → see logs → delete cell
  - Pod healing: delete pod → operator recreates
  - Cost tracking: LLM call → cost recorded in Postgres
```

**Deliverable:** `kais up && kais apply -f cell.yaml && kais exec researcher "hello"` works.

---

### Phase 2: Formation + Mission + Topology

**Same as original, no changes needed.** Well-designed.

**Tests:**
```
Unit:
  - Formation controller: replica management, rolling update logic
  - Mission controller: check evaluation, retry logic, timeout
  - Topology: route validation, protocol enforcement stubs
  - Budget allocation: parent → child, insufficient budget handling
  - spawn_cell: budget deduction, ownerReference generation

Integration:
  - Formation → creates Cells → creates Pods (3-layer cascade)
  - Mission → sends to entrypoint → runs checks → succeeds/fails
  - Topology enforcement: allowed route → message delivered, denied → error
  - Shared workspace: PVC created, files visible across Cell Pods
  - Cascading deletion: delete Formation → Cells gone → Pods gone

E2E:
  - Full workflow: formation.yaml + mission.yaml → team works → mission succeeds
  - Scale: kais scale formation --cell developer --replicas 3
  - Budget exhaustion: formation pauses when budget depleted
```

---

### Phase 3: Experiments + Protocols + In-Process Mode

**Added vs original:**
- CommMetrics collection (basic — message count, latency per link)
- Structured experiment results in NATS for later analysis

**Tests:**
```
Unit:
  - Experiment controller: variant matrix generation, cost estimation
  - Statistical analysis: t-test, CI, effect size, Pareto front
  - Protocol state machines: contract, deliberation, auction transitions
  - Protocol enforcer: valid/invalid message sequences
  - InProcessRuntime: worker_thread lifecycle
  - InMemoryBus: pub/sub, wildcard matching
  - Stigmergy: blackboard read/write, decay

Integration:
  - Experiment → generates runs → executes → collects metrics → analyzes
  - Protocol enforcement: formation with contract protocol, Cell follows sequence
  - In-process vs K8s: same experiment, both runtimes, similar results
  - Stigmergy blackboard: cells coordinate through shared blackboard

E2E:
  - Full experiment: define variants → estimate cost → run → get report with p-values
  - Protocol violation: Cell tries wrong message type → gets error → corrects
```

---

### Phase 4: Knowledge + Blueprints + Local Brain

**Added vs original:**
- **PreThink / PostFilter pipeline** — local brain (Ollama) pre-processes and validates
- **ContextAssembler v2** — now injects knowledge, not just working memory
- **Procedural memory** — "how to" knowledge stored as sequences, not just facts

**Local Brain architecture:**
```
Message arrives
    │
    ▼
PreThink (local Ollama, fast)
  - Classify message urgency
  - Extract key entities
  - Prepare structured input for cloud brain
  - Check if answer is in knowledge graph (skip cloud call)
    │
    ▼
Cloud Brain (Anthropic/OpenAI)
  - Full reasoning
  - Tool use
  - Response generation
    │
    ▼
PostFilter (local Ollama, fast)
  - Verify response doesn't contain hallucinations
  - Check response matches protocol expectations
  - Validate tool call parameters
  - Cost: ~$0 (local model)
    │
    ▼
Response sent
```

**Tests:**
```
Unit:
  - KnowledgeStore: addFact, search (semantic + keyword), invalidate
  - Knowledge promotion: 3+ missions → promote logic
  - Blueprint: parameter substitution, template rendering
  - Blueprint versioning: spec change detection
  - PreThink: urgency classification, entity extraction
  - PostFilter: hallucination check, protocol validation
  - ContextAssembler v2: knowledge injection, token budget management
  - Procedural memory: store sequence, recall by task similarity

Integration:
  - Knowledge service + Neo4j: fact CRUD, graph traversal, embedding search
  - Post-mission extraction: mission completes → facts extracted → stored
  - Blueprint instantiation: use blueprint → formation created → mission runs
  - Local brain pipeline: message → prethink → cloud → postfilter → response
  - Knowledge across missions: fact from mission 1 available in mission 2

E2E:
  - Knowledge accumulation: run 3 missions → knowledge grows → 4th mission faster
  - Blueprint from experiment: experiment → best variant → blueprint → use
  - PreThink skip: knowledge has answer → local brain returns it → no cloud call
```

---

### Phase 5: Instinct + Ritual + Biological Core

**Added vs original:**
- **SelfModel** — Cell tracks own performance, injected into context
- **CognitiveModulation** — adaptive parameters based on SelfModel
- **Apoptosis check** — Cell self-evaluates utility
- **SubconsciousLoop** — background processing in cell-runtime
- **Symbionts** — sidecar containers for linting/type-checking
- Full observability stack (Jaeger, Prometheus, Grafana) — moved here from original Phase 5

**SelfModel implementation:**
```typescript
// In cell-runtime, updated by SubconsciousLoop
interface SelfModel {
  strengths: string[];           // from successful task patterns
  weaknesses: string[];          // from failures and corrections
  biases: string[];              // detected by PostFilter
  optimal_task_types: string[];  // tasks with high success rate
  suboptimal_task_types: string[]; // tasks with low success rate
  current_cognitive_load: number;  // pending messages / max capacity
  estimated_reliability: number;   // rolling success rate
  peer_profiles: Map<string, PeerProfile>; // communication adaptation
}

// SubconsciousLoop runs every N minutes
async function subconsciousLoop() {
  // 1. Update SelfModel from recent outcomes
  const recentEvents = await store.getRecentEvents(this.cellId, '1h')
  this.selfModel = await updateSelfModel(this.selfModel, recentEvents)

  // 2. Apoptosis check
  if (this.selfModel.estimated_reliability < 0.3 && !this.hasPendingTasks) {
    await this.requestApoptosis("Low reliability, no pending tasks")
  }

  // 3. Consolidate learnings (remember important patterns)
  await this.consolidateMemory()

  // 4. Update cognitive modulation parameters
  this.cognitiveParams = modulateParameters(this.selfModel, this.taskContext)
}
```

**Tests:**
```
Unit:
  - Instinct: CEL expression evaluation, action execution
  - Instinct: LLM judge condition, rate limiting
  - Ritual: cron scheduling, concurrency policy, history retention
  - SelfModel: update from events, reliability calculation
  - CognitiveModulation: parameter adjustment logic
  - SubconsciousLoop: periodic execution, consolidation
  - Apoptosis: trigger conditions, graceful shutdown
  - CommMetrics: per-link metric collection and aggregation

Integration:
  - Instinct triggers: budget overrun → model switch
  - Instinct triggers: stuck detection → intervention message
  - Ritual execution: scheduled mission creation and execution
  - SelfModel injection: model sees own weaknesses in context
  - Symbiont sidecar: linter catches error before commit
  - Full OTel pipeline: cell event → collector → Jaeger trace visible

E2E:
  - Budget guardian: cell overspends → instinct switches model → cell continues
  - Daily ritual: cron fires → mission runs → report generated
  - SelfModel improvement: cell identifies weakness → compensates → better outcomes
  - Observability: run mission → see distributed trace across all cells
```

---

### Phase 6: Evolution + Swarm + Adaptation

**Added vs original:**
- **Topology Adaptation** — communication routes self-optimize based on CommMetrics
- **Neuroplasticity** — tool pruning, model selection optimization
- **EpigeneticLayer** — realm-level behavioral modification
- **Communication Adaptation** — peer profiles inform message style
- **Collective Immunity** — shared problem-solution cache

**Tests:**
```
Unit:
  - Evolution: GA operators (selection, crossover, mutation)
  - Evolution: fitness computation, multi-objective
  - Evolution: stopping criteria, gene importance analysis
  - Swarm: trigger evaluation, scaling decisions
  - Swarm: graceful drain, budget-aware scaling
  - Topology adaptation: CommMetrics → route weight adjustment
  - Neuroplasticity: tool usage tracking, pruning decision
  - EpigeneticLayer: realm config → prompt modification
  - Collective immunity: problem fingerprinting, solution cache lookup

Integration:
  - Evolution: seed → generations → improving fitness → best saved as blueprint
  - Swarm: queue depth increases → cells scale up → queue drains → scale down
  - Topology adaptation: high-traffic routes strengthened over time
  - Tool pruning: unused tool removed from cell's active set
  - Collective immunity: Cell A solves CORS → Cell B auto-gets solution

E2E:
  - Full evolution: 10 generations → best blueprint → use → mission succeeds
  - Autoscaling: load spike → swarm scales → load normalizes → scale down
```

---

### Phase 7: Dashboard + ClickHouse + Multi-node

**Same as original.** Well-designed.

**Tests:**
```
Unit:
  - Dashboard components: cell list, topology graph, mission timeline
  - ClickHouse schema: materialized views, TTL cleanup
  - Dashboard API endpoints: overview, topology data, timeline data

Integration:
  - Dual-write: event → Postgres + ClickHouse
  - Dashboard WebSocket: real-time event updates
  - ClickHouse analytics: cost trends, model latency, experiment comparison
  - Multi-node: NATS cluster, cell scheduling across nodes

E2E:
  - Dashboard: open browser → see platform overview → drill into mission trace
  - ClickHouse: query million-row analytics in <200ms
  - Multi-node: formation spans 2 nodes, cells communicate seamlessly
```

---

### Phase 8: Recursive + RBAC + MCP Gateway

**Added vs original:**
- NATS authorization (per-Cell credentials for topology enforcement at network level)

**Tests:**
```
Unit:
  - Recursive spawn: depth check, descendant limit, spawn policy
  - Budget ledger: allocate, spend, reclaim, tree balance
  - RBAC: role matching, namespace scoping, budget limits
  - MCP Gateway: tool registration, request routing
  - Spawn approval: queue, approve, reject workflow

Integration:
  - Recursive tree: project-lead → backend-team → developers (depth 3)
  - Budget cascade: parent exhausted → all children paused
  - RBAC enforcement: unauthorized user → 403
  - MCP: external LLM calls kais_launch_team → team runs → results returned
  - NATS auth: cell can only publish to allowed subjects

E2E:
  - Recursive ecosystem: blueprint spawns sub-teams → sub-teams work → mission completes
  - Budget management: tree visualization, top-up, reclaim
  - MCP: Claude Desktop delegates task to kAIs via MCP
```

---

### Phase 9: Human + Marketplace + Federation + A2A

**Same as original.** Well-designed.

**Tests:**
```
Unit:
  - HumanCellRuntime: message queuing, notification dispatch
  - Escalation: reminder, LLM fallback, skip
  - Marketplace: package format validation, security scan
  - Federation agent: heartbeat, capacity reporting
  - A2A Gateway: agent card serving, task routing
  - Channel: endpoint permissions, schema validation

Integration:
  - Human-as-Cell: message → notification → human response → cell receives
  - Marketplace: publish → install → use blueprint
  - Federation: cross-cluster cell scheduling via NATS Leafnode
  - A2A: external agent calls kAIs → mission created → results returned
  - Channels: cross-formation messaging with schema enforcement

E2E:
  - Hybrid team: human + AI cells collaborate, human gets Slack notifications
  - Marketplace: install popular blueprint → use → rate
  - Federation: formation spans 2 clusters, transparent to cells
```

---

## 4. Summary of changes from original roadmap

### Moved earlier:
- Basic OTel tracing → Phase 1 (was Phase 5)
- WorkingMemoryManager → Phase 1 (was implicit)
- ContextAssembler → Phase 1 (was Phase 4 implicit)
- Error model → Phase 1 (was missing)
- CommMetrics collection → Phase 3 (was missing)

### Added entirely:
- SelfModel → Phase 5
- CognitiveModulation → Phase 5
- PreThink/PostFilter (local brain) → Phase 4
- SubconsciousLoop → Phase 5
- Apoptosis check → Phase 5
- Symbionts (sidecars) → Phase 5
- Topology Adaptation → Phase 6
- Neuroplasticity → Phase 6
- EpigeneticLayer → Phase 6
- Communication Adaptation → Phase 6
- Collective Immunity → Phase 6
- NATS authorization → Phase 8
- Procedural memory → Phase 4

### Deferred to Phase 10+:
- gVisor/Kata sandbox runtime
- TrustGraph (reputation system)
- Voting/Negotiation as CRDs
- SimulationSandbox
- Observational Learning (mirror neurons)
- Priority-based messaging with interrupt semantics
- Snapshot/Rollback
- Graceful Handoff

### Not changed:
- Phase 2 (Formation + Mission + Topology) — already excellent
- Phase 7 (Dashboard + ClickHouse + Multi-node) — already excellent
- Phase 9 (Human + Marketplace + Federation + A2A) — already excellent

---

## 5. Risk factors

| Risk | Impact | Mitigation |
|---|---|---|
| LLM costs during development | High | Use Ollama for all tests, Sonnet only for E2E validation |
| Graphiti Python dependency | Medium | Isolate in Knowledge Service, keep interface clean |
| K8s operator complexity | Medium | Use well-tested operator frameworks, comprehensive integration tests |
| SelfModel accuracy | Medium | Start conservative (simple metrics), improve with data |
| Neo4j resource usage | Low | FalkorDB as lighter alternative, KnowledgeStore interface allows swap |
| NATS at scale | Low | NATS is battle-tested, clustering works well |
| Context window exhaustion | High | WorkingMemoryManager with summarization from Phase 1 |
| Test flakiness (LLM non-determinism) | Medium | Deterministic mocks for unit tests, tolerance ranges for integration |

---

## 6. Estimated effort per phase

| Phase | Modules | Estimated Opus sessions |
|---|---|---|
| Phase 1 | 11 modules | 8-12 sessions |
| Phase 2 | 6 modules | 6-10 sessions |
| Phase 3 | 7 modules | 10-14 sessions |
| Phase 4 | 7 modules | 10-14 sessions |
| Phase 5 | 10 modules | 10-14 sessions |
| Phase 6 | 8 modules | 10-14 sessions |
| Phase 7 | 5 modules | 12-16 sessions |
| Phase 8 | 7 modules | 12-16 sessions |
| Phase 9 | 8 modules | 16-20 sessions |

Total: ~94-130 focused coding sessions.
