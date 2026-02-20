import { describe, expect, it, vi } from 'vitest';

import { BudgetError, TransientError } from '../errors.js';
import { withRetry } from '../retry.js';
import type { RetryStrategy } from '../types.js';

const fastStrategy: RetryStrategy = {
  maxRetries: 3,
  backoff: 'constant',
  baseDelayMs: 1, // 1ms for fast tests
  maxDelayMs: 10,
};

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, fastStrategy);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError('timeout'))
      .mockRejectedValueOnce(new TransientError('timeout again'))
      .mockResolvedValue('recovered');

    const result = await withRetry(fn, fastStrategy);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on non-retryable KaisError', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new BudgetError('over budget'));

    await expect(withRetry(fn, fastStrategy)).rejects.toThrow(BudgetError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on non-KaisError', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new Error('unexpected'));

    await expect(withRetry(fn, fastStrategy)).rejects.toThrow('unexpected');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts max retries and throws last error', async () => {
    const fn = vi.fn().mockRejectedValue(new TransientError('always fails'));

    await expect(withRetry(fn, fastStrategy)).rejects.toThrow(TransientError);
    // 1 initial attempt + 3 retries = 4 calls
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('respects maxRetries=0 (no retries)', async () => {
    const noRetry: RetryStrategy = {
      ...fastStrategy,
      maxRetries: 0,
    };
    const fn = vi.fn().mockRejectedValue(new TransientError('fail'));

    await expect(withRetry(fn, noRetry)).rejects.toThrow(TransientError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff delays', async () => {
    vi.useFakeTimers();

    const expStrategy: RetryStrategy = {
      maxRetries: 3,
      backoff: 'exponential',
      baseDelayMs: 100,
      maxDelayMs: 10000,
    };

    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        return Promise.reject(new TransientError('fail'));
      }
      return Promise.resolve('done');
    });

    const promise = withRetry(fn, expStrategy);

    // Advance through retries: 100ms, 200ms, 400ms
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(400);

    const result = await promise;
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
  });

  it('caps delay at maxDelayMs', async () => {
    const cappedStrategy: RetryStrategy = {
      maxRetries: 5,
      backoff: 'exponential',
      baseDelayMs: 1,
      maxDelayMs: 5, // very low cap
    };

    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 5) {
        return Promise.reject(new TransientError('fail'));
      }
      return Promise.resolve('done');
    });

    const result = await withRetry(fn, cappedStrategy);
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('works with linear backoff', async () => {
    const linearStrategy: RetryStrategy = {
      maxRetries: 2,
      backoff: 'linear',
      baseDelayMs: 1,
      maxDelayMs: 100,
    };

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new TransientError('fail'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, linearStrategy);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
