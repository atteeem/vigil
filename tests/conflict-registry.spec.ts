import { test, expect } from "@playwright/test";
import { ACTOR_REGISTRY, canonicalizeActor, findAmbiguousAliases, resolveActorName } from "@/lib/actors/registry";
import { REGISTRY_CONFLICTS, REGISTRY_FAMILIES, familyMembers, registryEntry } from "@/lib/registry/conflict-registry";
import { conflictGeographyOf, geographyIssues, geographyRole, parseCodes } from "@/lib/registry/geography";
import { COVERAGE_THRESHOLDS, classifySource, computeCoverage, summarizeCoverage, type CoverageSource } from "@/lib/registry/coverage";
import { normalizeConflictStatus } from "@/lib/registry/status";
import { computeImpact, getCountryByCode, MOCK_CONFLICTS } from "@/lib/data";

// Global Conflict Registry: geography (fighting vs participants vs supporters),
// families, central actor aliases and coverage health. Pure tests — no server.

const REQUIRED = [
  "russia-ukraine", "sudan", "israel-palestine", "israel-lebanon", "persian-gulf-iran", "myanmar", "drc", "yemen-red-sea", "syria", "somalia",
  "sahel", "burkina-faso", "niger", "afghanistan-pakistan", "haiti", "mexico-cartel", "nigeria-insurgencies", "ethiopia", "colombia", "ecuador",
  "philippines-insurgencies", "india-pakistan", "northeast-india", "kurdish-turkey-pkk", "kurdish-iran", "kurdish-syria-sdf", "central-african-republic", "libya", "cameroon", "armenia-azerbaijan",
];

test.describe("Registry data", () => {
  test("covers every conflict the audit had to evaluate, with unique slugs and no asserted global total", () => {
    const slugs = REGISTRY_CONFLICTS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of REQUIRED) expect(slugs, slug).toContain(slug);
    // The registry never states "N active conflicts worldwide" anywhere.
    expect(JSON.stringify(REGISTRY_CONFLICTS)).not.toMatch(/\b46 (active )?conflicts\b/i);
  });

  test("every entry carries geography, classification and a valid status; tensions are recorded as uncertain instead of forced into 'active armed conflict'", () => {
    for (const c of REGISTRY_CONFLICTS) {
      expect(c.classification.note.length, c.slug).toBeGreaterThan(10);
      expect(["established", "uncertain", "disputed"]).toContain(c.classification.confidence);
      expect(c.participantCountries.length, `${c.slug} participants`).toBeGreaterThan(0);
      if (c.status) expect(["active", "reduced", "dormant", "ended"]).toContain(c.status);
    }
    for (const slug of ["korean-peninsula", "taiwan-strait", "armenia-azerbaijan"]) {
      const c = registryEntry(slug)!;
      expect(c.fightingCountries, slug).toEqual([]); // no fighting venue -> no scoring floor
      expect(c.classification.confidence).toBe("uncertain");
      expect(c.status).toBe("dormant");
    }
  });

  test("fighting geography is separate from participants and supporters", () => {
    const ru = registryEntry("russia-ukraine")!;
    expect(ru.fightingCountries).toEqual(["UA", "RU"]);
    expect(ru.supporterCountries).toContain("US");
    for (const supporter of ru.supporterCountries) expect(ru.fightingCountries).not.toContain(supporter);

    // DRC: Rwanda is a participant (alleged M23 backer) but the fighting is inside the DRC only.
    const drc = registryEntry("drc")!;
    expect(drc.participantCountries).toContain("RW");
    expect(drc.fightingCountries).toEqual(["CD"]);
    // Iran-Israel: Saudi Arabia is not a fighting country.
    expect(registryEntry("persian-gulf-iran")!.fightingCountries).not.toContain("SA");
    // Yemen/Red Sea: Israel, US, UK participate; only Yemen is a venue.
    const ye = registryEntry("yemen-red-sea")!;
    expect(ye.participantCountries).toEqual(expect.arrayContaining(["IL", "US", "GB"]));
    expect(ye.fightingCountries).toEqual(["YE"]);
  });

  test("conflict families link related conflicts without collapsing them", () => {
    const sahel = familyMembers("sahel-insurgency").map((c) => c.slug).sort();
    expect(sahel).toEqual(["burkina-faso", "niger", "sahel"]);
    // Each member keeps its own fighting geography.
    expect(sahel.map((s) => registryEntry(s)!.fightingCountries[0])).toEqual(["BF", "NE", "ML"]);

    const kurdish = familyMembers("kurdish-conflicts");
    expect(kurdish).toHaveLength(3);
    expect(new Set(kurdish.map((c) => c.fightingCountries.join(","))).size).toBe(3); // distinct fronts
    for (const c of kurdish) expect(new Set(c.actors.map((a) => a.name)).size).toBeGreaterThan(1);

    const israel = familyMembers("israel-regional").map((c) => c.slug);
    expect(israel).toEqual(expect.arrayContaining(["israel-palestine", "israel-lebanon", "persian-gulf-iran"]));
    // Separately trackable: distinct records with their own statuses/geography, not one merged conflict.
    expect(new Set(israel.map((s) => registryEntry(s)!.name)).size).toBe(israel.length);
    for (const f of REGISTRY_FAMILIES) expect(familyMembers(f.slug).length, f.slug).toBeGreaterThanOrEqual(2);
  });

  test("every actor a conflict names exists in the central actor registry (no ad-hoc names)", () => {
    const known = new Set(ACTOR_REGISTRY.map((a) => a.canonical));
    for (const c of REGISTRY_CONFLICTS) for (const a of c.actors) expect(known.has(a.name), `${c.slug}: ${a.name}`).toBe(true);
  });
});

