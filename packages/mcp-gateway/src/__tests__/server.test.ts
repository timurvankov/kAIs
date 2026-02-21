import { describe, expect, it, vi } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { KaisClient } from '../kais-client.js';
import { createMcpServer } from '../server.js';

// ---------------------------------------------------------------------------
// Mock KaisClient
// ---------------------------------------------------------------------------

function createMockClient(): KaisClient {
  return {
    launchTeam: vi.fn().mockResolvedValue({
      missionId: 'mission-001',
      formationId: 'formation-001',
      namespace: 'default',
    }),
    getMissionStatus: vi.fn().mockResolvedValue({
      phase: 'Running',
      attempt: 1,
      cost: 2.50,
      checks: [{ name: 'api-exists', status: 'Passed' }],
    }),
    recall: vi.fn().mockResolvedValue({
      facts: [
        { id: 'fact-1', content: 'TypeScript is great', scope: 'platform', confidence: 0.95 },
      ],
    }),
    listBlueprints: vi.fn().mockResolvedValue([
      { name: 'code-review', description: 'Code review team blueprint' },
      { name: 'research', description: 'Research team blueprint' },
    ]),
    sendMessage: vi.fn().mockResolvedValue({
      ok: true,
      messageId: 'msg-001',
    }),
    getResults: vi.fn().mockResolvedValue({
      phase: 'Succeeded',
      artifacts: [{ path: '/workspace/shared/api.ts', type: 'file' }],
      summary: 'Built REST API successfully',
      cost: 5.23,
    }),
  } as unknown as KaisClient;
}

// ---------------------------------------------------------------------------
// Helper: connect MCP client to server via in-memory transport
// ---------------------------------------------------------------------------

async function connectClientToServer(mockClient: KaisClient) {
  const server = createMcpServer(mockClient, { name: 'test-kais', version: '0.0.1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: 'test-client', version: '0.0.1' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP Gateway Server', () => {
  it('lists all 6 kAIs tools', async () => {
    const mockClient = createMockClient();
    const { client } = await connectClientToServer(mockClient);

    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();

    expect(toolNames).toEqual([
      'kais_get_results',
      'kais_launch_team',
      'kais_list_blueprints',
      'kais_mission_status',
      'kais_recall',
      'kais_send_message',
    ]);

    await client.close();
  });

  describe('kais_launch_team', () => {
    it('launches a team and returns mission info', async () => {
      const mockClient = createMockClient();
      const { client } = await connectClientToServer(mockClient);

      const result = await client.callTool({
        name: 'kais_launch_team',
        arguments: {
          blueprint: 'code-review',
          objective: 'Review auth module',
          budget: 5.0,
        },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0]!.text);
      expect(parsed.missionId).toBe('mission-001');
      expect(parsed.formationId).toBe('formation-001');

      expect(mockClient.launchTeam).toHaveBeenCalledWith({
        blueprint: 'code-review',
        objective: 'Review auth module',
        budget: 5.0,
        params: undefined,
        namespace: undefined,
      });

      await client.close();
    });

    it('returns error on failure', async () => {
      const mockClient = createMockClient();
      (mockClient.launchTeam as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('API down'));
      const { client } = await connectClientToServer(mockClient);

      const result = await client.callTool({
        name: 'kais_launch_team',
        arguments: { blueprint: 'x', objective: 'y' },
      });

      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]!.text).toContain('API down');

      await client.close();
    });
  });

  describe('kais_mission_status', () => {
    it('returns mission status', async () => {
      const mockClient = createMockClient();
      const { client } = await connectClientToServer(mockClient);

      const result = await client.callTool({
        name: 'kais_mission_status',
        arguments: { mission: 'mission-001' },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0]!.text);
      expect(parsed.phase).toBe('Running');
      expect(parsed.cost).toBe(2.50);

      await client.close();
    });
  });

  describe('kais_recall', () => {
    it('returns knowledge facts', async () => {
      const mockClient = createMockClient();
      const { client } = await connectClientToServer(mockClient);

      const result = await client.callTool({
        name: 'kais_recall',
        arguments: { query: 'TypeScript' },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0]!.text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].content).toBe('TypeScript is great');

      await client.close();
    });
  });

  describe('kais_list_blueprints', () => {
    it('returns available blueprints', async () => {
      const mockClient = createMockClient();
      const { client } = await connectClientToServer(mockClient);

      const result = await client.callTool({
        name: 'kais_list_blueprints',
        arguments: {},
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0]!.text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe('code-review');

      await client.close();
    });
  });

  describe('kais_send_message', () => {
    it('sends message to a cell', async () => {
      const mockClient = createMockClient();
      const { client } = await connectClientToServer(mockClient);

      const result = await client.callTool({
        name: 'kais_send_message',
        arguments: { cell: 'researcher-0', message: 'What progress?' },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0]!.text);
      expect(parsed.ok).toBe(true);
      expect(parsed.messageId).toBe('msg-001');

      expect(mockClient.sendMessage).toHaveBeenCalledWith('researcher-0', 'What progress?', undefined);

      await client.close();
    });
  });

  describe('kais_get_results', () => {
    it('returns mission results', async () => {
      const mockClient = createMockClient();
      const { client } = await connectClientToServer(mockClient);

      const result = await client.callTool({
        name: 'kais_get_results',
        arguments: { mission: 'mission-001' },
      });

      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text: string }>;
      const parsed = JSON.parse(content[0]!.text);
      expect(parsed.phase).toBe('Succeeded');
      expect(parsed.summary).toBe('Built REST API successfully');
      expect(parsed.artifacts).toHaveLength(1);

      await client.close();
    });
  });
});
