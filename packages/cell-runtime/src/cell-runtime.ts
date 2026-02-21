/**
 * CellRuntime — the core agent loop that runs inside each Cell Pod.
 *
 * Receives messages via NATS, processes them with a Mind (LLM),
 * executes tools, and responds.
 */
import { createEnvelope, getTracer, getMeter } from '@kais/core';
import type { CellSpec, Envelope } from '@kais/core';
import { context, trace, SpanKind, SpanStatusCode, propagation } from '@opentelemetry/api';
import type { Mind, Message, ContentBlock, ThinkOutput, ToolDefinition } from '@kais/mind';

import { WorkingMemoryManager } from './memory/working-memory.js';
import type { WorkingMemoryConfig } from './memory/working-memory.js';
import { ContextAssembler } from './context/context-assembler.js';
import { ToolExecutor } from './tools/tool-executor.js';
import type { Tool } from './tools/tool-executor.js';

// --- NATS abstraction for testability ---

export interface NatsConnection {
  publish(subject: string, data: Uint8Array): void;
  subscribe(subject: string, callback: (msg: NatsMessage) => void): NatsSubscription;
  /** Subscribe via JetStream durable consumer. Messages are ack'd after callback returns. */
  subscribeJetStream?(
    stream: string,
    subject: string,
    consumerName: string,
    callback: (msg: NatsMessage & { ack: () => void }) => Promise<void>,
  ): NatsSubscription;
  drain(): Promise<void>;
}

export interface NatsMessage {
  data: Uint8Array;
  subject: string;
}

export interface NatsSubscription {
  unsubscribe(): void;
}

// --- Budget tracking ---

interface CostEntry {
  timestamp: number;
  cost: number;
}

export class BudgetTracker {
  private totalCost = 0;
  private costEntries: CostEntry[] = [];
  private readonly maxCostPerHour?: number;
  private readonly maxTotalCost?: number;

  constructor(maxCostPerHour?: number, maxTotalCost?: number) {
    this.maxCostPerHour = maxCostPerHour;
    this.maxTotalCost = maxTotalCost;
  }

  /**
   * Prune cost entries older than 1 hour to prevent unbounded growth.
   * Called on every addCost() so that getters remain side-effect-free.
   */
  private pruneOldEntries(): void {
    const oneHourAgo = Date.now() - 3_600_000;
    this.costEntries = this.costEntries.filter(e => e.timestamp >= oneHourAgo);
  }

  addCost(cost: number): void {
    this.totalCost += cost;
    this.costEntries.push({ timestamp: Date.now(), cost });
    this.pruneOldEntries();
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  private getRecentCost(): number {
    return this.costEntries.reduce((sum, e) => sum + e.cost, 0);
  }

  isExceeded(): boolean {
    if (this.maxTotalCost !== undefined && this.totalCost >= this.maxTotalCost) {
      return true;
    }

    if (this.maxCostPerHour !== undefined && this.getRecentCost() >= this.maxCostPerHour) {
      return true;
    }

    return false;
  }

  getExceededReason(): string {
    if (this.maxTotalCost !== undefined && this.totalCost >= this.maxTotalCost) {
      return `Total cost $${this.totalCost.toFixed(4)} exceeds max $${this.maxTotalCost}`;
    }
    if (this.maxCostPerHour !== undefined) {
      const recentCost = this.getRecentCost();
      if (recentCost >= this.maxCostPerHour) {
        return `Hourly cost $${recentCost.toFixed(4)} exceeds max $${this.maxCostPerHour}/hour`;
      }
    }
    return '';
  }
}

// --- CellRuntime config ---

export interface CellRuntimeConfig {
  cellName: string;
  namespace: string;
  spec: CellSpec;
  mind: Mind;
  nats: NatsConnection;
  tools?: Tool[];
  workingMemoryConfig?: WorkingMemoryConfig;
}

// --- CellRuntime ---

export class CellRuntime {
  readonly cellName: string;
  readonly namespace: string;
  readonly spec: CellSpec;

