// Shared Fastify set-up: JSON logs through our logger, /healthz, span names
// that use the route template (GET /api/bookings/:pnr) so RED metrics have
// low cardinality, and errors that never echo internals to the client.

import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from "fastify";
import { trace } from "@opentelemetry/api";
import type { Logger } from "./logger";

export function createServer(logger: Logger): FastifyInstance {
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    disableRequestLogging: true,
    trustProxy: true,
    bodyLimit: 16 * 1024,
  });

  app.addHook("onRequest", async (request) => {
    const route = request.routeOptions.url;
    const span = trace.getActiveSpan();
    if (span && route) {
      span.updateName(`${request.method} ${route}`);
      span.setAttribute("http.route", route);
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    if (request.url === "/healthz") return;
    request.log.info(
      {
        httpRequest: {
          requestMethod: request.method,
          requestUrl: request.routeOptions.url ?? "unmatched",
          status: reply.statusCode,
          latency: `${(reply.elapsedTime / 1000).toFixed(3)}s`,
        },
      },
      "request",
    );
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, "unhandled error");
      trace.getActiveSpan()?.recordException(error);
    }
    reply.code(status).send({ error: status >= 500 ? "internal error" : error.message });
  });

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}

/** Throw from a handler to send a 4xx with this message. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
