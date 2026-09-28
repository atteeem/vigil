import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/db/client";
import { matchConflict } from "@/lib/ingestion/conflict-match";
import { deriveReadinessSnapshot, applyDuplicateSignal, AMBIGUOUS_MATCH_CEILING } from "@/lib/ingestion/publish-readiness";
import type { DraftSuggestionDTO } from "@/lib/types/db";

// Backlog Triage & Safe Publication v1 — deterministic coverage for the central conflict-matching evidence
// model (lib/ingestion/conflict-match.ts) and the readiness/classification derivation it feeds
// (lib/ingestion/publish-readiness.ts). Same rationale as tests/extract-facts.spec.ts: no DOM dependency,
// exercised directly. Needs the migrated+seeded dev/test DB for real conflict rows (same precondition
// every other test in this file's family already relies on).

async function makeSource(overrides: { name: string }): Promise<string> {
  const s = await prisma.source.create({
    data: {
      name: overrides.name,
      type: "manual",
      url: `https://example-test-source.invalid/${overrides.name.replace(/\s+/g, "-").toLowerCase()}`,
      autoIngest: false,
      autoProcessing: true,
      enabled: true,
    },
  });
  return s.id;
}

test.describe("Central conflict-matching evidence model (lib/ingestion/conflict-match.ts)", () => {
  test("1. Country mention alone does not imply a conflict", async () => {
    const sourceId = await makeSource({ name: "Generic Wire (bare country test)" });
    const result = await matchConflict({
      title: "Ukraine signs new grain export deal with EU partners",
      bodyText: "The agreement covers logistics and financing for agricultural exports over the next three years.",
      countryCode: "UA",
      eventType: "other",
      sourceId,
    });
    expect(result.conflictId).toBeNull();
    expect(result.matchConfidence).toBe(0);
    expect(result.matchReasons[0]).toContain("country name alone is never enough");
  });

  test("2. Explicit conflict evidence does imply a conflict", async () => {
    const sourceId = await makeSource({ name: "Generic Wire (explicit alias test)" });
    const result = await matchConflict({
      title: "Officials describe worsening conditions in the war in Ukraine",
      bodyText: "Humanitarian groups say the war in Ukraine has displaced millions of civilians this year.",
      countryCode: "UA",
      eventType: "other",
      sourceId,
    });
    expect(result.conflictId).not.toBeNull();
    expect(result.matchConfidence).toBeGreaterThanOrEqual(0.8);
    expect(result.matchReasons[0]).toContain("explicit conflict name/alias");
  });

  test("3. A conflict actor named with a conflict-relevant event type is strong evidence", async () => {
    const sourceId = await makeSource({ name: "Generic Wire (actor test)" });
    const result = await matchConflict({
      title: "Ukrainian forces intercept drone over Kyiv region",
      bodyText: "Air defense units destroyed the drone before it reached its target, officials said.",
      countryCode: "UA",
      eventType: "drone",
      sourceId,
    });
    expect(result.conflictId).not.toBeNull();
    expect(result.matchConfidence).toBeGreaterThanOrEqual(0.8);
    expect(result.matchReasons[0]).toContain("ukrainian forces");
  });

  test("4. A conflict's own dedicated source behaves as weak-but-real evidence", async () => {
    const conflict = await prisma.conflict.findFirst({ where: { slug: "russia-ukraine" } });
    expect(conflict).not.toBeNull();
    const sourceId = await makeSource({ name: "Dedicated Ukraine Outlet (test)" });
    await prisma.sourceConflictLink.create({ data: { sourceId, conflictId: conflict!.id, scope: "dedicated" } });

    const result = await matchConflict({
      title: "Ukraine's central bank holds interest rates steady",
      bodyText: "Analysts had expected no change ahead of next month's policy meeting.",
      countryCode: "UA",
      eventType: "other",
      sourceId,
    });
    // Real finding from this milestone's sample audit: a dedicated source's own non-conflict content
    // still gets linked (it's genuinely the weakest evidence tier) but must never clear the "high
    // confidence" band alone — readiness (test 6 below) is what keeps this out of auto-publish.
    expect(result.conflictId).toBe(conflict!.id);
    expect(result.matchConfidence).toBeLessThan(AMBIGUOUS_MATCH_CEILING);
    expect(result.matchReasons[0]).toContain("dedicated source");
  });

  test("5. A generic business article from a NON-dedicated source stays country-level", async () => {
    const sourceId = await makeSource({ name: "Generic Business Wire (test)" });
    const result = await matchConflict({
      title: "Ukraine's central bank holds interest rates steady",
      bodyText: "Analysts had expected no change ahead of next month's policy meeting.",
      countryCode: "UA",
      eventType: "other",
      sourceId,
    });
    expect(result.conflictId).toBeNull();
  });

  test("6. Match reasons are always populated, whether linked or not", async () => {
    const sourceId = await makeSource({ name: "Generic Wire (reasons test)" });
    const linked = await matchConflict({ title: "War in Ukraine escalates", bodyText: "", countryCode: "UA", eventType: "other", sourceId });
    const unlinked = await matchConflict({ title: "Ukraine hosts trade summit", bodyText: "", countryCode: "UA", eventType: "other", sourceId });
    expect(linked.matchReasons.length).toBeGreaterThan(0);
    expect(unlinked.matchReasons.length).toBeGreaterThan(0);
  });

  test("7. A single bare place name in a conflict's own name/alias is not strong evidence", async () => {
    // Real false positive found in this milestone's own sample audit: "Libya" and "Haiti gang
    // conflict" are literally named after their country, so a naive substring match on conflict.name/
    // shortName treated an NFL sports tribute and a football story as high-confidence conflict events
    // purely because they said "Gaza"/"Haiti". Multi-word aliases must still work.
    const libya = await prisma.conflict.findFirst({ where: { slug: "libya" } });
    expect(libya).not.toBeNull();
    const sourceId = await makeSource({ name: "Generic Wire (bare alias test)" });
    const result = await matchConflict({
      title: "Spanish ambassador visits cultural exhibition in Libya",
      bodyText: "The exhibition showcases centuries of Libyan craftsmanship.",
      countryCode: "LY",
      eventType: "other",
      sourceId,
    });
    expect(result.matchConfidence).toBeLessThan(0.8);
  });
});

