# Phase 4: Knowledge Graph + Blueprints — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cells accumulate knowledge between missions via a Graphiti-backed Knowledge Service; successful configurations become reusable Blueprint templates.

**Architecture:** Python FastAPI knowledge service wrapping Graphiti + Neo4j for temporal knowledge management. Blueprint CRD with nunjucks template rendering. Knowledge tools (recall/remember/correct) in cell-runtime via HTTP. Automatic post-mission knowledge extraction via MissionController hook.

**Tech Stack:** Python 3.12, FastAPI, graphiti-core, neo4j, pydantic; TypeScript nunjucks, Zod schemas; Helm charts for Neo4j.

---

## Task 1: Knowledge & Blueprint Schemas in @kais/core

**Files:**
- Modify: `packages/core/src/schemas.ts` (after line 405)
- Modify: `packages/core/src/types.ts` (after line 109)
- Modify: `packages/core/src/index.ts` (add exports)
- Test: `packages/core/src/__tests__/knowledge-schemas.test.ts`

**Step 1: Write failing tests for Knowledge schemas**

```typescript
// packages/core/src/__tests__/knowledge-schemas.test.ts
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
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/core && pnpm test -- --run knowledge-schemas`
Expected: FAIL — imports don't exist

**Step 3: Implement schemas**

Add to `packages/core/src/schemas.ts` after line 405:

```typescript
// --- Knowledge ---

export const KnowledgeScopeLevelSchema = z.enum([
  'platform',
  'realm',
  'formation',
  'cell',
]);

export const KnowledgeScopeSchema = z.object({
  level: KnowledgeScopeLevelSchema,
  realmId: z.string().optional(),
  formationId: z.string().optional(),
  cellId: z.string().optional(),
});

export const FactSourceTypeSchema = z.enum([
  'mission_extraction',
  'experiment',
  'user_input',
  'promoted',
  'explicit_remember',
]);

export const FactSourceSchema = z.object({
  type: FactSourceTypeSchema,
  missionId: z.string().optional(),
  experimentId: z.string().optional(),
  missionResult: z.string().optional(),
  fromFactId: z.string().optional(),
});

export const FactSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  embedding: z.array(z.number()).optional(),
  scope: KnowledgeScopeSchema,
  source: FactSourceSchema,
  confidence: z.number().min(0).max(1),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().optional(),
  tags: z.array(z.string()),
});

export const SearchOptionsSchema = z.object({
  maxResults: z.number().int().positive().default(20),
  minConfidence: z.number().min(0).max(1).default(0),
  includeInvalidated: z.boolean().default(false),
  semantic: z.boolean().default(true),
  recency: z.enum(['prefer_recent', 'prefer_established', 'any']).default('any'),
});

// --- Blueprint ---

export const BlueprintParameterTypeSchema = z.enum([
  'string',
  'integer',
  'number',
  'boolean',
  'enum',
]);

export const BlueprintParameterSchema = z.object({
  name: z.string().min(1),
  type: BlueprintParameterTypeSchema,
  default: z.unknown().optional(),
  description: z.string().optional(),
  values: z.array(z.unknown()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const BlueprintEvidenceSchema = z.object({
  experiments: z.array(z.object({
    name: z.string(),
    finding: z.string(),
  })).optional(),
  successRate: z.number().min(0).max(1).optional(),
  avgCompletionTime: z.number().nonnegative().optional(),
  avgCost: z.number().nonnegative().optional(),
});

export const BlueprintSpecSchema = z.object({
  description: z.string().optional(),
  parameters: z.array(BlueprintParameterSchema),
  formation: z.unknown(),
  mission: z.unknown().optional(),
  evidence: BlueprintEvidenceSchema.optional(),
});

export const BlueprintVersionSchema = z.object({
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  changes: z.string().optional(),
});

export const BlueprintStatusSchema = z.object({
  usageCount: z.number().int().nonnegative().default(0),
  lastUsed: z.string().datetime().optional(),
  avgSuccessRate: z.number().min(0).max(1).optional(),
  versions: z.array(BlueprintVersionSchema).optional(),
});
```

Add to `packages/core/src/types.ts` after line 109:

```typescript
// Knowledge types
export type KnowledgeScopeLevel = z.infer<typeof KnowledgeScopeLevelSchema>;
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>;
export type FactSourceType = z.infer<typeof FactSourceTypeSchema>;
export type FactSource = z.infer<typeof FactSourceSchema>;
export type Fact = z.infer<typeof FactSchema>;
export type SearchOptions = z.infer<typeof SearchOptionsSchema>;

// Blueprint types
export type BlueprintParameterType = z.infer<typeof BlueprintParameterTypeSchema>;
export type BlueprintParameter = z.infer<typeof BlueprintParameterSchema>;
export type BlueprintEvidence = z.infer<typeof BlueprintEvidenceSchema>;
export type BlueprintSpec = z.infer<typeof BlueprintSpecSchema>;
export type BlueprintVersion = z.infer<typeof BlueprintVersionSchema>;
export type BlueprintStatus = z.infer<typeof BlueprintStatusSchema>;
```

Add corresponding imports to `types.ts` and exports to `index.ts`.

**Step 4: Run tests to verify they pass**

Run: `cd packages/core && pnpm test -- --run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/types.ts packages/core/src/index.ts packages/core/src/__tests__/knowledge-schemas.test.ts
git commit -m "feat(core): add Knowledge and Blueprint schemas"
```

---

## Task 2: KnowledgeStore Interface in @kais/core

**Files:**
- Create: `packages/core/src/knowledge.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/src/__tests__/knowledge.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/core/src/__tests__/knowledge.test.ts
import { describe, it, expect } from 'vitest';
import type { KnowledgeStore, ScopedKnowledgeStore } from '../knowledge.js';
import { InMemoryKnowledgeStore } from '../knowledge.js';

describe('InMemoryKnowledgeStore', () => {
  it('adds and retrieves a fact', async () => {
    const store = new InMemoryKnowledgeStore();
    const id = await store.addFact({
      content: 'TypeScript projects should use strict mode',
      scope: { level: 'platform' },
      source: { type: 'user_input' },
      confidence: 0.95,
      tags: ['typescript'],
    });
    expect(id).toBeTruthy();

    const facts = await store.search('typescript strict', { level: 'platform' });
    expect(facts).toHaveLength(1);
    expect(facts[0]!.content).toContain('strict mode');
  });

  it('respects scope hierarchy — cell sees platform facts', async () => {
    const store = new InMemoryKnowledgeStore();
    await store.addFact({
      content: 'Platform fact',
      scope: { level: 'platform' },
      source: { type: 'user_input' },
      confidence: 0.9,
      tags: [],
    });
    await store.addFact({
      content: 'Cell fact',
      scope: { level: 'cell', realmId: 'default', cellId: 'arch-0' },
      source: { type: 'explicit_remember' },
      confidence: 0.8,
      tags: [],
    });

    // Cell-level search should see both
    const cellFacts = await store.search('fact', {
      level: 'cell',
      realmId: 'default',
      cellId: 'arch-0',
    });
    expect(cellFacts.length).toBeGreaterThanOrEqual(2);

    // Platform search should NOT see cell facts
    const platformFacts = await store.search('fact', { level: 'platform' });
    expect(platformFacts).toHaveLength(1);
    expect(platformFacts[0]!.content).toBe('Platform fact');
  });

  it('invalidates a fact', async () => {
    const store = new InMemoryKnowledgeStore();
    const id = await store.addFact({
      content: 'Old fact',
      scope: { level: 'platform' },
      source: { type: 'user_input' },
      confidence: 0.9,
      tags: [],
    });

    await store.invalidateFact(id, 'Superseded');

    const facts = await store.search('old', { level: 'platform' });
    expect(facts).toHaveLength(0);

    // With includeInvalidated
    const allFacts = await store.search('old', { level: 'platform' }, { includeInvalidated: true });
    expect(allFacts).toHaveLength(1);
  });

  it('creates a scoped view', async () => {
    const store = new InMemoryKnowledgeStore();
    await store.addFact({
      content: 'Realm fact',
      scope: { level: 'realm', realmId: 'project-x' },
      source: { type: 'user_input' },
      confidence: 0.9,
      tags: [],
    });

    const scoped = store.scopedView({ level: 'realm', realmId: 'project-x' });
    const facts = await scoped.search('realm');
    expect(facts).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd packages/core && pnpm test -- --run knowledge.test`
