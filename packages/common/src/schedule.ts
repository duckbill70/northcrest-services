// The daily schedule and how each flight behaves on the day.
//
// Everything here is a pure function of the date (and, for status, the
// current time), so both APIs agree without sharing a database and the
// schedule costs no Firestore reads or writes. Firestore only holds what
// people change: bookings, seat counts and ops overrides.

import { AIRPORTS, ROUTES, distanceKm, type Airport } from "./network";

export const SEATS_PER_FLIGHT = 180;
const TURNAROUND_MIN = 45;
const FIRST_DEPARTURE_MIN = 6 * 60; // 06:00 UTC
const LAST_DEPARTURE_MIN = 21 * 60; // 21:00 UTC

export interface Flight {
  id: string; // NC104-2026-11-26
  flightNumber: string; // NC104
  date: string; // YYYY-MM-DD, the scheduled departure date (UTC)
  origin: string;
  destination: string;
  scheduledDeparture: string; // ISO 8601, UTC
  scheduledArrival: string;
  distanceKm: number;
  durationMin: number;
}

export type FlightState =
  | "SCHEDULED"
  | "DELAYED"
  | "BOARDING"
  | "GATE_CLOSED"
  | "DEPARTED"
  | "LANDED"
  | "CANCELLED";

export interface FlightStatus {
  state: FlightState;
  delayMin: number;
  estimatedDeparture: string;
  estimatedArrival: string;
  gate: string | null;
  remark: string | null;
}

/** Override an operator set by hand; takes precedence over the simulation. */
export interface StatusOverride {
  delayMin?: number;
  cancelled?: boolean;
  gate?: string;
  remark?: string;
}

// --- Deterministic randomness -------------------------------------------------

/** FNV-1a: a stable 32-bit hash, so the same flight always behaves the same. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A number in [0, 1) derived from the text. */
export function unit(text: string): number {
  return hash(text) / 0x1_0000_0000;
}

// --- Schedule -----------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  // Round-trip, because Date quietly rolls 2026-02-31 over to March.
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function atMinutes(date: string, minutes: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60_000).toISOString();
}

interface Leg {
  flightNumber: string;
  origin: string;
  destination: string;
  departureMin: number; // minutes after 00:00 UTC on the schedule date
  durationMin: number;
  distanceKm: number;
}

/** The repeating daily pattern: the same flight numbers and times every day. */
function buildPattern(): Leg[] {
  const legs: Leg[] = [];
  let next = 100;
  for (const [base, dest, rotations] of ROUTES) {
    const a = AIRPORTS[base];
    const b = AIRPORTS[dest];
    const km = distanceKm(a, b);
    // Cruise at about 750 km/h plus 25 minutes of taxi and climb.
    const duration = roundTo((km / 750) * 60 + 25, 5);
    const window = LAST_DEPARTURE_MIN - FIRST_DEPARTURE_MIN;
    const spacing = window / rotations;
    const offset = roundTo(unit(`${base}${dest}`) * Math.min(spacing, 90), 5);
    for (let i = 0; i < rotations; i++) {
      const out = roundTo(FIRST_DEPARTURE_MIN + i * spacing + offset, 5);
      const back = out + duration + TURNAROUND_MIN;
      legs.push({ flightNumber: `NC${next}`, origin: base, destination: dest, departureMin: out, durationMin: duration, distanceKm: km });
      legs.push({ flightNumber: `NC${next + 1}`, origin: dest, destination: base, departureMin: back, durationMin: duration, distanceKm: km });
      next += 2;
    }
  }
  return legs;
}

const PATTERN = buildPattern();
const BY_NUMBER = new Map(PATTERN.map((leg) => [leg.flightNumber, leg]));

function toFlight(leg: Leg, date: string): Flight {
  return {
    id: `${leg.flightNumber}-${date}`,
    flightNumber: leg.flightNumber,
    date,
    origin: leg.origin,
    destination: leg.destination,
    scheduledDeparture: atMinutes(date, leg.departureMin),
    scheduledArrival: atMinutes(date, leg.departureMin + leg.durationMin),
    distanceKm: leg.distanceKm,
    durationMin: leg.durationMin,
  };
}

