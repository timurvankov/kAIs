/**
 * CellRuntime — the core agent loop that runs inside each Cell Pod.
 *
 * Receives messages via NATS, processes them with a Mind (LLM),
 * executes tools, and responds.
 */
import { createEnvelope } from '@kais/core';
import type { CellSpec, Envelope } from '@kais/core';
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

  addCost(cost: number): void {
    this.totalCost += cost;
    this.costEntries.push({ timestamp: Date.now(), cost });
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  isExceeded(): boolean {
    if (this.maxTotalCost !== undefined && this.totalCost >= this.maxTotalCost) {
      return true;
    }

    if (this.maxCostPerHour !== undefined) {
      const oneHourAgo = Date.now() - 3_600_000;
      const recentCost = this.costEntries
        .filter(e => e.timestamp >= oneHourAgo)
        .reduce((sum, e) => sum + e.cost, 0);
      if (recentCost >= this.maxCostPerHour) {
        return true;
      }
    }

    return false;
  }

  getExceededReason(): string {
    if (this.maxTotalCost !== undefined && this.totalCost >= this.maxTotalCost) {
      return `Total cost $${this.totalCost.toFixed(4)} exceeds max $${this.maxTotalCost}`;
    }
    if (this.maxCostPerHour !== undefined) {
      const oneHourAgo = Date.now() - 3_600_000;
      const recentCost = this.costEntries
        .filter(e => e.timestamp >= oneHourAgo)
        .reduce((sum, e) => sum + e.cost, 0);
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
  }

  /**
   * Start the runtime — subscribe to NATS inbox and begin processing.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const inboxSubject = `cell.${this.namespace}.${this.cellName}.inbox`;

    this.subscription = this.nats.subscribe(inboxSubject, (msg: NatsMessage) => {
      // Parse envelope and process asynchronously
      try {
        const text = new TextDecoder().decode(msg.data);
        const envelope = JSON.parse(text) as Envelope;
        // Fire and forget — errors are handled inside processMessage
        this.processMessage(envelope).catch(err => {
          this.publishEvent('error', { error: String(err) });
        });
      } catch (err) {
        this.publishEvent('error', { error: `Failed to parse message: ${String(err)}` });
      }
    });

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

    await this.nats.drain();
    this.publishEvent('stopped', { cellName: this.cellName });
  }

  /**
   * Process a single message (exposed for testing).
   */
  async processMessage(envelope: Envelope): Promise<void> {
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

    while (iterations < maxIterations) {
      iterations++;

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

      // Call Mind.think()
      const thinkOutput: ThinkOutput = await this.mind.think({
        messages,
        tools: tools.length > 0 ? tools : undefined,
        temperature: this.spec.mind.temperature,
        maxTokens: this.spec.mind.maxTokens,
      });

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

        // Execute each tool call
        const toolResultBlocks: ContentBlock[] = [];
        for (const tc of thinkOutput.toolCalls) {
          const result = await this.toolExecutor.execute(tc);
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

      break;
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

    const responseEnvelope = createEnvelope({
      from: this.cellName,
      to: sourceEnvelope.from,
      type: 'message',
      payload: { content },
      traceId: sourceEnvelope.traceId,
    });

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
