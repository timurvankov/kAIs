/**
 * In-Process Runtime — Runs Cells as lightweight units in a single process.
 *
 * Used by the Experiment Engine for fast experiment runs without Pod overhead.
 * Cells communicate via an in-memory message bus or real NATS.
 */

import type { Envelope } from './types.js';

/** A running Cell instance. */
export interface RunningCell {
  id: string;
  name: string;
  status: 'starting' | 'running' | 'stopped' | 'failed';
  startedAt: number;
}

/** Abstract runtime interface for spawning and managing Cells. */
export interface CellRuntime {
  spawn(name: string, spec: Record<string, unknown>): Promise<RunningCell>;
  kill(cellId: string): Promise<void>;
  list(): Promise<RunningCell[]>;
  send(cellId: string, message: Envelope): Promise<void>;
  shutdown(): Promise<void>;
}

/** Subscription handle for the message bus. */
export interface Subscription {
  unsubscribe(): void;
}

/** Message handler function. */
export type MessageHandler = (message: Envelope) => void | Promise<void>;

/** Abstract message bus for Cell-to-Cell communication. */
export interface MessageBus {
  publish(subject: string, message: Envelope): Promise<void>;
  subscribe(subject: string, handler: MessageHandler): Subscription;
}

/**
 * In-memory message bus for in-process runtime.
 * Replaces NATS for experiment runs — direct function calls, no network overhead.
 * Supports NATS-style wildcard matching (. separated, * and > wildcards).
 */
export class InMemoryBus implements MessageBus {
  private subscriptions = new Map<string, Set<MessageHandler>>();
  private messageCount = 0;

  async publish(subject: string, message: Envelope): Promise<void> {
    this.messageCount++;
    const handlers = this.matchSubscriptions(subject);
    const promises: Array<void | Promise<void>> = [];
    for (const handler of handlers) {
      promises.push(handler(message));
    }
    await Promise.all(promises);
  }

  subscribe(subject: string, handler: MessageHandler): Subscription {
    if (!this.subscriptions.has(subject)) {
      this.subscriptions.set(subject, new Set());
    }
    this.subscriptions.get(subject)!.add(handler);
    return {
      unsubscribe: () => {
        this.subscriptions.get(subject)?.delete(handler);
        if (this.subscriptions.get(subject)?.size === 0) {
          this.subscriptions.delete(subject);
        }
      },
    };
  }

  /** Get total messages published through this bus. */
  getMessageCount(): number {
    return this.messageCount;
  }

  /** Get count of active subscriptions. */
  getSubscriptionCount(): number {
    let count = 0;
    for (const handlers of this.subscriptions.values()) {
      count += handlers.size;
    }
    return count;
  }

  /** Clear all subscriptions. */
  clear(): void {
    this.subscriptions.clear();
    this.messageCount = 0;
  }

  /**
   * Find all handlers matching the subject, supporting NATS-style wildcards:
   * - Exact match: "cell.default.coder.inbox"
   * - * matches single token: "cell.*.coder.inbox" matches "cell.default.coder.inbox"
   * - > matches remaining tokens: "cell.>" matches "cell.default.coder.inbox"
   */
  private matchSubscriptions(subject: string): MessageHandler[] {
    const handlers: MessageHandler[] = [];
    const subjectTokens = subject.split('.');

    for (const [pattern, handlerSet] of this.subscriptions) {
      if (this.matchesPattern(subjectTokens, pattern.split('.'))) {
        for (const h of handlerSet) {
          handlers.push(h);
        }
      }
    }

    return handlers;
  }

  private matchesPattern(subject: string[], pattern: string[]): boolean {
    for (let i = 0; i < pattern.length; i++) {
      const token = pattern[i]!;
      if (token === '>') {
        // > matches everything from here
        return true;
      }
      if (i >= subject.length) {
        return false;
      }
      if (token !== '*' && token !== subject[i]) {
        return false;
      }
    }
    return subject.length === pattern.length;
  }
}

/**
 * In-process runtime that manages Cells as lightweight objects.
 * Each Cell runs in the main thread (or could use worker_threads for isolation).
 */
export class InProcessRuntime implements CellRuntime {
  private cells = new Map<string, RunningCell>();
  private bus: MessageBus;
  private cellHandlers = new Map<string, Subscription>();

  constructor(bus?: MessageBus) {
    this.bus = bus ?? new InMemoryBus();
  }

  async spawn(name: string, spec: Record<string, unknown>): Promise<RunningCell> {
    const cell: RunningCell = {
      id: `cell-${name}-${Date.now()}`,
      name,
      status: 'running',
      startedAt: Date.now(),
    };
    this.cells.set(cell.id, cell);

    // Subscribe to cell inbox
    const sub = this.bus.subscribe(`cell.*.${name}.inbox`, (message) => {
      // In a real implementation, this would dispatch to the cell's mind
      // For now, just acknowledge receipt
    });
    this.cellHandlers.set(cell.id, sub);

    return cell;
  }

  async kill(cellId: string): Promise<void> {
    const cell = this.cells.get(cellId);
    if (cell) {
      cell.status = 'stopped';
      const sub = this.cellHandlers.get(cellId);
      sub?.unsubscribe();
      this.cellHandlers.delete(cellId);
      this.cells.delete(cellId);
    }
  }

  async list(): Promise<RunningCell[]> {
    return [...this.cells.values()];
  }

  async send(cellId: string, message: Envelope): Promise<void> {
    const cell = this.cells.get(cellId);
    if (!cell) {
      throw new Error(`Cell ${cellId} not found`);
    }
    const namespace = 'default';
    await this.bus.publish(`cell.${namespace}.${cell.name}.inbox`, message);
  }

  async shutdown(): Promise<void> {
    for (const [id, sub] of this.cellHandlers) {
      sub.unsubscribe();
    }
    this.cellHandlers.clear();
    this.cells.clear();
  }

  /** Get the underlying message bus. */
  getBus(): MessageBus {
    return this.bus;
  }
}
