/**
 * MockMind — configurable mock provider for testing.
 */
import { LLMError } from '@kais/core';

import type { Mind, ThinkInput, ThinkOutput } from './types.js';

export class MockMind implements Mind {
  public readonly provider = 'mock';
  public readonly model: string;

  /** Recorded think() calls for assertion. */
  public readonly calls: ThinkInput[] = [];

  private readonly queue: ThinkOutput[] = [];
  private errorToThrow: Error | null = null;

  constructor(model: string = 'mock-model') {
    this.model = model;
  }

  /**
   * Enqueue one or more responses. They will be returned in FIFO order.
   */
  enqueue(...outputs: ThinkOutput[]): void {
    this.queue.push(...outputs);
  }

  /**
   * Set an error to throw on the next think() call(s).
   * The error will be thrown on every call until clearError() is called.
   */
  setError(error: Error): void {
    this.errorToThrow = error;
  }

  /**
   * Clear a previously set error.
   */
  clearError(): void {
    this.errorToThrow = null;
  }

  /**
   * Clear the response queue and call history.
   */
  reset(): void {
    this.queue.length = 0;
    this.calls.length = 0;
    this.errorToThrow = null;
  }

  async think(input: ThinkInput): Promise<ThinkOutput> {
    this.calls.push(input);

    if (this.errorToThrow) {
      throw this.errorToThrow;
    }

    const output = this.queue.shift();
    if (!output) {
      throw new LLMError('MockMind: no responses queued', 'MOCK_EMPTY');
    }

    return output;
  }
}
