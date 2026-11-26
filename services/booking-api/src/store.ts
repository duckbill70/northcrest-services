// Bookings and seat inventory. Firestore in production, memory in tests.
//
// Firestore layout (customer project, (default) database):
//   inventory/{flightId}  { taken: number }
//   bookings/{pnr}        Booking

import { randomInt } from "node:crypto";
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { SEATS_PER_FLIGHT } from "@northcrest/common";

export interface Passenger {
  firstName: string;
  lastName: string;
  email: string;
}

export interface Booking {
  pnr: string;
  flightId: string;
  passengers: Passenger[];
  farePerPassenger: number;
  total: number;
  currency: "GBP";
  status: "CONFIRMED" | "CANCELLED";
  createdAt: string;
}

export type NewBooking = Omit<Booking, "pnr" | "status" | "createdAt">;

export class SoldOutError extends Error {
  constructor(public readonly seatsLeft: number) {
    super("not enough seats left");
  }
}

export interface BookingStore {
  seatsTaken(flightIds: string[]): Promise<Map<string, number>>;
  create(booking: NewBooking): Promise<Booking>;
  get(pnr: string): Promise<Booking | undefined>;
  cancel(pnr: string): Promise<Booking | undefined>;
}

// Unambiguous characters only: no 0/O or 1/I.
const PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newPnr(): string {
  let pnr = "";
  for (let i = 0; i < 6; i++) pnr += PNR_ALPHABET[randomInt(PNR_ALPHABET.length)];
  return pnr;
}

export class FirestoreBookingStore implements BookingStore {
  constructor(private readonly db = new Firestore({ ignoreUndefinedProperties: true })) {}

  async seatsTaken(flightIds: string[]): Promise<Map<string, number>> {
    const taken = new Map<string, number>();
    if (flightIds.length === 0) return taken;
    const refs = flightIds.map((id) => this.db.collection("inventory").doc(id));
    const docs = await this.db.getAll(...refs);
    docs.forEach((doc, i) => taken.set(flightIds[i], (doc.get("taken") as number | undefined) ?? 0));
    return taken;
  }

  async create(input: NewBooking): Promise<Booking> {
    const booking: Booking = {
      ...input,
      pnr: newPnr(),
      status: "CONFIRMED",
      createdAt: new Date().toISOString(),
    };
    const seats = input.passengers.length;
    const inventory = this.db.collection("inventory").doc(input.flightId);
    const record = this.db.collection("bookings").doc(booking.pnr);

    await this.db.runTransaction(async (tx) => {
      const [inv, existing] = await tx.getAll(inventory, record);
      if (existing.exists) throw new Error("PNR collision, retry");
      const taken = (inv.get("taken") as number | undefined) ?? 0;
      if (taken + seats > SEATS_PER_FLIGHT) throw new SoldOutError(SEATS_PER_FLIGHT - taken);
      tx.set(inventory, { taken: taken + seats }, { merge: true });
      tx.create(record, booking);
    });
    return booking;
  }

  async get(pnr: string): Promise<Booking | undefined> {
    const doc = await this.db.collection("bookings").doc(pnr).get();
    return doc.exists ? (doc.data() as Booking) : undefined;
  }

  async cancel(pnr: string): Promise<Booking | undefined> {
    const record = this.db.collection("bookings").doc(pnr);
    return this.db.runTransaction(async (tx) => {
      const doc = await tx.get(record);
      if (!doc.exists) return undefined;
      const booking = doc.data() as Booking;
      if (booking.status === "CANCELLED") return booking;
      const inventory = this.db.collection("inventory").doc(booking.flightId);
      tx.update(record, { status: "CANCELLED" });
      tx.set(inventory, { taken: FieldValue.increment(-booking.passengers.length) }, { merge: true });
      return { ...booking, status: "CANCELLED" as const };
    });
  }
}

export class MemoryBookingStore implements BookingStore {
  private readonly taken = new Map<string, number>();
  private readonly bookings = new Map<string, Booking>();

  async seatsTaken(flightIds: string[]): Promise<Map<string, number>> {
    return new Map(flightIds.map((id) => [id, this.taken.get(id) ?? 0]));
  }

  async create(input: NewBooking): Promise<Booking> {
    const taken = this.taken.get(input.flightId) ?? 0;
    if (taken + input.passengers.length > SEATS_PER_FLIGHT) throw new SoldOutError(SEATS_PER_FLIGHT - taken);
    const booking: Booking = { ...input, pnr: newPnr(), status: "CONFIRMED", createdAt: new Date().toISOString() };
    this.taken.set(input.flightId, taken + input.passengers.length);
    this.bookings.set(booking.pnr, booking);
    return booking;
  }

  async get(pnr: string): Promise<Booking | undefined> {
    return this.bookings.get(pnr);
  }

  async cancel(pnr: string): Promise<Booking | undefined> {
    const booking = this.bookings.get(pnr);
    if (!booking || booking.status === "CANCELLED") return booking;
    const cancelled = { ...booking, status: "CANCELLED" as const };
    this.bookings.set(pnr, cancelled);
    this.taken.set(booking.flightId, (this.taken.get(booking.flightId) ?? 0) - booking.passengers.length);
    return cancelled;
  }
}