Expected: FAIL

**Step 3: Implement KnowledgeStore interface + InMemoryKnowledgeStore**

```typescript
// packages/core/src/knowledge.ts
import { randomUUID } from 'node:crypto';
import type { Fact, KnowledgeScope, SearchOptions } from './types.js';

/** Input for adding a new fact (id and validFrom are auto-generated). */
export interface AddFactInput {
  content: string;
  scope: KnowledgeScope;
  source: Fact['source'];
  confidence: number;
  tags: string[];
  embedding?: number[];
}

/** Abstract knowledge store interface — backend-agnostic. */
export interface KnowledgeStore {
  addFact(input: AddFactInput): Promise<string>;
  invalidateFact(factId: string, reason: string): Promise<void>;
  search(
    query: string,
    scope: KnowledgeScope,
    options?: Partial<SearchOptions>,
  ): Promise<Fact[]>;
  getRelated(factId: string): Promise<Fact[]>;
  scopedView(scope: KnowledgeScope): ScopedKnowledgeStore;
}

/** A scope-restricted view of a KnowledgeStore. */
export interface ScopedKnowledgeStore {
  search(query: string, options?: Partial<SearchOptions>): Promise<Fact[]>;
  addFact(input: Omit<AddFactInput, 'scope'>): Promise<string>;
  invalidateFact(factId: string, reason: string): Promise<void>;
}

/** Scope hierarchy levels from broadest to narrowest. */
const SCOPE_LEVELS: KnowledgeScope['level'][] = ['platform', 'realm', 'formation', 'cell'];

/** Check if a fact's scope is visible from the given query scope. */
function isVisible(factScope: KnowledgeScope, queryScope: KnowledgeScope): boolean {
  const factLevel = SCOPE_LEVELS.indexOf(factScope.level);
  const queryLevel = SCOPE_LEVELS.indexOf(queryScope.level);

  // Facts at broader scope are always visible
  if (factLevel < queryLevel) return true;
  if (factLevel > queryLevel) return false;

  // Same level: check IDs match
  switch (factScope.level) {
    case 'platform':
      return true;
    case 'realm':
      return factScope.realmId === queryScope.realmId;
    case 'formation':
      return (
        factScope.realmId === queryScope.realmId &&
        factScope.formationId === queryScope.formationId
      );
    case 'cell':
      return (
        factScope.realmId === queryScope.realmId &&
        factScope.formationId === queryScope.formationId &&
        factScope.cellId === queryScope.cellId
      );
    default:
      return false;
  }
}

/** Simple keyword matching for in-memory search (production uses Graphiti). */
function matches(fact: Fact, query: string): boolean {
  const lower = query.toLowerCase();
  const words = lower.split(/\s+/);
  const content = fact.content.toLowerCase();
  const tagStr = fact.tags.join(' ').toLowerCase();
  return words.some((w) => content.includes(w) || tagStr.includes(w));
}

/**
 * In-memory implementation of KnowledgeStore.
 * Used for unit tests and development. Production uses GraphitiKnowledgeStore (Python).
 */
export class InMemoryKnowledgeStore implements KnowledgeStore {
  private readonly facts: Map<string, Fact> = new Map();

  async addFact(input: AddFactInput): Promise<string> {
    const id = randomUUID();
    const fact: Fact = {
      id,
      content: input.content,
      scope: input.scope,
      source: input.source,
      confidence: input.confidence,
      validFrom: new Date().toISOString(),
      tags: input.tags,
      embedding: input.embedding,
    };
    this.facts.set(id, fact);
    return id;
  }

  async invalidateFact(factId: string, _reason: string): Promise<void> {
    const fact = this.facts.get(factId);
    if (fact) {
      fact.validUntil = new Date().toISOString();
    }
  }

  async search(
    query: string,
    scope: KnowledgeScope,
    options?: Partial<SearchOptions>,
  ): Promise<Fact[]> {
    const maxResults = options?.maxResults ?? 20;
    const minConfidence = options?.minConfidence ?? 0;
    const includeInvalidated = options?.includeInvalidated ?? false;

    const results: Fact[] = [];
    for (const fact of this.facts.values()) {
      if (!includeInvalidated && fact.validUntil) continue;
      if (fact.confidence < minConfidence) continue;
      if (!isVisible(fact.scope, scope)) continue;
      if (!matches(fact, query)) continue;
      results.push(fact);
    }

    // Sort by confidence descending
    results.sort((a, b) => b.confidence - a.confidence);
    return results.slice(0, maxResults);
  }

  async getRelated(_factId: string): Promise<Fact[]> {
    return []; // Not implemented for in-memory store
  }

  scopedView(scope: KnowledgeScope): ScopedKnowledgeStore {
    const self = this;
    return {
      async search(query: string, options?: Partial<SearchOptions>) {
        return self.search(query, scope, options);
      },
      async addFact(input: Omit<AddFactInput, 'scope'>) {
        return self.addFact({ ...input, scope });
      },
      async invalidateFact(factId: string, reason: string) {
        return self.invalidateFact(factId, reason);
      },
    };
  }
}
```

**Step 4: Export from index.ts**

Add to `packages/core/src/index.ts`:

```typescript
// Knowledge store
export { InMemoryKnowledgeStore } from './knowledge.js';
export type { KnowledgeStore, ScopedKnowledgeStore, AddFactInput } from './knowledge.js';
```

**Step 5: Run tests**

Run: `cd packages/core && pnpm test -- --run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add packages/core/src/knowledge.ts packages/core/src/__tests__/knowledge.test.ts packages/core/src/index.ts
git commit -m "feat(core): add KnowledgeStore interface + InMemoryKnowledgeStore"
```

---

## Task 3: Blueprint CRD YAML

