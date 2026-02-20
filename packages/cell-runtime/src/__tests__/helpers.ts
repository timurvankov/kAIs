/**
 * Test helpers — mock NATS, mock filesystem, mock command executor.
 */
import { createEnvelope } from '@kais/core';
import type { Envelope } from '@kais/core';
import type { ThinkOutput } from '@kais/mind';

import type { NatsConnection, NatsMessage, NatsSubscription } from '../cell-runtime.js';
import type { NatsPublisher } from '../tools/send-message.js';
import type { FileSystem } from '../tools/read-file.js';
import type { WriteFileSystem } from '../tools/write-file.js';
import type { CommandExecutor } from '../tools/bash.js';

// --- Mock NATS ---

export interface PublishedMessage {
  subject: string;
  data: string;
}

export class MockNatsConnection implements NatsConnection, NatsPublisher {
  public published: PublishedMessage[] = [];
  private subscribers: Map<string, ((msg: NatsMessage) => void)[]> = new Map();

  publish(subject: string, data: Uint8Array): void {
    this.published.push({
      subject,
      data: new TextDecoder().decode(data),
    });
  }

  subscribe(subject: string, callback: (msg: NatsMessage) => void): NatsSubscription {
    const callbacks = this.subscribers.get(subject) ?? [];
    callbacks.push(callback);
    this.subscribers.set(subject, callbacks);

    return {
      unsubscribe: () => {
        const cbs = this.subscribers.get(subject) ?? [];
        const idx = cbs.indexOf(callback);
        if (idx >= 0) cbs.splice(idx, 1);
      },
    };
  }

  async drain(): Promise<void> {
    // no-op for mock
  }

  /**
   * Inject a message into a subject (for testing).
   */
  inject(subject: string, data: unknown): void {
    const callbacks = this.subscribers.get(subject) ?? [];
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    for (const cb of callbacks) {
      cb({ subject, data: encoded });
    }
  }

  /**
   * Get all published messages on a given subject.
   */
  getPublished(subject: string): PublishedMessage[] {
    return this.published.filter(m => m.subject === subject);
  }

  /**
   * Parse published envelope messages.
   */
  getPublishedEnvelopes(subject: string): Envelope[] {
    return this.getPublished(subject).map(m => JSON.parse(m.data) as Envelope);
  }

  reset(): void {
    this.published = [];
    this.subscribers.clear();
  }
}

// --- Mock File System ---

export class MockFileSystem implements FileSystem, WriteFileSystem {
  private files: Map<string, string> = new Map();
  public writtenFiles: Array<{ path: string; content: string }> = [];
  public createdDirs: string[] = [];

  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  async readFile(path: string, _encoding: 'utf-8'): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  async writeFile(path: string, content: string, _encoding: 'utf-8'): Promise<void> {
    this.files.set(path, content);
    this.writtenFiles.push({ path, content });
  }

  async mkdir(path: string, _options: { recursive: boolean }): Promise<void> {
    this.createdDirs.push(path);
  }

  reset(): void {
    this.files.clear();
    this.writtenFiles = [];
    this.createdDirs = [];
  }
}

// --- Mock Command Executor ---

export class MockCommandExecutor implements CommandExecutor {
  public executedCommands: Array<{ command: string; timeout: number }> = [];
  private responses: Array<{ stdout: string; stderr: string; exitCode: number }> = [];
  private defaultResponse = { stdout: '', stderr: '', exitCode: 0 };

  setResponse(response: { stdout: string; stderr: string; exitCode: number }): void {
    this.responses = [response];
  }

  enqueue(response: { stdout: string; stderr: string; exitCode: number }): void {
    this.responses.push(response);
  }

  async exec(
    command: string,
    options: { timeout: number },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.executedCommands.push({ command, timeout: options.timeout });
    return this.responses.shift() ?? this.defaultResponse;
  }

  reset(): void {
    this.executedCommands = [];
    this.responses = [];
  }
}

// --- Helper to create a ThinkOutput ---

export function makeThinkOutput(overrides: Partial<ThinkOutput> = {}): ThinkOutput {
  return {
    content: 'Hello from mock mind',
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cost: 0.001 },
    model: 'mock-model',
    stopReason: 'end_turn',
    ...overrides,
  };
}

// --- Helper to create a test Envelope ---

export function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return createEnvelope({
    from: overrides.from ?? 'user',
    to: overrides.to ?? 'test-cell',
    type: overrides.type ?? 'message',
    payload: overrides.payload ?? { content: 'Hello' },
    traceId: overrides.traceId,
  });
}
