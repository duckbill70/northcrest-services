// Booking API. Browsers reach it at https://<prefix>-booking.web.app/api/...
// through a Firebase Hosting rewrite.

import { trace } from "@opentelemetry/api";
import {
  AIRPORTS,
  ROUTES,
  HttpError,
  SEATS_PER_FLIGHT,
  createServer,
  fareFor,
  findFlights,
  getFlight,
  isValidDate,
  type Logger,
} from "@northcrest/common";
import { SoldOutError, type Booking, type BookingStore } from "./store";

const NAME = "^[\\p{L}][\\p{L} '\\-]{0,49}$";
const EMAIL = "^[^@\\s]{1,64}@[^@\\s]{1,190}\\.[^@\\s]{2,}$";
/** Bookings close this long before departure. */
const CUT_OFF_MIN = 60;

/** Destinations served from each airport, for the search form. */
function destinations(): Record<string, string[]> {
  const served: Record<string, Set<string>> = {};
  for (const [a, b] of ROUTES) {
    (served[a] ??= new Set()).add(b);
    (served[b] ??= new Set()).add(a);
  }
  return Object.fromEntries(Object.entries(served).map(([k, v]) => [k, [...v].sort()]));
}

function annotate(attributes: Record<string, string | number>) {
  trace.getActiveSpan()?.setAttributes(attributes);
}

/** What a passenger may see of their booking: no other passengers' emails. */
function view(booking: Booking) {
  const flight = getFlight(booking.flightId);
  return {
    pnr: booking.pnr,
    status: booking.status,
    flight,
    passengers: booking.passengers.map(({ firstName, lastName }) => ({ firstName, lastName })),
    total: booking.total,
    currency: booking.currency,
    createdAt: booking.createdAt,
  };
}

async function findBooking(store: BookingStore, pnr: string, lastName: string): Promise<Booking> {
  const booking = await store.get(pnr.toUpperCase());
  // Same answer for "no such PNR" and "wrong name", so PNRs can't be probed.
  const match = booking?.passengers.some((p) => p.lastName.toLowerCase() === lastName.trim().toLowerCase());
  if (!booking || !match) throw new HttpError(404, "booking not found");
  annotate({ "northcrest.passenger_id": booking.pnr, "northcrest.flight_id": booking.flightId });
  return booking;
}

export function buildApp(store: BookingStore, logger: Logger, now: () => Date = () => new Date()) {
  const app = createServer(logger);
  const served = destinations();

  app.get("/api/airports", async () => ({
    airports: Object.values(AIRPORTS)
      .filter((a) => served[a.code])
      .map(({ code, name, city, country }) => ({ code, name, city, country, destinations: served[code] })),
  }));

  app.get<{ Querystring: { from: string; to: string; date: string } }>(
    "/api/flights",
    {
      schema: {
        querystring: {
          type: "object",
          required: ["from", "to", "date"],
          properties: {
            from: { type: "string", pattern: "^[A-Z]{3}$" },
            to: { type: "string", pattern: "^[A-Z]{3}$" },
            date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          },
        },
      },
    },
    async (request) => {
      const { from, to, date } = request.query;
      if (!isValidDate(date)) throw new HttpError(400, "invalid date");
      annotate({ "northcrest.route": `${from}-${to}` });

      const cutOff = now().getTime() + CUT_OFF_MIN * 60_000;
      const flights = findFlights(date, from, to).filter((f) => Date.parse(f.scheduledDeparture) > cutOff);
      const taken = await store.seatsTaken(flights.map((f) => f.id));
      return {
        flights: flights.map((f) => ({
          ...f,
          fare: fareFor(f),
          currency: "GBP",
          seatsLeft: SEATS_PER_FLIGHT - (taken.get(f.id) ?? 0),
        })),
      };
    },
  );

  app.post<{ Body: { flightId: string; passengers: { firstName: string; lastName: string; email: string }[] } }>(
    "/api/bookings",
    {
      schema: {
        body: {
          type: "object",
          required: ["flightId", "passengers"],
          additionalProperties: false,
          properties: {
            flightId: { type: "string", maxLength: 32 },
            passengers: {
              type: "array",
              minItems: 1,
              maxItems: 9,
              items: {
                type: "object",
                required: ["firstName", "lastName", "email"],
                additionalProperties: false,
                properties: {
                  firstName: { type: "string", pattern: NAME },
                  lastName: { type: "string", pattern: NAME },
                  email: { type: "string", pattern: EMAIL },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { flightId, passengers } = request.body;
      const flight = getFlight(flightId);
      if (!flight) throw new HttpError(404, "flight not found");
      if (Date.parse(flight.scheduledDeparture) <= now().getTime() + CUT_OFF_MIN * 60_000) {
        throw new HttpError(409, "booking has closed for this flight");
      }
      annotate({
        "northcrest.flight_id": flight.id,
        "northcrest.route": `${flight.origin}-${flight.destination}`,
        "northcrest.passengers": passengers.length,
      });

      const fare = fareFor(flight);
      try {
        const booking = await store.create({
          flightId: flight.id,
          passengers: passengers.map((p) => ({ ...p, firstName: p.firstName.trim(), lastName: p.lastName.trim() })),
          farePerPassenger: fare,
          total: Math.round(fare * passengers.length * 100) / 100,
          currency: "GBP",
        });
        annotate({ "northcrest.passenger_id": booking.pnr });
        request.log.info({ flightId: flight.id, seats: passengers.length }, "booking created");
        return reply.code(201).send(view(booking));
      } catch (err) {
        if (err instanceof SoldOutError) throw new HttpError(409, `only ${err.seatsLeft} seats left`);
        throw err;
      }
    },
  );

  const pnrParams = {
    type: "object",
    required: ["pnr"],
    properties: { pnr: { type: "string", pattern: "^[A-Za-z0-9]{6}$" } },
  } as const;
  const lastNameField = { type: "string", minLength: 1, maxLength: 50 } as const;

  app.get<{ Params: { pnr: string }; Querystring: { lastName: string } }>(
    "/api/bookings/:pnr",
    {
      schema: {
        params: pnrParams,
        querystring: { type: "object", required: ["lastName"], properties: { lastName: lastNameField } },
      },
    },
    async (request) => view(await findBooking(store, request.params.pnr, request.query.lastName)),
  );

  app.post<{ Params: { pnr: string }; Body: { lastName: string } }>(
    "/api/bookings/:pnr/cancel",
    {
      schema: {
        params: pnrParams,
        body: { type: "object", required: ["lastName"], additionalProperties: false, properties: { lastName: lastNameField } },
      },
    },
    async (request) => {
      const booking = await findBooking(store, request.params.pnr, request.body.lastName);
      const flight = getFlight(booking.flightId);
      if (flight && Date.parse(flight.scheduledDeparture) <= now().getTime()) {
        throw new HttpError(409, "flight has already departed");
      }
      const cancelled = await store.cancel(booking.pnr);
      request.log.info({ flightId: booking.flightId }, "booking cancelled");
      return view(cancelled!);
    },
  );

  return app;
}
