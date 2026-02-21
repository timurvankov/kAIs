import pg from 'pg';
import { connect, type NatsConnection } from 'nats';
import type { DbClient, NatsClient, NatsSubscription } from '@kais/api';

// ---------------------------------------------------------------------------
// Environment defaults
// ---------------------------------------------------------------------------

const POSTGRES_URL = process.env.POSTGRES_URL ?? 'postgres://postgres:test@localhost:5432/kais_test';
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:4222';

// ---------------------------------------------------------------------------
// Postgres adapter
// ---------------------------------------------------------------------------

export interface TestDbClient extends DbClient {
  /** Expose the underlying pool so we can close it in teardown. */
  pool: pg.Pool;
}

export function createDbClient(url: string = POSTGRES_URL): TestDbClient {
  const pool = new pg.Pool({ connectionString: url });

  const client: TestDbClient = {
    pool,
    async query(text: string, params?: unknown[]) {
      const result = await pool.query(text, params);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// NATS adapter
// ---------------------------------------------------------------------------

export interface TestNatsClient extends NatsClient {
  /** Expose the underlying connection so we can drain/close it in teardown. */
  connection: NatsConnection;
}

export async function createNatsClient(url: string = NATS_URL): Promise<TestNatsClient> {
  const nc = await connect({ servers: url });

  const client: TestNatsClient = {
    connection: nc,

    async publish(subject: string, data: Uint8Array) {
      nc.publish(subject, data);
    },

    subscribe(subject: string): NatsSubscription {
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

  return client;
}

// ---------------------------------------------------------------------------
// Database reset
// ---------------------------------------------------------------------------

const TABLES_TO_TRUNCATE = ['cell_events', 'formations', 'missions', 'mission_checks'];

export async function resetDb(db: DbClient): Promise<void> {
  await db.query(`TRUNCATE ${TABLES_TO_TRUNCATE.join(', ')} CASCADE`);
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

export async function closeAll(db: TestDbClient, nc: TestNatsClient): Promise<void> {
  await nc.connection.drain();
  await db.pool.end();
}

// ---------------------------------------------------------------------------
// NATS message collector — subscribe and gather N messages with a timeout
// ---------------------------------------------------------------------------

export interface CollectedMessage {
  data: Uint8Array;
}

/**
 * Subscribe to a NATS subject and collect up to `count` messages.
 * Resolves with collected messages when `count` is reached or rejects after
 * `timeoutMs` milliseconds.
 */
export function collectMessages(
  nats: NatsClient,
  subject: string,
  count: number,
  timeoutMs: number = 10_000,
): { promise: Promise<CollectedMessage[]>; subscription: NatsSubscription } {
  const sub = nats.subscribe(subject);
  const collected: CollectedMessage[] = [];

  const promise = new Promise<CollectedMessage[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(
        new Error(
          `collectMessages: timed out after ${timeoutMs}ms — received ${collected.length}/${count} messages on "${subject}"`,
        ),
      );
    }, timeoutMs);

    void (async () => {
      try {
        for await (const msg of sub) {
          collected.push({ data: msg.data });
          if (collected.length >= count) {
            clearTimeout(timer);
            sub.unsubscribe();
            resolve(collected);
            return;
          }
        }
        // Subscription ended before reaching count (e.g. unsubscribe from outside)
        clearTimeout(timer);
        resolve(collected);
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })();
  });

  return { promise, subscription: sub };
}

// ---------------------------------------------------------------------------
// Poll helper — wait for a condition to be true
// ---------------------------------------------------------------------------

export async function pollUntil(
  fn: () => Promise<boolean>,
  { intervalMs = 200, timeoutMs = 10_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollUntil: timed out after ${timeoutMs}ms`);
}
