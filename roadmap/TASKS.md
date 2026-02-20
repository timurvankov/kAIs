# kAIs — Task Decomposition & Parallel Execution Plan

## Architectural Clarification: Orchestrator vs Cell-Runtime Image

```
┌─────────────────────────────────────────────────────────────┐
│  kAIs ORCHESTRATOR (K8s-level)                              │
│                                                             │
│  Responsibilities:                                          │
│  - CRDs: Cell, Formation, Mission, Experiment, Blueprint,   │
│    Instinct, Ritual, Evolution, Swarm, Channel              │
│  - Operator: reconciliation loops, Pod lifecycle            │
│  - Infrastructure: NATS, Postgres, Neo4j, ClickHouse        │
│  - Topology enforcement (NATS subject routing)              │
│  - Budget management (ledger, allocation, exhaustion)       │
│  - API server (REST/WS)                                     │
│  - CLI (thin kubectl wrapper)                               │
│  - Dashboard (React web app)                                │
│  - MCP Gateway, A2A Gateway                                 │
│                                                             │
│  The orchestrator DOES NOT know how the Cell thinks.        │
│  It configures: systemPrompt, tools, model, budget.         │
│  The image does the rest.                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  CELL-RUNTIME IMAGE (inside Pod)                            │
│                                                             │
│  This IS the agent. The image controls:                     │
│  - Mind abstraction (LLM calls, streaming, tool handling)   │
│  - WorkingMemory (sliding window, summarization)            │
│  - ContextAssembler (memory + knowledge + self → prompt)    │
│  - PreThink / PostFilter (local brain pipeline)             │
│  - SelfModel (meta-cognition, updated from outcomes)        │
│  - CognitiveModulation (dynamic parameter tuning)           │
│  - SubconsciousLoop (background processing, consolidation)  │
│  - AttentionManager (inbox message prioritization)          │
│  - Communication Adaptation (peer profiles)                 │
│  - Apoptosis self-check                                     │
│  - Error handling + recovery strategies                     │
│  - Tool execution                                           │
│  - NATS message loop (inbox/outbox)                         │
│  - Protocol enforcement (state machines)                    │
│  - Metrics emission (OTel)                                  │
│                                                             │
│  Configured via CRD spec (environment vars, config maps).   │
│  Orchestrator just passes config; image decides behavior.   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SEPARATE SERVICES (distinct deployments)                   │
│                                                             │
│  - Knowledge Service (Python + Graphiti + Neo4j adapter)    │
│  - Dashboard (React + nginx)                                │
│  - Experiment Runner (worker_threads, in-process cells)     │
│  - MCP Gateway (MCP SSE server)                             │
│  - A2A Gateway (A2A JSON-RPC server)                        │
│  - Federation Agent (per worker cluster)                    │
└─────────────────────────────────────────────────────────────┘
```

**Key insight**: Memory, dual-brain, self-model, cognitive modulation — these are all
IMAGE-internal. The orchestrator provides infrastructure (Postgres for persistence, NATS
for messaging) but the cell-runtime image decides how to use them. From the orchestrator
CRD perspective, these appear as optional configuration:

```yaml
spec:
  mind:
    provider: anthropic
    model: claude-sonnet-4-20250514
    systemPrompt: "..."
    temperature: 0.3
    # Cell-runtime image reads these as feature flags:
    localBrain:
      enabled: true
      provider: ollama
      model: qwen2.5:7b
      preThink: true
      postFilter: true
    selfModel:
      enabled: true
    cognitiveModulation:
      enabled: true
    workingMemory:
      maxMessages: 100
      summarizeAfter: 50
```

The orchestrator doesn't implement these — it passes the config. The cell-runtime image
implements the behavior.

---

## Missing Components Added to Phases

### Phase 1 Additions
```
ORCHESTRATOR:
  + Error model types (packages/core/errors.ts)
  + Basic structured event logging to NATS (for later consumption)

CELL-RUNTIME IMAGE:
  + WorkingMemoryManager (sliding window, summarization trigger)
  + ContextAssembler v1 (system prompt + working memory + tool results)
  + Error handling with typed errors + retry logic
  + Basic OTel trace emission (trace IDs in NATS headers)
```

### Phase 2 Additions
```
(No additions — Phase 2 is already well-designed)
```