**Files:**
- Create: `deploy/crds/blueprint-crd.yaml`

**Step 1: Write the CRD**

```yaml
# deploy/crds/blueprint-crd.yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: blueprints.kais.io
spec:
  group: kais.io
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          required: [spec]
          properties:
            spec:
              type: object
              required: [parameters, formation]
              properties:
                description:
                  type: string
                parameters:
                  type: array
                  items:
                    type: object
                    required: [name, type]
                    properties:
                      name:
                        type: string
                      type:
                        type: string
                        enum: [string, integer, number, boolean, enum]
                      default:
                        x-kubernetes-preserve-unknown-fields: true
                      description:
                        type: string
                      values:
                        type: array
                        items:
                          x-kubernetes-preserve-unknown-fields: true
                      min:
                        type: number
                      max:
                        type: number
                formation:
                  type: object
                  x-kubernetes-preserve-unknown-fields: true
                mission:
                  type: object
                  x-kubernetes-preserve-unknown-fields: true
                evidence:
                  type: object
                  properties:
                    experiments:
                      type: array
                      items:
                        type: object
                        properties:
                          name:
                            type: string
                          finding:
                            type: string
                    successRate:
                      type: number
                    avgCompletionTime:
                      type: number
                    avgCost:
                      type: number
            status:
              type: object
              properties:
                usageCount:
                  type: integer
                  default: 0
                lastUsed:
                  type: string
                  format: date-time
                avgSuccessRate:
                  type: number
                versions:
                  type: array
                  items:
                    type: object
                    properties:
                      version:
                        type: integer
                      createdAt:
                        type: string
                        format: date-time
                      changes:
                        type: string
      subresources:
        status: {}
      additionalPrinterColumns:
        - name: Parameters
          type: integer
          jsonPath: .spec.parameters
          description: Number of template parameters
        - name: Uses
          type: integer
          jsonPath: .status.usageCount
        - name: Success
          type: number
          jsonPath: .status.avgSuccessRate
        - name: Age
          type: date
          jsonPath: .metadata.creationTimestamp
  scope: Namespaced
  names:
    plural: blueprints
    singular: blueprint
    kind: Blueprint
    shortNames: [bp]
```

**Step 2: Commit**

```bash
git add deploy/crds/blueprint-crd.yaml
git commit -m "feat(deploy): add Blueprint CRD"
```

---

## Task 4: Blueprint Template Renderer

**Files:**
- Create: `packages/operator/src/blueprint-renderer.ts`
- Test: `packages/operator/src/__tests__/blueprint-renderer.test.ts`
- Modify: `packages/operator/package.json` (add nunjucks)

**Step 1: Add nunjucks dependency**

Run: `cd packages/operator && pnpm add nunjucks && pnpm add -D @types/nunjucks`

**Step 2: Write failing tests**

```typescript
// packages/operator/src/__tests__/blueprint-renderer.test.ts
import { describe, it, expect } from 'vitest';
import { renderBlueprint } from '../blueprint-renderer.js';

describe('BlueprintRenderer', () => {
  it('renders simple variable substitution', () => {
    const template = {
      cells: [
        {
          name: 'developer',
          replicas: '{{ developer_count }}',
          spec: {
            mind: {
              model: '{{ model }}',
              systemPrompt: 'You write {{ language }} code.',
            },
          },
        },
      ],
    };

    const result = renderBlueprint(template, {
      developer_count: 3,
      model: 'claude-sonnet-4-20250514',
      language: 'typescript',
    });

    expect(result.cells[0].replicas).toBe(3);
    expect(result.cells[0].spec.mind.model).toBe('claude-sonnet-4-20250514');
    expect(result.cells[0].spec.mind.systemPrompt).toBe('You write typescript code.');
  });

  it('renders conditional blocks', () => {
    const template = {
      provider: "{% if tier == 'premium' %}anthropic{% else %}ollama{% endif %}",
    };

    const premium = renderBlueprint(template, { tier: 'premium' });
    expect(premium.provider).toBe('anthropic');

    const budget = renderBlueprint(template, { tier: 'budget' });
    expect(budget.provider).toBe('ollama');
  });

  it('preserves non-template values', () => {
    const template = {
      name: 'static',
      count: 42,
      nested: { flag: true },
    };

    const result = renderBlueprint(template, {});
    expect(result).toEqual(template);
  });

  it('renders nested objects recursively', () => {
    const template = {
      a: { b: { c: '{{ val }}' } },
    };

    const result = renderBlueprint(template, { val: 'deep' });
    expect(result.a.b.c).toBe('deep');
  });

  it('coerces numeric strings to numbers', () => {
    const template = { replicas: '{{ count }}' };
    const result = renderBlueprint(template, { count: 5 });
    expect(result.replicas).toBe(5);
    expect(typeof result.replicas).toBe('number');
  });
});
```

**Step 3: Implement renderer**

```typescript
// packages/operator/src/blueprint-renderer.ts
import nunjucks from 'nunjucks';

const env = new nunjucks.Environment(null, { autoescape: false });

/**
 * Recursively render nunjucks templates in an object.
 * Strings containing {{ }} or {% %} are rendered; everything else passes through.
 */
export function renderBlueprint(
  template: unknown,
  params: Record<string, unknown>,
): any {
  if (typeof template === 'string') {
    if (!template.includes('{{') && !template.includes('{%')) {
      return template;
    }
    const rendered = env.renderString(template, params).trim();
    // Try to coerce to number/boolean
    if (rendered === 'true') return true;
    if (rendered === 'false') return false;
    const num = Number(rendered);
    if (!isNaN(num) && rendered !== '') return num;
    return rendered;
  }

  if (Array.isArray(template)) {
    return template.map((item) => renderBlueprint(item, params));
  }

  if (template !== null && typeof template === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      result[key] = renderBlueprint(value, params);
    }
    return result;
  }

  return template; // number, boolean, null
}
```

**Step 4: Run tests**

Run: `cd packages/operator && pnpm test -- --run blueprint-renderer`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/operator/src/blueprint-renderer.ts packages/operator/src/__tests__/blueprint-renderer.test.ts packages/operator/package.json pnpm-lock.yaml
git commit -m "feat(operator): add Blueprint template renderer with nunjucks"
```

---

## Task 5: BlueprintController

**Files:**
- Create: `packages/operator/src/blueprint-controller.ts`
- Modify: `packages/operator/src/types.ts` (add BlueprintResource, BlueprintEventType)
- Modify: `packages/operator/src/index.ts` (export)
- Test: `packages/operator/src/__tests__/blueprint-controller.test.ts`

**Step 1: Add types**

In `packages/operator/src/types.ts`, add:

```typescript
import type { BlueprintSpec, BlueprintStatus } from '@kais/core';

export interface BlueprintResource {
  apiVersion: 'kais.io/v1';
  kind: 'Blueprint';
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    resourceVersion?: string;
  };
  spec: BlueprintSpec;
  status?: BlueprintStatus;
}

export type BlueprintEventType =
  | 'BlueprintCreated'
  | 'BlueprintUpdated'
  | 'BlueprintVersioned';
