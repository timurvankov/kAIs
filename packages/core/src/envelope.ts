import { randomUUID } from 'node:crypto';

import { EnvelopeSchema } from './schemas.js';
import type { Envelope, EnvelopeType } from './types.js';

/**
 * Create a new Envelope with auto-generated id and timestamp.
 */
export function createEnvelope(params: {
  from: string;
  to: string;
  type: EnvelopeType;
  payload: unknown;
  traceId?: string;
  replyTo?: string;
}): Envelope {
  const envelope: Envelope = {
    id: randomUUID(),
    from: params.from,
    to: params.to,
    type: params.type,
    payload: params.payload,
    timestamp: new Date().toISOString(),
    traceId: params.traceId,
    replyTo: params.replyTo,
  };

  // Validate the constructed envelope
  return EnvelopeSchema.parse(envelope);
}