  private readonly mind: Mind;
  private readonly nats: NatsConnection;
  private readonly workingMemory: WorkingMemoryManager;
  private readonly contextAssembler: ContextAssembler;
  private readonly toolExecutor: ToolExecutor;
  private readonly budget: BudgetTracker;
  private subscription: NatsSubscription | null = null;
  private paused = false;
  private running = false;

  // Serial message processing queue (C1: concurrency protection)
  private messageQueue: Envelope[] = [];
  private processing = false;

  // Deduplication: track processed envelope IDs to avoid re-processing after restart
  private processedIds = new Set<string>();

  // --- OTel instrumentation ---
  private readonly tracer;
  private readonly llmCallsCounter;
  private readonly tokensCounter;
  private readonly costCounter;
  private readonly messagesCounter;
  private readonly llmLatencyHistogram;
  private readonly toolLatencyHistogram;

  constructor(config: CellRuntimeConfig) {
    this.cellName = config.cellName;
    this.namespace = config.namespace;
    this.spec = config.spec;
    this.mind = config.mind;
    this.nats = config.nats;

    // Working memory
    this.workingMemory = new WorkingMemoryManager(
      config.workingMemoryConfig ?? {
        maxMessages: config.spec.mind.workingMemory?.maxMessages,
        summarizeAfter: config.spec.mind.workingMemory?.summarizeAfter,
      },
    );

    // Context assembler
    this.contextAssembler = new ContextAssembler();

    // Tool executor
    this.toolExecutor = new ToolExecutor();
    if (config.tools) {
      for (const tool of config.tools) {
        this.toolExecutor.register(tool);
      }
    }

    // Budget
    this.budget = new BudgetTracker(
      config.spec.resources?.maxCostPerHour,
      config.spec.resources?.maxTotalCost,
    );

    // OTel tracer and metrics
    this.tracer = getTracer('kais-cell');
    const meter = getMeter('kais-cell');
    this.llmCallsCounter = meter.createCounter('kais.cell.llm_calls');
    this.tokensCounter = meter.createCounter('kais.cell.tokens');
    this.costCounter = meter.createCounter('kais.cell.cost');
    this.messagesCounter = meter.createCounter('kais.cell.messages');
    this.llmLatencyHistogram = meter.createHistogram('kais.cell.llm_latency_ms');
    this.toolLatencyHistogram = meter.createHistogram('kais.cell.tool_latency_ms');
  }