```

Add to KubeClient interface:

```typescript
  updateBlueprintStatus(
    name: string,
    namespace: string,
    status: BlueprintStatus,
  ): Promise<void>;

  emitBlueprintEvent(
    blueprint: BlueprintResource,
    eventType: BlueprintEventType,
    reason: string,
    message: string,
  ): Promise<void>;
```

**Step 2: Write failing tests**

```typescript
// packages/operator/src/__tests__/blueprint-controller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlueprintController } from '../blueprint-controller.js';
import type { KubeClient, BlueprintResource } from '../types.js';

function makeMockKube(): KubeClient {
  return {
    // ... all existing mock methods ...
    updateBlueprintStatus: vi.fn(),
    emitBlueprintEvent: vi.fn(),
  } as unknown as KubeClient;
}

describe('BlueprintController', () => {
  it('tracks version on spec change', async () => {
    const kube = makeMockKube();
    const controller = new BlueprintController(kube);

    const blueprint: BlueprintResource = {
      apiVersion: 'kais.io/v1',
      kind: 'Blueprint',
      metadata: { name: 'test-bp', namespace: 'default', uid: 'uid-1', resourceVersion: '1' },
      spec: {
        parameters: [{ name: 'lang', type: 'string', default: 'ts' }],
        formation: { cells: [] },
      },
    };

    await controller.reconcile(blueprint);

    expect(kube.updateBlueprintStatus).toHaveBeenCalledWith(
      'test-bp',
      'default',
      expect.objectContaining({
        versions: expect.arrayContaining([
          expect.objectContaining({ version: 1 }),
        ]),
      }),
    );
  });

  it('increments version on spec change', async () => {
    const kube = makeMockKube();
    const controller = new BlueprintController(kube);

    const bp1: BlueprintResource = {
      apiVersion: 'kais.io/v1',
      kind: 'Blueprint',
      metadata: { name: 'test-bp', namespace: 'default', uid: 'uid-1', resourceVersion: '1' },
      spec: {
        parameters: [{ name: 'lang', type: 'string', default: 'ts' }],
        formation: { cells: [] },
      },
      status: {
        usageCount: 0,
        versions: [{ version: 1, createdAt: '2026-01-01T00:00:00Z' }],
      },
    };

    // Change spec
    const bp2 = { ...bp1, spec: { ...bp1.spec, description: 'Updated' } };
    await controller.reconcile(bp2);

    expect(kube.updateBlueprintStatus).toHaveBeenCalledWith(
      'test-bp',
      'default',
      expect.objectContaining({
        versions: expect.arrayContaining([
          expect.objectContaining({ version: 2 }),
        ]),
      }),
    );
  });
});
```

**Step 3: Implement BlueprintController**

```typescript
// packages/operator/src/blueprint-controller.ts
import type { BlueprintStatus } from '@kais/core';
import { getTracer } from '@kais/core';
import { specChanged } from './spec-changed.js';
import type { BlueprintResource, KubeClient } from './types.js';

const tracer = getTracer('kais-operator');

export class BlueprintController {
  private readonly kube: KubeClient;
  private readonly lastSpecs = new Map<string, unknown>();

  constructor(kube: KubeClient) {
    this.kube = kube;
  }

  async reconcile(blueprint: BlueprintResource): Promise<void> {
    const span = tracer.startSpan('operator.reconcile_blueprint', {
      attributes: { 'resource.name': blueprint.metadata.name },
    });
    try {
      const key = `${blueprint.metadata.namespace}/${blueprint.metadata.name}`;
      const lastSpec = this.lastSpecs.get(key);
      const currentVersions = blueprint.status?.versions ?? [];
      const currentVersion = currentVersions.length > 0
        ? Math.max(...currentVersions.map((v) => v.version))
        : 0;

      let newVersions = [...currentVersions];

      if (!lastSpec || specChanged(lastSpec, blueprint.spec)) {
        const newVersion = currentVersion + 1;
        newVersions.push({
          version: newVersion,
          createdAt: new Date().toISOString(),
          changes: lastSpec ? 'Spec updated' : 'Initial version',
        });
      }

      this.lastSpecs.set(key, JSON.parse(JSON.stringify(blueprint.spec)));

      const status: BlueprintStatus = {
        usageCount: blueprint.status?.usageCount ?? 0,
        lastUsed: blueprint.status?.lastUsed,
        avgSuccessRate: blueprint.status?.avgSuccessRate,
        versions: newVersions,
      };

      await this.kube.updateBlueprintStatus(
        blueprint.metadata.name,
        blueprint.metadata.namespace,
        status,
      );
    } finally {
      span.end();
    }
  }
}
```

**Step 4: Run tests and commit**

Run: `cd packages/operator && pnpm test -- --run blueprint`
Expected: PASS

```bash
git add packages/operator/src/blueprint-controller.ts packages/operator/src/__tests__/blueprint-controller.test.ts packages/operator/src/types.ts packages/operator/src/index.ts
git commit -m "feat(operator): add BlueprintController with version tracking"
```

---

## Task 6: Python Knowledge Service

**Files:**
- Create: `packages/knowledge/pyproject.toml`
- Create: `packages/knowledge/Dockerfile`
- Create: `packages/knowledge/src/knowledge/__init__.py`
- Create: `packages/knowledge/src/knowledge/main.py`
- Create: `packages/knowledge/src/knowledge/models.py`
- Create: `packages/knowledge/src/knowledge/store.py`
- Create: `packages/knowledge/src/knowledge/scoping.py`
- Create: `packages/knowledge/tests/test_models.py`
- Create: `packages/knowledge/tests/test_store.py`

**Step 1: Create pyproject.toml**

```toml
[project]
name = "kais-knowledge"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.34.0",
    "graphiti-core>=0.5.0",
    "neo4j>=5.28.0",
    "pydantic>=2.10.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "httpx>=0.28",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

**Step 2: Create Pydantic models**

```python
# packages/knowledge/src/knowledge/models.py
from __future__ import annotations
from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field

class ScopeLevel(str, Enum):
    platform = "platform"
    realm = "realm"
    formation = "formation"
    cell = "cell"

class KnowledgeScope(BaseModel):
    level: ScopeLevel
    realm_id: str | None = None
    formation_id: str | None = None
    cell_id: str | None = None

class FactSourceType(str, Enum):
    mission_extraction = "mission_extraction"
    experiment = "experiment"
    user_input = "user_input"
    promoted = "promoted"
    explicit_remember = "explicit_remember"

class FactSource(BaseModel):
    type: FactSourceType
    mission_id: str | None = None
    experiment_id: str | None = None

class Fact(BaseModel):
    id: str
    content: str
    scope: KnowledgeScope
    source: FactSource
    confidence: float = Field(ge=0, le=1)
    valid_from: datetime
    valid_until: datetime | None = None
    tags: list[str] = []

class AddFactRequest(BaseModel):
    content: str
    scope: KnowledgeScope
    source: FactSource
    confidence: float = Field(ge=0, le=1, default=0.5)
    tags: list[str] = []

class SearchRequest(BaseModel):
    query: str
    scope: KnowledgeScope
    max_results: int = 20
    min_confidence: float = 0.0
    include_invalidated: bool = False

class InvalidateRequest(BaseModel):
    fact_id: str
    reason: str
```

