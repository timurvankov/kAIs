# KnowledgeGraph CRD Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Declarative per-scope knowledge graphs with explicit parent hierarchy, hybrid isolation (shared Neo4j databases vs dedicated Pods), and configurable inheritance.

**Architecture:** New `KnowledgeGraph` CRD managed by a KnowledgeGraphController. Shared mode creates a database inside the existing Neo4j; dedicated mode spins up a separate Neo4j Pod+Service. The knowledge service becomes a multi-graph router that resolves `graphId` to the right store and walks parentChain for inheritance. Cells get `KNOWLEDGE_GRAPH_ID` injected by the operator.

**Tech Stack:** TypeScript (operator, core, cell-runtime, CLI), Python (knowledge service), Zod (schemas), Kubernetes CRDs, Neo4j multi-database, Graphiti

---

## Context

- **Design doc:** `docs/plans/2026-02-21-knowledgegraph-crd-design.md`
- **Existing knowledge service:** `packages/knowledge/` (Python FastAPI + Graphiti)
- **Existing knowledge tools:** `packages/cell-runtime/src/tools/recall.ts`
- **Existing schemas:** `packages/core/src/schemas.ts` (Knowledge schemas at lines 407-457, Blueprint schemas at lines 459-508)
- **Existing operator patterns:** `packages/operator/src/blueprint-controller.ts` (model controller after this)
- **Existing pod builder:** `packages/operator/src/pod-builder.ts` (KNOWLEDGE_SERVICE_URL at line 112)

---

### Task 1: KnowledgeGraph Zod schemas in @kais/core

**Files:**
- Modify: `packages/core/src/schemas.ts:457` (add after SearchOptionsSchema, before Blueprint section)
- Modify: `packages/core/src/types.ts:130` (add type inferences after Knowledge types, before Blueprint types)
- Modify: `packages/core/src/index.ts:57,127` (add exports in both schema and type sections)
- Create: `packages/core/src/__tests__/knowledgegraph-schemas.test.ts`

**Step 1: Write the test**

```typescript
// packages/core/src/__tests__/knowledgegraph-schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
  KnowledgeGraphSpecSchema,
  KnowledgeGraphStatusSchema,
  KnowledgeGraphRetentionSchema,
} from '../schemas.js';

describe('KnowledgeGraph Schemas', () => {
  it('validates a minimal shared KnowledgeGraph spec', () => {
    const spec = {
      scope: { level: 'platform' },
      dedicated: false,
      inherit: true,
    };
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
```

**Step 2: Run test to verify it fails**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/core exec vitest run src/__tests__/knowledgegraph-schemas.test.ts`
Expected: FAIL — schemas don't exist yet

**Step 3: Implement the schemas**

Add to `packages/core/src/schemas.ts` after line 457 (after `SearchOptionsSchema`), before the Blueprint section:

```typescript
// ── KnowledgeGraph CRD ──────────────────────────────────────────────
export const KnowledgeGraphPhaseSchema = z.enum(['Pending', 'Provisioning', 'Ready', 'Error']);

export const KnowledgeGraphRetentionSchema = z.object({
  maxFacts: z.number().int().positive(),
  ttlDays: z.number().int().positive(),
});

export const KnowledgeGraphResourcesSchema = z.object({
  memory: z.string(),
  cpu: z.string(),
  storage: z.string().optional(),
});

export const KnowledgeGraphSpecSchema = z.object({
  scope: KnowledgeScopeSchema,
  parentRef: z.string().optional(),
  dedicated: z.boolean().default(false),
  inherit: z.boolean().default(true),
  retention: KnowledgeGraphRetentionSchema.optional(),
  resources: KnowledgeGraphResourcesSchema.optional(),
});

export const KnowledgeGraphStatusSchema = z.object({
  phase: KnowledgeGraphPhaseSchema,
  endpoint: z.string().optional(),
  database: z.string().optional(),
  factCount: z.number().int().optional(),
  parentChain: z.array(z.string()).optional(),
  lastSyncedAt: z.string().optional(),
});
```

Add to `packages/core/src/types.ts` after line 129 (after `SearchOptions`):

```typescript
export type KnowledgeGraphPhase = z.infer<typeof KnowledgeGraphPhaseSchema>;
export type KnowledgeGraphRetention = z.infer<typeof KnowledgeGraphRetentionSchema>;
export type KnowledgeGraphResources = z.infer<typeof KnowledgeGraphResourcesSchema>;
export type KnowledgeGraphSpec = z.infer<typeof KnowledgeGraphSpecSchema>;
export type KnowledgeGraphStatus = z.infer<typeof KnowledgeGraphStatusSchema>;
```

Add the imports in `types.ts` — add these to the existing import from `'./schemas.js'`:
```typescript
KnowledgeGraphPhaseSchema,
KnowledgeGraphRetentionSchema,
KnowledgeGraphResourcesSchema,
KnowledgeGraphSpecSchema,
KnowledgeGraphStatusSchema,
```

Add to `packages/core/src/index.ts` — in the schema exports section (around line 57, after `SearchOptionsSchema`):
```typescript
  KnowledgeGraphPhaseSchema,
  KnowledgeGraphRetentionSchema,
  KnowledgeGraphResourcesSchema,
  KnowledgeGraphSpecSchema,
  KnowledgeGraphStatusSchema,
