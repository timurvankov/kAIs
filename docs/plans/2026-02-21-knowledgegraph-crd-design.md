# KnowledgeGraph CRD — Customizable Per-Scope Knowledge Graphs

## Problem

The current knowledge service is a single monolithic instance with one Neo4j backend. Scope isolation exists only as logical `group_id` strings within Graphiti. There is no way to:

- Run dedicated knowledge graphs per realm/formation with separate resources
- Configure inheritance behavior (whether a graph sees parent-scope facts)
- Manage graph lifecycle declaratively via YAML
- Physically isolate knowledge data for security or performance reasons

## Design

### KnowledgeGraph CRD

A new CRD `KnowledgeGraph` (`kais.io/v1`) declares a knowledge graph instance, its scope binding, isolation mode, inheritance behavior, and retention policy.

```yaml
apiVersion: kais.io/v1
kind: KnowledgeGraph
metadata:
  name: platform-knowledge
  namespace: default
spec:
  scope:
    level: platform                # platform | realm | formation | cell
  dedicated: false                 # false = shared Neo4j database, true = own Pod
  inherit: true                    # true = recall merges parent chain results
  retention:
    maxFacts: 100000
    ttlDays: 90
---
apiVersion: kais.io/v1
kind: KnowledgeGraph
metadata:
  name: trading-knowledge
  namespace: default
spec:
  scope:
    level: realm
    realmId: trading
  parentRef: platform-knowledge    # explicit parent link — forms the inheritance tree
  dedicated: false
  inherit: true
  retention:
    maxFacts: 50000
    ttlDays: 60
---
apiVersion: kais.io/v1
kind: KnowledgeGraph
metadata:
  name: alpha-kg
  namespace: default
spec:
  scope:
    level: formation
    realmId: trading
    formationId: alpha
  parentRef: trading-knowledge
  dedicated: true                  # gets its own Neo4j Pod
  inherit: true
  resources:
    memory: "1Gi"
    cpu: "500m"
    storage: "10Gi"
  retention:
    maxFacts: 100000
    ttlDays: 90
```

### Status

```yaml
status:
  phase: Ready              # Pending | Provisioning | Ready | Error
  endpoint: "bolt://neo4j-alpha-kg.kais-system:7687"
  database: "alpha-kg"
  factCount: 1234
  parentChain:               # resolved chain for fast lookup
    - platform-knowledge
    - trading-knowledge
  lastSyncedAt: "2026-02-21T18:00:00Z"
```

### Hierarchy

KnowledgeGraph resources form an explicit tree via `spec.parentRef`:

```
platform-knowledge (shared Neo4j, database "platform-knowledge")
  └── trading-knowledge (shared Neo4j, database "trading-knowledge")
       ├── alpha-kg (dedicated Neo4j Pod)
       └── beta-kg (shared Neo4j, database "beta-kg")
```

Parent chains are resolved by the controller and stored in `status.parentChain` for fast lookup by the knowledge service.

### Isolation modes

**Shared** (`dedicated: false`):
- KnowledgeGraphController creates a separate **database** within the shared Neo4j instance (Neo4j 5+ multi-database support)
- Knowledge service routes requests to the correct database by graph name
- Cheap, fast to provision

**Dedicated** (`dedicated: true`):
- Controller creates a Neo4j Pod + Service (similar to how CellController creates Pods for Cells)
- Full resource isolation, own PV for storage
- `status.endpoint` points to the dedicated instance
- `spec.resources` controls Pod resource limits

### Inheritance behavior

**`inherit: true`** (on recall/search):
- Knowledge service walks the `parentChain`: `[alpha-kg, trading-knowledge, platform-knowledge]`
- Queries each graph's store (potentially different Neo4j endpoints)
- Merges results, ranks by confidence
- Writes (`remember`) go only to the graph matching the request scope

**`inherit: false`**:
- Search only in own graph, no parent chain traversal
- Writes go to own graph

### Routing in Knowledge Service

Replace the current single-store architecture with a **multi-graph router**:

1. Knowledge service watches KnowledgeGraph resources (or reads a ConfigMap synced by the controller)
2. Each KnowledgeGraph maps to a `GraphitiKnowledgeStore` instance with its own Neo4j endpoint + database
3. On `/recall` — resolve graph by `graphId` param, if `inherit=true` walk parentChain and merge
4. On `/remember` — resolve graph by `graphId`, write only to that graph
5. On `/correct` — resolve graph by `graphId`, invalidate in that graph

### Cell → KnowledgeGraph binding

- Operator matches Cells to KnowledgeGraph resources by scope (most specific match wins)
- Injects `KNOWLEDGE_GRAPH_ID` env var into Cell Pod spec
- Cell-runtime passes `graphId` in all knowledge tool requests
- Knowledge service uses `graphId` to route to the correct store(s)

## Components affected

| Component | Change |
|---|---|
| `deploy/crds/knowledgegraph-crd.yaml` | New CRD definition |
| `packages/core/src/schemas.ts` | `KnowledgeGraphSpecSchema`, `KnowledgeGraphStatusSchema` |
| `packages/core/src/types.ts` | Inferred types |
| `packages/core/src/index.ts` | Exports |
| `packages/operator/src/knowledgegraph-controller.ts` | New controller: reconcile shared (create database) or dedicated (create Pod+Service), resolve parentChain |
| `packages/operator/src/types.ts` | `KnowledgeGraphResource` interface, KubeClient methods |
| `packages/operator/src/main.ts` | Register KnowledgeGraph informer + controller |
| `packages/knowledge/src/knowledge/router.py` | New: multi-graph router, parentChain traversal, result merging |
| `packages/knowledge/src/knowledge/store.py` | `GraphitiKnowledgeStore` accepts specific endpoint+database (not global) |
| `packages/knowledge/src/knowledge/main.py` | `/recall`, `/remember`, `/correct` accept `graphId` param, use router |
| `packages/operator/src/pod-builder.ts` | Inject `KNOWLEDGE_GRAPH_ID` env var based on scope matching |
| `packages/cell-runtime/src/tools/recall.ts` | Pass `graphId` from env to knowledge service requests |
| `packages/cli/src/kais.ts` | `kais knowledge graphs` (list/describe) |