test.describe("Central actor aliases and deduplication", () => {
  test("spelling variants resolve to one canonical actor", () => {
    for (const variant of ["IDF", "Israel Defense Forces", "Israeli forces", "the Israeli military"]) expect(canonicalizeActor(variant)).toBe("Israel");
    for (const variant of ["KNDF", "Karenni Nationalities Defence Force", "Karenni Nationalities Defense Force"]) expect(canonicalizeActor(variant)).toBe("KNDF");
    for (const variant of ["Ansar Allah", "Houthis", "the Houthi"]) expect(canonicalizeActor(variant)).toBe("Houthi movement");
    for (const variant of ["RSF", "Rapid Support Forces"]) expect(canonicalizeActor(variant)).toBe("Rapid Support Forces");
    expect(canonicalizeActor("Al Shabaab")).toBe("al-Shabaab");
    expect(canonicalizeActor("Haiti's gang coalition")).toBeNull(); // unknown stays unmerged
  });

  test("country-scoped aliases: 'the junta' is the Tatmadaw only in Myanmar", () => {
    expect(canonicalizeActor("the junta", { countryCode: "MM" })).toBe("Tatmadaw");
    expect(canonicalizeActor("SAC", { countryCode: "MM" })).toBe("Tatmadaw");
    expect(canonicalizeActor("the junta", { countryCode: "ML" })).toBeNull();
    expect(canonicalizeActor("the junta")).toBeNull();
    expect(resolveActorName("Tatmadaw")).toBe("Tatmadaw");
  });

  test("no alias is ambiguous between two actors", () => {
    expect(findAmbiguousAliases()).toEqual([]);
  });
});

test.describe("Geography helpers", () => {
  test("role lookup keeps fighting, participant and supporter apart", () => {
    const geo = { fighting: ["UA", "RU"], participants: ["UA", "RU"], supporters: ["US", "IR"] };
    expect(geographyRole(geo, "ua")).toBe("fighting");
    expect(geographyRole(geo, "US")).toBe("supporter");
    expect(geographyRole(geo, "FI")).toBe("none");
    expect(geographyRole({ fighting: [], participants: ["KP"], supporters: [] }, "KP")).toBe("participant");
  });

  test("a participant-only country is not a fighting country, and missing geography is flagged only for live conflicts", () => {
    const geo = conflictGeographyOf({ fightingCountries: '["CD"]', participantCountries: '["CD","RW"]', supporterCountries: null, geographyBasis: "curated" });
    expect(geo.fighting).toEqual(["CD"]);
    expect(geo.participants).toContain("RW");
    expect(geographyRole(geo, "RW")).toBe("participant");
    expect(parseCodes("not json")).toEqual([]);
    expect(geographyIssues({ ...geo, fighting: [] }, "active").missingFighting).toBe(true);
    expect(geographyIssues({ ...geo, fighting: [] }, "dormant").missingFighting).toBe(false);
    expect(geographyIssues({ ...geo, basis: "legacy_countries" }, "active").unreviewed).toBe(true);
  });
});

const conflictBySlug = (slug: string) => MOCK_CONFLICTS.find((c) => c.slug === slug)!;