  /**
   * Start the runtime — subscribe to NATS inbox and begin processing.
   * Uses JetStream durable consumer when available (survives restarts),
   * falls back to core NATS subscription otherwise.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const inboxSubject = `cell.${this.namespace}.${this.cellName}.inbox`;
    const consumerName = `cell-${this.cellName}`;

    if (this.nats.subscribeJetStream) {
      // JetStream: durable consumer with ack-after-processing + dedup
      this.subscription = this.nats.subscribeJetStream(
        'CELL_INBOX',
        inboxSubject,
        consumerName,
        async (msg) => {
          try {
            const text = new TextDecoder().decode(msg.data);
            const envelope = JSON.parse(text) as Envelope;

            // Dedup: skip already-processed messages (e.g. after pod restart)
            if (this.processedIds.has(envelope.id)) {
              console.log(`[${this.cellName}] Dedup: skipping already-processed message ${envelope.id}`);
              msg.ack();
              return;
            }

            console.log(`[${this.cellName}] Received message ${envelope.id} from ${envelope.from}: ${(typeof envelope.payload === 'string' ? envelope.payload : JSON.stringify(envelope.payload)).slice(0, 200)}`);

            // Process synchronously before ack to guarantee at-least-once
            await this.processMessage(envelope);
            this.processedIds.add(envelope.id);
            msg.ack();
            console.log(`[${this.cellName}] Acked message ${envelope.id}`);
          } catch (err) {
            console.error(`[${this.cellName}] Error processing message: ${String(err)}`);
            this.publishEvent('error', { error: `Failed to process message: ${String(err)}` });
            // Don't ack — message will be redelivered
          }
        },
      );
    } else {
      // Fallback: core NATS (no persistence, no dedup)
      this.subscription = this.nats.subscribe(inboxSubject, (msg: NatsMessage) => {
        try {
          const text = new TextDecoder().decode(msg.data);
          const envelope = JSON.parse(text) as Envelope;
          this.enqueueMessage(envelope);
        } catch (err) {
          this.publishEvent('error', { error: `Failed to parse message: ${String(err)}` });
        }
      });
    }

    this.publishEvent('started', { cellName: this.cellName });
  }

  /**
   * Stop gracefully — unsubscribe and drain NATS.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    this.publishEvent('stopped', { cellName: this.cellName });
    await this.nats.drain();
  }

  /**
   * Process a single message (exposed for testing).
   */
  async processMessage(envelope: Envelope): Promise<void> {
    // Extract trace context from envelope (W3C propagation)
    const parentContext = envelope.traceContext
      ? propagation.extract(context.active(), envelope.traceContext)
      : context.active();

    // Extract message content for the trace
    const messageContent = typeof envelope.payload === 'string'
      ? envelope.payload
      : (envelope.payload as { content?: string })?.content ?? JSON.stringify(envelope.payload);

    const span = this.tracer.startSpan('cell.handle_message', {
      kind: SpanKind.SERVER,
      attributes: {
        'cell.name': this.cellName,
        'message.type': envelope.type,
        'message.from': envelope.from,
      },
    }, parentContext);

    // Log incoming message content
    span.addEvent('message.received', {
      'message.content': messageContent.slice(0, 4096),
    });

    // Record received message metric
    this.messagesCounter.add(1, { direction: 'received' });

    return context.with(trace.setSpan(parentContext, span), async () => {
      try {
        await this.processMessageInner(envelope);
        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Inner implementation of processMessage, runs within the OTel span context.
   */
  private async processMessageInner(envelope: Envelope): Promise<void> {
    // Check if paused
    if (this.paused) {
      this.publishOutbox({
        role: 'assistant',
        content: 'Cell is paused due to budget limits.',
      }, envelope);
      return;
    }

    // Add user message to working memory
    const userContent = typeof envelope.payload === 'string'
      ? envelope.payload
      : (envelope.payload as { content?: string })?.content ?? JSON.stringify(envelope.payload);

    this.workingMemory.addMessage({
      role: 'user',
      content: userContent,
    });

    // Agentic loop
    let iterations = 0;
    const maxIterations = 20; // safety limit
    let responded = false;

    while (iterations < maxIterations) {
      iterations++;
      console.log(`[${this.cellName}] Agentic loop iteration ${iterations}/${maxIterations}`);

      // Check budget before each think call
      if (this.budget.isExceeded()) {
        const reason = this.budget.getExceededReason();
        this.paused = true;

        const budgetMsg: Message = {
          role: 'assistant',
          content: `Budget exceeded: ${reason}. Cell is now paused.`,
        };
        this.workingMemory.addMessage(budgetMsg);
        this.publishOutbox(budgetMsg, envelope);
        this.publishEvent('budget_exceeded', { reason, totalCost: this.budget.getTotalCost() });
        return;
      }

      // Assemble context
      const messages = this.contextAssembler.assemble({
        systemPrompt: this.spec.mind.systemPrompt,
        workingMemory: this.workingMemory.getMessages(),
      });

      // Get tool definitions
      const tools: ToolDefinition[] = this.toolExecutor.getDefinitions();

      // Call Mind.think() — wrapped in child span
      let thinkOutput: ThinkOutput;
      try {
        const llmStart = Date.now();
        // Capture the last user message for the trace
        const lastUserMsg = messages.filter(m => m.role === 'user').pop();
        const promptPreview = lastUserMsg
          ? (typeof lastUserMsg.content === 'string'
            ? lastUserMsg.content
            : JSON.stringify(lastUserMsg.content))
          : '';

        const llmSpan = this.tracer.startSpan('cell.llm_call', {
          attributes: {
            'llm.provider': this.spec.mind.provider,
            'llm.model': this.spec.mind.model,
          },
        });

        // Log the prompt as a span event (keeps large content out of attributes)
        llmSpan.addEvent('gen_ai.content.prompt', {
          'gen_ai.prompt': promptPreview.slice(0, 4096),
        });

        try {
          console.log(`[${this.cellName}] Calling LLM (${this.spec.mind.provider}/${this.spec.mind.model}), ${messages.length} messages, ${tools.length} tools`);
          thinkOutput = await this.mind.think({
            messages,
            tools: tools.length > 0 ? tools : undefined,
            temperature: this.spec.mind.temperature,
            maxTokens: this.spec.mind.maxTokens,
          });

          const llmLatency = Date.now() - llmStart;
          console.log(`[${this.cellName}] LLM responded in ${llmLatency}ms, stopReason=${thinkOutput.stopReason}, toolCalls=${thinkOutput.toolCalls?.length ?? 0}, tokens=${thinkOutput.usage.outputTokens}`);

          // Log the completion as a span event
          llmSpan.addEvent('gen_ai.content.completion', {
            'gen_ai.completion': (thinkOutput.content ?? '').slice(0, 4096),
          });

          // Set span attributes after completion
          llmSpan.setAttribute('llm.input_tokens', thinkOutput.usage.inputTokens);
          llmSpan.setAttribute('llm.output_tokens', thinkOutput.usage.outputTokens);
          llmSpan.setAttribute('llm.cost', thinkOutput.usage.cost);
          llmSpan.setAttribute('llm.latency_ms', llmLatency);
          llmSpan.setStatus({ code: SpanStatusCode.OK });

          // Record metrics
          this.llmCallsCounter.add(1);
          this.tokensCounter.add(thinkOutput.usage.inputTokens, { direction: 'input' });
          this.tokensCounter.add(thinkOutput.usage.outputTokens, { direction: 'output' });
          this.costCounter.add(thinkOutput.usage.cost);
          this.llmLatencyHistogram.record(llmLatency);
        } catch (err) {
          llmSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
          throw err;
        } finally {
          llmSpan.end();
        }
      } catch (err) {
        const errorMsg: Message = {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
        this.workingMemory.addMessage(errorMsg);
        this.publishOutbox(errorMsg, envelope);
        this.publishEvent('error', { messageId: envelope.id, error: String(err) });
        return;
      }

      // Track cost
      this.budget.addCost(thinkOutput.usage.cost);

      if (thinkOutput.stopReason === 'tool_use' && thinkOutput.toolCalls && thinkOutput.toolCalls.length > 0) {
        // Add assistant message with tool calls to working memory
        const assistantBlocks: ContentBlock[] = [];
        if (thinkOutput.content) {
          assistantBlocks.push({ type: 'text', text: thinkOutput.content });
        }
        for (const tc of thinkOutput.toolCalls) {
          assistantBlocks.push({
            type: 'tool_use',
            toolUseId: tc.id,
            toolName: tc.name,
            input: tc.input,
          });
        }
        this.workingMemory.addMessage({ role: 'assistant', content: assistantBlocks });

        // Execute each tool call — wrapped in child spans
        const toolResultBlocks: ContentBlock[] = [];
        for (const tc of thinkOutput.toolCalls) {
          const toolStart = Date.now();
          const toolSpan = this.tracer.startSpan('cell.tool_call', {
            attributes: { 'tool.name': tc.name },
          });

          let result;
          try {
            console.log(`[${this.cellName}] Executing tool: ${tc.name}(${JSON.stringify(tc.input).slice(0, 200)})`);
            result = await this.toolExecutor.execute(tc);
            console.log(`[${this.cellName}] Tool ${tc.name} result: ${(result.content ?? '').slice(0, 200)}${result.isError ? ' [ERROR]' : ''}`);
            toolSpan.setStatus({ code: SpanStatusCode.OK });
          } catch (err) {
            toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
            throw err;
          } finally {
            this.toolLatencyHistogram.record(Date.now() - toolStart);
            toolSpan.end();
          }

          toolResultBlocks.push({
            type: 'tool_result',
            toolUseId: tc.id,
            content: result.content,
            isError: result.isError,
          });
        }
        this.workingMemory.addMessage({ role: 'user', content: toolResultBlocks });

        // Check if summarization is needed
        if (this.workingMemory.shouldSummarize()) {
          await this.workingMemory.summarize(this.mind);
        }

        // Continue loop
        continue;
      }

      // end_turn or max_tokens — we're done
      console.log(`[${this.cellName}] Final response (${thinkOutput.stopReason}): ${(thinkOutput.content ?? '').slice(0, 300)}`);
      const responseMsg: Message = {
        role: 'assistant',
        content: thinkOutput.content,
      };
      this.workingMemory.addMessage(responseMsg);
      this.publishOutbox(responseMsg, envelope);

      // Log structured event
      this.publishEvent('response', {
        messageId: envelope.id,
        model: thinkOutput.model,
        usage: thinkOutput.usage,
        stopReason: thinkOutput.stopReason,
        iterations,
        totalCost: this.budget.getTotalCost(),
      });

      responded = true;
      break;
    }

    // I6: If max iterations reached without a final response, notify the caller
    if (!responded) {
      const maxIterMsg: Message = {
        role: 'assistant',
        content: 'Maximum tool call iterations reached. Stopping.',
      };
      this.workingMemory.addMessage(maxIterMsg);
      this.publishOutbox(maxIterMsg, envelope);
      this.publishEvent('max_iterations', {
        messageId: envelope.id,
        iterations: maxIterations,
        totalCost: this.budget.getTotalCost(),
      });
    }
  }

  /**
   * Publish a response to the outbox NATS subject.
   */
  private publishOutbox(message: Message, sourceEnvelope: Envelope): void {
    const outboxSubject = `cell.${this.namespace}.${this.cellName}.outbox`;
    const content = typeof message.content === 'string'
      ? message.content
      : message.content.map(b => b.text ?? b.content ?? '').join('');

    // Log outgoing message content on the active span
    const activeSpan = trace.getActiveSpan();
    activeSpan?.addEvent('message.sent', {
      'message.content': content.slice(0, 4096),
      'message.to': sourceEnvelope.from,
    });

    // Inject current trace context into the outgoing envelope
    const traceContext: Record<string, string> = {};
    propagation.inject(context.active(), traceContext);

    const responseEnvelope = createEnvelope({
      from: this.cellName,
      to: sourceEnvelope.from,
      type: 'message',
      payload: { content },
      traceId: sourceEnvelope.traceId,
      traceContext: Object.keys(traceContext).length > 0 ? traceContext : undefined,
    });

    // Record sent message metric
    this.messagesCounter.add(1, { direction: 'sent' });

    const data = new TextEncoder().encode(JSON.stringify(responseEnvelope));
    this.nats.publish(outboxSubject, data);
  }

  /**
   * Publish a structured event to the events NATS subject.
   */
  private publishEvent(eventType: string, data: Record<string, unknown>): void {
    const eventsSubject = `cell.events.${this.namespace}.${this.cellName}`;
    const event = {
      type: eventType,
      cellName: this.cellName,
      namespace: this.namespace,
      timestamp: new Date().toISOString(),
      ...data,
    };
    const encoded = new TextEncoder().encode(JSON.stringify(event));
    this.nats.publish(eventsSubject, encoded);
  }

  /**
   * Enqueue a message for serial processing (C1: concurrency protection).
   */
  private enqueueMessage(envelope: Envelope): void {
    this.messageQueue.push(envelope);
    if (!this.processing) {
      this.drainQueue().catch(err => {
        this.publishEvent('error', { error: String(err) });
      });
    }
  }

  /**
   * Drain the message queue, processing one message at a time.
   */
  private async drainQueue(): Promise<void> {
    this.processing = true;
    try {
      while (this.messageQueue.length > 0) {
        const envelope = this.messageQueue.shift()!;
        await this.processMessage(envelope);
      }
    } finally {
      this.processing = false;
    }
  }

  // --- Accessors for testing ---

  getWorkingMemory(): WorkingMemoryManager {
    return this.workingMemory;
  }

  getBudget(): BudgetTracker {
    return this.budget;
  }

  isPaused(): boolean {
    return this.paused;
  }
}
