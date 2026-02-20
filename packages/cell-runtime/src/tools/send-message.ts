/**
 * send_message tool — publish a message to another Cell's inbox via NATS.
 */
import { createEnvelope } from '@kais/core';

import type { Tool } from './tool-executor.js';

export interface NatsPublisher {
  publish(subject: string, data: Uint8Array): void;
}

export interface SendMessageConfig {
  cellName: string;
  namespace: string;
  nats: NatsPublisher;
}

export function createSendMessageTool(config: SendMessageConfig): Tool {
  return {
    name: 'send_message',
    description: 'Send a message to another Cell by name. The message will be delivered to their inbox.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'The name of the target Cell' },
        message: { type: 'string', description: 'The message content to send' },
      },
      required: ['to', 'message'],
    },
    async execute(input: unknown): Promise<string> {
      const { to, message } = input as { to: string; message: string };

      if (!to || !message) {
        throw new Error('Both "to" and "message" are required');
      }

      const envelope = createEnvelope({
        from: config.cellName,
        to,
        type: 'message',
        payload: { content: message },
      });

      const subject = `cell.${config.namespace}.${to}.inbox`;
      const data = new TextEncoder().encode(JSON.stringify(envelope));
      config.nats.publish(subject, data);

      return `Message sent to ${to}`;
    },
  };
}