test.describe("Scoring uses fighting geography only (mock conflict data)", () => {
  test("same-country impact = 100 only where the war is fought (only war-like conflicts floor at all)", () => {
    expect(computeImpact(getCountryByCode("UA")!, conflictBySlug("russia-ukraine")).score).toBe(100);
    expect(computeImpact(getCountryByCode("IL")!, conflictBySlug("israel-palestine")).score).toBe(100);
    expect(computeImpact(getCountryByCode("SD")!, conflictBySlug("sudan")).score).toBe(100);
    // Yemen/Red Sea is not at full-scale-war severity, so even Yemen gets no hard floor from it.
    expect(computeImpact(getCountryByCode("YE")!, conflictBySlug("red-sea")).hardFloor).toBeNull();
  });

  test("an external supporter never triggers a floor", () => {
    const impact = computeImpact(getCountryByCode("US")!, conflictBySlug("russia-ukraine"));
    expect(impact.hardFloor).toBeNull();
    expect(impact.score).toBeLessThan(75);
  });

  test("the border floor is measured against fighting countries", () => {
    // Poland borders Ukraine (fighting) -> floor; Germany borders no fighting country -> none.
    expect(computeImpact(getCountryByCode("PL")!, conflictBySlug("russia-ukraine")).hardFloor).toBe("bordering_war");
    expect(computeImpact(getCountryByCode("DE")!, conflictBySlug("russia-ukraine")).hardFloor).toBeNull();
    // Egypt borders Israel and Palestine, where the fighting is.
    expect(computeImpact(getCountryByCode("EG")!, conflictBySlug("israel-palestine")).hardFloor).toBe("bordering_war");
  });

  test("a tension with no fighting venue gives no country a floor", () => {
    for (const code of ["KR", "JP", "TW", "CN"]) {
      const country = getCountryByCode(code);
      if (!country) continue;
      expect(computeImpact(country, conflictBySlug("korean-peninsula")).hardFloor, `${code}/korea`).toBeNull();
      expect(computeImpact(country, conflictBySlug("taiwan-strait")).hardFloor, `${code}/taiwan`).toBeNull();
    }
  });

  test("mock conflicts read their geography and audited status from the registry", () => {
    for (const c of MOCK_CONFLICTS) {
      const entry = REGISTRY_CONFLICTS.find((r) => r.mockSlug === c.slug)!;
      expect(entry, c.slug).toBeTruthy();
      expect(c.fightingCountryCodes).toEqual(entry.fightingCountries);
      expect(c.participantCountryCodes).toEqual(entry.participantCountries);
      expect(c.supporterCountryCodes).toEqual(entry.supporterCountries);
    }
    expect(conflictBySlug("taiwan-strait").status).toBe("dormant");
    expect(conflictBySlug("russia-ukraine").status).toBe("active");
  });
});

