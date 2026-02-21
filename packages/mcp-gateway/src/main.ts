import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';

import { KaisClient } from './kais-client.js';
import { createMcpServer } from './server.js';

const KAIS_API_URL = process.env['KAIS_API_URL'] ?? 'http://localhost:8080';
const KAIS_AUTH_TOKEN = process.env['KAIS_AUTH_TOKEN'] ?? '';
const PORT = parseInt(process.env['MCP_PORT'] ?? '3001', 10);

const client = new KaisClient({
  baseUrl: KAIS_API_URL,
  authToken: KAIS_AUTH_TOKEN || undefined,
});

const mcpServer = createMcpServer(client, {
  name: 'kais',
  version: '0.1.0',
});

// Streamable HTTP transport mounted at /mcp
const httpServer = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === '/mcp' || req.url?.startsWith('/mcp?')) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    // Connect the MCP server to this transport for the request lifetime
    await mcpServer.connect(transport);

    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

httpServer.listen(PORT, () => {
  console.log(`kAIs MCP Gateway listening on port ${PORT}`);
  console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`  Health check: http://localhost:${PORT}/healthz`);
  console.log(`  kAIs API:     ${KAIS_API_URL}`);
});
