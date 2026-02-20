import { KaisError } from './errors.js';
import type { RetryStrategy } from './types.js';

/**
 * Compute delay for a given attempt using the retry strategy.
 */
function computeDelay(strategy: RetryStrategy, attempt: number): number {
  let delay: number;

  switch (strategy.backoff) {
    case 'constant':
      delay = strategy.baseDelayMs;
      break;
    case 'linear':
      delay = strategy.baseDelayMs * (attempt + 1);
      break;
    case 'exponential':
      delay = strategy.baseDelayMs * Math.pow(2, attempt);
      break;
  }

  return Math.min(delay, strategy.maxDelayMs);
}

/**
 * Execute a function with retry logic.
 *
 * - Only retries if the error is a KaisError with retryable=true
 * - Non-retryable errors are thrown immediately
 * - Non-KaisError exceptions are thrown immediately
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  strategy: RetryStrategy,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= strategy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Only retry KaisError with retryable=true
      if (error instanceof KaisError && error.retryable) {
        if (attempt < strategy.maxRetries) {
          const delay = computeDelay(strategy, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }

      // Non-retryable or not a KaisError — throw immediately
      if (!(error instanceof KaisError) || !error.retryable) {
        throw error;
      }
    }
  }

  // Max retries exhausted
  throw lastError;
}
