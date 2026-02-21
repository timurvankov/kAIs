/**
 * send_message tool — publish a message to another Cell's inbox via NATS.
 */
import { createEnvelope } from '@kais/core';
import { z } from 'zod';

import type { TopologyEnforcer } from '../topology/topology-enforcer.js';
import type { Tool } from './tool-executor.js';

export interface NatsPublisher {
  publish(subject: string, data: Uint8Array): void;
}

export interface SendMessageConfig {
  cellName: string;
  namespace: string;
  nats: NatsPublisher;
  topologyEnforcer?: TopologyEnforcer;
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
      const SendMessageInput = z.object({
        to: z.string().min(1, '"to" must be a non-empty string'),
        message: z.string().min(1, '"message" must be a non-empty string'),
      });
      const { to, message } = SendMessageInput.parse(input);

      // Topology enforcement: check if this cell is allowed to send to the target
      if (config.topologyEnforcer && !config.topologyEnforcer.canSendTo(to)) {
        const allowed = config.topologyEnforcer.getAllowedTargets();
        throw new Error(
          `Topology violation: ${config.cellName} cannot send messages to ${to}. Allowed targets: [${allowed.join(', ')}]`,
        );
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
