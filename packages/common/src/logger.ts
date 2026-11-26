// Structured JSON logs that Cloud Logging understands: "severity" instead of
// pino's numeric level, and the active trace and span so each log line links
// to its trace.

import pino from "pino";
import { trace } from "@opentelemetry/api";

const SEVERITY: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

export function createLogger(service: string, traceProject = process.env.OTEL_PIPELINE_PROJECT) {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    messageKey: "message",
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ severity: SEVERITY[label] ?? "DEFAULT" }),
    },
    mixin() {
      const ctx = trace.getActiveSpan()?.spanContext();
      if (!ctx || !traceProject) return {};
      return {
        "logging.googleapis.com/trace": `projects/${traceProject}/traces/${ctx.traceId}`,
        "logging.googleapis.com/spanId": ctx.spanId,
        "logging.googleapis.com/trace_sampled": (ctx.traceFlags & 1) === 1,
      };
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