### Phase 3 Additions
```
ORCHESTRATOR:
  + CommMetrics collection (message count, latency per link — from NATS metadata)

CELL-RUNTIME IMAGE:
  + AttentionManager v1 (message priority queue in inbox processing)
```

### Phase 4 Additions
```
CELL-RUNTIME IMAGE:
  + PreThink pipeline (local Ollama classifies urgency, extracts entities)
  + PostFilter pipeline (local Ollama validates response, checks hallucination)
  + ContextAssembler v2 (adds knowledge injection, token budget management)
  + Procedural memory storage (task→steps sequences via Knowledge Service)
```

### Phase 5 Additions
```
CELL-RUNTIME IMAGE:
  + SelfModel (profile: strengths, weaknesses, biases, cognitive_load, reliability)
  + CognitiveModulation (temperature, verification, delegation, thoroughness)
  + SubconsciousLoop (periodic background: update self-model, consolidate, apoptosis check)
  + Apoptosis self-check ("am I still useful?")
  + Communication Adaptation v1 (peer profiles, message style tracking)

ORCHESTRATOR:
  + Symbiont sidecar support in Cell Pod spec (linter, type-checker, security-scanner)
  + Full OTel pipeline (Collector, Jaeger, Prometheus, Grafana)
```

### Phase 6 Additions
```
ORCHESTRATOR:
  + Topology Adaptation controller (CommMetrics → route weight adjustment)
  + Collective Immunity store (NATS KV: problem→solution cache)

CELL-RUNTIME IMAGE:
  + Neuroplasticity — tool usage tracking, pruning unused tools
  + Neuroplasticity — model performance tracking per task type
  + EpigeneticLayer — realm-level config modifies prompt generation
  + Communication Adaptation v2 — adapt message style to peer profiles
  + Collective Immunity client — check/contribute problem→solution pairs
```

### Phase 7 Additions
```
(No additions — Phase 7 is already well-designed)
```

### Phase 8 Additions
```
ORCHESTRATOR:
  + NATS authorization (per-Cell credentials restricting pub/sub subjects)
  + Audit log (append-only compliance log from NATS events)
```

### Phase 9 Additions
```
(No additions — Phase 9 is already well-designed)
```

### Deferred to Phase 10+
```
  - gVisor / Kata sandbox runtime
  - TrustGraph (reputation system)
  - Voting / Negotiation as CRDs
  - SimulationSandbox (dry-run actions)
  - Observational Learning (mirror neurons)
  - Priority-based messaging with interrupt semantics
  - Snapshot / Rollback
  - Graceful Handoff (state transfer between cells)
  - Circadian Rhythm as cell-level state machine (beyond Ritual)
  - Artifact CRD (versioned with lifecycle)
```

---

## Task Decomposition by Phase

### Legend
```
[orch]     = Operator / K8s / Infrastructure
[runtime]  = Cell-runtime image (inside Pod)
[service]  = Separate service deployment
[cli]      = CLI package
[api]      = API server
[dash]     = Dashboard (React)
[test]     = Tests
[infra]    = Helm / K8s manifests
```

---

## Phase 1: Foundation

### Parallel Streams

```
Stream A: Project skeleton + Core types + CRDs
Stream B: Mind abstraction + Cell-runtime
Stream C: Infra Helm + Operator
Stream D: API + CLI
```

### Tasks