**Step 3: Create store wrapper**

```python
# packages/knowledge/src/knowledge/store.py
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from .models import Fact, AddFactRequest, SearchRequest, KnowledgeScope, ScopeLevel

SCOPE_ORDER = [ScopeLevel.platform, ScopeLevel.realm, ScopeLevel.formation, ScopeLevel.cell]

def is_visible(fact_scope: KnowledgeScope, query_scope: KnowledgeScope) -> bool:
    """Check if a fact's scope is visible from the query scope."""
    fact_level = SCOPE_ORDER.index(fact_scope.level)
    query_level = SCOPE_ORDER.index(query_scope.level)
    if fact_level < query_level:
        return True
    if fact_level > query_level:
        return False
    # Same level — check IDs
    if fact_scope.level == ScopeLevel.platform:
        return True
    if fact_scope.level == ScopeLevel.realm:
        return fact_scope.realm_id == query_scope.realm_id
    if fact_scope.level == ScopeLevel.formation:
        return (fact_scope.realm_id == query_scope.realm_id and
                fact_scope.formation_id == query_scope.formation_id)
    if fact_scope.level == ScopeLevel.cell:
        return (fact_scope.realm_id == query_scope.realm_id and
                fact_scope.formation_id == query_scope.formation_id and
                fact_scope.cell_id == query_scope.cell_id)
    return False


class GraphitiKnowledgeStore:
    """
    Knowledge store backed by Graphiti + Neo4j.
    Falls back to in-memory keyword matching when Graphiti is not available.
    """

    def __init__(self, graphiti_client=None):
        self._graphiti = graphiti_client
        self._facts: dict[str, Fact] = {}  # in-memory fallback

    async def add_fact(self, req: AddFactRequest) -> str:
        fact_id = str(uuid.uuid4())
        fact = Fact(
            id=fact_id,
            content=req.content,
            scope=req.scope,
            source=req.source,
            confidence=req.confidence,
            valid_from=datetime.now(timezone.utc),
            tags=req.tags,
        )

        if self._graphiti:
            # Use Graphiti's add_episode for entity extraction
            await self._graphiti.add_episode(
                name=f"fact-{fact_id}",
                episode_body=req.content,
                source_description=f"kais:{req.source.type}",
                group_id=self._scope_group(req.scope),
            )

        self._facts[fact_id] = fact
        return fact_id

    async def search(self, req: SearchRequest) -> list[Fact]:
        if self._graphiti:
            # Use Graphiti hybrid search
            results = await self._graphiti.search(
                query=req.query,
                group_ids=self._visible_groups(req.scope),
                num_results=req.max_results,
            )
            # Map Graphiti nodes back to Facts
            return self._map_graphiti_results(results, req)

        # In-memory fallback: simple keyword matching
        query_lower = req.query.lower()
        words = query_lower.split()
        matches = []
        for fact in self._facts.values():
            if not req.include_invalidated and fact.valid_until is not None:
                continue
            if fact.confidence < req.min_confidence:
                continue
            if not is_visible(fact.scope, req.scope):
                continue
            content_lower = fact.content.lower()
            if any(w in content_lower or w in " ".join(fact.tags).lower() for w in words):
                matches.append(fact)

        matches.sort(key=lambda f: f.confidence, reverse=True)
        return matches[: req.max_results]

    async def invalidate(self, fact_id: str, reason: str) -> None:
        fact = self._facts.get(fact_id)
        if fact:
            fact.valid_until = datetime.now(timezone.utc)

    def _scope_group(self, scope: KnowledgeScope) -> str:
        parts = [scope.level.value]
        if scope.realm_id:
            parts.append(scope.realm_id)
        if scope.formation_id:
            parts.append(scope.formation_id)
        if scope.cell_id:
            parts.append(scope.cell_id)
        return ":".join(parts)

    def _visible_groups(self, scope: KnowledgeScope) -> list[str]:
        groups = ["platform"]
        if scope.realm_id:
            groups.append(f"realm:{scope.realm_id}")
        if scope.formation_id:
            groups.append(f"formation:{scope.realm_id}:{scope.formation_id}")
        if scope.cell_id:
            groups.append(f"cell:{scope.realm_id}:{scope.formation_id}:{scope.cell_id}")
        return groups

    def _map_graphiti_results(self, results, req: SearchRequest) -> list[Fact]:
        # Placeholder — map Graphiti EntityNode results to Fact objects
        return []
```

**Step 4: Create FastAPI app**

```python
# packages/knowledge/src/knowledge/main.py
from __future__ import annotations
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from .models import AddFactRequest, SearchRequest, InvalidateRequest, Fact
from .store import GraphitiKnowledgeStore

store: GraphitiKnowledgeStore | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global store
    neo4j_url = os.getenv("NEO4J_URL")
    graphiti_client = None

    if neo4j_url:
        try:
            from graphiti_core import Graphiti
            graphiti_client = Graphiti(neo4j_url, os.getenv("NEO4J_USER", "neo4j"), os.getenv("NEO4J_PASSWORD", "kais"))
            await graphiti_client.build_indices_and_constraints()
        except Exception as e:
            print(f"[knowledge] Graphiti init failed, using in-memory fallback: {e}")

    store = GraphitiKnowledgeStore(graphiti_client)
    yield

    if graphiti_client:
        await graphiti_client.close()

app = FastAPI(title="kAIs Knowledge Service", lifespan=lifespan)

@app.post("/recall", response_model=list[Fact])
async def recall(req: SearchRequest) -> list[Fact]:
    assert store is not None
    return await store.search(req)

@app.post("/remember")
async def remember(req: AddFactRequest) -> dict[str, str]:
    assert store is not None
    fact_id = await store.add_fact(req)
    return {"factId": fact_id}

@app.post("/correct")
async def correct(req: InvalidateRequest) -> dict[str, str]:
    assert store is not None
    await store.invalidate(req.fact_id, req.reason)
    return {"status": "ok"}

@app.get("/health")
async def health():
    return {"status": "ok"}
```

**Step 5: Create Dockerfile**

```dockerfile
# packages/knowledge/Dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY src/ src/
EXPOSE 8000

CMD ["uvicorn", "knowledge.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Step 6: Write tests**

```python
# packages/knowledge/tests/test_store.py
import pytest
from knowledge.models import AddFactRequest, SearchRequest, KnowledgeScope, FactSource, FactSourceType, ScopeLevel
from knowledge.store import GraphitiKnowledgeStore, is_visible

@pytest.fixture
def store():
    return GraphitiKnowledgeStore()

