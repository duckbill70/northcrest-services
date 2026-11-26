import pino from "pino";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { StaticOverrides } from "../src/overrides";

const NOW = new Date("2026-12-01T12:00:00Z");

function app(overrides = new StaticOverrides()) {
  return buildApp(overrides, pino({ level: "silent" }), () => NOW);
}

describe("flight status api", () => {
  it("shows today's departures board in time order", async () => {
    const res = await app().inject("/api/status/board?airport=MAN");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toBe("2026-12-01");
    expect(body.flights.length).toBeGreaterThan(50);
    expect(body.flights.every((f: { origin: string }) => f.origin === "MAN")).toBe(true);
    const times = body.flights.map((f: { scheduledDeparture: string }) => f.scheduledDeparture);
    expect([...times].sort()).toEqual(times);
    expect(body.flights[0].status.state).toBe("LANDED");
  });

  it("shows arrivals", async () => {
    const res = await app().inject("/api/status/board?airport=EDI&direction=arrivals&date=2026-12-01");
    expect(res.json().flights.every((f: { destination: string }) => f.destination === "EDI")).toBe(true);
  });

  it("applies operator overrides", async () => {
    const overrides = new StaticOverrides(new Map([["NC100-2026-12-02", { cancelled: true, remark: "Crew availability" }]]));
    const res = await app(overrides).inject("/api/status/flights/nc100?date=2026-12-02");
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toMatchObject({ state: "CANCELLED", remark: "Crew availability" });
  });

  it("returns 404 for unknown flights and airports", async () => {
    expect((await app().inject("/api/status/flights/NC9999")).statusCode).toBe(404);
    expect((await app().inject("/api/status/board?airport=XXX")).statusCode).toBe(404);
  });
});
