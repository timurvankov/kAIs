import { describe, expect, it } from 'vitest';
import { trace, metrics } from '@opentelemetry/api';

import { initTelemetry, shutdownTelemetry, getTracer, getMeter } from '../telemetry.js';

describe('initTelemetry', () => {
  it('is a no-op when no endpoint is provided and env var is unset', () => {
    // Should not throw even without any OTel collector configured.
    expect(() => initTelemetry({ serviceName: 'test-service' })).not.toThrow();
  });

  it('returns a no-op tracer when SDK is not initialised', () => {
    const tracer = getTracer('test');
    // The tracer must still be a valid object with a startSpan method.
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('returns a no-op meter when SDK is not initialised', () => {
    const meter = getMeter('test');
    expect(meter).toBeDefined();
    expect(typeof meter.createCounter).toBe('function');
  });

  it('shutdownTelemetry resolves when SDK was never started', async () => {
    // Should resolve (not reject) even if initTelemetry was never called with a real endpoint.
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});

describe('getTracer', () => {
  it('delegates to the OpenTelemetry trace API', () => {
    const tracer = getTracer('@kais/core');
    const apiTracer = trace.getTracer('@kais/core');
    // Both should return valid tracer objects (no-op in this test context).
    expect(typeof tracer.startSpan).toBe('function');
    expect(typeof apiTracer.startSpan).toBe('function');
  });
});

describe('getMeter', () => {
  it('delegates to the OpenTelemetry metrics API', () => {
    const meter = getMeter('@kais/core');
    const apiMeter = metrics.getMeter('@kais/core');
    expect(typeof meter.createCounter).toBe('function');
    expect(typeof apiMeter.createCounter).toBe('function');
  });
});
