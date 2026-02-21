import { createServer, type Server } from 'node:http';

/**
 * Start a minimal HTTP health server for Kubernetes liveness and readiness probes.
 *
 * Responds with 200 "ok" on /healthz and /readyz, 404 on everything else.
 */
export function startHealthServer(port = 8080): Server {
  const server = createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/readyz') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port);
  return server;
}
