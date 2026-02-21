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
