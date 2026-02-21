import { describe, expect, it } from 'vitest';

import { logger, createLogger } from '../logger.js';

describe('logger', () => {
  it('is a pino logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.child).toBe('function');
  });
});

describe('createLogger', () => {
  it('returns a child logger with the component binding', () => {
    const child = createLogger('my-component');
    expect(child).toBeDefined();
    expect(typeof child.info).toBe('function');

    // pino child loggers expose their bindings
    const bindings = child.bindings();
    expect(bindings).toHaveProperty('component', 'my-component');
  });

  it('creates distinct children for different names', () => {
    const a = createLogger('alpha');
    const b = createLogger('beta');
    expect(a.bindings().component).toBe('alpha');
    expect(b.bindings().component).toBe('beta');
  });
});
