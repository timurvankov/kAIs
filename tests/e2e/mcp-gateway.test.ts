/**
 * E2E test: MCP Gateway
 *
 * Tests the full MCP Gateway flow:
 * - MCP server starts and exposes tools
 * - MCP client discovers tools
 * - MCP client calls tools, which delegate to kais-api
 *
 * Uses in-memory transport (no real HTTP) and a mock kais-api server.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { KaisClient, createMcpServer } from '@kais/mcp-gateway';

// ---------------------------------------------------------------------------
// Mock kais-api HTTP server
// ---------------------------------------------------------------------------

let apiServer: Server;
let apiPort: number;

const mockMissions: Record<string, { phase: string; attempt: number; cost: number }> = {
  'mission-e2e-1': { phase: 'Running', attempt: 1, cost: 3.21 },
};

beforeAll(async () => {
  apiServer = createServer((req, res) => {
    const urlPath = req.url?.split('?')[0] ?? '/';
    const method = req.method ?? 'GET';

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // POST /api/v1/teams/launch
      if (method === 'POST' && urlPath === '/api/v1/teams/launch') {
        const parsed = JSON.parse(body);
        const missionId = `mission-${Date.now()}`;
        mockMissions[missionId] = { phase: 'Pending', attempt: 0, cost: 0 };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          missionId,
          formationId: `formation-${Date.now()}`,
          namespace: parsed.namespace ?? 'default',
        }));
        return;
      }

      // GET /api/v1/missions/:name/status
      const statusMatch = /^\/api\/v1\/missions\/([^/]+)\/status$/.exec(urlPath);
      if (method === 'GET' && statusMatch?.[1]) {
        const mission = decodeURIComponent(statusMatch[1]);
        const data = mockMissions[mission];
        if (data) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Mission not found' }));
        }
        return;
      }

      // POST /api/v1/knowledge/search
      if (method === 'POST' && urlPath === '/api/v1/knowledge/search') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          facts: [
            { id: 'fact-e2e-1', content: 'E2E test knowledge fact', scope: 'platform', confidence: 0.99 },
          ],
        }));
        return;
      }

      // GET /api/v1/blueprints
      if (method === 'GET' && urlPath === '/api/v1/blueprints') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { name: 'code-review', description: 'Automated code review team' },
          { name: 'research', description: 'Research team with web search' },
        ]));
        return;
      }

      // POST /api/v1/cells/:name/exec
      const execMatch = /^\/api\/v1\/cells\/([^/]+)\/exec$/.exec(urlPath);
      if (method === 'POST' && execMatch?.[1]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, messageId: `msg-${Date.now()}` }));
        return;
      }

      // GET /api/v1/missions/:name/results
      const resultsMatch = /^\/api\/v1\/missions\/([^/]+)\/results$/.exec(urlPath);
      if (method === 'GET' && resultsMatch?.[1]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          phase: 'Succeeded',
          artifacts: [{ path: '/workspace/shared/output.ts', type: 'file' }],
          summary: 'E2E test mission completed successfully',
          cost: 4.50,
        }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Unknown endpoint', method, url: urlPath }));
    });
  });

  await new Promise<void>((resolve) => {
    apiServer.listen(0, () => {
      const addr = apiServer.address();
      apiPort = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createTestMcpClient() {
  const kaisClient = new KaisClient({
    baseUrl: `http://localhost:${apiPort}`,
    authToken: 'e2e-test-token',
  });

  const mcpServer = createMcpServer(kaisClient, {
    name: 'kais-e2e-test',
    version: '0.0.1',
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'e2e-test-client', version: '0.0.1' });

  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, mcpServer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Gateway E2E', () => {
  it('discovers all 6 kAIs tools', async () => {
    const { client } = await createTestMcpClient();
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(6);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'kais_get_results',
      'kais_launch_team',
      'kais_list_blueprints',
      'kais_mission_status',
      'kais_recall',
      'kais_send_message',
    ]);

    // Each tool has a description
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }

    await client.close();
  });

  it('full workflow: list blueprints → launch team → check status → get results', async () => {
    const { client } = await createTestMcpClient();

    // 1. List blueprints
    const bpResult = await client.callTool({
      name: 'kais_list_blueprints',
      arguments: {},
    });
    expect(bpResult.isError).toBeFalsy();
    const blueprints = JSON.parse((bpResult.content as Array<{ text: string }>)[0]!.text);
    expect(blueprints.length).toBeGreaterThan(0);
    expect(blueprints[0].name).toBe('code-review');

    // 2. Launch team
    const launchResult = await client.callTool({
      name: 'kais_launch_team',
      arguments: {
        blueprint: 'code-review',
        objective: 'E2E test: review auth module',
        budget: 10.0,
      },
    });
    expect(launchResult.isError).toBeFalsy();
    const launchData = JSON.parse((launchResult.content as Array<{ text: string }>)[0]!.text);
    expect(launchData.missionId).toBeTruthy();
    expect(launchData.formationId).toBeTruthy();

    // 3. Check pre-existing mission status
    const statusResult = await client.callTool({
      name: 'kais_mission_status',
      arguments: { mission: 'mission-e2e-1' },
    });
    expect(statusResult.isError).toBeFalsy();
    const status = JSON.parse((statusResult.content as Array<{ text: string }>)[0]!.text);
    expect(status.phase).toBe('Running');
    expect(status.cost).toBe(3.21);

    // 4. Get results
    const getResult = await client.callTool({
      name: 'kais_get_results',
      arguments: { mission: 'mission-e2e-1' },
    });
    expect(getResult.isError).toBeFalsy();
    const resultData = JSON.parse((getResult.content as Array<{ text: string }>)[0]!.text);
    expect(resultData.phase).toBe('Succeeded');
    expect(resultData.summary).toContain('E2E test');

    await client.close();
  });

  it('kais_recall returns knowledge facts', async () => {
    const { client } = await createTestMcpClient();

    const result = await client.callTool({
      name: 'kais_recall',
      arguments: { query: 'testing best practices' },
    });

    expect(result.isError).toBeFalsy();
    const facts = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe('E2E test knowledge fact');

    await client.close();
  });

  it('kais_send_message delivers to a cell', async () => {
    const { client } = await createTestMcpClient();

    const result = await client.callTool({
      name: 'kais_send_message',
      arguments: { cell: 'worker-0', message: 'What is your status?' },
    });

    expect(result.isError).toBeFalsy();
    const data = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(data.ok).toBe(true);
    expect(data.messageId).toBeTruthy();

    await client.close();
  });

  it('returns error for nonexistent mission', async () => {
    const { client } = await createTestMcpClient();

    const result = await client.callTool({
      name: 'kais_mission_status',
      arguments: { mission: 'does-not-exist' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ text: string }>;
    expect(content[0]!.text).toContain('404');

    await client.close();
  });
});
