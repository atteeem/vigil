import { test, expect } from "@playwright/test";
import { slugForAlias, slugsMatchingAlias } from "@/lib/conflicts/resolve";
import { conflictConfidence } from "@/lib/db/repositories/scoring";
import { coverageVerdict } from "@/lib/sources/coverage-verdict";
import type { ConflictIntelligence } from "@/lib/conflicts/intelligence";

// Conflict Intelligence Page v2: one aggregation (GET /api/conflict/[id]/intelligence), canonical routing, three
// separate scores, evidence / corroboration on the canonical model, fighting geography vs belligerents vs supporters,
// territorial datasets by type, country links, and the mobile order. Fixtures are written through Prisma so the
// evidence shapes are exact.

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ago = (h: number) => new Date(Date.now() - h * 3_600_000);

// ---------------------------------------------------------------------------------------------------------------
test.describe("Conflict v2 rules (pure)", () => {
  test("curated aliases resolve to the one canonical slug; search matches aliases by word", () => {
    expect(slugForAlias("Ukraine war")).toBe("russia-ukraine");
    expect(slugForAlias("russo-ukrainian war")).toBe("russia-ukraine");
    expect(slugForAlias("SAF-RSF war")).toBe("sudan");
    expect(slugForAlias("Mexican drug war")).toBe("mexico-cartel");
    expect(slugForAlias("nothing like this")).toBeUndefined();
    expect(slugsMatchingAlias("gaza").map((a) => a.slug)).toContain("israel-palestine");
    expect(slugsMatchingAlias("ga")).toEqual([]); // too short to match anything
  });

  const src = (id: string, over: Record<string, string | null> = {}) => ({ id, sourceRole: null, independenceClass: "independent_standard", claimPolicy: null, perspective: null, sourceCategory: "News", type: "rss", ...over });
  const ev = (sources: { id: string; url: string | null; relay?: boolean; over?: Record<string, string | null> }[]) => ({ occurredAt: ago(1), sources: sources.map((s) => ({ relationship: s.relay ? "relay" : "originating", rawIngestionItem: { originalUrl: s.url, publishedAt: ago(1), receivedAt: ago(1), source: src(s.id, s.over) } })) });

  test("conflict confidence uses independence groups, not event count: many single-source incidents never read as 'multiple independent sources'", () => {
    const single = Array.from({ length: 40 }, (_, i) => ev([{ id: `o${i % 3}`, url: `https://n.test/${i}` }]));
    const many = conflictConfidence(single);
    expect(many.reasons.join(" ")).not.toMatch(/Multiple independent sources/);
    expect(many.reasons[0]).toBe("0 of 40 incidents in 90 days corroborated by 2+ independent source groups");
    const corroborated = conflictConfidence(Array.from({ length: 5 }, (_, i) => ev([{ id: "a", url: `https://a.test/${i}` }, { id: "b", url: `https://b.test/${i}` }, { id: "c", url: `https://c.test/${i}` }])));
    expect(corroborated.confidenceScore).toBeGreaterThan(many.confidenceScore);
    // A syndicated copy (same article URL) and a relay add nothing; a party claim is not independent.
    const copies = conflictConfidence([ev([{ id: "a", url: "https://a.test/x" }, { id: "b", url: "https://a.test/x" }, { id: "c", url: "https://c.test/x", relay: true }])]);
    expect(copies.reasons[0]).toMatch(/^0 of 1/);
    const party = conflictConfidence([ev([{ id: "m", url: "https://mod.test/1", over: { independenceClass: "official_military", claimPolicy: "party_claim" } }])]);
    expect(party.reasons[0]).toMatch(/No independent source/);
  });

  test("source coverage verdict: GOOD / LIMITED / STALE by stated rules; a source count is not confidence", () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - 3_600_000);
    const old = new Date(now.getTime() - 100 * 3_600_000);
    const s = (id: string, dedicated: boolean, last: Date | null, cls = "independent_standard") => ({ id, dedicated, independenceClass: cls, lastSuccessfulIngestion: last });
    expect(coverageVerdict("X", [s("a", true, fresh), s("b", true, fresh)], { now, staleHours: 48 }).state).toBe("GOOD");
    expect(coverageVerdict("X", [s("a", true, fresh), s("b", true, fresh)], { now, staleHours: 48, gaps: 1 }).state).toBe("LIMITED");
    expect(coverageVerdict("X", [s("a", true, fresh), s("b", true, fresh, "state_media")], { now, staleHours: 48 }).state).toBe("LIMITED"); // party source is not independent
    expect(coverageVerdict("X", [s("g", false, fresh)], { now, staleHours: 48 }).state).toBe("LIMITED");
    expect(coverageVerdict("X", [s("a", true, old), s("g", false, old)], { now, staleHours: 48 }).state).toBe("STALE");
    expect(coverageVerdict("X", Array.from({ length: 30 }, (_, i) => s(`g${i}`, false, fresh)), { now, staleHours: 48 }).state).toBe("LIMITED"); // many global outlets still is not GOOD
  });
});