```
STREAM A (can start immediately):
  A1 [orch]    Project skeleton (pnpm, Turborepo, Vitest, Tiltfile, Dockerfiles)
  A2 [orch]    Core types + error model (packages/core)
                - CellSpec, MindSpec, ToolSpec, Envelope types
                - Typed errors: TransientError, BudgetError, ToolError, LLMError
                - Retry strategies: exponential backoff, circuit breaker
                - Zod schemas for CRD validation
  A3 [orch]    CRD YAML definitions (crds/cell-crd.yaml)
                - Cell CRD with OpenAPI v3 schema
                - Printer columns (Status, Model, Cost, Age)
                - Status subresource

  TEST-A [test] Unit tests for core types, Zod schema validation

STREAM B (depends on A2 for types):
  B1 [runtime] Mind abstraction (packages/mind)
                - Mind interface: think(input): ThinkOutput
                - AnthropicMind (tool_use blocks, streaming)
                - OllamaMind (local models via HTTP)
                - OpenAIMind (compatible API)
                - Token counting, cost calculation
                - MockMind (for tests)
  B2 [runtime] WorkingMemoryManager (packages/cell-runtime/memory)
                - Sliding window over conversation messages
                - Summarization trigger (when window > threshold)
                - Message pinning (important messages stay)
                - Tool result compression
  B3 [runtime] ContextAssembler v1 (packages/cell-runtime/context)
                - Combines: system prompt + working memory + injections
                - Token budget management (fit within model context)
                - Placeholder for future: knowledge, self-model
  B4 [runtime] Cell-runtime main loop (packages/cell-runtime)
                - NATS connection, inbox subscription
                - Message → ContextAssembler → Mind.think() → tool execution → response
                - Structured event logging to NATS
                - Cost tracking, budget enforcement
                - Graceful shutdown on SIGTERM
                - Basic OTel trace emission
  B5 [runtime] Built-in tools
                - send_message, read_file, write_file, bash, web_search
                - Tool executor with error handling

  TEST-B [test] Unit: Mind providers (mock LLM), WorkingMemory, ContextAssembler
                Integration: cell-runtime + NATS message loop

STREAM C (depends on A2, A3):
  C1 [infra]   Infra Helm chart (Postgres, NATS, optional Ollama)
                - helmfile.yaml with bitnami/postgresql, nats/nats
                - DB init SQL (cell_events table, etc.)
  C2 [orch]    Operator CellController (packages/operator)
                - Watch Cell CRDs
                - Reconcile: create/update/delete Pods
                - ownerReferences for cascade
                - Status sync (cost, tokens, lastActive)
                - K8s Event emission
  C3 [orch]    Pod template builder
                - Build Cell Pod spec from CRD
                - Mount secrets (LLM credentials)
                - Resource limits from CRD spec

  TEST-C [test] Integration: operator creates Pod from Cell CRD
                Integration: Pod healing (delete pod → recreated)

STREAM D (depends on B4, C2):
  D1 [api]     API server (packages/api)
                - Fastify server
                - POST /cells/:name/exec (NATS publish)
                - GET /cells/:name/logs (Postgres query)
                - WS /cells/:name/attach (bidirectional NATS)
                - GET /cells/:name/usage (stats)
  D2 [cli]     CLI (packages/cli)
                - kais apply/get/describe/delete → kubectl passthrough
                - kais exec/logs/attach/usage → API calls
                - kais init/up/down (setup helpers)

  TEST-D [test] E2E: kais up → create cell → exec → see logs → delete

DELIVERABLE: `kais up && kais apply -f cell.yaml && kais exec researcher "hello"` works
```

**Parallelism:** Streams A, B, C can run concurrently (3 agents). D depends on B+C.

---

## Phase 2: Formation + Mission + Topology

### Tasks

```
STREAM A (CRDs + Operator):
  A1 [orch]    Formation CRD YAML + Zod types
  A2 [orch]    Mission CRD YAML + Zod types
  A3 [orch]    FormationController
                - Reconcile: create/update/delete Cells for each template
                - Budget allocation (percentage or absolute)
                - Aggregate status (readyCells, totalCost)
  A4 [orch]    MissionController
                - Send objective to entrypoint Cell
                - Run completion checks (fileExists, command, coverage)
                - LLM-based review (forward to reviewer Cell)
                - Retry logic, timeout handling
                - Mission lifecycle (Pending → Running → Succeeded/Failed)
  A5 [orch]    Shared workspace PVC provisioning
                - PVC per Formation, ReadWriteMany
                - Mount: /workspace/shared + /workspace/private/{cellName}

STREAM B (Cell-runtime additions):
  B1 [runtime] Topology enforcement in cell-runtime
                - Load routes.json from ConfigMap
                - Validate send_message against routes
                - Error message on topology violation
  B2 [runtime] spawn_cell tool
                - Budget deduction from parent
                - Create Cell CRD via K8s API
                - ownerReferences → parent Cell
  B3 [runtime] commit_file tool (shared workspace)
                - Copy from private/ to shared/ area

STREAM C (CLI):
  C1 [cli]     Formation commands (apply, get, describe, scale, delete)
  C2 [cli]     Mission commands (apply, status, retry, abort)
  C3 [cli]     Topology commands (show — ASCII graph)

TESTS:
  T1 [test]    Unit: FormationController reconciliation logic
  T2 [test]    Unit: MissionController check evaluation, retry
  T3 [test]    Unit: Topology route validation
  T4 [test]    Integration: Formation → Cells → Pods cascade
  T5 [test]    Integration: Mission lifecycle end-to-end
  T6 [test]    E2E: formation.yaml + mission.yaml → team works → mission succeeds

DELIVERABLE: Code review team Formation runs, Mission succeeds, topology enforced
```