test.describe("Publish readiness derivation (lib/ingestion/publish-readiness.ts)", () => {
  function draft(overrides: Partial<DraftSuggestionDTO>): DraftSuggestionDTO {
    return {
      eventType: "other",
      countryCode: "UA",
      countryName: "Ukraine",
      region: "Europe",
      locationName: "Ukraine",
      latitude: null,
      longitude: null,
      conflictId: null,
      conflictName: null,
      conflictMatchConfidence: 0,
      conflictMatchReasons: [],
      title: "A usable headline",
      titleSource: "source_title",
      summary: "A usable summary.",
      summarySource: "source_excerpt",
      verificationStatus: "reported",
      importance: 50,
      severity: "elevated",
      locationSource: "none",
      locationPrecision: "country",
      locationScope: "country",
      city: null,
      adminRegion: null,
      locationEvidence: "Country named in the headline.",
      locationEvidenceSource: "lead",
      locationCandidates: [],
      duplicates: [],
      ...overrides,
    };
  }

  test("8. Ambiguous conflict match routes to NEEDS_REVIEW, not READY", () => {
    const d = draft({ conflictId: "conflict-1", conflictName: "Test Conflict", conflictMatchConfidence: 0.45, conflictMatchReasons: ["dedicated source"] });
    const result = deriveReadinessSnapshot({ draft: d, hasOriginalText: true, sourceMissing: false, sourceUrl: "https://example.com/a", sourceAutoProcessing: true, source: {} });
    expect(result.readiness).toBe("NEEDS_REVIEW");
    expect(result.classification).toBe("CONFLICT_EVENT");
  });

  test("9. Strong conflict match is eligible for READY", () => {
    const d = draft({ conflictId: "conflict-1", conflictName: "Test Conflict", conflictMatchConfidence: 0.85, conflictMatchReasons: ["explicit alias"] });
    const result = deriveReadinessSnapshot({ draft: d, hasOriginalText: true, sourceMissing: false, sourceUrl: "https://example.com/a", sourceAutoProcessing: true, source: {} });
    expect(result.readiness).toBe("READY");
    expect(result.classification).toBe("CONFLICT_EVENT");
  });

  test("10. Country-level development with no coordinates is READY — a conflict is never required", () => {
    const d = draft({ conflictId: null, locationScope: "country", latitude: null, longitude: null });
    const result = deriveReadinessSnapshot({ draft: d, hasOriginalText: true, sourceMissing: false, sourceUrl: "https://example.com/a", sourceAutoProcessing: true, source: {} });
    expect(result.readiness).toBe("READY");
    expect(result.classification).toBe("COUNTRY_DEVELOPMENT");
  });

  test("11. No usable title/text is BLOCKED as INSUFFICIENT", () => {
    const noTitle = draft({ titleSource: "none" });
    const r1 = deriveReadinessSnapshot({ draft: noTitle, hasOriginalText: true, sourceMissing: false, sourceUrl: "https://example.com/a", sourceAutoProcessing: true, source: {} });
    expect(r1).toEqual({ classification: "INSUFFICIENT", readiness: "BLOCKED", reasons: ["no usable headline"] });
  });

  test("12. A live high-likelihood duplicate always downgrades to BLOCKED", () => {
    const readySnapshot = deriveReadinessSnapshot({ draft: draft({}), hasOriginalText: true, sourceMissing: false, sourceUrl: "https://example.com/a", sourceAutoProcessing: true, source: {} });
    expect(readySnapshot.readiness).toBe("READY");
    const final = applyDuplicateSignal(readySnapshot, "high");
    expect(final.readiness).toBe("BLOCKED");
    expect(final.classification).toBe("DUPLICATE");
  });

  test("13. A medium-likelihood duplicate downgrades READY to NEEDS_REVIEW, never upgrades", () => {
    const readySnapshot = deriveReadinessSnapshot({ draft: draft({}), hasOriginalText: true, sourceMissing: false, sourceUrl: "https://example.com/a", sourceAutoProcessing: true, source: {} });
    const final = applyDuplicateSignal(readySnapshot, "medium");
    expect(final.readiness).toBe("NEEDS_REVIEW");
    const alreadyBlocked = applyDuplicateSignal({ classification: "INSUFFICIENT", readiness: "BLOCKED", reasons: [] }, "low");
    expect(alreadyBlocked.readiness).toBe("BLOCKED");
  });

  test("14. A party/aligned claim is classified PARTY_CLAIM and always needs review", () => {
    const d = draft({ conflictId: "conflict-1", conflictName: "Test Conflict", conflictMatchConfidence: 0.9, conflictMatchReasons: ["explicit alias"] });
    const result = deriveReadinessSnapshot({ draft: d, hasOriginalText: true, sourceMissing: false, sourceUrl: "https://example.com/a", sourceAutoProcessing: true, source: { claimPolicy: "party_claim" } });
    expect(result.classification).toBe("PARTY_CLAIM");
    expect(result.readiness).toBe("NEEDS_REVIEW");
  });
});
