import pino from "pino";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryBookingStore } from "../src/store";

const NOW = new Date("2026-12-01T00:00:00Z");
const FLIGHT = "NC100-2026-12-02";
const passenger = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" };

function app() {
  return buildApp(new MemoryBookingStore(), pino({ level: "silent" }), () => NOW);
}

describe("booking api", () => {
  it("lists airports with destinations", async () => {
    const res = await app().inject("/api/airports");
    expect(res.statusCode).toBe(200);
    const man = res.json().airports.find((a: { code: string }) => a.code === "MAN");
    expect(man.destinations).toContain("EDI");
  });

  it("searches flights with fares and seats", async () => {
    const res = await app().inject("/api/flights?from=MAN&to=EDI&date=2026-12-02");
    expect(res.statusCode).toBe(200);
    const { flights } = res.json();
    expect(flights).toHaveLength(5);
    expect(flights[0]).toMatchObject({ origin: "MAN", destination: "EDI", seatsLeft: 180, currency: "GBP" });
  });

  it("rejects a bad search", async () => {
    expect((await app().inject("/api/flights?from=man&to=EDI&date=2026-12-02")).statusCode).toBe(400);
    expect((await app().inject("/api/flights?from=MAN&to=EDI&date=2026-02-31")).statusCode).toBe(400);
  });

  it("books, retrieves and cancels", async () => {
    const a = app();
    const created = await a.inject({ method: "POST", url: "/api/bookings", payload: { flightId: FLIGHT, passengers: [passenger] } });
    expect(created.statusCode).toBe(201);
    const { pnr, total } = created.json();
    expect(pnr).toMatch(/^[A-Z2-9]{6}$/);
    expect(total).toBeGreaterThan(0);

    const seats = (await a.inject("/api/flights?from=MAN&to=EDI&date=2026-12-02")).json().flights.find((f: { id: string }) => f.id === FLIGHT).seatsLeft;
    expect(seats).toBe(179);

    const fetched = await a.inject(`/api/bookings/${pnr.toLowerCase()}?lastName=lovelace`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().passengers[0]).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(fetched.body).not.toContain("ada@example.com");

    const wrongName = await a.inject(`/api/bookings/${pnr}?lastName=Byron`);
    expect(wrongName.statusCode).toBe(404);

    const cancelled = await a.inject({ method: "POST", url: `/api/bookings/${pnr}/cancel`, payload: { lastName: "Lovelace" } });
    expect(cancelled.json().status).toBe("CANCELLED");
  });

  it("validates passengers", async () => {
    const res = await app().inject({
      method: "POST",
      url: "/api/bookings",
      payload: { flightId: FLIGHT, passengers: [{ ...passenger, email: "not-an-email" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refuses flights that have closed or don't exist", async () => {
    const closed = await app().inject({ method: "POST", url: "/api/bookings", payload: { flightId: "NC100-2026-11-30", passengers: [passenger] } });
    expect(closed.statusCode).toBe(409);
    const missing = await app().inject({ method: "POST", url: "/api/bookings", payload: { flightId: "NC999-2026-12-02", passengers: [passenger] } });
    expect(missing.statusCode).toBe(404);
  });

  it("stops selling when the flight is full", async () => {
    const a = app();
    const nine = Array.from({ length: 9 }, () => passenger);
    for (let i = 0; i < 20; i++) {
      expect((await a.inject({ method: "POST", url: "/api/bookings", payload: { flightId: FLIGHT, passengers: nine } })).statusCode).toBe(201);
    }
    const res = await a.inject({ method: "POST", url: "/api/bookings", payload: { flightId: FLIGHT, passengers: [passenger] } });
    expect(res.statusCode).toBe(409);
  });
});
