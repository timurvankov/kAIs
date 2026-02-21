/**
 * Entrypoint for running the kAIs API server standalone.
 *
 * Reads configuration from environment variables:
 *   NATS_URL   — NATS server URL (default: nats://localhost:4222)
 *   POSTGRES_URL — Postgres connection string (default: postgres://localhost:5432/kais)
 *   PORT       — HTTP port (default: 3000)
 */

import { connect } from 'nats';
import pg from 'pg';

import { buildServer } from './server.js';
import type { DbClient, NatsClient } from './clients.js';

const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';
const POSTGRES_URL = process.env['POSTGRES_URL'] ?? 'postgres://localhost:5432/kais';
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

async function main(): Promise<void> {
  // Connect to NATS
  const nc = await connect({ servers: NATS_URL });
  const nats: NatsClient = {
    async publish(subject, data) {
      nc.publish(subject, data);
    },
    subscribe(subject) {
      const sub = nc.subscribe(subject);
      return {
        async *[Symbol.asyncIterator]() {
          for await (const msg of sub) {
            yield { data: msg.data };
          }
        },
        unsubscribe() {
          sub.unsubscribe();
        },
      };
    },
  };

  // Connect to Postgres
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  const db: DbClient = {
    async query(text, params) {
      return pool.query(text, params);
    },
  };

  // Build & start
  const app = await buildServer({ nats, db });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    console.log(`kAIs API server listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown — drain NATS and close Postgres pool on termination
  const shutdown = async () => {
    await app.close();
    await nc.drain();
    await pool.end();
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
