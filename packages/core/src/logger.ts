import pino from 'pino';

/** Root logger instance. Respects the `LOG_LEVEL` environment variable (default: `info`). */
export const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

/** Create a child logger tagged with `component`. */
export function createLogger(name: string) {
  return logger.child({ component: name });
}