@pytest.mark.asyncio
async def test_add_and_search(store):
    await store.add_fact(AddFactRequest(
        content="TypeScript projects should use strict mode",
        scope=KnowledgeScope(level=ScopeLevel.platform),
        source=FactSource(type=FactSourceType.user_input),
        confidence=0.95,
        tags=["typescript"],
    ))
    results = await store.search(SearchRequest(
        query="typescript strict",
        scope=KnowledgeScope(level=ScopeLevel.platform),
    ))
    assert len(results) == 1
    assert "strict mode" in results[0].content

@pytest.mark.asyncio
async def test_scope_hierarchy(store):
    await store.add_fact(AddFactRequest(
        content="Platform fact",
        scope=KnowledgeScope(level=ScopeLevel.platform),
        source=FactSource(type=FactSourceType.user_input),
        confidence=0.9,
        tags=[],
    ))
    await store.add_fact(AddFactRequest(
        content="Cell fact",
        scope=KnowledgeScope(level=ScopeLevel.cell, realm_id="ns", cell_id="c1"),
        source=FactSource(type=FactSourceType.explicit_remember),
        confidence=0.8,
        tags=[],
    ))
    # Cell sees both
    cell_results = await store.search(SearchRequest(
        query="fact",
        scope=KnowledgeScope(level=ScopeLevel.cell, realm_id="ns", cell_id="c1"),
    ))
    assert len(cell_results) >= 2
    # Platform sees only platform
    plat_results = await store.search(SearchRequest(
        query="fact",
        scope=KnowledgeScope(level=ScopeLevel.platform),
    ))
    assert len(plat_results) == 1

@pytest.mark.asyncio
async def test_invalidate(store):
    fid = await store.add_fact(AddFactRequest(
        content="Old fact",
        scope=KnowledgeScope(level=ScopeLevel.platform),
        source=FactSource(type=FactSourceType.user_input),
        confidence=0.9,
        tags=[],
    ))
    await store.invalidate(fid, "superseded")
    results = await store.search(SearchRequest(
        query="old",
        scope=KnowledgeScope(level=ScopeLevel.platform),
    ))
    assert len(results) == 0

def test_is_visible():
    platform = KnowledgeScope(level=ScopeLevel.platform)
    cell = KnowledgeScope(level=ScopeLevel.cell, realm_id="ns", cell_id="c1")
    assert is_visible(platform, cell) is True
    assert is_visible(cell, platform) is False
```

**Step 7: Run tests**

Run: `cd packages/knowledge && pip install -e ".[dev]" && pytest tests/ -v`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/knowledge/
git commit -m "feat(knowledge): add Python knowledge service with Graphiti + FastAPI"
```

---

## Task 7: Knowledge Tools in Cell Runtime

**Files:**
- Create: `packages/cell-runtime/src/tools/recall.ts`
- Create: `packages/cell-runtime/src/tools/remember.ts`
- Create: `packages/cell-runtime/src/tools/correct.ts`
- Modify: `packages/cell-runtime/src/tools/index.ts` (export)
- Modify: `packages/cell-runtime/src/main.ts` (register tools)
- Test: `packages/cell-runtime/src/__tests__/knowledge-tools.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/cell-runtime/src/__tests__/knowledge-tools.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createRecallTool, createRememberTool, createCorrectTool } from '../tools/recall.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('recall tool', () => {
  it('calls knowledge service and returns facts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'f1', content: 'Use strict mode', confidence: 0.9, tags: ['ts'] },
      ],
    });

    const tool = createRecallTool({
      knowledgeUrl: 'http://knowledge:8000',
      cellName: 'arch-0',
      namespace: 'default',
    });

    const result = await tool.execute({ query: 'typescript config', scope: 'all' });
    expect(result).toContain('Use strict mode');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://knowledge:8000/recall',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('remember tool', () => {
  it('sends fact to knowledge service', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ factId: 'f-new' }),
    });

    const tool = createRememberTool({
      knowledgeUrl: 'http://knowledge:8000',
      cellName: 'arch-0',
      namespace: 'default',
    });

    const result = await tool.execute({
      fact: 'Always validate email input',
      tags: ['security'],
      confidence: 0.9,
    });
    expect(result).toContain('f-new');
  });
});

describe('correct tool', () => {
  it('invalidates fact via knowledge service', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'ok' }),
    });

    const tool = createCorrectTool({
      knowledgeUrl: 'http://knowledge:8000',
    });

    const result = await tool.execute({ factId: 'f1', reason: 'Wrong' });
    expect(result).toContain('invalidated');
  });
});
```

**Step 2: Implement tools**

```typescript
// packages/cell-runtime/src/tools/recall.ts
import type { Tool } from './tool-executor.js';

export interface KnowledgeToolConfig {
  knowledgeUrl: string;
  cellName: string;
  namespace: string;
}

const SCOPE_MAP: Record<string, string> = {
  mine: 'cell',
  team: 'formation',
  project: 'realm',
  all: 'platform',
};

export function createRecallTool(config: KnowledgeToolConfig): Tool {
  return {
    name: 'recall',
    description: 'Search your knowledge for relevant information from past missions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for' },
        scope: {
          type: 'string',
          enum: ['mine', 'team', 'project', 'all'],
          description: 'How wide to search (default: all)',
        },
      },
      required: ['query'],
    },
    async execute(input: unknown): Promise<string> {
      const { query, scope: scopeStr = 'all' } = input as { query: string; scope?: string };
      const level = SCOPE_MAP[scopeStr] ?? 'platform';

      const res = await fetch(`${config.knowledgeUrl}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          scope: {
            level,
            realm_id: config.namespace,
            cell_id: level === 'cell' ? config.cellName : undefined,
          },
          max_results: 10,
        }),
      });

      if (!res.ok) return `Knowledge service error: ${res.status}`;

      const facts = (await res.json()) as Array<{
        id: string;
        content: string;
        confidence: number;
        tags: string[];
      }>;

      if (facts.length === 0) return 'No relevant knowledge found.';

      return facts
        .map((f) => `- [${f.id}] (confidence: ${f.confidence}) ${f.content}`)
        .join('\n');
    },
  };
}

