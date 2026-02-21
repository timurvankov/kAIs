import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { KaisClient } from './kais-client.js';

export interface McpGatewayOptions {
  /** Name shown to MCP clients. */
  name?: string;
  /** Version string. */
  version?: string;
}

/**
 * Create and configure the kAIs MCP server.
 * Registers all kAIs tools and connects them to the kais-api via KaisClient.
 *
 * Returns a McpServer instance that can be connected to any transport.
 */
export function createMcpServer(client: KaisClient, opts?: McpGatewayOptions): McpServer {
  const server = new McpServer({
    name: opts?.name ?? 'kais',
    version: opts?.version ?? '0.1.0',
  });

  // ---------- kais_launch_team ----------

  server.tool(
    'kais_launch_team',
    'Launch an AI team from a Blueprint to accomplish a task',
    {
      blueprint: z.string().describe('Blueprint name'),
      objective: z.string().describe('What the team should accomplish'),
      budget: z.number().optional().describe('Max budget in USD'),
      params: z.record(z.string(), z.unknown()).optional().describe('Blueprint parameter overrides'),
      namespace: z.string().optional().describe('Kubernetes namespace'),
    },
    async ({ blueprint, objective, budget, params, namespace }) => {
      try {
        const result = await client.launchTeam({ blueprint, objective, budget, params, namespace });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                missionId: result.missionId,
                formationId: result.formationId,
                namespace: result.namespace,
                message: `Team launched from blueprint "${blueprint}". Mission ${result.missionId} is running.`,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error launching team: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------- kais_mission_status ----------

  server.tool(
    'kais_mission_status',
    'Check status of a running mission',
    {
      mission: z.string().describe('Mission name or ID'),
      namespace: z.string().optional().describe('Kubernetes namespace'),
    },
    async ({ mission, namespace }) => {
      try {
        const status = await client.getMissionStatus(mission, namespace);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error getting mission status: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------- kais_recall ----------

  server.tool(
    'kais_recall',
    'Search kAIs knowledge graph for information from past missions',
    {
      query: z.string().describe('Search query'),
      scope: z.enum(['platform', 'realm']).optional().describe('Knowledge scope'),
    },
    async ({ query, scope }) => {
      try {
        const result = await client.recall(query, scope);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result.facts, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error searching knowledge: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------- kais_list_blueprints ----------

  server.tool(
    'kais_list_blueprints',
    'List available team blueprints with descriptions',
    {
      namespace: z.string().optional().describe('Kubernetes namespace'),
    },
    async ({ namespace }) => {
      try {
        const blueprints = await client.listBlueprints(namespace);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(blueprints, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error listing blueprints: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------- kais_send_message ----------

  server.tool(
    'kais_send_message',
    'Send a message to a running Cell',
    {
      cell: z.string().describe('Cell name'),
      message: z.string().describe('Message content'),
      namespace: z.string().optional().describe('Kubernetes namespace'),
    },
    async ({ cell, message, namespace }) => {
      try {
        const result = await client.sendMessage(cell, message, namespace);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ok: result.ok,
                messageId: result.messageId,
                message: `Message sent to cell "${cell}".`,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error sending message: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---------- kais_get_results ----------

  server.tool(
    'kais_get_results',
    'Get results/artifacts from a completed mission',
    {
      mission: z.string().describe('Mission name or ID'),
      namespace: z.string().optional().describe('Kubernetes namespace'),
    },
    async ({ mission, namespace }) => {
      try {
        const result = await client.getResults(mission, namespace);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error getting results: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}
