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
    console.log('[ollama] Cleaning up...');
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
    console.log('[test] === Ollama LLM response test ===');
    await applyCell(OLLAMA_CELL);

    console.log('[test] Waiting for Cell pod to be ready...');
    await waitFor(
      async () => {
        const pods = await listPods('kais.io/cell=e2e-ollama-cell');
        if (pods.length === 0) return false;
        const pod = pods[0]!;
        const phase = pod.status?.phase ?? '?';
        const containerStatuses = pod.status?.containerStatuses ?? [];
        const ready = containerStatuses.some((cs) => cs.ready);
        console.log(`[test] Pod phase=${phase}, ready=${ready}, containers=${containerStatuses.length}`);
        if (!ready && containerStatuses.length > 0) {
          const cs = containerStatuses[0]!;
          const waiting = cs.state?.waiting;
          if (waiting) console.log(`[test]   Container waiting: ${waiting.reason} — ${waiting.message ?? ''}`);
        }
        return ready;
      },
      { timeoutMs: 90_000, label: 'ollama cell pod ready' },
    );

    console.log('[test] Pod ready. Connecting to NATS...');
    const nc = await connect({ servers: NATS_URL });
    const outboxSub = nc.subscribe('cell.default.e2e-ollama-cell.outbox', { max: 1 });

    const envelope = {
      id: crypto.randomUUID(),
      from: 'e2e-test',
      to: 'cell.default.e2e-ollama-cell',
      type: 'message',
      payload: { content: 'What is 2 + 2? Reply with just the number.' },
      timestamp: new Date().toISOString(),
    };
    console.log('[test] Sending message to cell inbox...');
    nc.publish(
      'cell.default.e2e-ollama-cell.inbox',
      new TextEncoder().encode(JSON.stringify(envelope)),
    );

    console.log('[test] Waiting for response on outbox...');
    let responseData: string | null = null;
    const timeout = setTimeout(() => {
      console.log('[test] Outbox subscription timed out (60s)');
      outboxSub.unsubscribe();
    }, 60_000);

    for await (const msg of outboxSub) {
      responseData = new TextDecoder().decode(msg.data);
      console.log(`[test] Got response: ${responseData.slice(0, 200)}...`);
      break;
    }
    clearTimeout(timeout);

    await nc.drain();

    expect(responseData).not.toBeNull();
    const response = JSON.parse(responseData!) as {
      type: string;
      payload: { content?: string };
    };
    expect(response.type).toBeDefined();
    expect(response.payload).toBeDefined();
    expect(response.payload.content).toBeDefined();
    expect(response.payload.content!.length).toBeGreaterThan(0);
    console.log(`[test] PASSED: LLM responded with: "${response.payload.content!.slice(0, 50)}"`);
  });
});
