/**
 * Entrypoint for the kAIs Cell Pod.
 * Reads env vars and starts CellRuntime.
 */
import { connect, AckPolicy, DeliverPolicy } from 'nats';

import { CellRuntime } from './cell-runtime.js';
import type { NatsConnection } from './cell-runtime.js';
import { createSendMessageTool } from './tools/send-message.js';
import { createReadFileTool } from './tools/read-file.js';
import { createWriteFileTool } from './tools/write-file.js';
import { createBashTool } from './tools/bash.js';
import type { Tool } from './tools/tool-executor.js';
import type { CellSpec } from '@kais/core';
import { initTelemetry, shutdownTelemetry } from '@kais/core';
import { createTopologyEnforcer } from './topology/topology-enforcer.js';

const CELL_NAME = process.env['CELL_NAME'] ?? '';
const CELL_NAMESPACE = process.env['CELL_NAMESPACE'] ?? 'default';
const CELL_SPEC_JSON = process.env['CELL_SPEC'] ?? '';
const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';

if (!CELL_NAME || !CELL_SPEC_JSON) {
  console.error('Missing required env vars: CELL_NAME, CELL_SPEC');
  process.exit(1);
}

const spec: CellSpec = JSON.parse(CELL_SPEC_JSON);

async function main() {
  // Initialise OpenTelemetry (no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset)
  initTelemetry({ serviceName: 'kais-cell' });

  // Connect to NATS
  const nc = await connect({ servers: NATS_URL });
  const js = nc.jetstream();
  const jsm = await nc.jetstreamManager();

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
    subscribeJetStream(
      stream: string,
      subject: string,
      consumerName: string,
      callback: (msg: { data: Uint8Array; subject: string; ack: () => void }) => Promise<void>,
    ) {
      let stopped = false;
      (async () => {
        // Create or update a durable consumer for this cell
        // ack_wait must exceed the longest LLM call (up to 10 min on CPU)
        await jsm.consumers.add(stream, {
          durable_name: consumerName,
          filter_subject: subject,
          ack_policy: AckPolicy.Explicit,
          deliver_policy: DeliverPolicy.All,
          ack_wait: 600_000_000_000, // 10 minutes in nanoseconds
        });
        // Get the durable consumer by name
        const consumer = await js.consumers.get(stream, consumerName);
        while (!stopped) {
          try {
            const msg = await consumer.next({ expires: 5_000 });
            if (msg) {
              await callback({
                data: msg.data,
                subject: msg.subject,
                ack: () => msg.ack(),
              });
            }
          } catch {
            // Timeout or transient error — retry
            if (!stopped) await new Promise(r => setTimeout(r, 1_000));
          }
        }
      })();
      return {
        unsubscribe() {
          stopped = true;
        },
      };
    },
    async drain() {
      await nc.drain();
    },
  };

  // Create topology enforcer (loads route table from ConfigMap mount)
  const topologyEnforcer = await createTopologyEnforcer(CELL_NAME);

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
        topologyEnforcer,
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

  // Knowledge tools (only when KNOWLEDGE_SERVICE_URL is set)
  const KNOWLEDGE_URL = process.env['KNOWLEDGE_SERVICE_URL'];
  if (KNOWLEDGE_URL) {
    const { createRecallTool, createRememberTool, createCorrectTool } = await import('./tools/recall.js');
    const graphId = process.env['KNOWLEDGE_GRAPH_ID'] || undefined;
    const knowledgeConfig = {
      knowledgeUrl: KNOWLEDGE_URL,
      cellName: CELL_NAME,
      namespace: CELL_NAMESPACE,
      graphId,
    };

    if (allowedTools.some(t => t.name === 'recall') || allowedTools.length === 0) {
      tools.push(createRecallTool(knowledgeConfig));
    }
    if (allowedTools.some(t => t.name === 'remember') || allowedTools.length === 0) {
      tools.push(createRememberTool(knowledgeConfig));
    }
    if (allowedTools.some(t => t.name === 'correct') || allowedTools.length === 0) {
      tools.push(createCorrectTool({ knowledgeUrl: KNOWLEDGE_URL, graphId }));
    }
  }

  // TODO: Wire spawn_cell tool — requires K8s client (e.g., @kubernetes/client-node)
  // which is not yet available in the cell runtime. Defer until K8s client integration.

  // TODO: Wire commit_file tool — requires shared/private workspace paths and
  // fs bindings. Defer until workspace volume mounts are configured in the Pod spec.

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
    await shutdownTelemetry();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  console.error('Fatal error starting cell:', err);
  process.exit(1);
});
