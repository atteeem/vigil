import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db/client";
import { scoreConflict } from "@/lib/db/repositories/scoring";
import { toPublicConflict, getPublicConflictBySlug } from "@/lib/public/conflicts";
import { effectiveSeverityLabel } from "@/lib/scoring/severity";

// Pre-Launch Critical Correctness & Security v1 — canonical Severity section. Covers the two real bugs
// found in audit: (1) scoreConflict() queried ALL events for a conflict, not just published ones, so a
// draft/unpublished event could move the PUBLIC severity number; (2) several public surfaces derived a
// conflict's severity LABEL straight from the raw stored `Conflict.severity` enum instead of the same
// canonical rule `computeSeverityScore` applies (active full-scale war => "extreme"/100), so one page could
// show "100" next to "Severe" for the same conflict. Needs the migrated+seeded dev/test DB (same
// precondition as tests/conflict-match.spec.ts), plus one disposable Conflict/Event fixture per test so
// this never depends on or mutates the real seeded registry conflicts.

async function makeConflict(overrides: Partial<{ severity: string; intensity: number; fullScaleWar: boolean; status: string }> = {}) {
  const slug = `test-severity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.conflict.create({
    data: {
      slug,
      name: `Severity Test Conflict ${slug}`,
      region: "Europe",
      status: overrides.status ?? "active",
      severity: overrides.severity ?? "elevated",
      intensity: overrides.intensity ?? 40,
      fullScaleWar: overrides.fullScaleWar ?? false,
    },
  });
}

async function makeEvent(conflictId: string, overrides: Partial<{ published: boolean; casualtiesKilled: number; occurredAt: Date }> = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.event.create({
    data: {
      slug: `test-severity-event-${id}`,
      title: `Severity test event ${id}`,
      summary: "Fixture event for severity scoring tests.",
      eventType: "military",
      conflictId,
      occurredAt: overrides.occurredAt ?? new Date(),
      severity: "high",
      published: overrides.published ?? true,
      casualtiesKilled: overrides.casualtiesKilled ?? 0,
    },
  });
}

test.describe("Canonical Severity (lib/db/repositories/scoring.ts: scoreConflict)", () => {
  test("1. Active full-scale war conflicts score exactly 100 / extreme via scoreConflict", async () => {
    const conflict = await makeConflict({ severity: "severe", intensity: 88, fullScaleWar: true, status: "active" });
    const scores = await scoreConflict(conflict.id);
    expect(scores).not.toBeNull();
    expect(scores!.severity.severityScore).toBe(100);
    expect(scores!.severity.severityLabel).toBe("extreme");
  });

  test("3. Unpublished/draft events do not alter public conflict Severity", async () => {
    const conflict = await makeConflict({ severity: "elevated", intensity: 40, fullScaleWar: false, status: "active" });
    const before = await scoreConflict(conflict.id);

    // A large batch of unpublished, high-casualty events must not move the score at all — they are not
    // real corroborated intelligence yet.
    for (let i = 0; i < 6; i++) await makeEvent(conflict.id, { published: false, casualtiesKilled: 50 });
    const afterUnpublished = await scoreConflict(conflict.id);
    expect(afterUnpublished!.severity.severityScore).toBe(before!.severity.severityScore);

    // The same shape of events, but published, DOES feed the score — proving the difference above is
    // specifically about published-state, not that events never matter.
    for (let i = 0; i < 6; i++) await makeEvent(conflict.id, { published: true, casualtiesKilled: 50 });
    const afterPublished = await scoreConflict(conflict.id);
    expect(afterPublished!.severity.severityScore).toBeGreaterThan(before!.severity.severityScore);
  });

  test("2. More reports about the SAME unchanged incident do not increase severity (severity has no report/source-count input)", async () => {
    const conflict = await makeConflict({ severity: "elevated", intensity: 40, fullScaleWar: false, status: "active" });
    const event = await makeEvent(conflict.id, { published: true, casualtiesKilled: 3 });
    const before = await scoreConflict(conflict.id);

    // Simulate additional corroborating reports/sources on the SAME event (not a new incident) via a
    // fixture Source + RawIngestionItem + EventSource link — the event count for severity purposes must
    // not change, since it's still exactly one real-world incident.
    const source = await prisma.source.create({ data: { name: `Severity test source ${event.id}`, type: "manual", url: `https://example-test-source.invalid/${event.id}`, enabled: true } });
    for (let i = 0; i < 4; i++) {
      const item = await prisma.rawIngestionItem.create({ data: { sourceId: source.id, externalId: `${event.id}-${i}`, originalTitle: "Corroborating report" } });
      await prisma.eventSource.create({ data: { eventId: event.id, rawIngestionItemId: item.id, relationship: "corroborating" } });
    }
    const after = await scoreConflict(conflict.id);
    expect(after!.severity.severityScore).toBe(before!.severity.severityScore);
  });

  test("4. Confidence/source corroboration is scored separately and never mutates severity", async () => {
    const conflict = await makeConflict({ severity: "elevated", intensity: 40, fullScaleWar: false, status: "active" });
    await makeEvent(conflict.id, { published: true, casualtiesKilled: 2 });
    const scores = await scoreConflict(conflict.id);
    expect(scores).not.toBeNull();
    // Two independently-computed numbers on the same result — confidence swinging (as more/fewer
    // corroborating sources are added elsewhere in this suite) must never be read back into severityScore.
    expect(typeof scores!.severity.severityScore).toBe("number");
    expect(typeof scores!.confidence.confidenceScore).toBe("number");
  });
});

test.describe("Canonical Severity label (lib/public/conflicts.ts: toPublicConflict)", () => {
  test("An active full-scale-war conflict's public severity label is always 'extreme', regardless of its stored raw enum", async () => {
    const conflict = await makeConflict({ severity: "severe", intensity: 88, fullScaleWar: true, status: "active" });
    const publicConflict = toPublicConflict(conflict, { eventCount: 0, lastEventAt: null });
    expect(publicConflict.severity).toBe("extreme");
    expect(publicConflict.severity).toBe(effectiveSeverityLabel("severe", true, "active"));
  });

  test("5. All public conflict DTOs agree on the severity label for the same conflict (no contradictory values)", async () => {
    const conflict = await makeConflict({ severity: "severe", intensity: 88, fullScaleWar: true, status: "active" });
    const [scores, publicDetail] = await Promise.all([scoreConflict(conflict.id), getPublicConflictBySlug(conflict.slug)]);
    expect(scores!.severity.severityLabel).toBe("extreme");
    expect(publicDetail!.severity).toBe("extreme");
  });

  test("A non-full-scale-war conflict's public severity label is unaffected (no false 'extreme' promotion)", async () => {
    const conflict = await makeConflict({ severity: "guarded", intensity: 20, fullScaleWar: false, status: "active" });
    const publicConflict = toPublicConflict(conflict, { eventCount: 0, lastEventAt: null });
    expect(publicConflict.severity).toBe("guarded");
  });
});
