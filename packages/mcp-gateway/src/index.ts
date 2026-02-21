// @kais/mcp-gateway — MCP server exposing kAIs as tools
export { createMcpServer } from './server.js';
export type { McpGatewayOptions } from './server.js';
export { KaisClient } from './kais-client.js';
export type {
  KaisClientOptions,
  LaunchTeamParams,
  LaunchTeamResult,
  MissionStatusResult,
  RecallResult,
  BlueprintSummary,
  MissionResult,
} from './kais-client.js';
