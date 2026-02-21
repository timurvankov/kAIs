import type { NeuroplasticityEntry } from './types.js';

/**
 * Tracks tool usage per cell and prunes unused tools.
 */
export class NeuroplasticityTracker {
  private tools = new Map<string, NeuroplasticityEntry>();

  recordUsage(toolName: string, success: boolean): void {
    let entry = this.tools.get(toolName);
    if (!entry) {
      entry = { toolName, usageCount: 0, successCount: 0, pruned: false };
      this.tools.set(toolName, entry);
    }
    entry.usageCount++;
    if (success) entry.successCount++;
    entry.lastUsed = new Date().toISOString();
  }

  getStats(): NeuroplasticityEntry[] {
    return [...this.tools.values()];
  }

  pruneUnused(minUsageCount: number, sinceDaysAgo: number): string[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - sinceDaysAgo);
    const pruned: string[] = [];
    for (const [name, entry] of this.tools) {
      if (entry.usageCount < minUsageCount && (!entry.lastUsed || new Date(entry.lastUsed) < cutoff)) {
        entry.pruned = true;
        pruned.push(name);
      }
    }
    return pruned;
  }

  getActiveTools(): string[] {
    return [...this.tools.values()].filter(e => !e.pruned).map(e => e.toolName);
  }

  getSuccessRate(toolName: string): number {
    const entry = this.tools.get(toolName);
    if (!entry || entry.usageCount === 0) return 0;
    return entry.successCount / entry.usageCount;
  }
}
