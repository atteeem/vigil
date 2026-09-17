import { test, expect } from "@playwright/test";
import { extractFacts } from "@/lib/ingestion/extract-facts";
import type { RawIngestionItemDTO } from "@/lib/db/repositories/raw-ingestion-items";

// Deterministic coverage for the Structured Event Intelligence heuristic
// extractor (spec "Structured Event Intelligence"). Pure-function tests,
// same rationale as tests/globe-clusters.spec.ts and
// tests/world-map-heat.spec.ts — no unit-test runner besides Playwright
// exists in this project, and extractFacts has no DOM dependency, so it's
// exercised directly against a fabricated RawIngestionItemDTO rather than
// through the admin UI. (One scenario below resolves a single gazetteer
// match, which makes extractFacts do a real conflict lookup against the
// migrated+seeded dev DB — same "DB assumed migrated" precondition every
// other Playwright test in this project already relies on.)

let counter = 0;
function item(overrides: Partial<RawIngestionItemDTO>): RawIngestionItemDTO {
  counter++;
  return {
    id: `item-${counter}`,
    sourceId: "source-1",
    externalId: `ext-${counter}`,
    originalUrl: null,
    originalTitle: "Untitled report",
    originalText: "",
    language: null,
    publishedAt: new Date("2026-09-17T10:00:00.000Z"),
    receivedAt: new Date("2026-09-17T10:05:00.000Z"),
    mediaUrls: [],
    processingStatus: "pending",
    rawMetadata: null,
    suggestedEventType: null,
    suggestedConflictId: null,
    suggestedRegion: null,
    suggestedCountryCode: null,
    suggestedLocationName: null,
    suggestedLat: null,
    suggestedLng: null,
    suggestedSeverity: null,
    suggestedImportance: null,
    locationSource: null,
    processedAt: null,
    ...overrides,
  };
}

function facts(field: string, all: Awaited<ReturnType<typeof extractFacts>>) {
  return all.filter((f) => f.field === field);
}

test.describe("Structured fact extraction (lib/ingestion/extract-facts.ts)", () => {
  test("1. Clear location and event-type extraction", async () => {
    const result = await extractFacts(
      item({
        originalTitle: "Airstrike reported in Kyiv",
        originalText: "An airstrike struck a residential area of Kyiv overnight, officials said.",
      }),
    );

    const eventType = facts("eventType", result);
    expect(eventType).toHaveLength(1);
    expect(eventType[0]!.value).toBe("airstrike");
    expect(eventType[0]!.confidence).toBeGreaterThan(0);

    const locationName = facts("locationName", result);
    expect(locationName).toHaveLength(1);
    expect(locationName[0]!.value).toContain("Kyiv");
    expect(locationName[0]!.confidence).toBeCloseTo(0.85, 2);

    const lat = facts("latitude", result);
    const lng = facts("longitude", result);
    expect(Number(lat[0]!.value)).toBeCloseTo(50.45, 2);
    expect(Number(lng[0]!.value)).toBeCloseTo(30.52, 2);

    expect(facts("countryCode", result)[0]!.value).toBe("UA");
    expect(facts("region", result)[0]!.value).toBe("Europe");

    // A single resolved location whose country matches a seeded conflict
    // should surface a likely conflict association (spec "likely conflict
    // association") — but only as a suggestion, never asserted as fact.
    const conflictId = facts("conflictId", result);
    expect(conflictId.length).toBeLessThanOrEqual(1);
    if (conflictId.length === 1) {
      expect(conflictId[0]!.source).toContain("UA");
    }

    // Every extracted field carries confidence + provenance + status.
    for (const f of result) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
      expect(f.source.length).toBeGreaterThan(0);
    }
  });

  test("2. Missing information stays absent, never guessed", async () => {
    const result = await extractFacts(
      item({
        originalTitle: "Community meeting held",
        originalText: "Officials gathered for a scheduled community meeting with no incidents reported.",
      }),
    );

    expect(facts("eventType", result)).toHaveLength(0);
    expect(facts("locationName", result)).toHaveLength(0);
    expect(facts("latitude", result)).toHaveLength(0);
    expect(facts("longitude", result)).toHaveLength(0);
    expect(facts("countryCode", result)).toHaveLength(0);
    expect(facts("region", result)).toHaveLength(0);
    expect(facts("actor", result)).toHaveLength(0);
    expect(facts("casualtiesKilled", result)).toHaveLength(0);
    expect(facts("casualtiesInjured", result)).toHaveLength(0);
    expect(facts("infrastructureDamage", result)).toHaveLength(0);
    expect(facts("conflictId", result)).toHaveLength(0);

    // Fields that are always directly observable (title/summary is what
    // the source literally said, severity always has SOME value in this
    // heuristic, occurredAt comes from source metadata) still show up —
    // "unknown stays unknown" applies to INFERRED facts, not to what the
    // report itself always provides.
    expect(facts("title", result)).toHaveLength(1);
    expect(facts("summary", result)).toHaveLength(1);
    expect(facts("severity", result)).toHaveLength(1);
    expect(facts("occurredAt", result)).toHaveLength(1);
    // No genuine escalation language here — severity confidence should
    // honestly reflect "generic default", not fake certainty.
    expect(facts("severity", result)[0]!.confidence).toBeLessThan(0.5);
  });

  test("3. Conflicting casualty figures coexist rather than overwrite", async () => {
    const result = await extractFacts(
      item({
        originalTitle: "Casualty reports vary",
        originalText:
          "Local authorities said 5 people were killed in the strike, though separate reports say 8 people were killed.",
      }),
    );

    const killed = facts("casualtiesKilled", result);
    expect(killed).toHaveLength(2);
    const values = killed.map((f) => f.value).sort();
    expect(values).toEqual(["5", "8"]);
    for (const f of killed) {
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.source).toContain("killed");
    }
  });

  test("4. Multiple actors are each extracted as distinct facts", async () => {
    const result = await extractFacts(
      item({
        originalTitle: "Clash reported",
        originalText: "Israeli forces exchanged fire with Hamas militants overnight.",
      }),
    );

    const actors = facts("actor", result);
    expect(actors).toHaveLength(2);
    const names = actors.map((f) => f.value).sort();
    expect(names).toEqual(["Hamas", "Israel"]);
    for (const f of actors) expect(f.confidence).toBeGreaterThan(0);
  });

  test("5. Ambiguous place name produces low-confidence, multi-candidate geolocation", async () => {
    const result = await extractFacts(
      item({
        originalTitle: "Shelling reported near Novoselivka",
        originalText: "Artillery shelling was reported near Novoselivka overnight.",
      }),
    );

    const locationName = facts("locationName", result);
    // Three oblasts share this place name in the gazetteer — all three
    // candidates must coexist (spec "conflicting source values must
    // coexist"), none silently chosen as THE answer.
    expect(locationName).toHaveLength(3);
    for (const f of locationName) {
      expect(f.confidence).toBeLessThan(0.5);
      expect(f.source).toContain("ambiguous");
    }
    expect(facts("latitude", result)).toHaveLength(3);
    expect(facts("longitude", result)).toHaveLength(3);
    // An ambiguous location must never silently resolve to one conflict.
    expect(facts("conflictId", result)).toHaveLength(0);
  });
});
