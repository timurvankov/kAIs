/**
 * Telemetry integration tests — verify operator spans are created with InMemorySpanExporter.
 *
 * Uses a single BasicTracerProvider for the whole suite to avoid OTel global
 * re-registration issues. Exporter is reset between tests.
 */
import { describe, expect, it, beforeAll, beforeEach, afterAll } from 'vitest';
import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { CompletionCheck } from '@kais/core';

import { runCheck } from '../check-runner.js';
import type { CommandExecutor, FileSystem } from '../types.js';

function createMockExecutor(
  results: Record<string, { stdout: string; stderr: string; exitCode: number }> = {},
): CommandExecutor {
  return {
    async exec(command: string, _cwd: string) {
      return results[command] ?? { stdout: '', stderr: 'command not found', exitCode: 127 };
    },
  };
}

function createMockFs(existingPaths: Set<string> = new Set()): FileSystem {
  return {
    async exists(path: string) {
      return existingPaths.has(path);
    },
  };
}

describe('Operator telemetry', () => {
  const exporter = new InMemorySpanExporter();
  let provider: BasicTracerProvider;

  beforeAll(() => {
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
  });

  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });

  beforeEach(() => {
    exporter.reset();
  });

  it('runCheck creates operator.run_checks span for fileExists check', async () => {
    const check: CompletionCheck = {
      name: 'check-file',
      type: 'fileExists',
      paths: ['/workspace/main.py'],
    };

    const fs = createMockFs(new Set(['/workspace/main.py']));
    await runCheck(check, '/workspace', createMockExecutor(), fs);
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const checkSpan = spans.find(s => s.name === 'operator.run_checks');

    expect(checkSpan).toBeDefined();
    expect(checkSpan!.attributes['resource.name']).toBe('check-file');
  });

  it('runCheck creates span for command check', async () => {
    const check: CompletionCheck = {
      name: 'run-tests',
      type: 'command',
      command: 'pytest -v',
      successPattern: 'passed',
    };

    const executor = createMockExecutor({
      'pytest -v': { stdout: '3 tests passed', stderr: '', exitCode: 0 },
    });

    const result = await runCheck(check, '/workspace', executor, createMockFs());
    await provider.forceFlush();

    expect(result.status).toBe('Passed');

    const spans = exporter.getFinishedSpans();
    const checkSpan = spans.find(s => s.name === 'operator.run_checks');

    expect(checkSpan).toBeDefined();
    expect(checkSpan!.attributes['resource.name']).toBe('run-tests');
  });

  it('runCheck creates span for coverage check', async () => {
    const check: CompletionCheck = {
      name: 'coverage-80',
      type: 'coverage',
      command: 'coverage json',
      jsonPath: '$.total.lines.pct',
      operator: '>=',
      value: 80,
    };

    const executor = createMockExecutor({
      'coverage json': {
        stdout: JSON.stringify({ total: { lines: { pct: 85 } } }),
        stderr: '',
        exitCode: 0,
      },
    });

    const result = await runCheck(check, '/workspace', executor, createMockFs());
    await provider.forceFlush();

    expect(result.status).toBe('Passed');

    const spans = exporter.getFinishedSpans();
    expect(spans.some(s => s.name === 'operator.run_checks')).toBe(true);
  });

  it('runCheck creates span even when check fails', async () => {
    const check: CompletionCheck = {
      name: 'missing-file',
      type: 'fileExists',
      paths: ['/workspace/nonexistent.py'],
    };

    const result = await runCheck(check, '/workspace', createMockExecutor(), createMockFs());
    await provider.forceFlush();

    expect(result.status).toBe('Failed');

    const spans = exporter.getFinishedSpans();
    const checkSpan = spans.find(s => s.name === 'operator.run_checks');

    expect(checkSpan).toBeDefined();
    expect(checkSpan!.attributes['resource.name']).toBe('missing-file');
  });

  it('runCheck creates span for natsResponse check (no client → Error)', async () => {
    const check: CompletionCheck = {
      name: 'wait-response',
      type: 'natsResponse',
      subject: 'cell.default.coder.outbox',
      successPattern: 'done',
    };

    const result = await runCheck(check, '/workspace', createMockExecutor(), createMockFs());
    await provider.forceFlush();

    expect(result.status).toBe('Error');
    expect(result.output).toContain('NATS client');

    const spans = exporter.getFinishedSpans();
    expect(spans.some(s => s.name === 'operator.run_checks')).toBe(true);
  });
});