// ---------------------------------------------------------------------------------------------------------------
test.describe.serial("Conflict intelligence API and page", () => {
  let slug = "";
  let conflictId = "";
  const tag = uid();

  test.beforeAll(async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    // Lesotho fighting (borders South Africa only); Norway a belligerent, Sweden an external supporter.
    const c = (await request.post("/api/admin/conflicts", { data: { slug: `ci2-${tag}`, name: `CI2 Lesotho War ${tag}`, region: "Africa", status: "active", severity: "extreme", intensity: 95, lat: -29.6, lng: 28.2, fightingCountries: ["LS"], participantCountries: ["LS", "NO"], supporterCountries: ["SE"], fullScaleWar: true } }).then((r) => r.json())) as { id: string; slug: string };
    slug = c.slug;
    conflictId = c.id;
    const mk = (name: string, cls: string, claim: string | null = null) => prisma.source.create({ data: { name: `CI2 ${name} ${tag}`, type: "manual", independenceClass: cls, claimPolicy: claim, enabled: true } });
    const [wireA, wireB, mod] = await Promise.all([mk("Wire A", "independent_standard"), mk("Wire B", "independent_high"), mk("MoD", "official_military", "party_claim")]);
    const item = (sourceId: string, title: string, url: string | null) => prisma.rawIngestionItem.create({ data: { sourceId, externalId: `ci2-${uid()}`, originalTitle: title, originalText: title, originalUrl: url, publishedAt: ago(2), processingStatus: "published" } });
    const event = (title: string, over: Record<string, unknown>) => prisma.event.create({ data: { slug: `ci2-${uid()}`, title, summary: title, eventType: "artillery", occurredAt: ago(2), severity: "severe", importance: 80, published: true, publishedAt: ago(2), conflictId: c.id, countryCode: "LS", region: "Africa", ...over } });
    const link = (eventId: string, rawIngestionItemId: string, relationship = "originating") => prisma.eventSource.create({ data: { eventId, rawIngestionItemId, relationship, isOriginatingSource: relationship !== "relay" } });

    // Corroborated incident: two independent outlets + a syndicated copy of A's article (same URL) -> 2 groups.
    const e1 = await event(`CI2 shelling near Maseru ${tag}`, { latitude: -29.31, longitude: 27.48, locationScope: "city", city: "Maseru", locationPrecision: "city" });
    const a1 = await item(wireA.id, "Shelling near Maseru", "https://wire-a.test/maseru");
    const b1 = await item(wireB.id, "Maseru shelled", "https://wire-b.test/maseru");
    const copy = await item(wireB.id, "Syndicated: shelling near Maseru", "https://wire-a.test/maseru");
    await link(e1.id, a1.id);
    await link(e1.id, b1.id, "corroborating");
    await link(e1.id, copy.id, "corroborating");
    // Figures disagree between the outlets: shown, not reconciled.
    await prisma.extractedFact.createMany({ data: [{ rawIngestionItemId: a1.id, field: "casualtiesKilled", value: "3", confidence: 0.6, source: "text", observedAt: ago(2) }, { rawIngestionItemId: b1.id, field: "casualtiesKilled", value: "7", confidence: 0.6, source: "text", observedAt: ago(2) }] });
    // Party-claim-only incident.
    const e2 = await event(`CI2 ministry claims capture ${tag}`, { latitude: -29.8, longitude: 28.0, locationScope: "point" });
    await link(e2.id, (await item(mod.id, "We captured the ridge", "https://mod.test/1")).id);
    // Country-level report: no coordinates at all.
    const e3 = await event(`CI2 national mobilisation announced ${tag}`, { latitude: null, longitude: null, locationScope: "country" });
    await link(e3.id, (await item(wireA.id, "National mobilisation", "https://wire-a.test/mob")).id);
  });

  test.afterAll(async () => {
    const { prisma } = await import("@/lib/db/client");
    await prisma.event.deleteMany({ where: { conflictId } });
    await prisma.conflict.deleteMany({ where: { id: conflictId } });
    await prisma.source.deleteMany({ where: { name: { startsWith: "CI2 " } } });
  });

  const intel = async (request: import("@playwright/test").APIRequestContext, ref: string) => (await request.get(`/api/conflict/${encodeURIComponent(ref)}/intelligence`).then((r) => r.json())) as ConflictIntelligence;

  test("canonical route: id, slug and name resolve to one record; the API aggregates every section", async ({ request }) => {
    const bySlug = await intel(request, slug);
    const byId = await intel(request, conflictId);
    expect(byId.detail.conflict.slug).toBe(slug);
    expect(bySlug.detail.conflict.id).toBe(conflictId);
    for (const k of ["scores", "currentSituation", "feed", "reportCounts", "geography", "territory", "actors", "belligerentStates", "externalSupporters", "relatedCountries", "infrastructure", "timeline", "whatChanged", "sourceCoverage", "brief"]) expect(bySlug, k).toHaveProperty(k);
    expect((await request.get("/api/conflict/no-such-thing/intelligence")).status()).toBe(404);
    expect((await intel(request, "Ukraine war")).detail.conflict.slug).toBe("russia-ukraine");
  });

  test("severity, impact and confidence stay separate; fighting geography alone sets the country floors", async ({ request }) => {
    const d = await intel(request, slug);
    expect(d.scores.severity.value).not.toBeNull();
    expect(d.scores.confidence.value).not.toBeNull();
    expect(d.scores.confidence.rollup).toMatchObject({ corroborated: 1, partyOnly: 1 });
    expect(d.scores.impact.byCountry.LS).toMatchObject({ score: 100, hardFloor: "own_country_war" });
    expect(d.scores.impact.byCountry.ZA!.score).toBeGreaterThanOrEqual(75);
    expect(d.scores.impact.byCountry.ZA!.hardFloor).toBe("bordering_war");
    // Belligerent and supporter countries get no floor.
    for (const code of ["NO", "SE"]) {
      expect(d.scores.impact.byCountry[code]!.hardFloor).toBeNull();
      expect(d.scores.impact.byCountry[code]!.score).toBeLessThan(75);
    }
    expect(d.relatedCountries.fightingInside.map((r) => r.code)).toEqual(["LS"]);
    expect(d.relatedCountries.bordering.map((r) => r.code)).toEqual(["ZA"]);
    expect([...d.relatedCountries.fightingInside, ...d.relatedCountries.bordering].some((r) => r.code === "NO" || r.code === "SE")).toBe(false);
    expect(d.geography.fighting.map((c) => c.code)).toEqual(["LS"]);
    expect(d.belligerentStates.map((c) => c.code)).toContain("NO");
    expect(d.externalSupporters.map((c) => c.code)).toEqual(["SE"]);
    expect(d.currentSituation.some((l) => /Classified as a full-scale war in Lesotho/.test(l))).toBe(true);
  });

  test("evidence: independence groups, syndicated copies not counted, party claims flagged, disagreement shown, unique report counts", async ({ request }) => {
    const d = await intel(request, slug);
    const corroborated = d.feed.find((f) => f.title.startsWith("CI2 shelling near Maseru"))!;
    expect(corroborated.evidence).toMatchObject({ independentSources: 2, partyClaims: 0 });
    expect(corroborated.evidence!.dependentRepeats).toBeGreaterThanOrEqual(1); // the syndicated copy
    expect(corroborated.reportCount).toBe(3); // unique published reports, copies included as reports
    expect(corroborated.locationScope).toBe("city");
    expect(corroborated.disagreements[0]).toMatchObject({ field: "casualtiesKilled" });
    expect(corroborated.disagreements[0]!.values.map((v) => v.value).sort()).toEqual(["3", "7"]);
    const claim = d.feed.find((f) => f.title.startsWith("CI2 ministry claims capture"))!;
    expect(claim.isPartyClaim).toBe(true);
    expect(claim.reports[0]!.evidenceRole).toMatch(/party claim/);
    const countryLevel = d.feed.find((f) => f.title.startsWith("CI2 national mobilisation"))!;
    expect(countryLevel.locationScope).toBe("country");
    expect(countryLevel.mapHref).toMatch(/country=LS/);
    expect(countryLevel.mapHref).not.toMatch(/event=/); // no invented point
    // The page's report counts are the canonical aggregate (/api/report-counts), unique reports only.
    const canonical = (await request.get("/api/report-counts?window=7D").then((r) => r.json())) as { conflicts: Record<string, number> };
    expect(d.reportCounts["7D"]).toBe(canonical.conflicts[conflictId]);
    expect(d.reportCounts["7D"]).toBe(5); // 3 + 1 + 1 unique raw reports
  });

  test("timeline and what-changed come from state changes and recorded incidents, not article volume", async ({ request }) => {
    const d = await intel(request, slug);
    expect(d.timeline.some((t) => t.kind === "geography" && /First recorded incident in Lesotho/.test(t.title))).toBe(true);
    expect(d.timeline.some((t) => t.kind === "incident" && t.title.startsWith("CI2 shelling near Maseru"))).toBe(true); // corroborated severe incident
    expect(d.timeline.some((t) => t.title.startsWith("CI2 ministry claims"))).toBe(false); // an uncorroborated claim is not a milestone
    const day = d.whatChanged.find((w) => w.window === "24h")!;
    expect(day.items.some((i) => i.kind === "new fighting geography")).toBe(true);
    expect(day.items.some((i) => i.kind === "corroborated incident")).toBe(true);
    expect(d.territory.datasets).toEqual([]);
    expect(["GOOD", "LIMITED", "STALE"]).toContain(d.sourceCoverage.state);
  });

  test("page: header scores, situation, evidence feed with party filtering, territory empty state, country links", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vigil-preferences", JSON.stringify({ state: { baseCountryCode: "ZA" }, version: 3 })));
    await page.goto(`/conflict/${conflictId}`); // an id redirects to the canonical slug
    await expect(page).toHaveURL(new RegExp(`/conflict/${slug}$`), { timeout: 90_000 });
    await expect(page.getByTestId("score-severity-value")).toBeVisible();
    await expect(page.getByTestId("score-impact-value")).toHaveText(/^7[5-9]|^[89]\d/); // South Africa borders Lesotho: >= 75
    await expect(page.getByTestId("score-confidence")).toBeVisible();
    await expect(page.getByTestId("current-situation")).toContainText("full-scale war in Lesotho");
    const feed = page.getByTestId("conflict-feed");
    await expect(feed.getByTestId("feed-item").filter({ hasText: "CI2 shelling near Maseru" })).toBeVisible();
    await expect(feed.getByTestId("feed-item").filter({ hasText: "CI2 ministry claims capture" })).toHaveCount(0); // party claim hidden by default
    await expect(feed.getByTestId("feed-hidden-claims")).toContainText("1 party / aligned claim");
    const row = feed.getByTestId("feed-item").filter({ hasText: "CI2 shelling near Maseru" });
    await expect(row.getByTestId("feed-contested")).toBeVisible();
    await row.getByTestId("feed-evidence-toggle").click();
    await expect(row.getByTestId("corroboration-groups")).toHaveText("2");
    await expect(row.getByTestId("feed-disagreement")).toContainText("Sources disagree on reported killed");
    await expect(row.getByTestId("evidence-group-strong")).toContainText(`CI2 Wire B ${tag}`);
    await expect(feed.getByTestId("feed-item").filter({ hasText: "CI2 national mobilisation" }).getByTestId("feed-scope")).toContainText("country-level");
    await expect(page.getByTestId("territory-empty")).toContainText("No verified territorial dataset available.");
    await expect(page.getByTestId("geo-fighting").getByTestId("geo-country-link")).toHaveAttribute("href", "/country/LS");
    await expect(page.getByTestId("geo-supporters")).toContainText("Sweden");
    await expect(page.getByTestId("header-open-world")).toHaveAttribute("href", new RegExp(`conflict=${slug}`));
  });

  test("party claims appear, labelled, when the setting is on", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vigil-preferences", JSON.stringify({ state: { showPartyClaims: true }, version: 3 })));
    await page.goto(`/conflict/${slug}`);
    const claim = page.getByTestId("conflict-feed").getByTestId("feed-item").filter({ hasText: "CI2 ministry claims capture" });
    await expect(claim).toContainText("PARTY CLAIM", { timeout: 90_000 });
  });

  test("country page conflict rows link into the conflict page; the conflict links back to the country", async ({ page }) => {
    await page.goto("/country/LS");
    const link = page.getByTestId("conflicts-domestic").locator(`a[href="/conflict/${slug}"]`).filter({ visible: true }).first();
    await expect(link).toBeVisible({ timeout: 90_000 });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/conflict/${slug}$`));
    await page.getByTestId("geo-fighting").getByTestId("geo-country-link").first().click();
    await expect(page).toHaveURL(/\/country\/LS$/);
  });

  test("mobile: header, situation, developments, map, actors and territory come first; no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/conflict/${slug}`);
    await expect(page.getByTestId("conflict-name")).toBeVisible({ timeout: 90_000 });
    const tops = await page.evaluate(() => ["conflict-name", "section-situation", "section-events", "section-map", "section-actors", "section-territory", "section-what-changed", "section-timeline"].map((id) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top));
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("section-timeline").evaluate((el) => (el as HTMLDetailsElement).open)).resolves.toBe(false); // secondary: collapsed on phones
  });

  test("search resolves aliases to the canonical conflict page", async ({ request }) => {
    const hits = (await request.get("/api/public/search?q=Ukraine%20war").then((r) => r.json())) as { type: string; href: string }[];
    expect(hits.find((h) => h.type === "conflict")?.href).toBe("/conflict/russia-ukraine");
  });
});

