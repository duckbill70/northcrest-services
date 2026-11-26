// Operator overrides (delays, cancellations, gate changes) for a date.
// Firestore: status_overrides/{flightId} { date, delayMin?, cancelled?, gate?, remark? }
// The ops console (phase 3) writes them; here they are only read, and
// cached briefly so a busy departures board costs few Firestore reads.

import { Firestore } from "@google-cloud/firestore";
import type { StatusOverride } from "@northcrest/common";

export interface OverrideSource {
  forDate(date: string): Promise<Map<string, StatusOverride>>;
}

export class FirestoreOverrides implements OverrideSource {
  private readonly cache = new Map<string, { at: number; value: Map<string, StatusOverride> }>();

  constructor(
    private readonly db = new Firestore(),
    private readonly ttlMs = 30_000,
  ) {}

  async forDate(date: string): Promise<Map<string, StatusOverride>> {
    const hit = this.cache.get(date);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const snap = await this.db.collection("status_overrides").where("date", "==", date).get();
    const value = new Map<string, StatusOverride>();
    snap.forEach((doc) => {
      const { delayMin, cancelled, gate, remark } = doc.data();
      value.set(doc.id, { delayMin, cancelled, gate, remark });
    });
    this.cache.set(date, { at: Date.now(), value });
    return value;
  }
}

export class StaticOverrides implements OverrideSource {
  constructor(private readonly overrides = new Map<string, StatusOverride>()) {}
  async forDate(): Promise<Map<string, StatusOverride>> {
    return this.overrides;
  }
}
