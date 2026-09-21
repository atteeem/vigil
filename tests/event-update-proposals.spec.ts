import { test, expect } from "@playwright/test";
import type { Event } from "@prisma/client";
import { buildProposalDrafts } from "@/lib/ingestion/event-update-proposals";
import { pickEffectiveFact, valuesDiffer } from "@/lib/ingestion/fact-diff";
import type { ExtractedFactDTO, ExtractedFactField } from "@/lib/types/db";

// Deterministic coverage for the Live Event Updates proposal-comparison
// logic (spec "Live Event Updates"). Pure-function tests, same rationale
// as tests/extract-facts.spec.ts — buildProposalDrafts/pickEffectiveFact/
// valuesDiffer have no Prisma client dependency (Event is passed in as a
// plain object), so they're exercised directly without a DB or server.

function event(overrides: Partial<Event>): Event {
  return {
    id: "event-1",
    slug: "event-1",
    title: "Airstrike hits Kyiv",
    summary: "An airstrike struck Kyiv.",
    eventType: "airstrike",
    origin: "conflict_news",
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
    publishedAt: new Date("2026-09-17T10:05:00.000Z"),
    actors: null,
    casualtiesKilled: null,
    casualtiesInjured: null,
    infrastructureDamage: null,
    locationPrecision: null,
    locationScope: null,
    adminRegion: null,
    city: null,
    locationEvidence: null,
    ...overrides,
  };
}

let counter = 0;
function fact(overrides: Partial<ExtractedFactDTO> & { field: ExtractedFactField; value: string }): ExtractedFactDTO {
  counter++;
  return {
    id: `fact-${counter}`,
    confidence: 0.75,
    source: "test provenance",
    observedAt: "2026-09-17T11:00:00.000Z",
    status: "extracted",
    originalValue: null,
    extractedAt: "2026-09-17T11:00:00.000Z",
    ...overrides,
  };
}

function draftsFor(field: ExtractedFactField, drafts: ReturnType<typeof buildProposalDrafts>) {
  return drafts.filter((d) => d.field === field);
}