```

And in the type exports section (around line 127, after `SearchOptions`):
```typescript
  KnowledgeGraphPhase,
  KnowledgeGraphRetention,
  KnowledgeGraphResources,
  KnowledgeGraphSpec,
  KnowledgeGraphStatus,
```

**Step 4: Run test to verify it passes**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/core exec vitest run src/__tests__/knowledgegraph-schemas.test.ts`
Expected: PASS (7 tests)

**Step 5: Run full core test suite**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/core exec vitest run`
Expected: All 240+ tests pass

**Step 6: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/types.ts packages/core/src/index.ts packages/core/src/__tests__/knowledgegraph-schemas.test.ts
git commit -m "feat(core): add KnowledgeGraph CRD schemas and types"
```

---

### Task 2: KnowledgeGraph CRD YAML

**Files:**
- Create: `deploy/crds/knowledgegraph-crd.yaml`

**Step 1: Create the CRD**

Model after `deploy/crds/blueprint-crd.yaml`. Create `deploy/crds/knowledgegraph-crd.yaml`:

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: knowledgegraphs.kais.io
spec:
  group: kais.io
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              required:
                - scope
              properties:
                scope:
                  type: object
                  required:
                    - level
                  properties:
                    level:
                      type: string
                      enum: [platform, realm, formation, cell]
                    realmId:
                      type: string
                    formationId:
                      type: string
                    cellId:
                      type: string
                parentRef:
                  type: string
                  description: Name of the parent KnowledgeGraph resource
                dedicated:
                  type: boolean
                  default: false
                  description: "true = own Neo4j Pod, false = shared Neo4j database"
                inherit:
                  type: boolean
                  default: true
                  description: "true = recall merges parent chain results"
                retention:
                  type: object
                  properties:
                    maxFacts:
                      type: integer
                      minimum: 1
                    ttlDays:
                      type: integer
                      minimum: 1
                resources:
                  type: object
                  description: Resource limits for dedicated mode
                  properties:
                    memory:
                      type: string
                    cpu:
                      type: string
                    storage:
                      type: string
            status:
              type: object
              properties:
                phase:
                  type: string
                  enum: [Pending, Provisioning, Ready, Error]
                endpoint:
                  type: string
                database:
                  type: string
                factCount:
                  type: integer
                parentChain:
                  type: array
                  items:
                    type: string
                lastSyncedAt:
                  type: string
                  format: date-time
                message:
                  type: string
      subresources:
        status: {}
      additionalPrinterColumns:
        - name: Scope
          type: string
          jsonPath: .spec.scope.level
        - name: Dedicated
          type: boolean
          jsonPath: .spec.dedicated
        - name: Inherit
          type: boolean
          jsonPath: .spec.inherit
        - name: Phase
          type: string
          jsonPath: .status.phase
        - name: Facts
          type: integer
          jsonPath: .status.factCount
        - name: Parent
          type: string
          jsonPath: .spec.parentRef
  scope: Namespaced
  names:
    plural: knowledgegraphs
    singular: knowledgegraph
    kind: KnowledgeGraph
    shortNames:
      - kg
```

**Step 2: Commit**

```bash
git add deploy/crds/knowledgegraph-crd.yaml
git commit -m "feat(deploy): add KnowledgeGraph CRD"
```

---

### Task 3: Operator types — KnowledgeGraphResource + KubeClient methods

**Files:**
- Modify: `packages/operator/src/types.ts:149` (add after BlueprintEventType, before MissionEventType)

**Step 1: Add types**

Add to `packages/operator/src/types.ts` after the `BlueprintEventType` line (around line 149):

```typescript
/** KnowledgeGraph custom resource shape. */
export interface KnowledgeGraphResource {
  apiVersion: 'kais.io/v1';
  kind: 'KnowledgeGraph';
  metadata: {
    name: string;
    namespace: string;
    resourceVersion?: string;
    uid?: string;
  };
  spec: import('@kais/core').KnowledgeGraphSpec;
  status?: import('@kais/core').KnowledgeGraphStatus;
}

export type KnowledgeGraphEventType = 'Created' | 'Provisioning' | 'Ready' | 'Error' | 'Deleted';
```

Add to the `KubeClient` interface (before the closing `}`, around line 288) these methods:

```typescript
  // KnowledgeGraph
  updateKnowledgeGraphStatus(
    name: string,
    namespace: string,
    status: import('@kais/core').KnowledgeGraphStatus,
  ): Promise<void>;
  emitKnowledgeGraphEvent(
    resource: KnowledgeGraphResource,
    type: KnowledgeGraphEventType,
    message: string,
  ): Promise<void>;
  listKnowledgeGraphs(namespace: string): Promise<KnowledgeGraphResource[]>;
  createPod(namespace: string, pod: unknown): Promise<void>;
  createService(namespace: string, service: unknown): Promise<void>;
  deletePod(name: string, namespace: string): Promise<void>;
  deleteService(name: string, namespace: string): Promise<void>;
