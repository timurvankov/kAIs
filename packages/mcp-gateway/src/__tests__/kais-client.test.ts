import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';

import { KaisClient } from '../kais-client.js';

// ---------------------------------------------------------------------------
// Mock HTTP server that simulates kais-api
// ---------------------------------------------------------------------------

let server: Server;
let port: number;

const RESPONSES: Record<string, { status: number; body: unknown }> = {
  'POST /api/v1/teams/launch': {
    status: 200,
    body: { missionId: 'mission-1', formationId: 'formation-1', namespace: 'default' },
  },
  'GET /api/v1/missions/mission-1/status': {
    status: 200,
    body: { phase: 'Running', attempt: 1, cost: 1.5 },
  },
  'POST /api/v1/knowledge/search': {
    status: 200,
    body: { facts: [{ id: 'f1', content: 'test fact', scope: 'platform', confidence: 0.9 }] },
  },
  'GET /api/v1/blueprints': {
    status: 200,
    body: [{ name: 'bp1', description: 'Blueprint 1' }],
  },
  'POST /api/v1/cells/worker-0/exec': {
    status: 200,
    body: { ok: true, messageId: 'msg-1' },
  },
  'GET /api/v1/missions/mission-1/results': {
    status: 200,
    body: { phase: 'Succeeded', artifacts: [], summary: 'Done', cost: 3.0 },
  },
};

beforeAll(async () => {
  server = createServer((req, res) => {
    // Strip query params for matching
    const urlPath = req.url?.split('?')[0] ?? '/';
    const key = `${req.method} ${urlPath}`;
    const match = RESPONSES[key];

    if (match) {
      res.writeHead(match.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(match.body));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', key }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KaisClient', () => {
  function makeClient() {
    return new KaisClient({
      baseUrl: `http://localhost:${port}`,
      authToken: 'test-token',
    });
  }

  it('launchTeam sends POST and returns result', async () => {
    const client = makeClient();
    const result = await client.launchTeam({
      blueprint: 'code-review',
      objective: 'Review code',
      budget: 5,
    });
    expect(result.missionId).toBe('mission-1');
    expect(result.formationId).toBe('formation-1');
  });

  it('getMissionStatus returns status', async () => {
    const client = makeClient();
    const result = await client.getMissionStatus('mission-1');
    expect(result.phase).toBe('Running');
    expect(result.cost).toBe(1.5);
  });

  it('recall returns knowledge facts', async () => {
    const client = makeClient();
    const result = await client.recall('test query');
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]!.content).toBe('test fact');
  });

  it('listBlueprints returns array', async () => {
    const client = makeClient();
    const result = await client.listBlueprints();
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('bp1');
  });

  it('sendMessage sends to cell', async () => {
    const client = makeClient();
    const result = await client.sendMessage('worker-0', 'hello');
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('msg-1');
  });

  it('getResults returns mission results', async () => {
    const client = makeClient();
    const result = await client.getResults('mission-1');
    expect(result.phase).toBe('Succeeded');
    expect(result.cost).toBe(3.0);
  });

  it('throws on API error', async () => {
    const client = makeClient();
    await expect(client.getMissionStatus('nonexistent')).rejects.toThrow('404');
  });
});
