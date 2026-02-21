import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';

import { startHealthServer } from '../health.js';

function fetch200(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    import('node:http').then(({ get }) => {
      get(url, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body }),
        );
      }).on('error', reject);
    });
  });
}

describe('startHealthServer', () => {
  let server: Server;

  afterEach(() => {
    server?.close();
  });

  it('responds 200 on /healthz', async () => {
    server = startHealthServer(0); // port 0 = random available port
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch200(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('responds 200 on /readyz', async () => {
    server = startHealthServer(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch200(`http://127.0.0.1:${port}/readyz`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('ok');
  });

  it('responds 404 on unknown paths', async () => {
    server = startHealthServer(0);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const res = await fetch200(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });
});
