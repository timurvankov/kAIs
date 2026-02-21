import type { Tool } from './tool-executor.js';

export interface KnowledgeToolConfig {
  knowledgeUrl: string;
  cellName: string;
  namespace: string;
}

const SCOPE_MAP: Record<string, string> = {
  mine: 'cell',
  team: 'formation',
  project: 'realm',
  all: 'platform',
};

export function createRecallTool(config: KnowledgeToolConfig): Tool {
  return {
    name: 'recall',
    description: 'Search your knowledge for relevant information from past missions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for' },
        scope: {
          type: 'string',
          enum: ['mine', 'team', 'project', 'all'],
          description: 'How wide to search (default: all)',
        },
      },
      required: ['query'],
    },
    async execute(input: unknown): Promise<string> {
      const { query, scope: scopeStr = 'all' } = input as { query: string; scope?: string };
      const level = SCOPE_MAP[scopeStr] ?? 'platform';

      const res = await fetch(`${config.knowledgeUrl}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          scope: {
            level,
            realm_id: config.namespace,
            cell_id: level === 'cell' ? config.cellName : undefined,
          },
          max_results: 10,
        }),
      });

      if (!res.ok) return `Knowledge service error: ${res.status}`;

      const facts = (await res.json()) as Array<{
        id: string;
        content: string;
        confidence: number;
        tags: string[];
      }>;

      if (facts.length === 0) return 'No relevant knowledge found.';

      return facts
        .map((f) => `- [${f.id}] (confidence: ${f.confidence}) ${f.content}`)
        .join('\n');
    },
  };
}

export function createRememberTool(config: KnowledgeToolConfig): Tool {
  return {
    name: 'remember',
    description: 'Store an important fact, decision, or lesson for future reference.',
    inputSchema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'What to remember' },
        tags: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number', description: '0-1, how sure are you' },
      },
      required: ['fact'],
    },
    async execute(input: unknown): Promise<string> {
      const { fact, tags = [], confidence = 0.7 } = input as {
        fact: string;
        tags?: string[];
        confidence?: number;
      };

      const res = await fetch(`${config.knowledgeUrl}/remember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: fact,
          scope: {
            level: 'cell',
            realm_id: config.namespace,
            cell_id: config.cellName,
          },
          source: { type: 'explicit_remember' },
          confidence,
          tags,
        }),
      });

      if (!res.ok) return `Knowledge service error: ${res.status}`;
      const data = (await res.json()) as { factId: string };
      return `Remembered (factId: ${data.factId})`;
    },
  };
}

export function createCorrectTool(config: { knowledgeUrl: string }): Tool {
  return {
    name: 'correct',
    description: 'Invalidate a previous fact that turned out to be wrong.',
    inputSchema: {
      type: 'object',
      properties: {
        factId: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['factId', 'reason'],
    },
    async execute(input: unknown): Promise<string> {
      const { factId, reason } = input as { factId: string; reason: string };

      const res = await fetch(`${config.knowledgeUrl}/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact_id: factId, reason }),
      });

      if (!res.ok) return `Knowledge service error: ${res.status}`;
      return `Fact ${factId} invalidated: ${reason}`;
    },
  };
}
