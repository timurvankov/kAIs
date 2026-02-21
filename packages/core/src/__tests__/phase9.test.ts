import { describe, it, expect } from 'vitest';
import {
  ChannelSpecSchema,
  FederationSpecSchema,
  HumanCellSpecSchema,
  MarketplaceBlueprintSchema,
  A2AAgentCardSchema,
} from '../schemas.js';

// ========== Channel Schema Tests ==========

describe('ChannelSpec schema', () => {
  it('validates a valid channel spec', () => {
    const spec = {
      formations: ['team-a', 'team-b'],
      schema: { type: 'object', properties: { message: { type: 'string' } } },
      maxMessageSize: 32768,
      retentionMinutes: 120,
    };
    const result = ChannelSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('requires at least 2 formations', () => {
    const result = ChannelSpecSchema.safeParse({
      formations: ['only-one'],
    });
    expect(result.success).toBe(false);
  });
});

// ========== Federation Schema Tests ==========

describe('FederationSpec schema', () => {
  it('validates a valid federation spec', () => {
    const spec = {
      clusters: [
        {
          name: 'us-east',
          endpoint: 'https://cluster-1.example.com:6443',
          labels: { region: 'us-east' },
          capacity: { maxCells: 100, availableCells: 80 },
        },
        {
          name: 'eu-west',
          endpoint: 'https://cluster-2.example.com:6443',
          labels: { region: 'eu-west' },
        },
      ],
      scheduling: { strategy: 'label_match' as const, labelSelector: { region: 'us-east' } },
      natsLeafnodePort: 7422,
    };
    const result = FederationSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('requires at least 1 cluster', () => {
    const result = FederationSpecSchema.safeParse({
      clusters: [],
      scheduling: { strategy: 'round_robin' },
    });
    expect(result.success).toBe(false);
  });
});

// ========== HumanCell Schema Tests ==========

describe('HumanCellSpec schema', () => {
  it('validates a human cell spec', () => {
    const spec = {
      notifications: {
        dashboard: true,
        slack: { webhookUrl: 'https://hooks.slack.com/xxx' },
      },
      escalation: {
        timeoutMinutes: 15,
        action: 'llm_fallback' as const,
        fallbackModel: 'claude-sonnet-4-20250514',
      },
    };
    const result = HumanCellSpecSchema.safeParse(spec);
    expect(result.success).toBe(true);
  });

  it('accepts minimal spec with dashboard only', () => {
    const result = HumanCellSpecSchema.safeParse({
      notifications: { dashboard: true },
    });
    expect(result.success).toBe(true);
  });
});

// ========== Marketplace Schema Tests ==========

describe('MarketplaceBlueprint schema', () => {
  it('validates a marketplace blueprint', () => {
    const bp = {
      name: 'code-review-team',
      version: '1.0.0',
      description: 'A pre-configured code review team with 3 reviewers',
      author: 'kais-community',
      blueprint: {
        parameters: [{ name: 'language', type: 'string' as const }],
        formation: { cells: [], topology: { type: 'star' } },
      },
      tags: ['code-review', 'team'],
      rating: 4.5,
      downloads: 128,
      publishedAt: '2024-06-01T00:00:00Z',
    };
    const result = MarketplaceBlueprintSchema.safeParse(bp);
    expect(result.success).toBe(true);
  });
});

// ========== A2A Agent Card Tests ==========

describe('A2AAgentCard schema', () => {
  it('validates an A2A agent card', () => {
    const card = {
      name: 'kAIs Platform',
      description: 'Multi-agent AI platform for software engineering',
      url: 'https://kais.example.com',
      skills: [
        { name: 'kais_launch_team', description: 'Launch a team of AI agents' },
        { name: 'kais_recall', description: 'Search accumulated knowledge' },
      ],
      version: '1.0.0',
    };
    const result = A2AAgentCardSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it('requires at least name and description', () => {
    const result = A2AAgentCardSchema.safeParse({
      name: 'test',
    });
    expect(result.success).toBe(false);
  });
});
