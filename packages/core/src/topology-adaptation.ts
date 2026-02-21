import type { TopologyAdaptationRule } from './types.js';

/**
 * Tracks communication metrics between cells and adapts route weights.
 */
export class TopologyAdapter {
  private rules = new Map<string, TopologyAdaptationRule>();

  private key(from: string, to: string): string {
    return `${from}->${to}`;
  }

  recordMessage(fromCell: string, toCell: string, latencyMs: number): void {
    const k = this.key(fromCell, toCell);
    let rule = this.rules.get(k);
    if (!rule) {
      rule = { fromCell, toCell, weight: 0.5, messageCount: 0, avgLatencyMs: 0 };
      this.rules.set(k, rule);
    }
    // Exponential moving average for latency
    rule.avgLatencyMs = rule.messageCount === 0
      ? latencyMs
      : rule.avgLatencyMs * 0.9 + latencyMs * 0.1;
    rule.messageCount++;
  }

  adaptWeights(): TopologyAdaptationRule[] {
    const allRules = [...this.rules.values()];
    if (allRules.length === 0) return [];

    const maxMessages = Math.max(...allRules.map(r => r.messageCount));
    if (maxMessages === 0) return allRules;

    for (const rule of allRules) {
      // Weight based on usage frequency and low latency
      const usageScore = rule.messageCount / maxMessages;
      const latencyPenalty = Math.min(rule.avgLatencyMs / 1000, 1);
      rule.weight = Math.max(0.1, Math.min(1, usageScore * (1 - latencyPenalty * 0.3)));
    }
    return allRules;
  }

  pruneUnused(minMessages: number): string[] {
    const pruned: string[] = [];
    for (const [key, rule] of this.rules) {
      if (rule.messageCount < minMessages) {
        pruned.push(key);
        this.rules.delete(key);
      }
    }
    return pruned;
  }

  getRules(): TopologyAdaptationRule[] {
    return [...this.rules.values()];
  }
}
