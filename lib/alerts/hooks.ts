import type { GlobalEvent } from "@prisma/client";
import { deriveConflictChange, deriveEscalation, deriveExpired, deriveFromClaim, deriveFromEvent, deriveFromGlobalEvent, deriveFromGlobalRow, deriveFromTerritorialChange } from "./developments";
import { processDevelopments, pruneAlertRecords, type ProcessResult } from "./engine";
import type { Development } from "./decide";

// Call sites: existing write paths tell the alert service "this changed". None of them create events or
// a parallel pipeline, and none of them can fail the write they hang off (alerts are best-effort).

async function run(label: string, derive: () => Promise<Development[]>): Promise<void> {
  try {
    const devs = await derive();
    if (devs.length > 0) await processDevelopments(devs, { commit: true });
  } catch (err) {
    console.error(`[alerts] ${label} failed:`, err);
  }
}

export const alertsForEvent = (eventId: string) => run(`event ${eventId}`, () => deriveFromEvent(eventId, { commit: true }));
export const alertsForConflict = (conflictId: string) => run(`conflict ${conflictId}`, async () => [...(await deriveConflictChange(conflictId, { commit: true })), ...(await deriveEscalation(conflictId, { commit: true }))]);
export const alertsForTerritorialChange = (candidateId: string) => run(`territorial ${candidateId}`, () => deriveFromTerritorialChange(candidateId, { commit: true }));
export const alertsForClaim = (claimId: string) => run(`claim ${claimId}`, () => deriveFromClaim(claimId, { commit: true }));

/** New/updated/ended GlobalEvents from one provider pass. Raw thermal detections are filtered out before any
 * watch lookup: high-volume observations never scan watches. */
export async function alertsForGlobalEvents(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await run("global events", async () => {
    const out: Development[] = [];
    for (const id of ids) out.push(...(await deriveFromGlobalEvent(id, { commit: true })));
    return out;
  });
}

/** Expiry sweep + housekeeping: raises resolutions for alerts whose time passed and prunes old inspector rows. */
export async function alertsSweep(): Promise<void> {
  await run("sweep", () => deriveExpired({ commit: true }));
  await pruneAlertRecords().catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------
// Simulation: "if this happened, which watches would match?" — read-only (no notifications, no ledger writes).
// ---------------------------------------------------------------------------------------------
export interface SimulationInput {
  kind: "event" | "global_event" | "territorial_change" | "claim" | "conflict" | "synthetic_global";
  id?: string;
  /** synthetic_global: describe a hypothetical GlobalEvent. */
  synthetic?: Partial<GlobalEvent> & { metadata?: Record<string, unknown> };
}

export async function simulate(input: SimulationInput): Promise<{ developments: number; results: ProcessResult[] }> {
  const opts = { commit: false, force: true } as const;
  let devs: Development[] = [];
  switch (input.kind) {
    case "event":
      devs = input.id ? await deriveFromEvent(input.id, opts) : [];
      break;
    case "global_event":
      devs = input.id ? await deriveFromGlobalEvent(input.id, opts) : [];
      break;
    case "territorial_change":
      devs = input.id ? await deriveFromTerritorialChange(input.id, opts) : [];
      break;
    case "claim":
      devs = input.id ? await deriveFromClaim(input.id, opts) : [];
      break;
    case "conflict":
      devs = input.id ? [...(await deriveConflictChange(input.id, opts)), ...(await deriveEscalation(input.id, opts))] : [];
      break;
    case "synthetic_global": {
      const s = input.synthetic ?? {};
      const now = new Date();
      const row: GlobalEvent = {
        id: `sim-${Date.now()}`, origin: "sensor", category: "earthquake", layer: "earthquakes", subtype: null, status: null, entityKey: null, countryCode: null, provider: "simulation", providerEventId: "sim", sourceId: null, title: "Simulated event", description: null, severityDomain: null, severityValue: null, severityLabel: null, prominence: 50, confidenceLabel: null, confidenceValue: null, geometryType: "point", geometry: null, lat: 0, lng: 0, minLat: 0, maxLat: 0, minLng: 0, maxLng: 0, locationPrecision: "exact", observedAt: now, providerUpdatedAt: now, effectiveAt: null, expiresAt: null, endedAt: null, sourceUrl: null, revision: 1, contentHash: "sim", firstSeenAt: now, lastSeenAt: now,
        ...(s as Partial<GlobalEvent>),
        metadata: s.metadata ? JSON.stringify(s.metadata) : null,
      };
      devs = await deriveFromGlobalRow(row, { commit: false });
      break;
    }
  }
  const results = await processDevelopments(devs, { commit: false });
  return { developments: devs.length, results };
}

