import type { CollectiveImmunityEntry } from './types.js';

/**
 * In-memory collective immunity cache. Cells check for known problem→solution pairs
 * before attempting work, and contribute solutions after solving problems.
 */
export class CollectiveImmunityStore {
  private entries = new Map<string, CollectiveImmunityEntry>();

  async check(fingerprint: string): Promise<CollectiveImmunityEntry | null> {
    const entry = this.entries.get(fingerprint);
    if (entry) {
      entry.hits++;
      return entry;
    }
    return null;
  }

  async contribute(fingerprint: string, solution: string, contributor: string, confidence = 0.8): Promise<void> {
    this.entries.set(fingerprint, {
      fingerprint, solution, contributor, confidence,
      hits: 0, createdAt: new Date().toISOString(),
    });
  }

  async list(): Promise<CollectiveImmunityEntry[]> {
    return [...this.entries.values()];
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
