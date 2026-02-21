/**
 * Abstract client interfaces for NATS and Postgres.
 * These allow easy mocking in tests without real connections.
 */

/** Represents a NATS subscription that can be iterated and unsubscribed. */
export interface NatsSubscription {
  [Symbol.asyncIterator](): AsyncIterableIterator<{ data: Uint8Array }>;
  unsubscribe(): void;
}

/** Minimal NATS client interface used by the API server. */
export interface NatsClient {
  publish(subject: string, data: Uint8Array): Promise<void>;
  subscribe(subject: string): NatsSubscription;
}

/** A row set returned from a Postgres query. */
export interface DbQueryResult {
  rows: Array<Record<string, unknown>>;
}

/** Minimal database client interface used by the API server. */
export interface DbClient {
  query(text: string, params?: unknown[]): Promise<DbQueryResult>;
}
