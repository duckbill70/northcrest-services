import { describe, expect, it } from "vitest";
import {
  SCHEDULE_SIZE,
  fareFor,
  findFlights,
  flightsOn,
  getFlight,
  statusAt,
} from "../src/schedule";

const DATE = "2026-12-01";

describe("schedule", () => {
  it("is the same every time for a date", () => {
    expect(flightsOn(DATE)).toEqual(flightsOn(DATE));
    expect(flightsOn(DATE)).toHaveLength(SCHEDULE_SIZE);
  });

  it("has unique flight numbers and pairs every outbound with a return", () => {
    const flights = flightsOn(DATE);
    expect(new Set(flights.map((f) => f.flightNumber)).size).toBe(flights.length);
    const out = getFlight(`NC100-${DATE}`)!;
    const back = getFlight(`NC101-${DATE}`)!;
    expect(back.origin).toBe(out.destination);
    expect(Date.parse(back.scheduledDeparture)).toBeGreaterThan(Date.parse(out.scheduledArrival));
  });

  it("finds flights by route", () => {
    const flights = findFlights(DATE, "MAN", "EDI");
    expect(flights).toHaveLength(5);
    expect(flights.every((f) => f.origin === "MAN" && f.destination === "EDI")).toBe(true);
  });

  it("rejects bad IDs and dates", () => {
    expect(getFlight("NC9999-2026-12-01")).toBeUndefined();
    expect(getFlight("NC100-2026-13-45")).toBeUndefined();
    expect(flightsOn("tomorrow")).toEqual([]);
  });

  it("prices every flight above the floor", () => {
    for (const f of flightsOn(DATE)) expect(fareFor(f)).toBeGreaterThanOrEqual(29.99);
  });
});

describe("status", () => {
  const flight = getFlight(`NC100-${DATE}`)!;
  const std = Date.parse(flight.scheduledDeparture);
  const at = (minutesFromStd: number) => new Date(std + minutesFromStd * 60_000);

  it("moves through the day", () => {
    const override = { delayMin: 0, cancelled: false };
    expect(statusAt(flight, at(-300), override).state).toBe("SCHEDULED");
    expect(statusAt(flight, at(-30), override).state).toBe("BOARDING");
    expect(statusAt(flight, at(-5), override).state).toBe("GATE_CLOSED");
    expect(statusAt(flight, at(10), override).state).toBe("DEPARTED");
    expect(statusAt(flight, at(flight.durationMin + 1), override).state).toBe("LANDED");
  });

  it("announces simulated delays only in the last three hours", () => {
    const delayed = flightsOn(DATE).find((f) => statusAt(f, new Date(Date.parse(f.scheduledDeparture) - 60 * 60_000)).state === "DELAYED")!;
    const std2 = Date.parse(delayed.scheduledDeparture);
    expect(statusAt(delayed, new Date(std2 - 240 * 60_000)).delayMin).toBe(0);
    expect(statusAt(delayed, new Date(std2 - 120 * 60_000)).state).toBe("DELAYED");
  });

  it("shows an operator's delay at once", () => {
    expect(statusAt(flight, at(-600), { delayMin: 60 })).toMatchObject({ state: "DELAYED", delayMin: 60 });
  });

  it("lets an operator cancel a flight", () => {
    expect(statusAt(flight, at(-60), { cancelled: true })).toMatchObject({ state: "CANCELLED", gate: null });
  });

  it("disrupts a realistic share of the day", () => {
    const now = new Date(`${DATE}T23:59:00Z`);
    const flights = flightsOn(DATE);
    const cancelled = flights.filter((f) => statusAt(f, now).state === "CANCELLED").length;
    expect(cancelled / flights.length).toBeLessThan(0.06);
  });
});