export function createRememberTool(config: KnowledgeToolConfig): Tool {
  return {
    name: 'remember',
    description: 'Store an important fact, decision, or lesson for future reference.',
    inputSchema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'What to remember' },
        tags: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number', description: '0-1, how sure are you' },
      },
      required: ['fact'],
    },
    async execute(input: unknown): Promise<string> {
      const { fact, tags = [], confidence = 0.7 } = input as {
        fact: string;
        tags?: string[];
        confidence?: number;
      };

      const res = await fetch(`${config.knowledgeUrl}/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fact,
          scope: {
            level: 'cell',
            realm_id: config.namespace,
            cell_id: config.cellName,
          },
          source: { type: 'explicit_remember' },
          confidence,
          tags,
        }),
      });

      if (!res.ok) return `Knowledge service error: ${res.status}`;
      const data = (await res.json()) as { factId: string };
      return `Remembered (factId: ${data.factId})`;
    },
  };
}

export function createCorrectTool(config: { knowledgeUrl: string }): Tool {
  return {
    name: 'correct',
    description: 'Invalidate a previous fact that turned out to be wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        factId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['factId', 'reason'],
    },
    async execute(input: unknown): Promise<string> {
      const { factId, reason } = input as { factId: string; reason: string };

      const res = await fetch(`${config.knowledgeUrl}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact_id: factId, reason }),
      });

      if (!res.ok) return `Knowledge service error: ${res.status}`;
      return `Fact ${factId} invalidated: ${reason}`;
    },
  };
}
```

**Step 3: Register in main.ts**

In `packages/cell-runtime/src/main.ts`, after line 184 (after bash tool), add:

```typescript
  // Knowledge tools (only when KNOWLEDGE_SERVICE_URL is set)
  const KNOWLEDGE_URL = process.env['KNOWLEDGE_SERVICE_URL'];
  if (KNOWLEDGE_URL) {
    const { createRecallTool, createRememberTool, createCorrectTool } = await import('./tools/recall.js');
    const knowledgeConfig = {
      knowledgeUrl: KNOWLEDGE_URL,
      cellName: CELL_NAME,
      namespace: CELL_NAMESPACE,
    };

    if (allowedTools.some(t => t.name === 'recall') || allowedTools.length === 0) {
      tools.push(createRecallTool(knowledgeConfig));
    }
    if (allowedTools.some(t => t.name === 'remember') || allowedTools.length === 0) {
      tools.push(createRememberTool(knowledgeConfig));
    }
    if (allowedTools.some(t => t.name === 'correct') || allowedTools.length === 0) {
      tools.push(createCorrectTool({ knowledgeUrl: KNOWLEDGE_URL }));
    }
  }
```

**Step 4: Export from tools/index.ts**

```typescript
export { createRecallTool, createRememberTool, createCorrectTool } from './recall.js';
export type { KnowledgeToolConfig } from './recall.js';
```

**Step 5: Run tests and commit**

Run: `cd packages/cell-runtime && pnpm test -- --run knowledge-tools`
Expected: PASS

```bash
git add packages/cell-runtime/src/tools/recall.ts packages/cell-runtime/src/tools/index.ts packages/cell-runtime/src/main.ts packages/cell-runtime/src/__tests__/knowledge-tools.test.ts
git commit -m "feat(cell-runtime): add recall/remember/correct knowledge tools"
```

---

## Task 8: Infrastructure — Neo4j Helm + Knowledge Service Deployment

**Files:**
- Modify: `deploy/helmfile.yaml` (add Neo4j + knowledge service)
- Modify: `packages/operator/src/pod-builder.ts` (add KNOWLEDGE_SERVICE_URL env)
- Create: `deploy/knowledge-service.yaml` (K8s Deployment + Service)
- Create: `deploy/migrations/002_knowledge.sql`

**Step 1: Add Neo4j to helmfile**

After existing releases in `deploy/helmfile.yaml`:

```yaml
  # Neo4j for knowledge graph (Phase 4)
  - name: neo4j
    namespace: kais-system
    chart: neo4j/neo4j-standalone
    version: 5.26.0
    condition: knowledge.enabled
    values:
      - neo4j:
          password: kais
          resources:
            requests:
              memory: 512Mi
              cpu: 500m
            limits:
              memory: 1Gi
              cpu: "1"
          volume:
            size: 10Gi
```

Add to helmfile repositories:

```yaml
  - name: neo4j
    url: https://helm.neo4j.com/neo4j
```

**Step 2: Create knowledge service deployment**

```yaml
# deploy/knowledge-service.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kais-knowledge
  namespace: kais-system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kais-knowledge
  template:
    metadata:
      labels:
        app: kais-knowledge
    spec:
      containers:
        - name: knowledge
          image: kais-knowledge:latest
          ports:
            - containerPort: 8000
          env:
            - name: NEO4J_URL
              value: bolt://neo4j.kais-system:7687
            - name: NEO4J_USER
              value: neo4j
            - name: NEO4J_PASSWORD
              value: kais
          resources:
            requests:
              memory: 256Mi
              cpu: 250m
            limits:
              memory: 512Mi
              cpu: 500m
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: kais-knowledge
  namespace: kais-system
spec:
  selector:
    app: kais-knowledge
  ports:
    - port: 8000
      targetPort: 8000
```

**Step 3: Add env var to pod-builder**

In `packages/operator/src/pod-builder.ts`, add to env array (after OTEL line):

```typescript
  {
    name: 'KNOWLEDGE_SERVICE_URL',
    value: 'http://kais-knowledge.kais-system:8000',
  },
```

**Step 4: Create migration**

```sql
-- deploy/migrations/002_knowledge.sql

-- Knowledge facts (metadata — actual graph data in Neo4j)
CREATE TABLE IF NOT EXISTS facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  scope_level TEXT NOT NULL,
  scope_realm TEXT,
  scope_formation TEXT,
  scope_cell TEXT,
  source_type TEXT NOT NULL,
  source_id UUID,
  confidence NUMERIC NOT NULL DEFAULT 0.5,
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope_level, scope_realm, scope_formation);
CREATE INDEX IF NOT EXISTS idx_facts_tags ON facts USING gin(tags);

-- Fact references (which missions used which facts)
CREATE TABLE IF NOT EXISTS fact_references (
  fact_id UUID REFERENCES facts(id) ON DELETE CASCADE,
  mission_id UUID,
  used_at TIMESTAMPTZ DEFAULT now(),
  was_helpful BOOLEAN,
  PRIMARY KEY (fact_id, mission_id)
);

-- Blueprint versions
CREATE TABLE IF NOT EXISTS blueprint_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_name TEXT NOT NULL,
  blueprint_namespace TEXT NOT NULL,
  version INT NOT NULL,
  spec JSONB NOT NULL,
  changes TEXT,
  experiment_source UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blueprint_versions ON blueprint_versions(blueprint_name, version DESC);

-- Blueprint usage tracking
CREATE TABLE IF NOT EXISTS blueprint_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_name TEXT NOT NULL,
  formation_id UUID,
  mission_id UUID,
  parameters JSONB NOT NULL,
  outcome TEXT,
  cost NUMERIC,
  duration_seconds INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Step 5: Commit**

```bash
git add deploy/helmfile.yaml deploy/knowledge-service.yaml deploy/migrations/002_knowledge.sql packages/operator/src/pod-builder.ts
git commit -m "feat(deploy): add Neo4j, knowledge service, Blueprint migrations"
```

---

## Task 9: CLI Commands — Knowledge + Blueprint

**Files:**
- Modify: `packages/cli/src/kais.ts` (add knowledge + blueprint subcommands)

**Step 1: Add knowledge commands**

After the `topology` command (around line 432), add:

```typescript
// --- Knowledge ---
program
  .command('knowledge')
  .description('Manage the knowledge graph')
  .addCommand(
    new Command('search')
      .argument('<query>', 'Search query')
      .option('--scope <scope>', 'Scope: platform|realm|formation|cell', 'platform')
      .option('--namespace <ns>', 'Namespace for realm scope', 'default')
      .option('-n, --max-results <n>', 'Max results', '10')
      .action(async (query, opts) => {
        const res = await fetch(
          `${API_URL}/api/v1/knowledge/search`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query,
              scope: { level: opts.scope, realm_id: opts.namespace },
              max_results: parseInt(opts.maxResults),
            }),
          },
        );
        const facts = await res.json();
        for (const f of facts) {
          console.log(`  [${f.id.slice(0, 8)}] (${f.confidence}) ${f.content}`);
          if (f.tags.length) console.log(`         tags: ${f.tags.join(', ')}`);
        }
      }),
  )
  .addCommand(
    new Command('add')
      .argument('<fact>', 'Fact to add')
      .option('--scope <scope>', 'Scope', 'platform')
      .option('--confidence <n>', 'Confidence 0-1', '0.9')
      .option('--tags <tags>', 'Comma-separated tags', '')
      .action(async (fact, opts) => {
        const res = await fetch(
          `${API_URL}/api/v1/knowledge/add`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: fact,
              scope: { level: opts.scope },
              source: { type: 'user_input' },
              confidence: parseFloat(opts.confidence),
              tags: opts.tags ? opts.tags.split(',') : [],
            }),
          },
        );
        const data = await res.json();
        console.log(`Fact added: ${data.factId}`);
      }),
  );

// --- Blueprint ---
program
  .command('blueprint')
  .description('Manage reusable team blueprints')
  .addCommand(
    new Command('list')
      .action(async () => {
        const result = await kubectl('get', 'blueprints', '-o', 'wide');
        console.log(result);
      }),
  )
  .addCommand(
    new Command('describe')
      .argument('<name>', 'Blueprint name')
      .action(async (name) => {
        const result = await kubectl('describe', 'blueprint', name);
        console.log(result);
      }),
  )
  .addCommand(
    new Command('use')
      .argument('<name>', 'Blueprint name')
      .option('--namespace <ns>', 'Target namespace', 'default')
      .option('--set <params...>', 'Parameter overrides (key=value)')
      .option('--mission <objective>', 'Mission objective')
      .action(async (name, opts) => {
        // Parse --set params
        const params: Record<string, string> = {};
        for (const p of opts.set ?? []) {
          const [k, v] = p.split('=');
          if (k && v) params[k] = v;
        }

        const res = await fetch(
          `${API_URL}/api/v1/blueprints/${name}/instantiate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              namespace: opts.namespace,
              parameters: params,
              mission: opts.mission,
            }),
          },
        );
        const data = await res.json();
        console.log(`Formation: ${data.formationName}`);
        if (data.missionName) console.log(`Mission: ${data.missionName}`);
      }),
  );
```

**Step 2: Run build**

Run: `cd packages/cli && pnpm build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/cli/src/kais.ts
git commit -m "feat(cli): add knowledge and blueprint commands"
```

---

## Task 10: API Endpoints for Knowledge + Blueprint

**Files:**
- Modify: `packages/api/src/server.ts` (add proxy routes to knowledge service)

**Step 1: Add proxy routes**

In `packages/api/src/server.ts`, add routes that proxy to the knowledge service:

```typescript
const KNOWLEDGE_URL = process.env['KNOWLEDGE_SERVICE_URL'] ?? 'http://kais-knowledge.kais-system:8000';

// Knowledge proxy routes
app.post('/api/v1/knowledge/search', async (req, reply) => {
  const res = await fetch(`${KNOWLEDGE_URL}/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body),
  });
  reply.status(res.status).send(await res.json());
});

app.post('/api/v1/knowledge/add', async (req, reply) => {
  const res = await fetch(`${KNOWLEDGE_URL}/remember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body),
  });
  reply.status(res.status).send(await res.json());
});

app.post('/api/v1/knowledge/invalidate', async (req, reply) => {
  const res = await fetch(`${KNOWLEDGE_URL}/correct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body),
  });
  reply.status(res.status).send(await res.json());
});

// Blueprint instantiation
app.post('/api/v1/blueprints/:name/instantiate', async (req, reply) => {
  // Read blueprint CRD, render template, create Formation + Mission
  const { name } = req.params as { name: string };
  const body = req.body as { namespace: string; parameters: Record<string, unknown>; mission?: string };

  // Get Blueprint CRD
  const bp = await customApi.getNamespacedCustomObject({
    group: 'kais.io', version: 'v1', namespace: 'kais-blueprints',
    plural: 'blueprints', name,
  });

  // Render template
  const { renderBlueprint } = await import('@kais/operator/blueprint-renderer');
  const rendered = renderBlueprint((bp as any).spec.formation, body.parameters);

  // Create Formation
  const formationName = `${name}-${Date.now().toString(36)}`;
  await customApi.createNamespacedCustomObject({
    group: 'kais.io', version: 'v1', namespace: body.namespace,
    plural: 'formations', body: {
      apiVersion: 'kais.io/v1', kind: 'Formation',
      metadata: { name: formationName, namespace: body.namespace },
      spec: rendered,
    },
  });

  let missionName: string | undefined;
  if (body.mission) {
    missionName = `${name}-mission-${Date.now().toString(36)}`;
    const missionTemplate = (bp as any).spec.mission ?? {};
    const renderedMission = renderBlueprint(missionTemplate, body.parameters);
    await customApi.createNamespacedCustomObject({
      group: 'kais.io', version: 'v1', namespace: body.namespace,
      plural: 'missions', body: {
        apiVersion: 'kais.io/v1', kind: 'Mission',
        metadata: { name: missionName, namespace: body.namespace },
        spec: {
          ...renderedMission,
          formationRef: formationName,
          objective: body.mission,
        },
      },
    });
  }

  reply.send({ formationName, missionName });
});
```

**Step 2: Build and commit**

Run: `pnpm build`
Expected: PASS

```bash
git add packages/api/src/server.ts
git commit -m "feat(api): add knowledge proxy + blueprint instantiation endpoints"
```

---

## Task 11: Build, Test, Verify

**Step 1: Build all packages**

Run: `pnpm run build`
Expected: All 6+ packages compile successfully

**Step 2: Run all unit tests**

Run: `pnpm run test`
Expected: All existing tests + new knowledge/blueprint tests pass

**Step 3: Run Python tests**

Run: `cd packages/knowledge && pip install -e ".[dev]" && pytest tests/ -v`
Expected: All Python tests pass

**Step 4: Final commit + PR**

```bash
git add -A
git commit -m "feat: Phase 4 — Knowledge Graph + Blueprints

- KnowledgeStore interface + InMemoryKnowledgeStore in @kais/core
- Knowledge and Blueprint Zod schemas
- Python knowledge service (FastAPI + Graphiti + Neo4j)
- Blueprint CRD + BlueprintController with version tracking
- Blueprint template renderer (nunjucks)
- Knowledge tools (recall/remember/correct) in cell-runtime
- Neo4j Helm chart + knowledge service deployment
- CLI commands for knowledge + blueprint management
- API proxy routes for knowledge + blueprint instantiation
- Database migrations for facts, blueprint_versions, blueprint_usage"
```

Create PR:
```bash
git push origin phase-4/knowledge-blueprints
gh pr create --title "Phase 4: Knowledge Graph + Blueprints" --body "..."
```