```

**Step 2: Add stubs to all existing KubeClient mocks and main.ts**

Every file that creates a KubeClient mock needs stubs. The files are:
- `packages/operator/src/main.ts` — add no-op implementations
- `packages/operator/src/__tests__/controller.test.ts` — add `vi.fn()` stubs
- `packages/operator/src/__tests__/formation-controller.test.ts` — add `vi.fn()` stubs
- `packages/operator/src/__tests__/mission-controller.test.ts` — add `vi.fn()` stubs
- `packages/operator/src/__tests__/experiment-controller.test.ts` — add `vi.fn()` stubs
- `packages/operator/src/__tests__/blueprint-controller.test.ts` — add `vi.fn()` stubs

For each mock, add:
```typescript
updateKnowledgeGraphStatus: vi.fn(),
emitKnowledgeGraphEvent: vi.fn(),
listKnowledgeGraphs: vi.fn().mockResolvedValue([]),
createPod: vi.fn(),
createService: vi.fn(),
deletePod: vi.fn(),
deleteService: vi.fn(),
```

For `main.ts`, add no-op implementations in the kubeClient object:
```typescript
async updateKnowledgeGraphStatus() {},
async emitKnowledgeGraphEvent() {},
async listKnowledgeGraphs() { return []; },
async createPod() {},
async createService() {},
async deletePod() {},
async deleteService() {},
```

**Step 3: Build to verify**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/operator run build`
Expected: Success

