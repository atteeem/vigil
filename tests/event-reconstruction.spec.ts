import { test, expect } from "@playwright/test";
import type { Event, EventHistory } from "@prisma/client";
import { reconstructEventState, type ReconstructableSource } from "@/lib/data/event-reconstruction";

// Deterministic coverage for Event Version History's replay logic (spec
// "add a service/function that can reconstruct an event as it existed
// at any timestamp"). Pure-function tests, same rationale as
// tests/event-update-proposals.spec.ts — reconstructEventState takes
// plain Event/EventHistory/source objects, no Prisma client, no server.

function event(overrides: Partial<Event>): Event {
  return {
    id: "event-1",
    slug: "event-1",
    title: "Airstrike hits Kyiv",
    summary: "An airstrike struck Kyiv.",
    eventType: "airstrike",
    locationName: "Kyiv, Ukraine",
    latitude: 50.45,
    longitude: 30.52,
    countryCode: "UA",
    region: "Europe",
    conflictId: null,
    occurredAt: new Date("2026-09-17T10:00:00.000Z"),
    createdAt: new Date("2026-09-17T10:05:00.000Z"),
    updatedAt: new Date("2026-09-17T10:05:00.000Z"),
    severity: "elevated",
    importance: 50,
    verificationStatus: "reported",
    published: true,
    publishedAt: new Date("2026-09-17T10:06:00.000Z"),
    actors: null,
    casualtiesKilled: null,
    casualtiesInjured: null,
    infrastructureDamage: null,
    locationPrecision: null,
    ...overrides,
  };
}

let counter = 0;
function historyEntry(overrides: Partial<EventHistory> & { field: string; newValue: string; createdAt: Date }): EventHistory {
  counter++;
  return {
    id: `history-${counter}`,
    eventId: "event-1",
    oldValue: null,
    rawIngestionItemId: null,
    source: "test provenance",
    confidence: 0.75,
    automatic: false,
    ...overrides,
  };
}

function source(overrides: Partial<ReconstructableSource> & { createdAt: Date }): ReconstructableSource {
  return { rawIngestionItemId: "item-1", relationship: "originating", ...overrides };
}