**Parallelism:** A (3 agents: CRDs, controllers, workspace) + B (1 agent) + C (1 agent)

---

## Phase 3: Experiments + Protocols + In-Process

### Tasks

```
STREAM A (Experiment Engine):
  A1 [orch]    Experiment CRD + Zod types
  A2 [orch]    ExperimentController
                - Variant matrix generation (cartesian product)
                - Cost estimation before launch
                - Run scheduling with parallelism limit
                - Budget tracking, abort on overbudget
  A3 [orch]    Statistical analysis module
                - t-test, confidence intervals, effect size (Cohen's d)
                - Pareto front computation
                - LLM-generated summary
                - `simple-statistics` npm package
  A4 [orch]    Experiment runner Pod template

STREAM B (Protocol System):
  B1 [runtime] Protocol definitions (contract, deliberation, auction, gossip)
                - State machine interfaces
                - Transition rules, guards
  B2 [runtime] ProtocolEnforcer in cell-runtime
                - Session tracking per link
                - Message validation against current state
                - Error message with allowed transitions
  B3 [runtime] Stigmergy tools (post_to_blackboard, read_blackboard)
                - NATS KV backed blackboard
                - TTL decay on entries
  B4 [runtime] AttentionManager v1
                - Priority queue for inbox messages
                - Urgency detection (budget alerts, stuck signals)

STREAM C (In-Process Runtime):
  C1 [orch]    InProcessRuntime (worker_threads)
                - CellRuntime interface (spawn, kill, send)
                - Worker thread lifecycle
  C2 [orch]    InMemoryBus (optional, for fast experiments)
                - pub/sub with wildcard matching
                - Direct function calls, no network
  C3 [orch]    CommMetrics collection
                - Message count per link
                - Latency per link
                - Store in NATS or Postgres

STREAM D (CLI):
  D1 [cli]     Experiment commands (run, status, results, abort, cost-estimate)
  D2 [cli]     Protocol commands (list, sessions, trace)

TESTS:
  T1 [test]    Unit: variant matrix, cost estimation, statistical analysis
  T2 [test]    Unit: protocol state machines, transition validation
  T3 [test]    Unit: InMemoryBus pub/sub, wildcard matching
  T4 [test]    Integration: Experiment → runs → analysis → report
  T5 [test]    Integration: Protocol enforcement (valid/invalid sequences)
  T6 [test]    E2E: Full experiment lifecycle with report

DELIVERABLE: Run experiment comparing topologies, get statistical report
```

**Parallelism:** A + B + C (3 agents), then D

---

## Phase 4: Knowledge + Blueprints + Local Brain

### Tasks

```
STREAM A (Knowledge Service — Python):
  A1 [service] Knowledge Service skeleton (Python + FastAPI)
                - Dockerfile, Helm chart
                - gRPC or NATS-based interface
  A2 [service] GraphitiAdapter (implements KnowledgeStore)
                - addFact, search (semantic + keyword), invalidate
                - Embedding generation
                - Temporal model (valid_from/valid_until)
  A3 [service] Neo4j Helm chart integration
                - Connection pooling
                - Index creation
  A4 [service] Ingestion pipeline
                - Post-mission extraction (LLM-based)
                - Post-experiment extraction
                - Batched processing queue

STREAM B (Blueprint System):
  B1 [orch]    Blueprint CRD + Zod types
  B2 [orch]    BlueprintController
                - Parameter substitution (Jinja-like templates)
                - Version tracking
                - Usage stats from missions
  B3 [orch]    Blueprint-from-experiment command
  B4 [orch]    Blueprint-from-formation command

STREAM C (Cell-Runtime — Local Brain):
  C1 [runtime] PreThink pipeline stage
                - Local Ollama classifies message urgency
                - Entity extraction for knowledge lookup
                - Check if knowledge has answer (skip cloud call)
  C2 [runtime] PostFilter pipeline stage
                - Local Ollama validates response
                - Protocol compliance check
                - Hallucination detection heuristics
  C3 [runtime] ContextAssembler v2
                - Knowledge injection (call Knowledge Service)
                - Token budget management across sources
                - Relevance scoring for injected knowledge
  C4 [runtime] Knowledge tools in cell-runtime
                - remember → Knowledge Service
                - recall → Knowledge Service
                - correct → Knowledge Service
  C5 [runtime] Procedural memory client
                - Store task→steps sequences
                - Recall by task similarity

STREAM D (CLI + DB):
  D1 [cli]     Knowledge commands (search, list, add, invalidate, stats, promote)
  D2 [cli]     Blueprint commands (list, describe, use, create-from-*)
  D3 [infra]   Postgres pgvector extension + schema additions
  D4 [infra]   DB migration scripts

TESTS:
  T1 [test]    Unit: Knowledge search, fact lifecycle
  T2 [test]    Unit: Blueprint parameter substitution, versioning
  T3 [test]    Unit: PreThink classification, PostFilter validation
  T4 [test]    Integration: Knowledge Service + Neo4j CRUD
  T5 [test]    Integration: Post-mission extraction → facts stored
  T6 [test]    Integration: Local brain pipeline (prethink → cloud → postfilter)
  T7 [test]    E2E: 3 missions → knowledge accumulates → 4th mission faster

DELIVERABLE: Knowledge accumulates, blueprints work, local brain pre/post-processes
```

