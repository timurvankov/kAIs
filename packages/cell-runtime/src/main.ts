/**
 * Entrypoint for the kAIs Cell Pod.
 * Reads env vars and starts CellRuntime.
 */
import { connect } from 'nats';

import { CellRuntime } from './cell-runtime.js';
import type { NatsConnection } from './cell-runtime.js';
import { createSendMessageTool } from './tools/send-message.js';
import { createReadFileTool } from './tools/read-file.js';
import { createWriteFileTool } from './tools/write-file.js';
import { createBashTool } from './tools/bash.js';
import type { Tool } from './tools/tool-executor.js';
import type { CellSpec } from '@kais/core';

const CELL_NAME = process.env['CELL_NAME'];
const CELL_NAMESPACE = process.env['CELL_NAMESPACE'] ?? 'default';
const CELL_SPEC_JSON = process.env['CELL_SPEC'];
const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';

if (!CELL_NAME || !CELL_SPEC_JSON) {
  console.error('Missing required env vars: CELL_NAME, CELL_SPEC');
  process.exit(1);
}

const spec: CellSpec = JSON.parse(CELL_SPEC_JSON);

async function main() {
  // Connect to NATS
  const nc = await connect({ servers: NATS_URL });
  const nats: NatsConnection = {
    publish(subject: string, data: Uint8Array) {
      nc.publish(subject, data);
    },
    subscribe(subject: string, callback: (msg: { data: Uint8Array; subject: string }) => void) {
      const sub = nc.subscribe(subject);
      (async () => {
        for await (const msg of sub) {
          callback({ data: msg.data, subject: msg.subject });
        }
      })();
      return {
        unsubscribe() {
          sub.unsubscribe();
        },
      };
    },
    async drain() {
      await nc.drain();
    },
  };

  // Create Mind based on provider
  const { provider, model } = spec.mind;
  let mind;
  if (provider === 'anthropic') {
    const { AnthropicMind } = await import('@kais/mind');
    mind = new AnthropicMind(model);
  } else if (provider === 'openai') {
    const { OpenAIMind } = await import('@kais/mind');
    mind = new OpenAIMind(model);
  } else if (provider === 'ollama') {
    const { OllamaMind } = await import('@kais/mind');
    mind = new OllamaMind(model);
  } else {
    console.error(`Unknown provider: ${provider}`);
    process.exit(1);
  }

  // Create tools
  const tools: Tool[] = [];
  const allowedTools = spec.tools ?? [];

  if (allowedTools.some(t => t.name === 'send_message') || allowedTools.length === 0) {
    tools.push(
      createSendMessageTool({
        nats: { publish: (s, d) => nats.publish(s, d) },
        cellName: CELL_NAME,
        namespace: CELL_NAMESPACE,
      }),
    );
  }
  if (allowedTools.some(t => t.name === 'read_file') || allowedTools.length === 0) {
    const fs = await import('node:fs/promises');
    tools.push(
      createReadFileTool({
        fs: {
          readFile: (p: string, enc: 'utf-8') => fs.readFile(p, enc),
        },
        cellName: CELL_NAME,
      }),
    );
  }
  if (allowedTools.some(t => t.name === 'write_file') || allowedTools.length === 0) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    tools.push(
      createWriteFileTool({
        fs: {
          writeFile: (p: string, c: string, enc: 'utf-8') => fs.writeFile(p, c, enc),
          mkdir: (p: string, opts: { recursive: boolean }) =>
            fs.mkdir(path.dirname(p), opts).then(() => {}),
        },
        cellName: CELL_NAME,
      }),
    );
  }
  if (allowedTools.some(t => t.name === 'bash') || allowedTools.length === 0) {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    tools.push(
      createBashTool({
        executor: {
          async exec(cmd: string, options: { timeout: number }) {
            try {
              const result = await execAsync(cmd, { timeout: options.timeout });
              return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
            } catch (err) {
              const e = err as { stdout?: string; stderr?: string; code?: number };
              return {
                stdout: e.stdout ?? '',
                stderr: e.stderr ?? String(err),
                exitCode: e.code ?? 1,
              };
            }
          },
        },
      }),
    );
  }

  // Create and start runtime
  const runtime = new CellRuntime({
    cellName: CELL_NAME,
    namespace: CELL_NAMESPACE,
    spec,
    mind,
    nats,
    tools,
  });

  await runtime.start();
  console.log(`Cell ${CELL_NAME} started in namespace ${CELL_NAMESPACE}`);

  // Graceful shutdown
  const shutdown = async () => {
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error('Fatal error starting cell:', err);
  process.exit(1);
});
