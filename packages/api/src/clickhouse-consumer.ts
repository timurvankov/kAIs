/**
 * Dual-write consumer: reads events from NATS JetStream and writes to both
 * Postgres (existing) and ClickHouse (analytics).
 *
 * Phase 7: ClickHouse integration for analytics queries.
 */

export interface ClickHouseClient {
  insert(table: string, rows: Record<string, unknown>[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

export interface DualWriteConsumerDeps {
  clickhouse: ClickHouseClient;
  db: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> };
}

interface CellEvent {
  id: number;
  cell_name: string;
  namespace: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Dual-write consumer that ensures events land in both Postgres and ClickHouse.
 */
export class DualWriteConsumer {
  private running = false;
  private pollIntervalMs: number;

  constructor(
    private readonly deps: DualWriteConsumerDeps,
    options?: { pollIntervalMs?: number },
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 5000;
  }

  private lastSyncedId = 0;

  /**
   * Sync new events from Postgres to ClickHouse.
   * Reads events with id > lastSyncedId, writes to ClickHouse in batches.
   */
  async sync(): Promise<number> {
    const result = await this.deps.db.query(
      'SELECT id, cell_name, namespace, event_type, payload, created_at FROM cell_events WHERE id > $1 ORDER BY id LIMIT 1000',
      [this.lastSyncedId],
    );

    const events = result.rows as CellEvent[];
    if (events.length === 0) return 0;

    const rows = events.map((e) => ({
      id: e.id,
      cell_name: e.cell_name,
      namespace: e.namespace,
      event_type: e.event_type,
      payload: JSON.stringify(e.payload),
      created_at: e.created_at,
    }));

    await this.deps.clickhouse.insert('cell_events_analytics', rows);

    this.lastSyncedId = events[events.length - 1]!.id;
    return events.length;
  }

  /** Start the continuous sync loop. */
  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.sync();
      } catch {
        // Log error but continue
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  /** Stop the sync loop. */
  stop(): void {
    this.running = false;
  }

  /** Get the last synced event ID. */
  getLastSyncedId(): number {
    return this.lastSyncedId;
  }
}

/**
 * Query helpers for ClickHouse analytics.
 */
export class ClickHouseAnalytics {
  constructor(private readonly ch: ClickHouseClient) {}

  /** Get daily cost trend for a namespace. */
  async costTrend(namespace: string, days = 30): Promise<Array<{ date: string; total_cost: number; total_tokens: number }>> {
    return this.ch.query(
      `SELECT date, sum(total_cost) AS total_cost, sum(total_tokens) AS total_tokens
       FROM cost_daily
       WHERE namespace = '${namespace}' AND date >= today() - ${days}
       GROUP BY date ORDER BY date`,
    );
  }

  /** Get top cells by cost in a namespace. */
  async topCellsByCost(namespace: string, limit = 10): Promise<Array<{ cell_name: string; total_cost: number }>> {
    return this.ch.query(
      `SELECT cell_name, sum(total_cost) AS total_cost
       FROM cost_daily
       WHERE namespace = '${namespace}'
       GROUP BY cell_name ORDER BY total_cost DESC LIMIT ${limit}`,
    );
  }

  /** Get event type distribution. */
  async eventDistribution(namespace: string): Promise<Array<{ event_type: string; count: number }>> {
    return this.ch.query(
      `SELECT event_type, count() AS count
       FROM cell_events_analytics
       WHERE namespace = '${namespace}'
       GROUP BY event_type ORDER BY count DESC`,
    );
  }
}