**Parallelism:** A + B + C (3 agents), then D

---

## Phase 5: Instinct + Ritual + Biological Core

### Tasks

```
STREAM A (Instinct System):
  A1 [orch]    Instinct CRD + Zod types
  A2 [orch]    InstinctController
                - CEL expression evaluator
                - Event buffer + trigger matching
                - Action execution (switch_model, send_message, pause, notify)
                - Rate limiting for LLM judge conditions
  A3 [orch]    Built-in Instincts (budget-guardian, health-monitor, knowledge-hygiene)

STREAM B (Ritual System):
  B1 [orch]    Ritual CRD + Zod types
  B2 [orch]    RitualController
                - Cron scheduling
                - Concurrency policy (Forbid, Replace)
                - History retention
                - Action types: mission, message, knowledge_maintenance

STREAM C (Cell-Runtime — Biological Systems):
  C1 [runtime] SelfModel
                - Profile: strengths[], weaknesses[], biases[], blind_spots[]
                - optimal_task_types[], suboptimal_task_types[]
                - current_cognitive_load, estimated_reliability
                - Stored in Postgres per Cell
                - formatSelfAwareness() → injected into context by ContextAssembler
  C2 [runtime] CognitiveModulation
                - Parameters: temperature, verification_depth, delegation_tendency,
                  thoroughness
                - Adjusted by SubconsciousLoop based on SelfModel + task context
                - Applied to Mind.think() calls
  C3 [runtime] SubconsciousLoop
                - Runs every N minutes in background
                - Updates SelfModel from recent outcomes
                - Apoptosis check (if reliability < threshold && no pending tasks)
                - Memory consolidation (summarize, forget low-value)
                - Peer profile updates
  C4 [runtime] Communication Adaptation v1
                - Per-peer profiles (stored locally)
                - Track: response style, preferred detail level, common misunderstandings
                - Inject peer context into messages
  C5 [runtime] Apoptosis self-check
                - Evaluate: am I contributing? How long since last useful output?
                - Request graceful shutdown if not useful
                - Notify parent before dying

STREAM D (Observability):
  D1 [infra]   OTel Collector Helm chart
  D2 [infra]   Jaeger Helm chart (trace storage)
  D3 [infra]   Prometheus Helm chart (metrics scraping)
  D4 [infra]   Grafana Helm chart + pre-built dashboards
  D5 [runtime] OTel SDK integration in cell-runtime
                - Trace propagation via NATS headers
                - LLM call spans with token/cost attributes
                - Tool call spans
  D6 [orch]    OTel SDK integration in operator
  D7 [orch]    Prometheus metrics endpoint in operator

STREAM E (Symbionts):
  E1 [orch]    Symbiont sidecar support in Pod template
                - Cell CRD spec: sidecars[] field
                - Operator injects sidecar containers into Cell Pod
                - Built-in sidecars: eslint, tsc, safety-scanner
                - Sidecar results available as tools or pre-commit hooks

STREAM F (CLI):
  F1 [cli]     Instinct commands (list, describe, create, disable, history, test)
  F2 [cli]     Ritual commands (list, describe, create, trigger, suspend, history)
  F3 [cli]     Observability commands (trace, metrics, dashboard, logs --trace-id)

TESTS:
  T1 [test]    Unit: CEL expression evaluation, Instinct rule matching
  T2 [test]    Unit: Ritual cron scheduling, concurrency
  T3 [test]    Unit: SelfModel update logic, reliability calculation
  T4 [test]    Unit: CognitiveModulation parameter adjustment
  T5 [test]    Integration: Instinct triggers on budget overrun → model switch
  T6 [test]    Integration: Ritual creates Mission on schedule
  T7 [test]    Integration: OTel traces visible in Jaeger
  T8 [test]    Integration: SelfModel updates from outcomes, injected into context
  T9 [test]    E2E: Budget guardian saves money, daily ritual runs

DELIVERABLE: Instincts react, Rituals schedule, SelfModel tracks performance,
             full observability stack running
```

