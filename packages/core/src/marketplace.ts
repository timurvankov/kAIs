import type { MarketplaceBlueprint } from './types.js';

/**
 * In-memory marketplace for publishing, searching, and installing blueprints.
 */
export class Marketplace {
  private blueprints = new Map<string, MarketplaceBlueprint>();

  async publish(bp: MarketplaceBlueprint): Promise<void> {
    const key = `${bp.name}@${bp.version}`;
    this.blueprints.set(key, { ...bp, publishedAt: bp.publishedAt || new Date().toISOString() });
  }

  async search(query: string, tags?: string[]): Promise<MarketplaceBlueprint[]> {
    const lower = query.toLowerCase();
    const results: MarketplaceBlueprint[] = [];
    for (const bp of this.blueprints.values()) {
      const matchesQuery = bp.name.toLowerCase().includes(lower) ||
        bp.description.toLowerCase().includes(lower);
      const matchesTags = !tags || tags.length === 0 ||
        tags.some(t => bp.tags.includes(t));
      if (matchesQuery && matchesTags) results.push(bp);
    }
    return results.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  }

  async get(name: string, version: string): Promise<MarketplaceBlueprint | null> {
    return this.blueprints.get(`${name}@${version}`) ?? null;
  }

  async rate(name: string, version: string, rating: number): Promise<boolean> {
    const bp = this.blueprints.get(`${name}@${version}`);
    if (!bp) return false;
    bp.rating = rating;
    return true;
  }

  async install(name: string, version: string): Promise<MarketplaceBlueprint | null> {
    const bp = this.blueprints.get(`${name}@${version}`);
    if (!bp) return null;
    bp.downloads++;
    return bp;
  }

  async list(): Promise<MarketplaceBlueprint[]> {
    return [...this.blueprints.values()];
  }

  /** Basic security scan: reject blueprints with suspicious patterns. */
  scan(bp: MarketplaceBlueprint): { safe: boolean; issues: string[] } {
    const issues: string[] = [];
    const spec = JSON.stringify(bp.blueprint);
    if (spec.includes('__proto__')) issues.push('Prototype pollution attempt');
    if (/https?:\/\/[^"}\s]+\.(ru|cn|tk)\b/i.test(spec)) issues.push('Suspicious external URL');
    if (spec.includes('IGNORE PREVIOUS') || spec.includes('ignore all previous'))
      issues.push('Prompt injection pattern detected');
    return { safe: issues.length === 0, issues };
  }
}
