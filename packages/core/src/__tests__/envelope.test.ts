import { describe, expect, it } from 'vitest';

import { createEnvelope } from '../envelope.js';
import { EnvelopeSchema } from '../schemas.js';

describe('createEnvelope', () => {
  it('creates a valid envelope with auto-generated id and timestamp', () => {
    const envelope = createEnvelope({
      from: 'cell.default.researcher',
      to: 'cell.default.writer',
      type: 'message',
      payload: { text: 'Hello' },
    });

    expect(envelope.from).toBe('cell.default.researcher');
    expect(envelope.to).toBe('cell.default.writer');
    expect(envelope.type).toBe('message');
    expect(envelope.payload).toEqual({ text: 'Hello' });

    // id should be a valid UUID
    expect(envelope.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // timestamp should be a valid ISO-8601 datetime
    expect(() => new Date(envelope.timestamp)).not.toThrow();
    expect(new Date(envelope.timestamp).toISOString()).toBeTruthy();
  });

  it('passes Zod validation', () => {
    const envelope = createEnvelope({
      from: 'cell.default.a',
      to: 'cell.default.b',
      type: 'tool_result',
      payload: { result: 42 },
    });

    const parsed = EnvelopeSchema.parse(envelope);
    expect(parsed).toEqual(envelope);
  });

  it('includes optional traceId and replyTo', () => {
    const envelope = createEnvelope({
      from: 'cell.default.a',
      to: 'cell.default.b',
      type: 'system',
      payload: null,
      traceId: 'trace-abc',
      replyTo: 'cell.default.coordinator',
    });

    expect(envelope.traceId).toBe('trace-abc');
    expect(envelope.replyTo).toBe('cell.default.coordinator');
  });

  it('generates unique ids for each envelope', () => {
    const e1 = createEnvelope({
      from: 'cell.default.a',
      to: 'cell.default.b',
      type: 'message',
      payload: null,
    });
    const e2 = createEnvelope({
      from: 'cell.default.a',
      to: 'cell.default.b',
      type: 'message',
      payload: null,
    });

    expect(e1.id).not.toBe(e2.id);
  });

  it('supports all envelope types', () => {
    for (const type of ['message', 'tool_result', 'system', 'control'] as const) {
      const envelope = createEnvelope({
        from: 'cell.default.a',
        to: 'cell.default.b',
        type,
        payload: null,
      });
      expect(envelope.type).toBe(type);
    }
  });
});
