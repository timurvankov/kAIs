import { describe, expect, it } from 'vitest';

import {
  BudgetError,
  KaisError,
  LLMError,
  ProtocolViolation,
  ToolError,
  TransientError,
} from '../errors.js';

describe('KaisError', () => {
  it('has code and retryable properties', () => {
    const err = new KaisError('test', 'TEST_CODE', false);
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('KaisError');
  });

  it('is an instance of Error', () => {
    const err = new KaisError('test', 'TEST', false);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(KaisError);
  });
});

describe('TransientError', () => {
  it('is retryable by default', () => {
    const err = new TransientError('network timeout');
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('TRANSIENT');
    expect(err.name).toBe('TransientError');
  });

  it('accepts a custom code', () => {
    const err = new TransientError('rate limited', 'RATE_LIMIT');
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.retryable).toBe(true);
  });

  it('extends KaisError', () => {
    const err = new TransientError('test');
    expect(err).toBeInstanceOf(KaisError);
    expect(err).toBeInstanceOf(TransientError);
  });
});

describe('BudgetError', () => {
  it('is not retryable', () => {
    const err = new BudgetError('cost exceeded $10');
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('BUDGET_EXCEEDED');
    expect(err.name).toBe('BudgetError');
  });

  it('extends KaisError', () => {
    expect(new BudgetError('test')).toBeInstanceOf(KaisError);
  });
});

describe('ToolError', () => {
  it('is not retryable', () => {
    const err = new ToolError('tool crashed');
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('TOOL_ERROR');
    expect(err.name).toBe('ToolError');
  });

  it('extends KaisError', () => {
    expect(new ToolError('test')).toBeInstanceOf(KaisError);
  });
});

describe('LLMError', () => {
  it('is not retryable', () => {
    const err = new LLMError('invalid request');
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('LLM_ERROR');
    expect(err.name).toBe('LLMError');
  });

  it('extends KaisError', () => {
    expect(new LLMError('test')).toBeInstanceOf(KaisError);
  });
});

describe('ProtocolViolation', () => {
  it('is not retryable', () => {
    const err = new ProtocolViolation('unexpected message type');
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('PROTOCOL_VIOLATION');
    expect(err.name).toBe('ProtocolViolation');
  });

  it('extends KaisError', () => {
    expect(new ProtocolViolation('test')).toBeInstanceOf(KaisError);
  });
});

describe('Error hierarchy', () => {
  it('all error types are instances of KaisError and Error', () => {
    const errors = [
      new TransientError('a'),
      new BudgetError('b'),
      new ToolError('c'),
      new LLMError('d'),
      new ProtocolViolation('e'),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(KaisError);
    }
  });

  it('only TransientError is retryable', () => {
    expect(new TransientError('a').retryable).toBe(true);
    expect(new BudgetError('b').retryable).toBe(false);
    expect(new ToolError('c').retryable).toBe(false);
    expect(new LLMError('d').retryable).toBe(false);
    expect(new ProtocolViolation('e').retryable).toBe(false);
  });
});
