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
