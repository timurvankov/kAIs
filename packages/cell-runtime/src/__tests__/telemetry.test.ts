/**
 * Telemetry integration tests — verify actual span creation with InMemorySpanExporter.
 *
 * Uses a single BasicTracerProvider for the whole suite to avoid OTel global
 * re-registration issues. Exporter is reset between tests.
 */
import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { trace, context, propagation } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { MockMind } from '@kais/mind';
import type { CellSpec } from '@kais/core';

import { CellRuntime } from '../cell-runtime.js';
import type { Tool } from '../tools/tool-executor.js';
import { MockNatsConnection, makeThinkOutput, makeEnvelope } from './helpers.js';

function makeSpec(overrides: Partial<CellSpec> = {}): CellSpec {
  return {
    mind: {
      provider: 'anthropic',
      model: 'test-model',
      systemPrompt: 'You are a test assistant.',
      ...overrides.mind,
    },
    tools: overrides.tools,
    resources: overrides.resources,
  };
}

function makeEchoTool(): Tool {
  return {
    name: 'echo',
    description: 'Echoes input back',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    async execute(input: unknown): Promise<string> {
      return `Echo: ${(input as { text: string }).text}`;
    },
  };
}

describe('CellRuntime telemetry', () => {
  const exporter = new InMemorySpanExporter();
  let provider: BasicTracerProvider;
  let mind: MockMind;
  let nats: MockNatsConnection;

  beforeAll(() => {
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });

  beforeEach(() => {
    exporter.reset();
    mind = new MockMind();
    nats = new MockNatsConnection();
  });

  it('creates cell.handle_message span with correct attributes', async () => {
    mind.enqueue(makeThinkOutput({ content: 'Response' }));

    const runtime = new CellRuntime({
      cellName: 'test-cell',
      namespace: 'default',
      spec: makeSpec(),
      mind,
      nats,
    });

    await runtime.processMessage(makeEnvelope({ from: 'user', to: 'test-cell' }));
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const handleSpan = spans.find(s => s.name === 'cell.handle_message');

    expect(handleSpan).toBeDefined();
    expect(handleSpan!.attributes['cell.name']).toBe('test-cell');
    expect(handleSpan!.attributes['message.type']).toBe('message');
    expect(handleSpan!.attributes['message.from']).toBe('user');
  });

  it('creates cell.llm_call span with LLM attributes', async () => {
    mind.enqueue(makeThinkOutput({
      content: 'Done',
      usage: { inputTokens: 200, outputTokens: 50, totalTokens: 250, cost: 0.01 },
    }));

    const runtime = new CellRuntime({
      cellName: 'test-cell',
      namespace: 'default',
      spec: makeSpec(),
      mind,
      nats,
    });

    await runtime.processMessage(makeEnvelope());
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const llmSpan = spans.find(s => s.name === 'cell.llm_call');

    expect(llmSpan).toBeDefined();
    expect(llmSpan!.attributes['llm.provider']).toBe('anthropic');
    expect(llmSpan!.attributes['llm.model']).toBe('test-model');
    expect(llmSpan!.attributes['llm.input_tokens']).toBe(200);
    expect(llmSpan!.attributes['llm.output_tokens']).toBe(50);
    expect(llmSpan!.attributes['llm.cost']).toBe(0.01);
  });

  it('creates cell.tool_call span per tool execution', async () => {
    mind.enqueue(makeThinkOutput({
      content: '',
      stopReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'echo', input: { text: 'hello' } }],
    }));
    mind.enqueue(makeThinkOutput({ content: 'Done after tool' }));

    const runtime = new CellRuntime({
      cellName: 'test-cell',
      namespace: 'default',
      spec: makeSpec({ tools: [{ name: 'echo' }] }),
      mind,
      nats,
      tools: [makeEchoTool()],
    });

    await runtime.processMessage(makeEnvelope());
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const toolSpan = spans.find(s => s.name === 'cell.tool_call');

    expect(toolSpan).toBeDefined();
    expect(toolSpan!.attributes['tool.name']).toBe('echo');
  });

  it('creates all three spans for a tool-use agentic loop', async () => {
    mind.enqueue(makeThinkOutput({
      content: '',
      stopReason: 'tool_use',
      toolCalls: [{ id: 'tc1', name: 'echo', input: { text: 'step1' } }],
    }));
    mind.enqueue(makeThinkOutput({ content: 'All done' }));

    const runtime = new CellRuntime({
      cellName: 'test-cell',
      namespace: 'default',
      spec: makeSpec({ tools: [{ name: 'echo' }] }),
      mind,
      nats,
      tools: [makeEchoTool()],
    });

    await runtime.processMessage(makeEnvelope());
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const spanNames = spans.map(s => s.name);

    expect(spanNames).toContain('cell.handle_message');
    expect(spanNames).toContain('cell.llm_call');
    expect(spanNames).toContain('cell.tool_call');

    // Should have 2 LLM calls (1st returns tool_use, 2nd returns end_turn)
    const llmSpans = spans.filter(s => s.name === 'cell.llm_call');
    expect(llmSpans).toHaveLength(2);
  });

  it('extracts parent trace context from envelope', async () => {
    mind.enqueue(makeThinkOutput({ content: 'Response' }));

    const runtime = new CellRuntime({
      cellName: 'test-cell',
      namespace: 'default',
      spec: makeSpec(),
      mind,
      nats,
    });

    // Create a parent span and inject its context into the envelope
    const parentSpan = provider.getTracer('test').startSpan('parent.operation');
    const parentCtx = trace.setSpan(context.active(), parentSpan);
    const carrier: Record<string, string> = {};
    propagation.inject(parentCtx, carrier);
    parentSpan.end();

    const envelope = makeEnvelope({
      from: 'operator',
      to: 'test-cell',
    });
    // Inject trace context into envelope
    (envelope as Record<string, unknown>).traceContext = carrier;

    await runtime.processMessage(envelope);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const handleSpan = spans.find(s => s.name === 'cell.handle_message');

    expect(handleSpan).toBeDefined();
    // The handle_message span should have the parent's trace ID
    const parentTraceId = parentSpan.spanContext().traceId;
    expect(handleSpan!.spanContext().traceId).toBe(parentTraceId);
  });

  it('injects trace context into outgoing envelopes', async () => {
    mind.enqueue(makeThinkOutput({ content: 'Reply' }));

    const runtime = new CellRuntime({
      cellName: 'test-cell',
      namespace: 'default',
      spec: makeSpec(),
      mind,
      nats,
    });

    await runtime.processMessage(makeEnvelope());
    await provider.forceFlush();

    // Check that the outbox envelope has traceContext
    const outboxMessages = nats.getPublished('cell.default.test-cell.outbox');
    expect(outboxMessages.length).toBeGreaterThan(0);

    const responseEnvelope = JSON.parse(outboxMessages[0]!.data);
    expect(responseEnvelope.traceContext).toBeDefined();
    expect(responseEnvelope.traceContext.traceparent).toBeDefined();
  });
});