test.describe("Event update proposal comparison (lib/ingestion/event-update-proposals.ts)", () => {
  test("1. Unchanged fields create no proposal", () => {
    const drafts = buildProposalDrafts(
      event({}),
      [
        fact({ field: "title", value: "Airstrike hits Kyiv" }),
        fact({ field: "severity", value: "elevated" }),
        fact({ field: "latitude", value: "50.4502" }), // within epsilon of 50.45
      ],
    );
    expect(drafts).toHaveLength(0);
  });

  test("2. A changed field creates a proposal carrying current/proposed/confidence/source/observedAt/changeType", () => {
    const drafts = buildProposalDrafts(
      event({ severity: "elevated" }),
      [fact({ field: "severity", value: "high", confidence: 0.7, source: "casualty language", observedAt: "2026-09-17T12:00:00.000Z" })],
    );
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.field).toBe("severity");
    expect(d.currentValue).toBe("elevated");
    expect(d.proposedValue).toBe("high");
    expect(d.confidence).toBe(0.7);
    expect(d.source).toBe("casualty language");
    expect(d.observedAt.toISOString()).toBe("2026-09-17T12:00:00.000Z");
    expect(d.changeType).toBe("updated");
  });

  test("3. A field the event has no value for yet proposes as 'new', not 'updated'", () => {
    const drafts = buildProposalDrafts(event({ conflictId: null }), [fact({ field: "conflictId", value: "conflict-1" })]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.changeType).toBe("new");
    expect(drafts[0]!.currentValue).toBeNull();
  });

  test("4. Competing casualty figures each produce their own coexisting proposal", () => {
    const drafts = draftsFor(
      "casualtiesKilled",
      buildProposalDrafts(event({ casualtiesKilled: null }), [
        fact({ field: "casualtiesKilled", value: "5", source: "local officials" }),
        fact({ field: "casualtiesKilled", value: "8", source: "hospital sources" }),
      ]),
    );
    expect(drafts).toHaveLength(2);
    const values = drafts.map((d) => d.proposedValue).sort();
    expect(values).toEqual(["5", "8"]);
    for (const d of drafts) expect(d.changeType).toBe("new");
  });

  test("5. A casualty figure matching the event's current value proposes nothing", () => {
    const drafts = draftsFor(
      "casualtiesKilled",
      buildProposalDrafts(event({ casualtiesKilled: 5 }), [fact({ field: "casualtiesKilled", value: "5" })]),
    );
    expect(drafts).toHaveLength(0);
  });

  test("6. A new actor not already on the event proposes as 'new'; an already-present actor proposes nothing", () => {
    const withExisting = event({ actors: JSON.stringify(["Israel"]) });
    const drafts = draftsFor(
      "actor",
      buildProposalDrafts(withExisting, [fact({ field: "actor", value: "Hamas" }), fact({ field: "actor", value: "Israel" })]),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.proposedValue).toBe("Hamas");
    expect(drafts[0]!.changeType).toBe("new");
  });

  test("7. Infrastructure damage follows the same new-value-only-if-absent rule as actors", () => {
    const withExisting = event({ infrastructureDamage: JSON.stringify(["power grid damaged"]) });
    const drafts = draftsFor(
      "infrastructureDamage",
      buildProposalDrafts(withExisting, [
        fact({ field: "infrastructureDamage", value: "power grid damaged" }),
        fact({ field: "infrastructureDamage", value: "bridge destroyed" }),
      ]),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.proposedValue).toBe("bridge destroyed");
  });

  test("8. Rejected facts never produce a proposal", () => {
    const drafts = buildProposalDrafts(event({ severity: "elevated" }), [
      fact({ field: "severity", value: "high", status: "rejected" }),
    ]);
    expect(drafts).toHaveLength(0);
  });

  test("9. pickEffectiveFact: an admin's accepted/edited fact wins over a higher-confidence undecided one, and rejected facts are excluded", () => {
    const facts: ExtractedFactDTO[] = [
      fact({ field: "eventType", value: "drone", confidence: 0.9, status: "extracted" }),
      fact({ field: "eventType", value: "airstrike", confidence: 0.5, status: "accepted" }),
      fact({ field: "eventType", value: "missile", confidence: 0.99, status: "rejected" }),
    ];
    expect(pickEffectiveFact(facts, "eventType")?.value).toBe("airstrike");
  });

  test("10. valuesDiffer: lat/lng use a ~50m epsilon, occurredAt uses a 5-minute tolerance, everything else is exact", () => {
    expect(valuesDiffer("latitude", "50.45", "50.4502")).toBe(false);
    expect(valuesDiffer("latitude", "50.45", "50.46")).toBe(true);
    expect(valuesDiffer("occurredAt", "2026-09-17T10:00:00.000Z", "2026-09-17T10:02:00.000Z")).toBe(false);
    expect(valuesDiffer("occurredAt", "2026-09-17T10:00:00.000Z", "2026-09-17T10:10:00.000Z")).toBe(true);
    expect(valuesDiffer("title", "A", "A")).toBe(false);
    expect(valuesDiffer("title", "A", "B")).toBe(true);
    expect(valuesDiffer("severity", null, "high")).toBe(true);
  });

  test("11. Provenance (confidence/source/observedAt) is carried through unchanged into the proposal draft", () => {
    const drafts = buildProposalDrafts(event({ title: "Old title" }), [
      fact({
        field: "title",
        value: "New title",
        confidence: 0.63,
        source: "original report title, edited by admin",
        observedAt: "2026-09-17T09:30:00.000Z",
      }),
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.confidence).toBe(0.63);
    expect(drafts[0]!.source).toBe("original report title, edited by admin");
    expect(drafts[0]!.observedAt.toISOString()).toBe("2026-09-17T09:30:00.000Z");
  });
});
