/**
 * EventConsumer — subscribes to cell.events.> on NATS and persists
 * events into the cell_events Postgres table.
 *
 * This bridges the gap between events published by cell-runtime and
 * the /logs and /usage API endpoints that query Postgres.
 */
import type { DbClient, NatsClient, NatsSubscription } from './clients.js';

export class EventConsumer {
  private subscription: NatsSubscription | null = null;
  private running = false;

  constructor(
    private readonly nats: NatsClient,
    private readonly db: DbClient,
  ) {}

  /**
   * Start consuming events from NATS and persisting them to Postgres.
   * Subscribes to `cell.events.>` (wildcard matching all cell event subjects).
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.subscription = this.nats.subscribe('cell.events.>');

    // Process events in the background
    void this.processEvents();

    console.log('[EventConsumer] started listening on cell.events.>');
  }

  /**
   * Stop consuming events.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    console.log('[EventConsumer] stopped');
  }

  /**
   * Process events from the subscription async iterator.
   */
  private async processEvents(): Promise<void> {
    if (!this.subscription) return;

    try {
      for await (const msg of this.subscription) {
        if (!this.running) break;

        try {
          const text = new TextDecoder().decode(msg.data);
          const payload = JSON.parse(text) as Record<string, unknown>;

          const cellName = payload.cellName as string | undefined;
          const namespace = payload.namespace as string | undefined;
          const eventType = payload.type as string | undefined;

          if (!cellName || !eventType) {
            console.warn('[EventConsumer] skipping event with missing cellName or type');
            continue;
          }

          const eventPayload = payload.payload ?? {};
          await this.db.query(
            'INSERT INTO cell_events (cell_name, namespace, event_type, payload) VALUES ($1, $2, $3, $4)',
            [cellName, namespace ?? 'default', eventType, JSON.stringify(eventPayload)],
          );
        } catch (err) {
          console.error('[EventConsumer] failed to process event:', err);
        }
      }
    } catch (err) {
      if (this.running) {
        console.error('[EventConsumer] subscription error:', err);
      }
    }
  }
}