/** All flights departing on the date (UTC). */
export function flightsOn(date: string): Flight[] {
  if (!isValidDate(date)) return [];
  return PATTERN.map((leg) => toFlight(leg, date)).sort((x, y) =>
    x.scheduledDeparture.localeCompare(y.scheduledDeparture),
  );
}

export function findFlights(date: string, origin?: string, destination?: string): Flight[] {
  return flightsOn(date).filter(
    (f) => (!origin || f.origin === origin) && (!destination || f.destination === destination),
  );
}

/** Look up a flight by its ID, for example NC104-2026-11-26. */
export function getFlight(id: string): Flight | undefined {
  const match = /^(NC\d+)-(\d{4}-\d{2}-\d{2})$/.exec(id);
  if (!match || !isValidDate(match[2])) return undefined;
  const leg = BY_NUMBER.get(match[1]);
  return leg && toFlight(leg, match[2]);
}

export function airport(code: string): Airport | undefined {
  return AIRPORTS[code];
}

// --- Fares --------------------------------------------------------------------

/** Fare per passenger in GBP: distance-based, with demand that varies by day. */
export function fareFor(flight: Flight): number {
  const base = 39 + flight.distanceKm * 0.08;
  const demand = 0.85 + unit(`fare:${flight.id}`) * 0.6;
  return Math.max(29, Math.floor(base * demand)) + 0.99;
}

// --- Status -------------------------------------------------------------------

/** How the day goes for this flight, before any operator override. */
function simulatedDisruption(flight: Flight): { cancelled: boolean; delayMin: number } {
  const r = unit(`ops:${flight.id}`);
  if (r < 0.02) return { cancelled: true, delayMin: 0 };
  if (r < 0.1) return { cancelled: false, delayMin: roundTo(45 + unit(`d2:${flight.id}`) * 135, 5) };
  if (r < 0.3) return { cancelled: false, delayMin: roundTo(5 + unit(`d1:${flight.id}`) * 40, 5) };
  return { cancelled: false, delayMin: 0 };
}

function gateFor(flight: Flight): string {
  const h = hash(`gate:${flight.id}`);
  return `${"AB"[h % 2]}${1 + (h % 24)}`;
}

/** Status at `now`. Delays and cancellations become visible 3 and 6 hours out. */
export function statusAt(flight: Flight, now: Date, override?: StatusOverride): FlightStatus {
  const sim = simulatedDisruption(flight);
  const cancelled = override?.cancelled ?? sim.cancelled;
  const delayMin = override?.delayMin ?? sim.delayMin;

  const std = Date.parse(flight.scheduledDeparture);
  const t = now.getTime();
  const minutesToStd = (std - t) / 60_000;

  // Simulated disruption is announced on the day; an operator's is at once.
  const announcedDelay = override?.delayMin !== undefined || minutesToStd <= 180 ? delayMin : 0;
  const etd = std + announcedDelay * 60_000;
  const eta = etd + flight.durationMin * 60_000;
  const gate = override?.gate ?? (minutesToStd <= 120 ? gateFor(flight) : null);

  let state: FlightState;
  if (cancelled && (override?.cancelled || minutesToStd <= 360)) state = "CANCELLED";
  else if (t >= eta) state = "LANDED";
  else if (t >= etd) state = "DEPARTED";
  else if (t >= etd - 10 * 60_000) state = "GATE_CLOSED";
  else if (t >= etd - 40 * 60_000) state = "BOARDING";
  else if (announcedDelay > 0) state = "DELAYED";
  else state = "SCHEDULED";

  return {
    state,
    delayMin: state === "CANCELLED" ? 0 : announcedDelay,
    estimatedDeparture: new Date(etd).toISOString(),
    estimatedArrival: new Date(eta).toISOString(),
    gate: state === "CANCELLED" ? null : gate,
    remark: override?.remark ?? null,
  };
}

export const SCHEDULE_SIZE = PATTERN.length;
