import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { independentSourceCount } from "@/lib/data/independence";
import { rankConflictsForCountry, rankMajorConflicts, rankSignificantEvents } from "@/lib/data/priority";
import { getCountryByCode } from "@/lib/data";
import { selectHeatConflicts } from "@/lib/heat/public-inputs";
import { describeEvidence, sourceTrust, summarizeEvidence, TRUST_LABEL, type EvidenceReport } from "@/lib/sources/trust";
import { MOCK_CONFLICTS } from "@/lib/dev-fixtures/mock-conflicts";
import type { Conflict, ConflictEvent } from "@/lib/types";
import type { PublicOverview } from "@/lib/public/overview";

// Public intelligence experience: source trust labels, party-claim hiding, claims worded as
// claims, independence groups, ranking that is not popularity, and honest empty states.

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const NOW = new Date("2026-09-20T12:00:00Z").getTime();

const report = (sourceId: string, cls: Parameters<typeof sourceTrust>[0], url: string | null = `https://${sourceId}.test/${Math.random()}`, relay = false): EvidenceReport => ({ sourceId, url, trust: sourceTrust(cls), relay });

// ---------------------------------------------------------------------------
test.describe("Source trust labels", () => {
  test("stored classes map onto the three public labels; discovery and unclassified stay distinct; no raw enum is shown", () => {
    expect(sourceTrust({ independenceClass: "independent_high" }).label).toBe("Independent / Strong Verification");
    for (const c of ["independent_standard", "advocacy_independent", "international_media", "specialist_reference"]) expect(sourceTrust({ independenceClass: c }).label).toBe("Independent / Perspective");
    for (const c of ["state_media", "aligned_media", "official_government", "official_military", "representative_advocacy"]) {
      const t = sourceTrust({ independenceClass: c });
      expect(t.category).toBe("party_claim");
      expect(t.badge).toBe("PARTY CLAIM");
      expect(t.countsAsIndependent).toBe(false);
    }
    expect(sourceTrust({ independenceClass: "osint_aggregator" }).category).toBe("discovery");
    expect(sourceTrust({ independenceClass: "independent_standard", claimPolicy: "party_claim" }).category).toBe("party_claim"); // policy wins
    expect(sourceTrust({ independenceClass: "independent_high", claimPolicy: "discovery_only" }).category).toBe("discovery");
    expect(sourceTrust({ sourceRole: "aggregator" }).category).toBe("discovery");
    expect(sourceTrust({}).category).toBe("unclassified");
    expect(sourceTrust({ perspective: "  Israeli military " , independenceClass: "official_military" }).perspective).toBe("Israeli military");
    for (const label of Object.values(TRUST_LABEL)) expect(label).not.toMatch(/_/);
  });
});