test.describe("Event state reconstruction (lib/data/event-reconstruction.ts)", () => {
  test("1. Reconstructing 'now' (or any time after every change) matches the event's current state exactly", () => {
    const e = event({ severity: "high" });
    const history = [
      historyEntry({ field: "severity", oldValue: "elevated", newValue: "high", createdAt: new Date("2026-09-17T11:00:00.000Z") }),
    ];
    const result = reconstructEventState(e, history, [], new Date("2026-09-18T00:00:00.000Z"));
    expect(result?.severity).toBe("high");
  });

  test("2. Reconstructing a time BEFORE a change recovers the OLD value", () => {
    const e = event({ severity: "high" });
    const history = [
      historyEntry({ field: "severity", oldValue: "elevated", newValue: "high", createdAt: new Date("2026-09-17T11:00:00.000Z") }),
    ];
    const before = reconstructEventState(e, history, [], new Date("2026-09-17T10:30:00.000Z"));
    expect(before?.severity).toBe("elevated");
    const after = reconstructEventState(e, history, [], new Date("2026-09-17T11:30:00.000Z"));
    expect(after?.severity).toBe("high");
  });

  test("3. An event reconstructed before it was created returns null", () => {
    const e = event({ createdAt: new Date("2026-09-17T10:05:00.000Z") });
    const result = reconstructEventState(e, [], [], new Date("2026-09-17T09:00:00.000Z"));
    expect(result).toBeNull();
  });

  test("4. Multiple sequential updates to the same field reconstruct correctly at every intermediate timestamp", () => {
    const e = event({ casualtiesKilled: 12 });
    // Chain: null -> 5 (t1) -> 8 (t2) -> 12 (t3). Each oldValue is the
    // TRUE prior value (as acceptProposal now guarantees), not a stale
    // proposal-creation-time snapshot.
    const history = [
      historyEntry({ field: "casualtiesKilled", oldValue: null, newValue: "5", createdAt: new Date("2026-09-17T11:00:00.000Z") }),
      historyEntry({ field: "casualtiesKilled", oldValue: "5", newValue: "8", createdAt: new Date("2026-09-17T12:00:00.000Z") }),
      historyEntry({ field: "casualtiesKilled", oldValue: "8", newValue: "12", createdAt: new Date("2026-09-17T13:00:00.000Z") }),
    ];
    expect(reconstructEventState(e, history, [], new Date("2026-09-17T10:30:00.000Z"))?.casualtiesKilled).toBeNull();
    expect(reconstructEventState(e, history, [], new Date("2026-09-17T11:30:00.000Z"))?.casualtiesKilled).toBe(5);
    expect(reconstructEventState(e, history, [], new Date("2026-09-17T12:30:00.000Z"))?.casualtiesKilled).toBe(8);
    expect(reconstructEventState(e, history, [], new Date("2026-09-17T13:30:00.000Z"))?.casualtiesKilled).toBe(12);
  });

  test("5. Source attachments are included only once their own attachment time has passed", () => {
    const e = event({});
    const sources = [
      source({ rawIngestionItemId: "item-a", createdAt: new Date("2026-09-17T10:10:00.000Z") }),
      source({ rawIngestionItemId: "item-b", createdAt: new Date("2026-09-17T14:00:00.000Z") }),
    ];
    const early = reconstructEventState(e, [], sources, new Date("2026-09-17T12:00:00.000Z"));
    expect(early?.sources.map((s) => s.rawIngestionItemId)).toEqual(["item-a"]);
    const late = reconstructEventState(e, [], sources, new Date("2026-09-17T15:00:00.000Z"));
    expect(late?.sources.map((s) => s.rawIngestionItemId)).toEqual(["item-a", "item-b"]);
  });

  test("6. Casualty, location, and severity fields all roll back independently and correctly in one reconstruction", () => {
    const e = event({ severity: "high", locationName: "Kyiv, Ukraine", casualtiesKilled: 9 });
    const t = new Date("2026-09-17T12:00:00.000Z");
    const history = [
      historyEntry({ field: "severity", oldValue: "elevated", newValue: "high", createdAt: new Date("2026-09-17T13:00:00.000Z") }),
      historyEntry({ field: "locationName", oldValue: "Kyiv Oblast", newValue: "Kyiv, Ukraine", createdAt: new Date("2026-09-17T13:00:00.000Z") }),
      historyEntry({ field: "casualtiesKilled", oldValue: "3", newValue: "9", createdAt: new Date("2026-09-17T13:00:00.000Z") }),
    ];
    const result = reconstructEventState(e, history, [], t);
    expect(result?.severity).toBe("elevated");
    expect(result?.locationName).toBe("Kyiv Oblast");
    expect(result?.casualtiesKilled).toBe(3);
  });

  test("7. Actor/infrastructure-damage entries accumulate (never roll back) and only include additions at or before the timestamp", () => {
    const e = event({ actors: JSON.stringify(["Israel", "Hamas"]) });
    const history = [
      historyEntry({ field: "actor", newValue: "Israel", createdAt: new Date("2026-09-17T11:00:00.000Z") }),
      historyEntry({ field: "actor", newValue: "Hamas", createdAt: new Date("2026-09-17T13:00:00.000Z") }),
    ];
    const early = reconstructEventState(e, history, [], new Date("2026-09-17T12:00:00.000Z"));
    expect(early?.actors).toEqual(["Israel"]);
    const late = reconstructEventState(e, history, [], new Date("2026-09-17T14:00:00.000Z"));
    expect(late?.actors).toEqual(["Israel", "Hamas"]);
  });

  test("8. Publication state reflects whether publishedAt had happened yet by the reconstruction timestamp", () => {
    const e = event({ publishedAt: new Date("2026-09-17T12:00:00.000Z") });
    expect(reconstructEventState(e, [], [], new Date("2026-09-17T11:00:00.000Z"))?.published).toBe(false);
    expect(reconstructEventState(e, [], [], new Date("2026-09-17T13:00:00.000Z"))?.published).toBe(true);
  });

  test("9. An event that was never published reconstructs as unpublished at every timestamp", () => {
    const e = event({ publishedAt: null, published: false });
    expect(reconstructEventState(e, [], [], new Date("2026-09-20T00:00:00.000Z"))?.published).toBe(false);
  });

  test("10. Numeric fields (latitude/longitude) roll back to the correct number, not a stringified leftover", () => {
    const e = event({ latitude: 50.45, longitude: 30.52 });
    const history = [
      historyEntry({ field: "latitude", oldValue: "50.4", newValue: "50.45", createdAt: new Date("2026-09-17T13:00:00.000Z") }),
      historyEntry({ field: "longitude", oldValue: "30.5", newValue: "30.52", createdAt: new Date("2026-09-17T13:00:00.000Z") }),
    ];
    const result = reconstructEventState(e, history, [], new Date("2026-09-17T12:00:00.000Z"));
    expect(result?.latitude).toBe(50.4);
    expect(result?.longitude).toBe(30.5);
    expect(typeof result?.latitude).toBe("number");
  });
});
