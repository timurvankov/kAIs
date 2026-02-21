import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { trace, metrics } from '@opentelemetry/api';
import type { Tracer, Meter } from '@opentelemetry/api';

let sdk: NodeSDK | undefined;

/**
 * Initialise the OpenTelemetry SDK with OTLP gRPC exporters.
 *
 * If no `otlpEndpoint` is provided and the `OTEL_EXPORTER_OTLP_ENDPOINT`
 * environment variable is not set, this function is a no-op.
 * The OTel API returns no-op implementations when no SDK is configured,
 * so callers of `getTracer` / `getMeter` always receive a safe object.
 */
export function initTelemetry(opts: {
  serviceName: string;
  otlpEndpoint?: string;
}): void {
  if (sdk) {
    throw new Error('initTelemetry() has already been called. Call shutdownTelemetry() first.');
  }

  const endpoint =
    opts.otlpEndpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!endpoint) return; // no-op if no collector configured

  sdk = new NodeSDK({
    serviceName: opts.serviceName,
    traceExporter: new OTLPTraceExporter({ url: endpoint }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: endpoint }),
    }),
  });
  sdk.start();
}

/**
 * Gracefully shut down the OpenTelemetry SDK, flushing any pending spans and
 * metrics. Resolves immediately if the SDK was never initialised.
 */
export async function shutdownTelemetry(): Promise<void> {
  const instance = sdk;
  sdk = undefined;
  await instance?.shutdown();
}

/** Obtain a Tracer scoped to the given name (usually the package name). */
export function getTracer(name: string): Tracer {
  return trace.getTracer(name);
}

/** Obtain a Meter scoped to the given name (usually the package name). */
export function getMeter(name: string): Meter {
  return metrics.getMeter(name);
}