test.describe("Independence groups", () => {
  test("an outlet counts once however many reports it files; the same article, relays and party claims never raise the count", () => {
    const summary = summarizeEvidence([
      report("acled", { independenceClass: "independent_high" }),
      report("acled", { independenceClass: "independent_high" }), // same outlet again
      report("hengaw", { independenceClass: "advocacy_independent" }),
      report("aljazeera", { independenceClass: "independent_standard" }, "https://aljazeera.test/a"),
      report("aljazeera2", { independenceClass: "independent_standard" }, "https://aljazeera.test/a"), // same article
      report("relayer", { independenceClass: "independent_standard" }, "https://x.test/r", true),
      report("idf", { independenceClass: "official_military", claimPolicy: "party_claim" }),
    ]);
    expect(summary).toMatchObject({ independentSources: 3, strongVerification: 1, perspectives: 2, partyClaims: 1, dependentRepeats: 3 });
    expect(describeEvidence(summary)).toBe("3 independent sources · 1 strongly verified · 2 perspectives · 1 party claim");
    expect(describeEvidence(summary, { claims: false })).not.toContain("party claim");
    const big = summarizeEvidence([
      ...["a", "b", "c", "d"].map((id) => report(id, { independenceClass: id === "a" ? "independent_high" : "independent_standard" })),
      report("p1", { claimPolicy: "party_claim" }),
    ]);
    expect(describeEvidence(big)).toBe("4 independent sources · 1 strongly verified · 3 perspectives · 1 party claim");
  });

  test("the stored event count uses the same outlet grouping", () => {
    const link = (id: string, url: string, role = "local_media", claim: string | null = null) => ({ isOriginatingSource: true, rawIngestionItem: { originalUrl: url, source: { id, sourceRole: role, claimPolicy: claim } } });
    expect(independentSourceCount([link("a", "https://a.test/1"), link("a", "https://a.test/2"), link("b", "https://b.test/1")])).toBe(2);
    expect(independentSourceCount([link("a", "https://a.test/1"), link("p", "https://p.test/1", "official", "party_claim")])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
const conflict = (over: Partial<Conflict>): Conflict => ({ ...MOCK_CONFLICTS[0]!, ...over });
const event = (over: Partial<ConflictEvent>): ConflictEvent => ({
  id: "e", slug: "e", title: "t", summary: "s", eventType: "other", lat: 0, lng: 0, countryCode: "XX", region: "Global", conflictId: null, occurredAt: new Date(NOW - 3_600_000).toISOString(),
  severity: "elevated", importance: 50, verificationStatus: "reported", disputed: false, sourceCount: 1, sources: [], timeline: [], ...over,
});
const outlets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `o${i}`, name: `O${i}`, sourceType: "News", url: `https://o${i}.test/x`, publishedAt: new Date(NOW).toISOString() })) as ConflictEvent["sources"];

test.describe("What deserves attention is not popularity", () => {
  test("major conflicts rank by severity/significance/recency; a heavily reported minor conflict does not outrank a severe one", () => {
    const severe = conflict({ id: "severe", slug: "severe", shortName: "Severe", status: "active", severity: "severe", intensity: 82, eventCount: 0, lastEventAt: null, fullScaleWar: false });
    const minor = conflict({ id: "minor", slug: "minor", shortName: "Minor", status: "active", severity: "guarded", intensity: 32, eventCount: 400, lastEventAt: new Date(NOW - 3_600_000).toISOString(), fullScaleWar: false });
    const flood = Array.from({ length: 30 }, (_, i) => event({ id: `m${i}`, conflictId: "minor", severity: "guarded", importance: 30, sources: outlets(40) }));
    const ranked = rankMajorConflicts([minor, severe], flood, NOW, 5).map((r) => r.conflict.id);
    expect(ranked).toEqual(["severe", "minor"]);
    expect(rankMajorConflicts([conflict({ id: "d", status: "dormant" })], [], NOW)).toEqual([]);
  });

  test("significant events: one severe, recent, well-founded event beats dozens of low-significance reports; stale ones fade", () => {
    const big = event({ id: "big", severity: "severe", importance: 85, sources: outlets(3) });
    const noisy = event({ id: "noisy", severity: "guarded", importance: 20, sources: outlets(60) });
    const old = event({ id: "old", severity: "severe", importance: 85, occurredAt: new Date(NOW - 20 * 86_400_000).toISOString(), sources: outlets(3) });
    expect(rankSignificantEvents([noisy, old, big], NOW, 3).map((r) => r.event.id)).toEqual(["big", "noisy", "old"]);
    // 60 reports from ONE outlet are one independent source: no confidence boost.
    const oneOutlet = event({ id: "one", severity: "elevated", importance: 50, sources: Array.from({ length: 60 }, (_, i) => ({ id: "same", name: "S", sourceType: "News", url: `https://same.test/${i}`, publishedAt: "2026-09-20T11:00:00Z" })) as ConflictEvent["sources"] });
    const three = { ...oneOutlet, id: "three", sources: outlets(3) };
    const [top] = rankSignificantEvents([oneOutlet, three], NOW, 1);
    expect(top!.event.id).toBe("three");
  });

  test("for a selected country, own-country and bordering full-scale wars always lead; the order is deterministic and unrelated conflicts cannot dilute the floors", () => {
    const ua = getCountryByCode("UA")!;
    const fi = getCountryByCode("FI")!;
    const war = MOCK_CONFLICTS.find((c) => c.slug === "russia-ukraine")!;
    const lows: Conflict[] = Array.from({ length: 12 }, (_, i) => conflict({ id: `low${i}`, slug: `low${i}`, status: "active", severity: "stable", intensity: 8, fullScaleWar: false, fightingCountryCodes: ["JP"], participantCountryCodes: ["JP"], lastEventAt: new Date(NOW).toISOString() }));
    const rankedUa = rankConflictsForCountry(ua, [...lows, ...MOCK_CONFLICTS], [], NOW, 5);
    expect(rankedUa[0]!.conflict.slug).toBe("russia-ukraine");
    expect(rankedUa[0]!.impact.score).toBe(100);
    expect(rankedUa[0]!.reasons).toContain("Active war inside your country");
    const rankedFi = rankConflictsForCountry(fi, [...lows, ...MOCK_CONFLICTS], [], NOW, 3);
    expect(rankedFi[0]!.conflict.slug).toBe("russia-ukraine");
    expect(rankedFi[0]!.impact.hardFloor).toBe("bordering_war");
    expect(rankedFi[0]!.impact.score).toBeGreaterThanOrEqual(75);
    const again = rankConflictsForCountry(fi, [...MOCK_CONFLICTS, ...lows], [], NOW, 3);
    expect(again.map((r) => r.conflict.id)).toEqual(rankedFi.map((r) => r.conflict.id));
    expect(war.status).toBe("active");
    // A recent significant event nudges order among non-floor conflicts, never above a floor.
    const nudged = rankConflictsForCountry(fi, MOCK_CONFLICTS, [event({ conflictId: MOCK_CONFLICTS.find((c) => c.slug === "sudan")!.id, severity: "extreme", importance: 100, sources: outlets(3) })], NOW, 3);
    expect(nudged[0]!.conflict.slug).toBe("russia-ukraine");
  });

  test("the globe and /world share one conflict universe: located, not ended", () => {
    const cs = [conflict({ id: "a", status: "active" }), conflict({ id: "b", status: "ended" }), conflict({ id: "c", status: "dormant", locationKnown: false }), conflict({ id: "d", status: "reduced" })];
    expect(selectHeatConflicts(cs).map((c) => c.id)).toEqual(["a", "d"]);
    expect(selectHeatConflicts(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
async function makeSource(request: APIRequestContext, over: Record<string, unknown>) {
  const res = await request.post("/api/admin/sources", { data: { name: `PI ${unique()}`, type: "manual", enabled: true, autoIngest: false, autoProcessing: false, ...over } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string; name: string };
}
async function reportFrom(request: APIRequestContext, sourceId: string, title: string, url: string | null) {
  const res = await request.post("/api/admin/incoming/manual", { data: { sourceId, externalId: `pi-${unique()}`, originalTitle: title, originalText: "PI fixture report.", ...(url ? { originalUrl: url } : {}), publishedAt: new Date().toISOString() } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string };
}
async function publishFrom(request: APIRequestContext, itemId: string, title: string, extra: Record<string, unknown> = {}) {
  const res = await request.post(`/api/admin/incoming/${itemId}/publish`, { data: { title, summary: "PI fixture event.", eventType: "ground", latitude: 48.4, longitude: 37.1, occurredAt: new Date().toISOString(), severity: "elevated", ...extra } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; slug: string };
}
async function mergeInto(request: APIRequestContext, itemId: string, eventId: string) {
  expect((await request.post(`/api/admin/incoming/${itemId}/merge`, { data: { eventId, relationship: "corroborating" } })).ok()).toBe(true);
}
const withParty = (page: Page, on: boolean) => page.addInitScript((v) => localStorage.setItem("vigil-preferences", JSON.stringify({ state: { showPartyClaims: v }, version: 3 })), on);

test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.territorialChangeCandidate.deleteMany({ where: { description: { startsWith: "PI " } } });
  await prisma.event.deleteMany({ where: { title: { startsWith: "PI " } } });
  await prisma.commander.deleteMany({ where: { name: { startsWith: "PI " } } });
  await prisma.militaryUnit.deleteMany({ where: { name: { startsWith: "PI " } } });
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "pi-" } } });
  await prisma.source.deleteMany({ where: { name: { startsWith: "PI " } } });
});

test.describe("Event page: event vs reports vs claims", () => {
  test.use({ isMobile: false });

  test("party claims are hidden by default (counted, not deleted); the setting reveals them as separate, labelled claims", async ({ page, request }) => {
    const indie = await makeSource(request, { independenceClass: "advocacy_independent", perspective: "Kurdish human-rights reporting", sourceRole: "local_media" });
    const strong = await makeSource(request, { independenceClass: "independent_high", sourceRole: "specialist_research" });
    const party = await makeSource(request, { independenceClass: "official_military", claimPolicy: "party_claim", perspective: "Test military", sourceRole: "official" });
    const title = `PI party event ${unique()}`;
    const first = await reportFrom(request, indie.id, "Independent account", "https://indie.test/story");
    const ev = await publishFrom(request, first.id, title);
    await mergeInto(request, (await reportFrom(request, strong.id, "Verified account", "https://strong.test/story")).id, ev.id);
    await mergeInto(request, (await reportFrom(request, party.id, "Military says 12 vehicles were destroyed", "https://military.test/statement")).id, ev.id);

    // Default: OFF.
    await page.goto(`/event/${ev.slug}`);
    await expect(page.getByTestId("event-report")).toHaveCount(2);
    await expect(page.getByTestId("party-claim")).toHaveCount(0);
    await expect(page.getByTestId("evidence-summary-line")).toContainText("2 independent sources");
    await expect(page.getByTestId("party-claims-hidden")).toContainText("1 party claim hidden");
    await expect(page.getByTestId("event-detail")).not.toContainText("12 vehicles");
    // Trust labels are human wording, with the perspective; no raw enum leaks.
    await expect(page.getByTestId("event-reports")).toContainText("Independent / Perspective");
    await expect(page.getByTestId("event-reports")).toContainText("Independent / Strong Verification");
    await expect(page.getByTestId("event-reports")).toContainText("Kurdish human-rights reporting");
    const body = await page.locator("body").innerText();
    for (const raw of ["advocacy_independent", "independent_high", "official_military", "party_claim", "state_media"]) expect(body).not.toContain(raw);

    // Turn it on through the real setting.
    await page.goto("/profile");
    await page.getByTestId("show-party-claims").check();
    await page.goto(`/event/${ev.slug}`);
    const claim = page.getByTestId("party-claim");
    await expect(claim).toHaveCount(1);
    await expect(claim).toContainText("PARTY CLAIM");
    await expect(claim.getByTestId("claim-wording")).toContainText("reports: “Military says 12 vehicles were destroyed”");
    await expect(claim.getByTestId("claim-status")).toContainText("Corroborated by 2 independent sources");
    await expect(claim.getByTestId("original-source-link")).toHaveAttribute("href", "https://military.test/statement");
    await expect(page.getByTestId("event-report")).toHaveCount(2); // independent reports unchanged
    await expect(page.getByTestId("party-claims-hidden")).toHaveCount(0);
    // Stored either way: the API still carries the report.
    const apiEvent = ((await request.get("/api/events").then((r) => r.json())) as ConflictEvent[]).find((e) => e.id === ev.id)!;
    expect(apiEvent.sources).toHaveLength(3);
    expect(apiEvent.sourceCount).toBe(2);
  });

  test("an event resting on a party claim alone says 'No independent confirmation' and words facts as claims", async ({ page, request }) => {
    const party = await makeSource(request, { independenceClass: "state_media", claimPolicy: "party_claim", perspective: "Test state media", sourceRole: "official" });
    const item = await reportFrom(request, party.id, "Ministry: 12 vehicles destroyed", null);
    const ev = await publishFrom(request, item.id, `PI claim-only event ${unique()}`);
    const { prisma } = await import("@/lib/db/client");
    await prisma.event.update({ where: { id: ev.id }, data: { casualtiesKilled: 12 } });

    await page.goto(`/event/${ev.slug}`);
    await expect(page.getByTestId("no-independent-confirmation")).toContainText("rests on party claims only");
    await expect(page.getByTestId("event-evidence-summary")).toContainText("No independent confirmation");
    await expect(page.getByTestId("party-claims-hidden")).toContainText("1 party claim hidden");
    await expect(page.getByTestId("event-accepted-facts")).toContainText("Claimed (uncorroborated): Killed: 12");

    // With claims shown: worded as a claim, uncorroborated, and a missing URL is 'Source unavailable' with no link.
    const shown = await page.context().newPage();
    await withParty(shown, true);
    await shown.goto(`/event/${ev.slug}`);
    const claim = shown.getByTestId("party-claim");
    await expect(claim.getByTestId("claim-status")).toContainText("Uncorroborated");
    await expect(claim.getByTestId("source-unavailable")).toHaveText("Source unavailable");
    await expect(claim.locator("a")).toHaveCount(0);
  });

  test("the event page separates when it happened, when the first source published and when the data was last updated", async ({ page, request }) => {
    const src = await makeSource(request, { independenceClass: "independent_standard" });
    const item = await reportFrom(request, src.id, "Timing report", "https://timing.test/a");
    const ev = await publishFrom(request, item.id, `PI timing event ${unique()}`, { occurredAt: "2026-01-02T03:04:00.000Z" });
    await page.goto(`/event/${ev.slug}`);
    const fresh = page.getByTestId("event-freshness");
    await expect(fresh).toContainText("Event occurred");
    await expect(fresh).toContainText("First source published");
    await expect(fresh).toContainText("Data last updated");
    await expect(fresh).toContainText("Jan 2");
    // Not called "live" because the page loaded.
    expect(await page.getByTestId("event-detail").innerText()).not.toMatch(/\blive\b/i);
  });
});

// ---------------------------------------------------------------------------
test.describe("Conflict page: claims, sources and states", () => {
  test.use({ isMobile: false });

  test("two sides claiming the same place are shown as conflicting claims with no conclusion", async ({ page, request }) => {
    const { prisma } = await import("@/lib/db/client");
    const tag = unique();
    const created = await request.post("/api/admin/conflicts", { data: { slug: `pi-${tag}`, name: `PI Conflict ${tag}`, region: "Africa", status: "active", severity: "high", intensity: 70, lat: 5, lng: 5, fightingCountries: ["ZQ"], participantCountries: ["ZR"] } });
    const c = (await created.json()) as { id: string; slug: string };
    const a = await prisma.militaryUnit.create({ data: { name: `PI Side A ${tag}`, unitType: "Brigade", primaryConflictId: c.id } });
    const b = await prisma.militaryUnit.create({ data: { name: `PI Side B ${tag}`, primaryConflictId: c.id } });
    await prisma.territorialChangeCandidate.create({ data: { conflictId: c.id, description: "PI A claim", changeType: "captured", status: "approved", claimedActorId: a.id, locationName: "Testville", sourceRole: "party_claim", sourceName: "A press", sourceUrl: "https://a-press.test/1", reviewedAt: new Date() } });
    await prisma.territorialChangeCandidate.create({ data: { conflictId: c.id, description: "PI B claim", changeType: "captured", status: "uncertain", claimedActorId: b.id, locationName: "testville", sourceRole: "party_claim", sourceName: "B press", sourceUrl: null, corroboration: JSON.stringify([{ sourceName: "Indie", sourceUrl: "https://indie.test/x", sourceRole: "local_media", observedAt: null }]) } });

    await page.goto(`/conflict/${c.slug}`);
    const block = page.getByTestId("conflicting-claims");
    await expect(block).toHaveCount(1);
    await expect(block).toContainText("Conflicting claims");
    await expect(block).toContainText("No conclusion is drawn while this is unresolved");
    await expect(block.getByTestId("territorial-claim")).toHaveCount(2);
    await expect(block).toContainText(`PI Side A ${tag} claims to have captured Testville`);
    await expect(block).toContainText(`PI Side B ${tag} claims to have captured Testville`);
    await expect(block).toContainText("Uncorroborated"); // A
    await expect(block).toContainText("Corroborated by 1 independent source"); // B
    await expect(block.getByTestId("source-unavailable")).toHaveCount(1); // B's own URL was never stored
    await expect(block.getByTestId("actor-link").first()).toHaveAttribute("href", /\/actor\//);
    // Actors carry a role; no territory is published yet.
    await expect(page.getByTestId("conflict-actor").filter({ hasText: `PI Side A ${tag}` }).getByTestId("actor-role")).toHaveText("Brigade");
    await expect(page.getByTestId("territory-empty")).toBeVisible();
    // A brand-new conflict has no dedicated source, and says so.
    await expect(page.getByTestId("no-dedicated-sources")).toBeVisible();
    await expect(page.getByTestId("coverage-health")).toHaveText("No source");
  });

  test("source cards show the public trust label and perspective for real seeded sources (Hengaw, IRNA)", async ({ page, request }) => {
    await page.goto("/conflict/kurdish-iran");
    await expect(page.getByTestId("conflict-family")).toBeVisible();
    const list = page.getByTestId("source-list");
    const hengaw = list.getByTestId("source-card").filter({ hasText: "Hengaw" }).first();
    await expect(hengaw).toContainText("Independent / Perspective");
    await expect(hengaw).toContainText("Kurdish human-rights reporting");
    const irna = list.getByTestId("source-card").filter({ hasText: "IRNA English" }).first();
    await expect(irna.getByTestId("trust-label")).toHaveText("PARTY CLAIM");
    await expect(irna).toContainText("Iranian state media");
    const acled = list.getByTestId("source-card").filter({ hasText: "ACLED Iran Crisis Live" }).first();
    await expect(acled).toContainText("Independent / Strong Verification");
    expect(await page.locator("body").innerText()).not.toMatch(/advocacy_independent|independent_high|state_media/);
    void request;
  });
});

// ---------------------------------------------------------------------------
test.describe("Homepage and For You use the ranked real data", () => {
  test.use({ isMobile: false });

  test("the homepage overview ranks real conflicts and events, and states are truthful", async ({ page, request }) => {
    const src = await makeSource(request, { independenceClass: "independent_high" });
    const item = await reportFrom(request, src.id, "Significant strike", "https://sig.test/strike");
    const title = `PI significant ${unique()}`;
    await publishFrom(request, item.id, title, { severity: "severe", importance: 90 });
    await page.goto("/");
    const overview = page.getByTestId("intel-overview").filter({ visible: true });
    await expect(overview.getByTestId("major-conflicts")).toBeVisible({ timeout: 30_000 });
    const data = (await request.get("/api/public/overview").then((r) => r.json())) as PublicOverview;
    const expected = rankMajorConflicts(data.conflicts, data.events, Date.now(), 5).map((r) => r.conflict.shortName);
    const shown = await overview.getByTestId("major-conflict").locator("span.text-sm").allInnerTexts();
    expect(shown.length).toBe(expected.length);
    expect(shown[0]).toBe(expected[0]);
    await expect(overview.getByTestId("significant-events")).toContainText(title);
    // "Latest verified updates" repeated Latest Activity and was removed from the Overview.
    await expect(overview.getByTestId("verified-updates")).toHaveCount(0);
  });

  test("For You explains the ranking with real reasons; the own-country war leads", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vigil-preferences", JSON.stringify({ state: { baseCountryCode: "UA" }, version: 3 })));
    await page.goto("/for-you");
    const first = page.locator("a[href^='/conflict/']").first();
    await expect(first).toHaveAttribute("href", "/conflict/russia-ukraine", { timeout: 20_000 });
    await expect(first.getByTestId("for-you-reasons")).toContainText("Active war inside your country");
  });

  test("search finds a commander through the actor page of the unit they lead", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const tag = unique().replace(/-/g, "");
    const unit = await prisma.militaryUnit.create({ data: { name: `PI Unit ${tag}` } });
    const commander = await prisma.commander.create({ data: { name: `PI Commander ${tag}`, rank: "Colonel", currentUnitId: unit.id } });
    const hits = (await request.get(`/api/public/search?q=${encodeURIComponent(`Commander ${tag}`)}`).then((r) => r.json())) as { type: string; title: string; href: string; subtitle: string }[];
    const hit = hits.find((h) => h.type === "commander")!;
    expect(hit.title).toBe(`Colonel PI Commander ${tag}`);
    expect(hit.href).toBe(`/commander/${commander.id}`); // commanders have their own page
    expect(hit.subtitle).toContain(`PI Unit ${tag}`);
  });

  test("the Sources setting is off by default and documented in Profile", async ({ page }) => {
    await page.goto("/profile");
    const box = page.getByTestId("show-party-claims");
    await expect(box).not.toBeChecked();
    await expect(page.getByTestId("sources-settings")).toContainText("never counted as independent");
    await box.check();
    await page.reload();
    await expect(page.getByTestId("show-party-claims")).toBeChecked();
  });
});
