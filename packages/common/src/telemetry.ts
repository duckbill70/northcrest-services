// OpenTelemetry bootstrap. Load before anything else:
//   node -r @northcrest/common/dist/telemetry.js dist/server.js
//
// Spans go over OTLP/HTTP to the collector sidecar on localhost:4318, which
// adds Google Cloud and Northcrest labels and publishes to the pipeline's
// Pub/Sub topics. Service name and resource attributes come from the
// standard OTEL_SERVICE_NAME and OTEL_RESOURCE_ATTRIBUTES variables.
//
// Only traces: application metrics would be dropped by the gateway's
// allowlist anyway (RED metrics are derived from spans there), and logs go
// to Cloud Logging as structured JSON on stdout, carrying the trace ID.

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { GrpcInstrumentation } from "@opentelemetry/instrumentation-grpc";

const enabled = process.env.OTEL_SDK_DISABLED !== "true";

if (enabled) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({
        // Health checks would be most of the traffic and tell us nothing.
        ignoreIncomingRequestHook: (req) => req.url === "/healthz",
      }),
      // Firestore client calls.
      new GrpcInstrumentation(),
    ],
  });
  sdk.start();

  const shutdown = () => {
    sdk.shutdown().finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
}