**Step 4: Run operator tests**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/operator exec vitest run`
Expected: All 225+ tests pass

**Step 5: Commit**

```bash
git add packages/operator/src/types.ts packages/operator/src/main.ts packages/operator/src/__tests__/*.test.ts
git commit -m "feat(operator): add KnowledgeGraph types and KubeClient interface methods"
```

---

### Task 4: KnowledgeGraphController

**Files:**
- Create: `packages/operator/src/knowledgegraph-controller.ts`
- Create: `packages/operator/src/__tests__/knowledgegraph-controller.test.ts`
- Modify: `packages/operator/src/index.ts` (add export)
- Modify: `packages/operator/src/main.ts` (register controller)

**Step 1: Write the test**

```typescript
// packages/operator/src/__tests__/knowledgegraph-controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeGraphController } from '../knowledgegraph-controller.js';
import type { KnowledgeGraphResource } from '../types.js';

function makeMockKube() {
  return {
    // All existing KubeClient stubs...
    getCustomResource: vi.fn(),
    updateCustomResourceStatus: vi.fn(),
    listPods: vi.fn().mockResolvedValue([]),
    createPod: vi.fn(),
    createService: vi.fn(),
    deletePod: vi.fn(),
    deleteService: vi.fn(),
    updateKnowledgeGraphStatus: vi.fn(),
    emitKnowledgeGraphEvent: vi.fn(),
    listKnowledgeGraphs: vi.fn().mockResolvedValue([]),
    // ... rest of stubs
    updateCellStatus: vi.fn(),
    emitEvent: vi.fn(),
    updateFormationStatus: vi.fn(),
    emitFormationEvent: vi.fn(),
    updateMissionStatus: vi.fn(),
    emitMissionEvent: vi.fn(),
    updateExperimentStatus: vi.fn(),
    emitExperimentEvent: vi.fn(),
    updateBlueprintStatus: vi.fn(),
    emitBlueprintEvent: vi.fn(),
  } as any;
}

function makeKG(overrides: Partial<KnowledgeGraphResource> = {}): KnowledgeGraphResource {
  return {
    apiVersion: 'kais.io/v1',
    kind: 'KnowledgeGraph',
    metadata: { name: 'test-kg', namespace: 'default' },
    spec: { scope: { level: 'realm', realmId: 'trading' }, dedicated: false, inherit: true },
    ...overrides,
  } as KnowledgeGraphResource;
}

describe('KnowledgeGraphController', () => {
  let kube: ReturnType<typeof makeMockKube>;
  let controller: KnowledgeGraphController;

  beforeEach(() => {
    kube = makeMockKube();
    controller = new KnowledgeGraphController(kube);
  });

  it('sets phase to Ready for shared mode', async () => {
    const kg = makeKG();
    await controller.reconcile(kg);

    expect(kube.updateKnowledgeGraphStatus).toHaveBeenCalledWith(
      'test-kg',
      'default',
      expect.objectContaining({ phase: 'Ready', database: 'test-kg' }),
    );
  });

  it('sets phase to Provisioning then Ready for dedicated mode', async () => {
    const kg = makeKG({
      spec: {
        scope: { level: 'formation', realmId: 'trading', formationId: 'alpha' },
        dedicated: true,
        inherit: true,
        resources: { memory: '1Gi', cpu: '500m', storage: '10Gi' },
      },
    } as any);

    await controller.reconcile(kg);

    expect(kube.createPod).toHaveBeenCalled();
    expect(kube.createService).toHaveBeenCalled();
    expect(kube.updateKnowledgeGraphStatus).toHaveBeenCalledWith(
      'test-kg',
      'default',
      expect.objectContaining({ phase: 'Ready' }),
    );
  });

  it('resolves parentChain from listKnowledgeGraphs', async () => {
    const parent = makeKG({
      metadata: { name: 'platform-kg', namespace: 'default' },
      spec: { scope: { level: 'platform' }, dedicated: false, inherit: true },
    } as any);
    const child = makeKG({
      spec: {
        scope: { level: 'realm', realmId: 'trading' },
        parentRef: 'platform-kg',
        dedicated: false,
        inherit: true,
      },
    } as any);

    kube.listKnowledgeGraphs.mockResolvedValue([parent, child]);
    await controller.reconcile(child);

    expect(kube.updateKnowledgeGraphStatus).toHaveBeenCalledWith(
      'test-kg',
      'default',
      expect.objectContaining({ parentChain: ['platform-kg'] }),
    );
  });

  it('handles missing parentRef gracefully (empty parentChain)', async () => {
    const kg = makeKG();
    kube.listKnowledgeGraphs.mockResolvedValue([kg]);
    await controller.reconcile(kg);

    expect(kube.updateKnowledgeGraphStatus).toHaveBeenCalledWith(
      'test-kg',
      'default',
      expect.objectContaining({ parentChain: [] }),
    );
  });

  it('handles reconcile delete — cleans up dedicated resources', async () => {
    const kg = makeKG({
      spec: {
        scope: { level: 'realm', realmId: 'trading' },
        dedicated: true,
        inherit: true,
      },
    } as any);

    await controller.reconcileDelete(kg);

    expect(kube.deletePod).toHaveBeenCalledWith('neo4j-test-kg', 'default');
    expect(kube.deleteService).toHaveBeenCalledWith('neo4j-test-kg', 'default');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/operator exec vitest run src/__tests__/knowledgegraph-controller.test.ts`
Expected: FAIL — controller doesn't exist yet

**Step 3: Implement the controller**

Create `packages/operator/src/knowledgegraph-controller.ts`:

```typescript
import { getTracer } from '@kais/core';
import type { KnowledgeGraphResource } from './types.js';

const tracer = getTracer('kais-operator');

interface KnowledgeGraphKubeClient {
  updateKnowledgeGraphStatus(
    name: string,
    namespace: string,
    status: NonNullable<KnowledgeGraphResource['status']>,
  ): Promise<void>;
  emitKnowledgeGraphEvent(
    resource: KnowledgeGraphResource,
    type: string,
    message: string,
  ): Promise<void>;
  listKnowledgeGraphs(namespace: string): Promise<KnowledgeGraphResource[]>;
  createPod(namespace: string, pod: unknown): Promise<void>;
  createService(namespace: string, service: unknown): Promise<void>;
  deletePod(name: string, namespace: string): Promise<void>;
  deleteService(name: string, namespace: string): Promise<void>;
}

export class KnowledgeGraphController {
  private readonly kube: KnowledgeGraphKubeClient;

  constructor(kube: KnowledgeGraphKubeClient) {
    this.kube = kube;
  }

  async reconcile(kg: KnowledgeGraphResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_knowledgegraph');
    const { name, namespace } = kg.metadata;

    try {
      span.setAttributes({ 'resource.name': name, 'resource.namespace': namespace });

      // Resolve parent chain
      const parentChain = await this.resolveParentChain(kg);

      if (kg.spec.dedicated) {
        await this.reconcileDedicated(kg, parentChain);
      } else {
        await this.reconcileShared(kg, parentChain);
      }
    } catch (err) {
      await this.kube.updateKnowledgeGraphStatus(name, namespace, {
        phase: 'Error',
        database: name,
        parentChain: [],
        message: (err as Error).message,
      });
      await this.kube.emitKnowledgeGraphEvent(kg, 'Error', (err as Error).message);
    } finally {
      span.end();
    }
  }

  async reconcileDelete(kg: KnowledgeGraphResource): Promise<void> {
    const { name, namespace } = kg.metadata;
    if (kg.spec.dedicated) {
      await this.kube.deletePod(`neo4j-${name}`, namespace);
      await this.kube.deleteService(`neo4j-${name}`, namespace);
    }
  }

  private async reconcileShared(
    kg: KnowledgeGraphResource,
    parentChain: string[],
  ): Promise<void> {
    const { name, namespace } = kg.metadata;
    // Shared mode: database name = resource name, endpoint = shared Neo4j
    const endpoint = 'bolt://neo4j.kais-system:7687';

    await this.kube.updateKnowledgeGraphStatus(name, namespace, {
      phase: 'Ready',
      endpoint,
      database: name,
      parentChain,
    });
    await this.kube.emitKnowledgeGraphEvent(kg, 'Ready', `Shared database "${name}" ready`);
  }

  private async reconcileDedicated(
    kg: KnowledgeGraphResource,
    parentChain: string[],
  ): Promise<void> {
    const { name, namespace } = kg.metadata;
    const podName = `neo4j-${name}`;
    const serviceName = `neo4j-${name}`;
    const endpoint = `bolt://${serviceName}.${namespace}:7687`;

    await this.kube.updateKnowledgeGraphStatus(name, namespace, {
      phase: 'Provisioning',
      endpoint,
      database: name,
      parentChain,
    });

    const resources = kg.spec.resources ?? { memory: '512Mi', cpu: '250m' };

    const pod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        namespace,
        labels: { app: 'kais-neo4j', 'kais.io/knowledgegraph': name },
      },
      spec: {
        containers: [
          {
            name: 'neo4j',
            image: 'neo4j:5-community',
            ports: [
              { containerPort: 7687, name: 'bolt' },
              { containerPort: 7474, name: 'http' },
            ],
            env: [
              { name: 'NEO4J_AUTH', value: 'neo4j/kais' },
              { name: 'NEO4J_PLUGINS', value: '["apoc"]' },
            ],
            resources: {
              requests: { memory: resources.memory, cpu: resources.cpu },
              limits: { memory: resources.memory, cpu: resources.cpu },
            },
          },
        ],
      },
    };

    const service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: serviceName,
        namespace,
        labels: { app: 'kais-neo4j', 'kais.io/knowledgegraph': name },
      },
      spec: {
        selector: { 'kais.io/knowledgegraph': name },
        ports: [
          { port: 7687, targetPort: 7687, name: 'bolt' },
          { port: 7474, targetPort: 7474, name: 'http' },
        ],
      },
    };

    await this.kube.createPod(namespace, pod);
    await this.kube.createService(namespace, service);

    await this.kube.updateKnowledgeGraphStatus(name, namespace, {
      phase: 'Ready',
      endpoint,
      database: name,
      parentChain,
    });
    await this.kube.emitKnowledgeGraphEvent(kg, 'Ready', `Dedicated Neo4j "${podName}" ready`);
  }

  private async resolveParentChain(kg: KnowledgeGraphResource): Promise<string[]> {
    if (!kg.spec.parentRef) return [];

    const allKGs = await this.kube.listKnowledgeGraphs(kg.metadata.namespace);
    const byName = new Map(allKGs.map((k) => [k.metadata.name, k]));
    const chain: string[] = [];
    let current = kg.spec.parentRef;

    // Walk up the parent chain (with cycle detection)
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      const parent = byName.get(current);
      if (!parent) break;
      chain.push(current);
      current = parent.spec.parentRef;
    }

    return chain;
  }
}
```

Add export to `packages/operator/src/index.ts`:
```typescript
export { KnowledgeGraphController } from './knowledgegraph-controller.js';
```

**Step 4: Run test to verify it passes**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/operator exec vitest run src/__tests__/knowledgegraph-controller.test.ts`
Expected: PASS (5 tests)

**Step 5: Run full operator test suite**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/operator exec vitest run`
Expected: All 230+ tests pass

**Step 6: Commit**

```bash
git add packages/operator/src/knowledgegraph-controller.ts packages/operator/src/__tests__/knowledgegraph-controller.test.ts packages/operator/src/index.ts
git commit -m "feat(operator): add KnowledgeGraphController with shared/dedicated modes"
```

---

### Task 5: Multi-graph router in Knowledge Service (Python)

**Files:**
- Create: `packages/knowledge/src/knowledge/router.py`
- Modify: `packages/knowledge/src/knowledge/store.py` (make store accept endpoint+database params)
- Modify: `packages/knowledge/src/knowledge/main.py` (use router, accept graphId)
- Modify: `packages/knowledge/src/knowledge/models.py` (add graphId to request models)
- Create: `packages/knowledge/tests/test_router.py`

**Step 1: Write the test**

```python
# packages/knowledge/tests/test_router.py
import pytest
from knowledge.router import KnowledgeGraphRouter
from knowledge.models import KnowledgeScope, ScopeLevel

@pytest.fixture
def router():
    r = KnowledgeGraphRouter()
    r.register_graph(
        graph_id="platform-kg",
        endpoint=None,  # in-memory
        database="platform-kg",
        parent_chain=[],
        inherit=True,
    )
    r.register_graph(
        graph_id="trading-kg",
        endpoint=None,
        database="trading-kg",
        parent_chain=["platform-kg"],
        inherit=True,
    )
    r.register_graph(
        graph_id="isolated-kg",
        endpoint=None,
        database="isolated-kg",
        parent_chain=["platform-kg"],
        inherit=False,
    )
    return r

@pytest.mark.asyncio
async def test_get_store_returns_store_for_graph(router):
    store = router.get_store("trading-kg")
    assert store is not None

@pytest.mark.asyncio
async def test_get_store_returns_none_for_unknown(router):
    store = router.get_store("unknown-kg")
    assert store is None

@pytest.mark.asyncio
async def test_get_search_chain_with_inherit(router):
    chain = router.get_search_chain("trading-kg")
    assert [g.graph_id for g in chain] == ["trading-kg", "platform-kg"]

@pytest.mark.asyncio
async def test_get_search_chain_without_inherit(router):
    chain = router.get_search_chain("isolated-kg")
    assert [g.graph_id for g in chain] == ["isolated-kg"]

@pytest.mark.asyncio
async def test_search_merges_results_from_chain(router):
    from knowledge.models import AddFactRequest, SearchRequest, FactSource, FactSourceType

    source = FactSource(type=FactSourceType.user_input)
    scope_platform = KnowledgeScope(level=ScopeLevel.platform)
    scope_realm = KnowledgeScope(level=ScopeLevel.realm, realm_id="trading")

    # Add facts to different graphs
    platform_store = router.get_store("platform-kg")
    await platform_store.add_fact(AddFactRequest(content="platform fact about markets", scope=scope_platform, source=source))

    trading_store = router.get_store("trading-kg")
    await trading_store.add_fact(AddFactRequest(content="trading fact about markets", scope=scope_realm, source=source))

    # Search via router with inheritance
    results = await router.search("trading-kg", SearchRequest(query="markets", scope=scope_realm))
    assert len(results) == 2

@pytest.mark.asyncio
async def test_search_isolated_only_returns_own(router):
    from knowledge.models import AddFactRequest, SearchRequest, FactSource, FactSourceType

    source = FactSource(type=FactSourceType.user_input)
    scope_platform = KnowledgeScope(level=ScopeLevel.platform)
    scope_realm = KnowledgeScope(level=ScopeLevel.realm, realm_id="trading")

    platform_store = router.get_store("platform-kg")
    await platform_store.add_fact(AddFactRequest(content="platform fact about markets", scope=scope_platform, source=source))

    isolated_store = router.get_store("isolated-kg")
    await isolated_store.add_fact(AddFactRequest(content="isolated fact about markets", scope=scope_realm, source=source))

    results = await router.search("isolated-kg", SearchRequest(query="markets", scope=scope_realm))
    assert len(results) == 1
    assert "isolated" in results[0].content
```

**Step 2: Run test to verify it fails**

Run: `cd /home/tim/kAIs/packages/knowledge && python -m pytest tests/test_router.py -v`
Expected: FAIL — router module doesn't exist

**Step 3: Implement the router**

Create `packages/knowledge/src/knowledge/router.py`:

```python
from __future__ import annotations
from dataclasses import dataclass, field
from .models import SearchRequest, AddFactRequest, Fact
from .store import GraphitiKnowledgeStore


@dataclass
class RegisteredGraph:
    graph_id: str
    store: GraphitiKnowledgeStore
    parent_chain: list[str]
    inherit: bool


class KnowledgeGraphRouter:
    """Routes knowledge operations to the correct graph store, with optional parent chain traversal."""

    def __init__(self):
        self._graphs: dict[str, RegisteredGraph] = {}

    def register_graph(
        self,
        graph_id: str,
        endpoint: str | None,
        database: str,
        parent_chain: list[str],
        inherit: bool,
    ) -> None:
        # For now, each graph gets its own in-memory store.
        # When Graphiti is available, pass endpoint+database to create a connected store.
        store = GraphitiKnowledgeStore(graphiti_client=None)
        self._graphs[graph_id] = RegisteredGraph(
            graph_id=graph_id,
            store=store,
            parent_chain=parent_chain,
            inherit=inherit,
        )

    def unregister_graph(self, graph_id: str) -> None:
        self._graphs.pop(graph_id, None)

    def get_store(self, graph_id: str) -> GraphitiKnowledgeStore | None:
        entry = self._graphs.get(graph_id)
        return entry.store if entry else None

    def get_search_chain(self, graph_id: str) -> list[RegisteredGraph]:
        entry = self._graphs.get(graph_id)
        if not entry:
            return []

        chain = [entry]
        if not entry.inherit:
            return chain

        for parent_id in entry.parent_chain:
            parent = self._graphs.get(parent_id)
            if parent:
                chain.append(parent)

        return chain

    async def search(self, graph_id: str, req: SearchRequest) -> list[Fact]:
        chain = self.get_search_chain(graph_id)
        if not chain:
            return []

        all_results: list[Fact] = []
        for entry in chain:
            results = await entry.store.search(req)
            all_results.extend(results)

        # Deduplicate by content, sort by confidence
        seen: set[str] = set()
        unique: list[Fact] = []
        for fact in all_results:
            if fact.content not in seen:
                seen.add(fact.content)
                unique.append(fact)

        unique.sort(key=lambda f: f.confidence, reverse=True)
        return unique[: req.max_results]

    async def add_fact(self, graph_id: str, req: AddFactRequest) -> str:
        store = self.get_store(graph_id)
        if not store:
            raise ValueError(f"Unknown knowledge graph: {graph_id}")
        return await store.add_fact(req)

    async def invalidate(self, graph_id: str, fact_id: str, reason: str) -> None:
        store = self.get_store(graph_id)
        if not store:
            raise ValueError(f"Unknown knowledge graph: {graph_id}")
        await store.invalidate(fact_id, reason)
```

**Step 4: Update models.py — add graphId to requests**

Add `graph_id` field to `SearchRequest`, `AddFactRequest`, and `InvalidateRequest` in `packages/knowledge/src/knowledge/models.py`:

```python
class AddFactRequest(BaseModel):
    content: str
    scope: KnowledgeScope
    source: FactSource
    confidence: float = Field(ge=0, le=1, default=0.5)
    tags: list[str] = []
    graph_id: str | None = None  # NEW: routes to specific graph

class SearchRequest(BaseModel):
    query: str
    scope: KnowledgeScope
    max_results: int = 20
    min_confidence: float = 0.0
    include_invalidated: bool = False
    graph_id: str | None = None  # NEW

class InvalidateRequest(BaseModel):
    fact_id: str
    reason: str
    graph_id: str | None = None  # NEW
```

**Step 5: Update main.py — use router**

Replace `packages/knowledge/src/knowledge/main.py`:

```python
from __future__ import annotations
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .models import AddFactRequest, SearchRequest, InvalidateRequest, Fact
from .store import GraphitiKnowledgeStore
from .router import KnowledgeGraphRouter

router = KnowledgeGraphRouter()
fallback_store: GraphitiKnowledgeStore | None = None

DEFAULT_GRAPH_ID = "__default__"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global fallback_store
    neo4j_url = os.getenv("NEO4J_URL")
    graphiti_client = None

    if neo4j_url:
        try:
            from graphiti_core import Graphiti
            graphiti_client = Graphiti(neo4j_url, os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "kais"))
            await graphiti_client.build_indices_and_constraints()
        except Exception as e:
            print(f"[knowledge] Graphiti init failed, using in-memory fallback: {e}")

    # Register a default graph for backward compatibility
    fallback_store = GraphitiKnowledgeStore(graphiti_client)
    router.register_graph(
        graph_id=DEFAULT_GRAPH_ID,
        endpoint=neo4j_url,
        database="neo4j",
        parent_chain=[],
        inherit=False,
    )

    yield

    if graphiti_client:
        await graphiti_client.close()


app = FastAPI(title="kAIs Knowledge Service", lifespan=lifespan)


def _resolve_graph_id(graph_id: str | None) -> str:
    return graph_id if graph_id and router.get_store(graph_id) else DEFAULT_GRAPH_ID


def _get_store(graph_id: str | None) -> GraphitiKnowledgeStore:
    gid = _resolve_graph_id(graph_id)
    if gid == DEFAULT_GRAPH_ID and fallback_store:
        return fallback_store
    store = router.get_store(gid)
    if store:
        return store
    assert fallback_store is not None
    return fallback_store


@app.post("/recall", response_model=list[Fact])
async def recall(req: SearchRequest) -> list[Fact]:
    gid = _resolve_graph_id(req.graph_id)
    if gid != DEFAULT_GRAPH_ID:
        return await router.search(gid, req)
    return await _get_store(req.graph_id).search(req)


@app.post("/remember")
async def remember(req: AddFactRequest) -> dict[str, str]:
    gid = _resolve_graph_id(req.graph_id)
    if gid != DEFAULT_GRAPH_ID:
        fact_id = await router.add_fact(gid, req)
    else:
        fact_id = await _get_store(req.graph_id).add_fact(req)
    return {"factId": fact_id}


@app.post("/correct")
async def correct(req: InvalidateRequest) -> dict[str, str]:
    gid = _resolve_graph_id(req.graph_id)
    if gid != DEFAULT_GRAPH_ID:
        await router.invalidate(gid, req.fact_id, req.reason)
    else:
        await _get_store(req.graph_id).invalidate(req.fact_id, req.reason)
    return {"status": "ok"}


@app.post("/graphs/register")
async def register_graph(body: dict) -> dict[str, str]:
    """Called by the operator when a KnowledgeGraph is reconciled."""
    router.register_graph(
        graph_id=body["graphId"],
        endpoint=body.get("endpoint"),
        database=body.get("database", body["graphId"]),
        parent_chain=body.get("parentChain", []),
        inherit=body.get("inherit", True),
    )
    return {"status": "ok"}


@app.post("/graphs/unregister")
async def unregister_graph(body: dict) -> dict[str, str]:
    """Called by the operator when a KnowledgeGraph is deleted."""
    router.unregister_graph(body["graphId"])
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok"}
```

**Step 6: Run tests**

Run: `cd /home/tim/kAIs/packages/knowledge && python -m pytest tests/ -v`
Expected: All tests pass (4 old + 6 new)

**Step 7: Commit**

```bash
git add packages/knowledge/
git commit -m "feat(knowledge): add multi-graph router with parent chain inheritance"
```

---

### Task 6: Wire KNOWLEDGE_GRAPH_ID into Cell Pods

**Files:**
- Modify: `packages/operator/src/pod-builder.ts:112` (add KNOWLEDGE_GRAPH_ID env var)
- Modify: `packages/cell-runtime/src/tools/recall.ts:3-7` (add graphId to KnowledgeToolConfig, pass in requests)
- Modify: `packages/cell-runtime/src/main.ts` (read KNOWLEDGE_GRAPH_ID env var)
- Modify: `packages/cell-runtime/src/__tests__/knowledge-tools.test.ts` (update tests)

**Step 1: Update KnowledgeToolConfig**

In `packages/cell-runtime/src/tools/recall.ts`, add `graphId` to the config interface (line 3-7):

```typescript
export interface KnowledgeToolConfig {
  knowledgeUrl: string;
  cellName: string;
  namespace: string;
  graphId?: string;  // NEW: routes to specific KnowledgeGraph
}
```

Then in each tool's fetch body, include `graph_id`:

In `createRecallTool` (around line 40), add to the request body:
```typescript
graph_id: config.graphId,
```

In `createRememberTool` (around line 92), add to the request body:
```typescript
graph_id: config.graphId,
```

In `createCorrectTool`, update config type and add to the request body:
```typescript
graph_id: config.graphId,
```

**Step 2: Update pod-builder.ts**

In `packages/operator/src/pod-builder.ts`, after the `KNOWLEDGE_SERVICE_URL` env var (line 113), add:

```typescript
{ name: 'KNOWLEDGE_GRAPH_ID', value: '' },  // Set by operator if KnowledgeGraph exists for this scope
```

**Step 3: Update main.ts in cell-runtime**

In `packages/cell-runtime/src/main.ts`, where knowledge tools are registered, read the env var:

```typescript
const graphId = process.env['KNOWLEDGE_GRAPH_ID'] || undefined;
```

And pass `graphId` into the `KnowledgeToolConfig` when creating tools.

**Step 4: Update tests**

In `packages/cell-runtime/src/__tests__/knowledge-tools.test.ts`, add a test:

```typescript
it('includes graph_id in recall request when configured', async () => {
  const tool = createRecallTool({
    knowledgeUrl: 'http://knowledge:8000',
    cellName: 'test',
    namespace: 'default',
    graphId: 'trading-kg',
  });

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  });

  await tool.execute({ query: 'test' });

  expect(global.fetch).toHaveBeenCalledWith(
    'http://knowledge:8000/recall',
    expect.objectContaining({
      body: expect.stringContaining('"graph_id":"trading-kg"'),
    }),
  );
});
```

**Step 5: Run tests**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/cell-runtime exec vitest run`
Expected: All tests pass

**Step 6: Commit**

```bash
git add packages/cell-runtime/ packages/operator/src/pod-builder.ts
git commit -m "feat: wire KNOWLEDGE_GRAPH_ID through pod-builder and knowledge tools"
```

---

### Task 7: CLI commands for KnowledgeGraph

**Files:**
- Modify: `packages/cli/src/kais.ts:561` (add `knowledge graphs` subcommand before blueprint section)

**Step 1: Add CLI commands**

After the existing `knowledge add` subcommand (around line 561), add:

```typescript
const knowledgeGraphs = knowledge.command('graphs').description('Manage KnowledgeGraph resources');

knowledgeGraphs
  .command('list')
  .description('List KnowledgeGraph resources')
  .action(async () => {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    const res = await customApi.listNamespacedCustomObject({
      group: 'kais.io',
      version: 'v1',
      namespace: 'default',
      plural: 'knowledgegraphs',
    });
    const items = ((res as any).items ?? []) as any[];
    if (items.length === 0) {
      console.log('No KnowledgeGraph resources found.');
      return;
    }
    console.log(`${'NAME'.padEnd(25)} ${'SCOPE'.padEnd(12)} ${'DEDICATED'.padEnd(10)} ${'INHERIT'.padEnd(8)} ${'PHASE'.padEnd(12)} ${'PARENT'.padEnd(20)}`);
    for (const kg of items) {
      const name = kg.metadata?.name ?? '';
      const scope = kg.spec?.scope?.level ?? '';
      const dedicated = kg.spec?.dedicated ? 'yes' : 'no';
      const inherit = kg.spec?.inherit !== false ? 'yes' : 'no';
      const phase = kg.status?.phase ?? 'Unknown';
      const parent = kg.spec?.parentRef ?? '-';
      console.log(`${name.padEnd(25)} ${scope.padEnd(12)} ${dedicated.padEnd(10)} ${inherit.padEnd(8)} ${phase.padEnd(12)} ${parent.padEnd(20)}`);
    }
  });

knowledgeGraphs
  .command('describe <name>')
  .description('Describe a KnowledgeGraph resource')
  .action(async (name: string) => {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    try {
      const res = await customApi.getNamespacedCustomObject({
        group: 'kais.io',
        version: 'v1',
        namespace: 'default',
        plural: 'knowledgegraphs',
        name,
      });
      console.log(JSON.stringify(res, null, 2));
    } catch {
      console.error(`KnowledgeGraph "${name}" not found.`);
      process.exit(1);
    }
  });
```

**Step 2: Run CLI tests**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/cli exec vitest run`
Expected: All tests pass

**Step 3: Commit**

```bash
git add packages/cli/src/kais.ts
git commit -m "feat(cli): add knowledge graphs list/describe commands"
```

---

### Task 8: API proxy for graph registration

**Files:**
- Modify: `packages/api/src/server.ts` (add `/api/v1/knowledge/graphs` proxy routes after existing knowledge routes)

**Step 1: Add routes**

After the existing knowledge proxy routes (around line 290 in `packages/api/src/server.ts`), add:

```typescript
  app.get('/api/v1/knowledge/graphs', async (_req, reply) => {
    const res = await fetch(`${KNOWLEDGE_URL}/graphs/list`);
    reply.status(res.status).send(await res.json());
  });

  app.post('/api/v1/knowledge/graphs/register', async (req, reply) => {
    const res = await fetch(`${KNOWLEDGE_URL}/graphs/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    reply.status(res.status).send(await res.json());
  });

  app.post('/api/v1/knowledge/graphs/unregister', async (req, reply) => {
    const res = await fetch(`${KNOWLEDGE_URL}/graphs/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    reply.status(res.status).send(await res.json());
  });
```

**Step 2: Build and test**

Run: `cd /home/tim/kAIs && pnpm --filter @kais/api run build && pnpm --filter @kais/api exec vitest run`
Expected: Build succeeds, all tests pass

**Step 3: Commit**

```bash
git add packages/api/src/server.ts
git commit -m "feat(api): add knowledge graph registration proxy routes"
```

---

### Task 9: Build, test, verify

**Step 1: Build all packages**

Run: `cd /home/tim/kAIs && pnpm run build`
Expected: All packages compile

**Step 2: Run all unit tests**

Run: `cd /home/tim/kAIs && pnpm run test`
Expected: All unit tests pass (integration tests may fail without infrastructure — that's OK)

**Step 3: Run Python tests**

Run: `cd /home/tim/kAIs/packages/knowledge && python -m pytest tests/ -v`
Expected: All tests pass

**Step 4: Commit any remaining fixes**

```bash
git add -A && git commit -m "fix: address build/test issues from KnowledgeGraph CRD implementation"
```

---

## Execution order

Tasks 1 → 2 → 3 → 4 (sequential: schemas → CRD → types → controller)
Tasks 5, 6, 7, 8 can run after Task 4
Task 9 is final verification
