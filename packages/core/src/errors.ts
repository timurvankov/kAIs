/**
 * Base error class for all kAIs errors.
 */
export class KaisError extends Error {
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = 'KaisError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Transient / retryable errors (network issues, LLM timeouts, rate limits).
 */
export class TransientError extends KaisError {
  constructor(message: string, code: string = 'TRANSIENT') {
    super(message, code, true);
    this.name = 'TransientError';
  }
}

/**
 * Budget/cost limits exceeded.
 */
export class BudgetError extends KaisError {
  constructor(message: string, code: string = 'BUDGET_EXCEEDED') {
    super(message, code, false);
    this.name = 'BudgetError';
  }
}

/**
 * Tool execution failed.
 */
export class ToolError extends KaisError {
  constructor(message: string, code: string = 'TOOL_ERROR') {
    super(message, code, false);
    this.name = 'ToolError';
  }
}

/**
 * LLM call failed (non-transient, e.g. invalid request).
 */
export class LLMError extends KaisError {
  constructor(message: string, code: string = 'LLM_ERROR') {
    super(message, code, false);
    this.name = 'LLMError';
  }
}

/**
 * Protocol violation — wrong message type for the current protocol state.
 */
export class ProtocolViolation extends KaisError {
  constructor(message: string, code: string = 'PROTOCOL_VIOLATION') {
    super(message, code, false);
    this.name = 'ProtocolViolation';
  }
}