**Parallelism:** A + B + C + D + E (5 agents!)

---

## Phase 6: Evolution + Swarm + Adaptation

### Tasks

```
STREAM A (Evolution):
  A1 [orch]    Evolution CRD + Zod types
  A2 [orch]    EvolutionController
                - GA: selection (tournament/roulette/rank)
                - Crossover (uniform, single_point, two_point)
                - Mutation (per-gene rates, type-aware)
                - Elitism
                - Stopping criteria (stagnation, fitness threshold, budget)
  A3 [orch]    Fitness evaluation (reuses Experiment runner)
  A4 [orch]    Gene importance analysis (ANOVA-style)
  A5 [orch]    Blueprint creation from best individual

STREAM B (Swarm Autoscaler):
  B1 [orch]    Swarm CRD + Zod types
  B2 [orch]    SwarmController
                - Trigger evaluation (queue_depth, metric, budget_efficiency, schedule)
                - Scaling behavior (stabilization, step, cooldown)
                - Budget-aware scaling
                - Graceful drain signal
  B3 [runtime] Drain signal handling in cell-runtime
                - Reject new messages when draining
                - Finish current task, then shutdown

STREAM C (Adaptation Systems):
  C1 [orch]    Topology Adaptation controller
                - Read CommMetrics from Phase 3
                - Adjust route weights based on traffic patterns
                - Prune unused routes, strengthen high-traffic ones
  C2 [orch]    Collective Immunity store
                - NATS KV bucket: problem_fingerprint → solution
                - Cell-runtime tool: check_immunity, contribute_immunity
  C3 [runtime] Neuroplasticity — tool tracking
                - Track tool usage frequency and success rate per Cell
                - Prune tools unused in last N tasks (remove from active set)
                - Report to SubconsciousLoop for SelfModel update
  C4 [runtime] Neuroplasticity — model performance tracking
                - Track success rate per model per task type
                - Suggest model switch when pattern detected
  C5 [runtime] EpigeneticLayer
                - Realm-level config that modifies prompt generation
                - "In production: be conservative. In experiments: be creative."
                - Time-of-day modifiers (optional)
  C6 [runtime] Communication Adaptation v2
                - Full peer profiles with style preferences
                - Message formatting adapted to receiver
  C7 [runtime] Collective Immunity client
                - Before starting task: check if solution exists
                - After solving: contribute fingerprint + solution

STREAM D (CLI + Misc):
  D1 [cli]     Evolution commands (run, status, results, gene-importance, cost-estimate)
  D2 [cli]     Swarm commands (list, describe, status, history, pause)
  D3 [orch]    Blueprint suggestion (semantic search over blueprints for missions)

TESTS:
  T1 [test]    Unit: GA operators, fitness computation, gene importance
  T2 [test]    Unit: Swarm trigger evaluation, scaling decisions
  T3 [test]    Unit: Topology adaptation logic
  T4 [test]    Unit: Neuroplasticity tool pruning
  T5 [test]    Integration: Evolution runs generations, fitness improves
  T6 [test]    Integration: Swarm scales up/down based on queue depth
  T7 [test]    Integration: Collective immunity cache hit
  T8 [test]    E2E: Full evolution → best blueprint created

DELIVERABLE: Evolution optimizes blueprints, Swarm autoscales, adaptation systems active
```

**Parallelism:** A + B + C (3 agents), then D

---

## Phase 7: Dashboard + ClickHouse + Multi-node

### Tasks

