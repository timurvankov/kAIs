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
