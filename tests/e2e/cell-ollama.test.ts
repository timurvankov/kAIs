/**
 * E2E: Cell with Ollama — verify a Cell can use a local Ollama model
 * to produce real LLM responses inside the cluster.
 */
import { describe, it, afterEach, expect } from 'vitest';
import { connect } from 'nats';
import { applyCell, deleteCell, listPods, waitFor } from './helpers.js';

const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';

const OLLAMA_CELL = {
  apiVersion: 'kais.io/v1',
  kind: 'Cell',
  metadata: {
    name: 'e2e-ollama-cell',
    namespace: 'default',
  },
  spec: {
    mind: {
      provider: 'ollama',
      model: 'qwen2.5:0.5b',
      systemPrompt: 'You are a helpful assistant. Keep answers very short.',
      temperature: 0,
    },
    tools: [],
    resources: {
      maxTokensPerTurn: 256,
      maxCostPerHour: 0,
      memoryLimit: '256Mi',
      cpuLimit: '500m',
    },
  },
};

describe('Cell with Ollama (real LLM)', () => {
  afterEach(async () => {
    await deleteCell('e2e-ollama-cell');
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-ollama-cell');
        return pods.length === 0;
      },
      { timeoutMs: 30_000, label: 'ollama cell cleanup' },
    ).catch(() => {});
  });

  it('produces an LLM response when sent a message via NATS', async () => {
    // Apply the Cell
    await applyCell(OLLAMA_CELL);

    // Wait for Cell to be Running
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-ollama-cell');
        if (pods.length === 0) return false;
        const pod = pods[0]!;
        const containerStatuses = pod.status?.containerStatuses ?? [];
        return containerStatuses.some((cs) => cs.ready);
      },
      { timeoutMs: 90_000, label: 'ollama cell pod ready' },
    );

    // Connect to NATS and subscribe to outbox BEFORE sending message
    const nc = await connect({ servers: NATS_URL });
    const outboxSub = nc.subscribe('cell.default.e2e-ollama-cell.outbox', { max: 1 });

    // Send a message to the cell's inbox
    const envelope = {
      id: crypto.randomUUID(),
      from: 'e2e-test',
      to: 'cell.default.e2e-ollama-cell',
      type: 'message',
      payload: { content: 'What is 2 + 2? Reply with just the number.' },
      timestamp: new Date().toISOString(),
    };
    nc.publish(
      'cell.default.e2e-ollama-cell.inbox',
      new TextEncoder().encode(JSON.stringify(envelope)),
    );

    // Wait for a response on the outbox
    let responseData: string | null = null;
    const timeout = setTimeout(() => outboxSub.unsubscribe(), 60_000);

    for await (const msg of outboxSub) {
      responseData = new TextDecoder().decode(msg.data);
      break;
    }
    clearTimeout(timeout);

    await nc.drain();

    // Verify we got a response
    expect(responseData).not.toBeNull();
    const response = JSON.parse(responseData!) as {
      type: string;
      payload: { content?: string };
    };
    expect(response.type).toBeDefined();
    expect(response.payload).toBeDefined();
    // The LLM should have produced some content
    expect(response.payload.content).toBeDefined();
    expect(response.payload.content!.length).toBeGreaterThan(0);
  });
});