```
STREAM A (Dashboard):
  A1 [dash]    Dashboard skeleton (React, Vite, Tailwind, shadcn/ui, TanStack)
  A2 [dash]    Platform Overview page (cell count, cost, recent activity)
  A3 [dash]    Cell list + detail page (logs, metrics, knowledge)
  A4 [dash]    Formation detail page (topology D3.js graph, cell status)
  A5 [dash]    Mission timeline page (Gantt chart, checks, cost breakdown)
  A6 [dash]    Experiment results page (charts, comparisons)
  A7 [dash]    Evolution progress page (fitness curve, gene importance, scatter)
  A8 [dash]    Blueprint catalog page (parameters, usage stats)
  A9 [dash]    Knowledge graph explorer (D3.js graph + fact list)
  A10 [dash]   Instinct/Ritual management pages
  A11 [dash]   Settings page (credentials, budgets)
  A12 [dash]   Dashboard Deployment + Service YAML

STREAM B (ClickHouse):
  B1 [infra]   ClickHouse Helm chart
  B2 [orch]    ClickHouse schema (cell_events, experiment_traces, materialized views)
  B3 [orch]    Dual-write consumer (NATS → Postgres + ClickHouse)
  B4 [orch]    Postgres cleanup Ritual (TTL 7 days for events)
  B5 [api]     API endpoints for dashboard (overview, topology, timeline, fitness)

STREAM C (Multi-node):
  C1 [infra]   NATS clustering configuration
  C2 [infra]   Multi-node minikube setup guide
  C3 [orch]    Node affinity in Pod template builder
  C4 [cli]     Node management commands (list, drain, cordon)

TESTS:
  T1 [test]    Unit: Dashboard components (render tests)
  T2 [test]    Integration: Dual-write consistency
  T3 [test]    Integration: ClickHouse analytics queries
  T4 [test]    Integration: Dashboard WebSocket real-time updates
  T5 [test]    E2E: Dashboard shows running formation, topology graph interactive

DELIVERABLE: Visual dashboard, ClickHouse analytics, multi-node support
```

**Parallelism:** A + B + C (3 agents). Dashboard pages (A2-A11) can be parallelized further (4-5 agents on pages).

---

## Phase 8: Recursive + RBAC + MCP Gateway

### Tasks

```
STREAM A (Recursive Ecosystems):
  A1 [orch]    Cell CRD recursion fields (maxDepth, maxDescendants, spawnPolicy)
  A2 [orch]    Recursion safety in operator (depth check, descendant count, platform limit)
  A3 [orch]    Budget ledger system
                - Postgres tables (budget_ledger, budget_balances)
                - BudgetLedger service (allocate, spend, reclaim, getTree)
                - Cascading pause on exhaustion
  A4 [orch]    Cell tree tracking (cell_tree table, materialized path)
  A5 [runtime] spawn_cell tool v2 (canSpawnChildren, blueprintRef, maxDepth)

STREAM B (Spawn Approval + RBAC):
  B1 [orch]    SpawnRequest CRD + controller
  B2 [orch]    RBAC system (Role CRD, user_role_bindings)
  B3 [api]     RBAC middleware in API server
  B4 [api]     Auth system (token-based + OIDC option)

STREAM C (MCP Gateway + Security):
  C1 [service] MCP Gateway server (packages/mcp-gateway)
                - MCP SSE transport
                - Tools: kais_launch_team, kais_mission_status, kais_recall, etc.
  C2 [orch]    NATS authorization (per-Cell credentials)
                - Generate credentials on Cell creation
                - Restrict pub/sub subjects based on topology
  C3 [orch]    Audit log (append-only NATS stream → Postgres/ClickHouse)
  C4 [orch]    Cross-level knowledge scoping (tree-based visibility)

STREAM D (CLI + Dashboard):
  D1 [cli]     Tree commands (tree, budget show/tree/top-up/history)
  D2 [cli]     Spawn request commands (list, approve, reject)
  D3 [cli]     RBAC commands (auth, roles, bind)
  D4 [cli]     MCP commands (serve, status)
  D5 [dash]    Tree visualization in dashboard
  D6 [dash]    Spawn approval page
  D7 [dash]    RBAC management page

TESTS:
  T1 [test]    Unit: Recursion safety validation
  T2 [test]    Unit: Budget ledger operations, tree balance
  T3 [test]    Unit: RBAC role matching, namespace scoping
  T4 [test]    Integration: 3-level recursive spawn with budget cascade
  T5 [test]    Integration: RBAC enforcement (authorized/unauthorized)
  T6 [test]    Integration: MCP Gateway → launch team → results
  T7 [test]    Integration: NATS auth prevents topology bypass
  T8 [test]    E2E: Recursive ecosystem builds SaaS app

DELIVERABLE: Recursive spawning, budget tree, RBAC, MCP integration
```