// ---------------------------------------------------------------------------
const NOW = new Date("2026-09-19T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const geo = { fighting: ["ZZ"], participants: ["ZZ"], supporters: [], basis: "curated" };
const src = (over: Partial<CoverageSource> & { id: string }): CoverageSource => ({ name: over.id, enabled: true, sourceRole: "originating", link: "derived", lastSuccessfulIngestion: hoursAgo(1), ...over });
const base = { status: "active", sources: [] as CoverageSource[], latestEventAt: hoursAgo(2), territorialAreas: 0, actorCount: 3, geography: geo };

test.describe("Coverage health", () => {
  test("no relevant enabled source -> no_source (a disabled source doesn't count)", () => {
    expect(computeCoverage(base, NOW).health).toBe("no_source");
    expect(computeCoverage({ ...base, sources: [src({ id: "a", enabled: false })] }, NOW).health).toBe("no_source");
  });

  test("sources that stopped ingesting -> stale, whatever their number", () => {
    const old = [src({ id: "a", lastSuccessfulIngestion: hoursAgo(24 * 10) }), src({ id: "b", lastSuccessfulIngestion: hoursAgo(24 * 9) })];
    const c = computeCoverage({ ...base, sources: old }, NOW);
    expect(c.health).toBe("stale");
    expect(c.latestSourceAt?.getTime()).toBe(hoursAgo(24 * 9).getTime());
    expect(computeCoverage({ ...base, sources: [src({ id: "a", lastSuccessfulIngestion: null })] }, NOW).health).toBe("stale");
  });

  test("many aggregator/relay sources are one independent source: weak, not healthy", () => {
    const aggregators = Array.from({ length: 6 }, (_, i) => src({ id: `agg${i}`, sourceRole: i % 2 ? "aggregator" : "relay" }));
    const c = computeCoverage({ ...base, sources: aggregators }, NOW);
    expect(c.aggregatorSources).toBe(6);
    expect(c.independentSources).toBe(1);
    expect(c.health).toBe("weak");
    expect(c.reasons.join(" ")).toMatch(/aggregators count once/);
  });

  test("healthy needs fresh ingestion, recent events and real diversity", () => {
    const good = [src({ id: "local", sourceRole: "local_media" }), src({ id: "wire", sourceRole: "originating" })];
    expect(computeCoverage({ ...base, sources: good }, NOW).health).toBe("healthy");
    // Same sources but no recent events -> weak.
    expect(computeCoverage({ ...base, sources: good, latestEventAt: hoursAgo(24 * 10) }, NOW).health).toBe("weak");
    expect(computeCoverage({ ...base, sources: good, latestEventAt: null }, NOW).reasons.join(" ")).toMatch(/No events recorded/);
    // One source only -> weak even when fresh.
    expect(computeCoverage({ ...base, sources: [good[0]!] }, NOW).health).toBe("weak");
  });

  test("a dedicated source is classified as dedicated and counts as specialised coverage", () => {
    const dedicated = src({ id: "d", link: "dedicated", sourceRole: "aggregator" });
    expect(classifySource(dedicated)).toBe("dedicated");
    const c = computeCoverage({ ...base, sources: [dedicated, src({ id: "g" })] }, NOW);
    expect(c.hasDedicatedSource).toBe(true);
    expect(c.health).toBe("healthy");
  });

  test("dormant and ended conflicts are inactive; reduced conflicts get the longer windows", () => {
    expect(computeCoverage({ ...base, status: "dormant" }, NOW).health).toBe("inactive");
    expect(computeCoverage({ ...base, status: "resolved" }, NOW).status).toBe("ended");
    expect(normalizeConflictStatus("archived")).toBe("ended");
    const week = hoursAgo(24 * 5);
    const sources = [src({ id: "a", sourceRole: "local_media", lastSuccessfulIngestion: week }), src({ id: "b", lastSuccessfulIngestion: week })];
    expect(computeCoverage({ ...base, status: "active", sources, latestEventAt: week }, NOW).health).toBe("stale");
    expect(computeCoverage({ ...base, status: "reduced", sources, latestEventAt: week }, NOW).health).toBe("healthy");
    expect(COVERAGE_THRESHOLDS.sourceFreshHours.reduced).toBeGreaterThan(COVERAGE_THRESHOLDS.sourceFreshHours.active);
  });

  test("missing metadata is flagged: no actors, no fighting geography, unreviewed legacy geography", () => {
    const c = computeCoverage({ ...base, actorCount: 0, geography: { fighting: [], participants: [], supporters: [], basis: "legacy_countries" } }, NOW);
    expect(c.flags).toEqual({ missingActors: true, missingFightingGeography: true, missingParticipants: true, unreviewedGeography: true });
    expect(computeCoverage({ ...base, status: "dormant", actorCount: 0, geography: { ...geo, fighting: [] } }, NOW).flags.missingActors).toBe(false);
  });

  test("summary counts weak/stale/no-source and 6h/24h updates over live conflicts only", () => {
    const row = (over: Partial<Parameters<typeof computeCoverage>[0]>) => ({ coverage: computeCoverage({ ...base, ...over }, NOW) });
    const good = [src({ id: "l", sourceRole: "local_media" }), src({ id: "w" })];
    const rows = [
      row({ sources: good }), // healthy, updated 1h ago
      row({ sources: [src({ id: "x", lastSuccessfulIngestion: hoursAgo(24 * 10) })], latestEventAt: hoursAgo(24 * 10) }), // stale
      row({}), // no source, but event 2h ago
      row({ status: "dormant" }),
      row({ status: "reduced", sources: good }),
    ];
    const s = summarizeCoverage(rows, NOW);
    expect(s).toMatchObject({ total: 5, activeTracked: 3, reducedTracked: 1, staleCoverage: 1, noSource: 1, weakCoverage: 0 });
    expect(s.updatedLast6h).toBe(3); // healthy, no-source (event 2h ago) and reduced; the stale one is 10d old
    expect(s.updatedLast24h).toBe(3);
  });
});
