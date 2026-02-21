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

  it('ancestor cell sees parent cell facts via ancestorCellIds', async () => {
    const store = new InMemoryKnowledgeStore();

    await store.addFact({
      content: 'Parent decision: use PostgreSQL',
      scope: { level: 'cell', realmId: 'default', cellId: 'parent-0' },
      source: { type: 'explicit_remember' },
      confidence: 0.9,
      tags: ['decision'],
    });

    await store.addFact({
      content: 'Sibling secret: internal notes',
      scope: { level: 'cell', realmId: 'default', cellId: 'sibling-0' },
      source: { type: 'explicit_remember' },
      confidence: 0.8,
      tags: ['notes'],
    });

    // Child cell searches WITH ancestor chain — should see parent's fact
    const childFacts = await store.search(
      'decision notes',
      { level: 'cell', realmId: 'default', cellId: 'child-0' },
      {},
      ['parent-0'],
    );
    const contents = childFacts.map((f) => f.content);
    expect(contents).toContain('Parent decision: use PostgreSQL');
    expect(contents).not.toContain('Sibling secret: internal notes');
  });

  it('grandchild sees grandparent facts through ancestor chain', async () => {
    const store = new InMemoryKnowledgeStore();

    await store.addFact({
      content: 'Root architecture choice',
      scope: { level: 'cell', realmId: 'default', cellId: 'root-0' },
      source: { type: 'explicit_remember' },
      confidence: 0.95,
      tags: ['arch'],
    });

    await store.addFact({
      content: 'Middle layer decision',
      scope: { level: 'cell', realmId: 'default', cellId: 'middle-0' },
      source: { type: 'explicit_remember' },
      confidence: 0.85,
      tags: ['arch'],
    });

    const facts = await store.search(
      'architecture decision',
      { level: 'cell', realmId: 'default', cellId: 'grandchild-0' },
      {},
      ['root-0', 'middle-0'],
    );
    expect(facts).toHaveLength(2);
  });

  it('cell without ancestors cannot see other cell facts', async () => {
    const store = new InMemoryKnowledgeStore();

    await store.addFact({
      content: 'Private cell fact',
      scope: { level: 'cell', realmId: 'default', cellId: 'other-cell' },
      source: { type: 'explicit_remember' },
      confidence: 0.9,
      tags: ['private'],
    });

    const facts = await store.search(
      'private',
      { level: 'cell', realmId: 'default', cellId: 'my-cell' },
    );
    expect(facts).toHaveLength(0);
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