**Parallelism:** A + B + C (3 agents), then D

---

## Phase 9: Human + Marketplace + Federation + A2A

### Tasks

```
STREAM A (Human-as-Cell):
  A1 [runtime] HumanCellRuntime
                - NATS inbox → pending message store
                - Notification dispatch (dashboard, Slack webhook, email)
                - Escalation handler (reminder, LLM fallback, skip)
  A2 [dash]    Dashboard inbox view
                - Pending messages with reply UI
                - Quick actions (LLM-generated response options)
                - Response submission → NATS publish
  A3 [orch]    Human provider type in Cell CRD

STREAM B (Marketplace):
  B1 [service] Marketplace backend (REST API, self-hostable)
                - Search, publish, rate, install
                - Blueprint package format (.kbp)
                - Security scan (no prompt injection patterns, no external URLs)
  B2 [cli]     Marketplace commands (search, info, install, publish, rate)

STREAM C (Federation):
  C1 [orch]    Federation CRD + controller
                - Cluster registry (heartbeat, capacity)
                - Scheduling rules (label matching)
  C2 [service] Federation agent (lightweight, runs on worker clusters)
                - Heartbeat reporting
                - Cell scheduling requests
  C3 [infra]   NATS Leafnode configuration for cross-cluster messaging

STREAM D (A2A + Channels):
  D1 [service] A2A Gateway (JSON-RPC, Agent Card)
                - Server: expose kAIs skills as A2A endpoints
                - Client: call_agent tool for external agents
  D2 [orch]    Channel CRD + tools
                - Cross-formation messaging
                - Schema enforcement
                - NATS subject routing
  D3 [cli]     Federation, channel, agents commands

STREAM E (Dashboard additions):
  E1 [dash]    Human inbox page
  E2 [dash]    Marketplace browser page
  E3 [dash]    Federation status page
  E4 [dash]    Channel messages page

TESTS:
  T1 [test]    Unit: HumanCellRuntime, escalation logic
  T2 [test]    Unit: Marketplace package validation, security scan
  T3 [test]    Unit: Federation scheduling rules
  T4 [test]    Integration: Human-in-loop (message → respond → continue)
  T5 [test]    Integration: Marketplace publish → install → use
  T6 [test]    Integration: Cross-cluster Cell scheduling
  T7 [test]    Integration: A2A gateway serves agent card, handles tasks
  T8 [test]    E2E: Hybrid team with human product owner

DELIVERABLE: Humans in formations, marketplace, multi-cluster, inter-platform agents
```

**Parallelism:** A + B + C + D (4 agents), then E

---

## Maximum Parallelism Summary

| Phase | Max Parallel Agents | Bottleneck |
|-------|-------------------|------------|
| 1     | 3 (A, B, C)       | D depends on B+C |
| 2     | 3 (A, B, C)       | Tests depend on all |
| 3     | 3 (A, B, C)       | Tests depend on all |
| 4     | 3 (A, B, C)       | Tests depend on all |
| 5     | 5 (A, B, C, D, E) | F depends on all |
| 6     | 3 (A, B, C)       | D depends on all |
| 7     | 7+ (A pages, B, C)| Dashboard pages very parallelizable |
| 8     | 3 (A, B, C)       | D depends on all |
| 9     | 4 (A, B, C, D)    | E depends on all |

---

## Agent Assignment Template

When starting a phase, dispatch agents like this:

```
Phase N:
  Agent 1: "Implement Stream A tasks (A1-A5) for Phase N: [description]"
  Agent 2: "Implement Stream B tasks (B1-B3) for Phase N: [description]"
  Agent 3: "Implement Stream C tasks (C1-C4) for Phase N: [description]"

After streams complete:
  Agent 4: "Implement CLI and API for Phase N: [description]"
  Agent 5: "Write and run tests for Phase N: [description]"
  Code Review Agent: "Review Phase N implementation against spec"
```

Each agent gets:
1. The phase file as context (phase-1, phase-2, etc.)
2. The specific stream tasks from this document
3. Access to packages/ they need to modify
4. Clear deliverable criteria
