// Flight status API. Browsers reach it at https://<prefix>-status.web.app/api/...
// through a Firebase Hosting rewrite.

import { trace } from "@opentelemetry/api";
import {
  AIRPORTS,
  HttpError,
  createServer,
  flightsOn,
  getFlight,
  isValidDate,
  statusAt,
  type Flight,
  type Logger,
} from "@northcrest/common";
import type { OverrideSource } from "./overrides";

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function buildApp(overrides: OverrideSource, logger: Logger, now: () => Date = () => new Date()) {
  const app = createServer(logger);

  async function withStatus(flights: Flight[], date: string) {
    const byId = await overrides.forDate(date);
    const at = now();
    return flights.map((f) => ({ ...f, status: statusAt(f, at, byId.get(f.id)) }));
  }

  app.get("/api/status/airports", async () => ({
    airports: Object.values(AIRPORTS).map(({ code, name, city, country }) => ({ code, name, city, country })),
  }));

  app.get<{ Querystring: { airport: string; date?: string; direction?: "departures" | "arrivals" } }>(
    "/api/status/board",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["airport"],
          properties: {
            airport: { type: "string", pattern: "^[A-Z]{3}$" },
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
            direction: { type: "string", enum: ["departures", "arrivals"], default: "departures" },
          },
        },
      },
    },
    async (request) => {
      const { airport, direction = "departures" } = request.query;
      const date = request.query.date ?? today(now());
      if (!isValidDate(date)) throw new HttpError(400, "invalid date");
      if (!AIRPORTS[airport]) throw new HttpError(404, "unknown airport");
      trace.getActiveSpan()?.setAttributes({ "northcrest.airport": airport, "northcrest.board": direction });

      const flights = flightsOn(date)
        .filter((f) => (direction === "departures" ? f.origin : f.destination) === airport)
        .sort((x, y) =>
          (direction === "departures" ? x.scheduledDeparture : x.scheduledArrival).localeCompare(
            direction === "departures" ? y.scheduledDeparture : y.scheduledArrival,
          ),
        );
      return { airport, date, direction, flights: await withStatus(flights, date) };
    },
  );

  app.get<{ Params: { flightNumber: string }; Querystring: { date?: string } }>(
    "/api/status/flights/:flightNumber",
    {
      schema: {
        params: { type: "object", properties: { flightNumber: { type: "string", pattern: "^[Nn][Cc]\\d{3,4}$" } } },
        querystring: { type: "object", properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } } },
      },
    },
    async (request) => {
      const date = request.query.date ?? today(now());
      const flight = getFlight(`${request.params.flightNumber.toUpperCase()}-${date}`);
      if (!flight) throw new HttpError(404, "flight not found");
      trace.getActiveSpan()?.setAttribute("northcrest.flight_id", flight.id);
      const [withState] = await withStatus([flight], date);
      return withState;
    },
  );

  return app;
}
