/**
 * Base error class for all kAIs errors.
 */
export class KaisError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KaisError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Transient / retryable errors (network issues, LLM timeouts, rate limits).
 */
export class TransientError extends KaisError {
  constructor(message: string, code: string = 'TRANSIENT', options?: { cause?: unknown }) {
    super(message, code, true, options);
    this.name = 'TransientError';
  }
}

/**
 * Budget/cost limits exceeded.
 */
export class BudgetError extends KaisError {
  constructor(message: string, code: string = 'BUDGET_EXCEEDED', options?: { cause?: unknown }) {
    super(message, code, false, options);
    this.name = 'BudgetError';
  }
}

/**
 * Tool execution failed.
 */
export class ToolError extends KaisError {
  constructor(message: string, code: string = 'TOOL_ERROR', options?: { cause?: unknown }) {
    super(message, code, false, options);
    this.name = 'ToolError';
  }
}

/**
 * LLM call failed (non-transient, e.g. invalid request).
 */
export class LLMError extends KaisError {
  constructor(message: string, code: string = 'LLM_ERROR', options?: { cause?: unknown }) {
    super(message, code, false, options);
    this.name = 'LLMError';
  }
}

/**
 * Protocol violation — wrong message type for the current protocol state.
 */
export class ProtocolViolation extends KaisError {
  constructor(message: string, code: string = 'PROTOCOL_VIOLATION', options?: { cause?: unknown }) {
    super(message, code, false, options);
    this.name = 'ProtocolViolation';
  }
}
