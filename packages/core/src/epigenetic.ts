import type { EpigeneticConfig } from './types.js';

/**
 * Realm-level configuration that modifies prompt generation and cell behavior.
 * "In production: be conservative. In experiments: be creative."
 */
export class EpigeneticLayer {
  private configs = new Map<string, EpigeneticConfig>();

  register(config: EpigeneticConfig): void {
    this.configs.set(config.realm, config);
  }

  unregister(realm: string): void {
    this.configs.delete(realm);
  }

  getModifiers(realm: string): Record<string, unknown> {
    return this.configs.get(realm)?.modifiers ?? {};
  }

  applyToPrompt(realm: string, basePrompt: string): string {
    const config = this.configs.get(realm);
    if (!config) return basePrompt;

    const mods = config.modifiers;
    const prefix = typeof mods['promptPrefix'] === 'string' ? mods['promptPrefix'] : '';
    const suffix = typeof mods['promptSuffix'] === 'string' ? mods['promptSuffix'] : '';
    return `${prefix}${prefix ? '\n' : ''}${basePrompt}${suffix ? '\n' : ''}${suffix}`;
  }

  applyToTemperature(realm: string, baseTemp: number): number {
    const config = this.configs.get(realm);
    if (!config) return baseTemp;
    const mod = config.modifiers['temperatureMultiplier'];
    if (typeof mod === 'number') return baseTemp * mod;
    return baseTemp;
  }

  listRealms(): string[] {
    return [...this.configs.keys()];
  }
}
