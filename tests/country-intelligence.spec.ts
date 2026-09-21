import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { COUNTRY_RECORDS, getCountryRecord, neighboursOf, resolveCountry, searchCountries } from "@/lib/countries/registry";
import { isDirectlyBordering, DEFAULT_ADJACENCY } from "@/lib/scoring/geography";
import { computeCountryExposure, computeImpact } from "@/lib/data/impact";
import { getCountryByCode, COUNTRIES } from "@/lib/reference/countries";
import { MOCK_CONFLICTS } from "@/lib/dev-fixtures/mock-conflicts";
import type { CountryIntelligence, CountrySummary } from "@/lib/countries/intelligence";

// Country Intelligence Pages. Registry / scoring tests are pure; page and API tests read the real database
// through the real write paths (conflicts, events, structured-provider fixtures).

const FIXTURE = "http://localhost:3100/api/test-fixtures/hazards";
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const T0 = Date.now();
const fixtureUrl = (path: string, query: string) => `${FIXTURE}/${path}${query ? `${query}&` : "?"}t=${T0}`;
const CLASS: Record<string, string> = { usgs_earthquakes: "scientific_official", faa_nas_status: "government_alert", ioda: "sensor_provider", elexon_remit: "infrastructure_operator" };
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

async function ingest(request: APIRequestContext, provider: string, path: string, query = "") {
  const res = await request.post("/api/admin/sources", { data: { name: `CI ${provider} ${unique()}`, type: "structured", platform: provider, feedUrl: fixtureUrl(path, query), url: fixtureUrl(path, query), enabled: true, autoIngest: false, autoProcessing: false, independenceClass: CLASS[provider], pollIntervalMinutes: 5 } });
  const src = (await res.json()) as { id: string };
  return (await request.post(`/api/admin/sources/${src.id}/fetch`).then((r) => r.json())) as { errors: number };
}
const intel = async (request: APIRequestContext, code: string) => (await request.get(`/api/countries/${code}/intelligence`).then((r) => r.json())) as CountryIntelligence;

test.describe.configure({ timeout: 150_000 });

test.beforeAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.stateTransition.deleteMany({});
  await prisma.alertState.deleteMany({});
});
test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.globalEvent.deleteMany({});
  await prisma.stateTransition.deleteMany({});
  await prisma.watcher.deleteMany({});
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "ci-" } } });
  await prisma.militaryUnit.deleteMany({ where: { name: { startsWith: "CI " } } });
  await prisma.source.deleteMany({ where: { name: { startsWith: "CI " } } });
});

// ---------------------------------------------------------------------------------------------
test.describe("Canonical country registry (pure)", () => {
  test("ISO2, ISO3, name and aliases resolve to the same entity", () => {
    for (const q of ["FI", "fi", "FIN", "Finland", "finland", "Suomi"]) expect(resolveCountry(q)?.code).toBe("FI");
    expect(resolveCountry("Türkiye")?.code).toBe("TR");
    expect(resolveCountry("Turkiye")?.code).toBe("TR");
    expect(resolveCountry("Ivory Coast")?.code).toBe("CI");
    expect(resolveCountry("USA")?.code).toBe("US");
    expect(resolveCountry("Burma")?.code).toBe("MM");
    expect(resolveCountry("Nowhereland")).toBeUndefined();
    expect(searchCountries("suomi")[0]!.code).toBe("FI");
    expect(searchCountries("fin").map((c) => c.code)).toContain("FI");
    expect(searchCountries("korea").map((c) => c.code)).toEqual(expect.arrayContaining(["KR", "KP"]));
  });

  test("every country has full identity, a centroid and metadata; ISO codes are unique", () => {
    expect(COUNTRY_RECORDS.length).toBeGreaterThanOrEqual(190);
    expect(new Set(COUNTRY_RECORDS.map((c) => c.code)).size).toBe(COUNTRY_RECORDS.length);
    expect(new Set(COUNTRY_RECORDS.map((c) => c.alpha3)).size).toBe(COUNTRY_RECORDS.length);
    for (const c of COUNTRY_RECORDS) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.alpha3).toMatch(/^[A-Z]{3}$/);
      expect(c.name.length).toBeGreaterThan(1);
      expect(Number.isFinite(c.lat) && Number.isFinite(c.lng)).toBe(true);
      expect(c.capital.length).toBeGreaterThan(1);
      expect(c.subregion.length).toBeGreaterThan(1);
      expect(c.zoom).toBeGreaterThanOrEqual(2.5);
    }
    expect(getCountryRecord("FI")).toMatchObject({ alpha3: "FIN", capital: "Helsinki", region: "Europe", landlocked: false });
    expect(getCountryRecord("BW")!.landlocked).toBe(true);
    expect(COUNTRIES.length).toBe(COUNTRY_RECORDS.length); // the old 29-country reference is now the whole registry
    expect(getCountryByCode("KE")).toMatchObject({ name: "Kenya", region: "Africa" });
  });

  test("land borders are global, symmetric and not special-cased: countries outside the old reference list border correctly", () => {
    for (const c of COUNTRY_RECORDS) for (const b of c.borders) expect(getCountryRecord(b)!.borders).toContain(c.code);
    expect(isDirectlyBordering("KE", "TZ")).toBe(true);
    expect(isDirectlyBordering("TD", "SD")).toBe(true);
    expect(isDirectlyBordering("BR", "AR")).toBe(true);
    expect(isDirectlyBordering("ZA", "BW")).toBe(true);
    expect(isDirectlyBordering("FI", "RU")).toBe(true);
    expect(isDirectlyBordering("FI", "PL")).toBe(false);
    expect(isDirectlyBordering("JP", "KR")).toBe(false);
    expect(neighboursOf("JP")).toHaveLength(0); // islands have no land neighbours
    expect(neighboursOf("FI").map((c) => c.code).sort()).toEqual(["NO", "RU", "SE"]);
    expect([...DEFAULT_ADJACENCY.keys()].length).toBeGreaterThan(150);
  });
});

test.describe("Impact hard floors work for every country (pure)", () => {
  const war = (fighting: string[], participants: string[] = fighting) => ({ ...MOCK_CONFLICTS.find((c) => c.slug === "russia-ukraine")!, fightingCountryCodes: fighting, participantCountryCodes: participants, lat: 12.8, lng: 30.2, locationKnown: true });
  const country = (c: string) => getCountryByCode(c)!;

  test("own-country war = 100; bordering war >= 75; participant-only gets no floor", () => {
    const w = war(["SD"], ["SD", "SA"]);
    expect(computeImpact(country("SD"), w)).toMatchObject({ score: 100, hardFloor: "own_country_war" });
    const chad = computeImpact(country("TD"), w); // Chad was never in the old 29-country list
    expect(chad.score).toBeGreaterThanOrEqual(75);
    expect(chad.hardFloor).toBe("bordering_war");
    expect(computeImpact(country("SS"), w).hardFloor).toBe("bordering_war");
    const saudi = computeImpact(country("SA"), w); // named participant, not bordering the fighting
    expect(saudi.hardFloor).toBeNull();
    expect(saudi.score).toBeLessThan(75);
    expect(computeImpact(country("IS"), w).hardFloor).toBeNull();
  });

  test("adding low-impact conflicts cannot dilute a hard floor", () => {
    const w = war(["SD"]);
    const lows = MOCK_CONFLICTS.filter((c) => c.slug !== "russia-ukraine").slice(0, 8);
    expect(computeCountryExposure(country("TD"), [w]).score).toBeGreaterThanOrEqual(75);
    expect(computeCountryExposure(country("TD"), [w, ...lows]).score).toBeGreaterThanOrEqual(75);
    expect(computeCountryExposure(country("SD"), [w, ...lows]).score).toBe(100);
  });

  test("exposure dimensions without evidence say so instead of showing a filler number", () => {
    const untagged = { ...war(["SD"]), primaryEffects: [] as string[] };
    const { components } = computeCountryExposure(country("TD"), [untagged]);
    const by = Object.fromEntries(components.map((c) => [c.dimension, c]));
    expect(by.security).toMatchObject({ basis: "computed" });
    for (const d of ["energy", "trade", "finance", "food_supply"]) expect(by[d]).toMatchObject({ basis: "insufficient", value: 0 });
    const tagged = computeCountryExposure(country("TD"), [{ ...untagged, primaryEffects: ["Energy"] }]).components;
    expect(tagged.find((c) => c.dimension === "energy")!.basis).toBe("estimated");
    expect(tagged.find((c) => c.dimension === "trade")!.basis).toBe("insufficient");
  });
});

// ---------------------------------------------------------------------------------------------
test.describe.serial("Country intelligence API and aggregation", () => {
  let war: { id: string; slug: string };
  let partySource: string;

  test.beforeAll(async ({ request }) => {
    // Botswana: landlocked, no real conflict recorded, borders ZA / NA / ZM / ZW.
    war = (await request.post("/api/admin/conflicts", { data: { slug: `ci-${unique()}`, name: "CI Botswana War", region: "Africa", status: "active", severity: "extreme", intensity: 95, lat: -22.3, lng: 24.7, fightingCountries: ["BW"], participantCountries: ["BW", "IS"], fullScaleWar: true, primaryEffects: ["Energy"] } }).then((r) => r.json())) as { id: string; slug: string };
    partySource = `CI MoD ${unique()}`;
    await request.post("/api/admin/sources", { data: { name: partySource, type: "manual", independenceClass: "official_military", claimPolicy: "party_claim", perspective: "Ministry of Defence", country: "BW" } });
    const publish = (over: Record<string, unknown>) => request.post("/api/admin/events", { data: { title: `CI event ${unique()}`, summary: "Fighting near the capital.", eventType: "artillery", latitude: -24.6, longitude: 25.9, occurredAt: ago(1), severity: "severe", importance: 88, published: true, sourceName: `CI Wire ${unique()}`, conflictId: war.id, countryCode: "BW", ...over } });
    await publish({ title: "CI Strike near Gaborone" });
    await publish({ title: "CI Airport shelled", sourceName: partySource, importance: 92 });
  });

  test("ISO2 / ISO3 / alias all resolve; the registry search and the comparison summaries are clean", async ({ request }) => {
    for (const q of ["BW", "BWA", "Botswana"]) expect(((await request.get(`/api/countries/${q}`).then((r) => r.json())) as { country: { code: string } }).country.code).toBe("BW");
    expect((await request.get("/api/countries/ZZZ")).status()).toBe(404);
    const search = (await request.get("/api/countries?q=suomi").then((r) => r.json())) as { countries: { code: string; alpha3: string }[] };
    expect(search.countries[0]).toMatchObject({ code: "FI", alpha3: "FIN" });
    const cmp = (await request.get("/api/countries?codes=FI,SE,EE").then((r) => r.json())) as { countries: CountrySummary[] };
    expect(cmp.countries.map((c) => c.code)).toEqual(["FI", "SE", "EE"]);
    for (const s of cmp.countries) expect(Object.keys(s).sort()).toEqual(["activeDevelopments", "activeDomesticConflicts", "alpha3", "code", "exposure", "exposureLabel", "freshnessStale", "hazards", "highImpactNearbyConflicts", "infrastructureDisruptions", "latestConflictEventAt", "name", "region"]);
    expect((await request.get("/api/countries?codes=ZZ,QQ")).status()).toBe(400);
    // Public search routes to the canonical country page.
    for (const q of ["Finland", "Suomi", "FIN", "FI"]) {
      const hits = (await request.get(`/api/public/search?q=${q}`).then((r) => r.json())) as { type: string; href: string }[];
      expect(hits.find((h) => h.type === "country")!.href).toBe("/country/FI");
    }
  });

  test("a domestic conflict gives own-country exposure 100 with its reasoning; neighbours get >= 75 from the border rule; participant-only gets no floor", async ({ request }) => {
    const bw = await intel(request, "BW");
    expect(bw.country).toMatchObject({ code: "BW", alpha3: "BWA", landlocked: true });
    expect(bw.overview.exposureScore).toBe(100);
    expect(bw.overview.activeDomesticConflicts).toBeGreaterThanOrEqual(1);
    const row = bw.domesticConflicts.find((d) => d.slug === war.slug)!;
    expect(row).toMatchObject({ name: "CI Botswana War", status: "active", fullScaleWar: true });
    expect(row.latestDevelopment?.title).toMatch(/Strike near Gaborone/);
    expect(row.confidence).not.toBeNull();
    expect(row.territorialData).toBe(false);
    const lead = bw.exposure.reasoning.find((r) => r.conflictSlug === war.slug)!;
    expect(lead).toMatchObject({ impact: 100, hardFloor: "own_country_war" });
    expect(lead.reasons.join(" ")).toMatch(/inside the country/);
    expect(bw.exposure.dimensions.find((d) => d.dimension === "security")).toMatchObject({ basis: "computed", value: 100 });

    const za = await intel(request, "ZA");
    expect(za.domesticConflicts.some((d) => d.slug === war.slug)).toBe(false); // not fighting there
    const near = za.nearbyConflicts.find((n) => n.conflictSlug === war.slug)!;
    expect(near.impact).toBeGreaterThanOrEqual(75);
    expect(near.hardFloor).toBe("bordering_war");
    expect(near.why).toContain("Direct-border active war");
    expect(za.overview.exposureScore).toBeGreaterThanOrEqual(75);

    const is = await intel(request, "IS"); // named as a participant only
    expect(is.domesticConflicts.some((d) => d.slug === war.slug)).toBe(false);
    expect(is.nearbyConflicts.some((n) => n.conflictSlug === war.slug)).toBe(false);
    expect(is.exposure.reasoning.find((r) => r.conflictSlug === war.slug)?.hardFloor ?? null).toBeNull();
  });

  test("party claims are counted but hidden by default; independent reports are counted separately", async ({ request }) => {
    const bw = await intel(request, "BW");
    expect(bw.claims.partyClaimsHidden).toBeGreaterThanOrEqual(1);
    expect(bw.claims.independentReports).toBeGreaterThanOrEqual(1);
    const claim = bw.claims.partyClaims.find((d) => d.title.includes("Airport shelled"))!;
    expect(claim).toMatchObject({ developmentType: "party_claim", isPartyClaim: true, independentSourceCount: 0 });
    expect(bw.developments.some((d) => d.title.includes("Airport shelled"))).toBe(false); // never merged into the factual list
    expect(bw.developments.some((d) => d.title.includes("Strike near Gaborone"))).toBe(true);
  });

  test("hazards, aviation, internet and energy sections come from the structured-event systems; unavailable states stay quiet", async ({ request }) => {
    await ingest(request, "usgs_earthquakes", "usgs-jp");
    await ingest(request, "faa_nas_status", "faa");
    await ingest(request, "ioda", "ioda");
    await ingest(request, "elexon_remit", "elexon");
    const jp = await intel(request, "JP");
    expect(jp.sections.hazards.some((d) => d.title.startsWith("M6.9"))).toBe(true);
    expect(jp.sections.hazards.every((d) => d.domain === "hazard")).toBe(true); // hazard severity is never mixed with conflict severity
    expect(jp.sections.aviation).toHaveLength(0);
    expect(jp.overview.exposureScore).toBeLessThan(75);
    const us = await intel(request, "US");
    expect(us.sections.aviation.some((d) => d.title.includes("O'Hare") && /closed$/.test(d.title))).toBe(true);
    const lb = await intel(request, "LB");
    const outage = lb.sections.internet.find((d) => d.title.includes("Lebanon"))!;
    expect(outage.summary).toMatch(/does not establish the cause/);
    expect(JSON.stringify(lb.sections.internet)).not.toMatch(/intentional shutdown was|censor/i);
    const gb = await intel(request, "GB");
    expect(gb.sections.energy.length).toBeGreaterThanOrEqual(1);
    expect(gb.sections.energy[0]!.sources[0]!.role).toBe("provider");
    // Landlocked: no maritime section content; a country without such events has empty sections.
    const bw = await intel(request, "BW");
    expect(bw.sections.maritime).toHaveLength(0);
    expect(bw.sections.aviation).toHaveLength(0);
    expect(bw.sections.internet).toHaveLength(0);
    expect(bw.freshness.some((f) => f.key === "maritime")).toBe(false);
    expect(bw.freshness.find((f) => f.key === "conflict_events")!.at).toBeTruthy();
    expect(bw.freshness.find((f) => f.key === "aviation")?.at ?? null).not.toBeNull(); // a fetched feed has its own clock
    // Freshness chips carry per-dataset state, not one LIVE flag.
    expect(new Set(bw.freshness.map((f) => f.key)).size).toBe(bw.freshness.length);
  });

  test("actors, coverage and territory come from the knowledge layer, the coverage system and territorial control", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const unit = await prisma.militaryUnit.create({ data: { name: `CI Botswana Defence Force ${unique()}`, entityType: "state_military", country: "BW", primaryConflictId: war.id } });
    const militia = await prisma.militaryUnit.create({ data: { name: `CI Bush Militia ${unique()}`, entityType: "armed_group", country: "BW", primaryConflictId: war.id } });
    const foreign = await prisma.militaryUnit.create({ data: { name: `CI Foreign Coalition ${unique()}`, entityType: "coalition", country: "ZA", primaryConflictId: war.id } });
    const a = await prisma.militaryUnit.create({ data: { name: `CI Actor A ${unique()}` } });
    const cand = await prisma.territorialChangeCandidate.create({ data: { conflictId: war.id, description: "CI took Northville", claimedActorId: a.id, previousActorId: unit.id, locationName: "Northville", changeType: "captured", status: "pending", confidence: 0.6, precision: "area_level", sourceName: "CI Report", sourceUrl: "https://example.test/x" } });
    expect((await request.post(`/api/admin/territorial-change-candidates/${cand.id}/review`, { data: { action: "approve", geometryMode: "record_only" } })).ok()).toBe(true);
    const bw = await intel(request, "BW");
    expect(bw.actors.stateForces.map((x) => x.id)).toContain(unit.id);
    expect(bw.actors.nonStateArmed.map((x) => x.id)).toContain(militia.id);
    expect(bw.actors.international.map((x) => x.id)).toContain(foreign.id);
    expect(bw.actors.stateForces.find((x) => x.id === unit.id)!.href).toBe(`/unit/${unit.id}`);
    expect(bw.territory.available).toBe(true);
    expect(bw.territory.conflicts.find((t) => t.slug === war.slug)!.changes[0]!.description).toBe("CI took Northville");
    expect(bw.developments.some((d) => d.developmentType === "territory_changed")).toBe(true);
    expect(bw.coverage.sourcesCovering).toBeGreaterThanOrEqual(1);
    expect(bw.coverage.byTrust.party_claim).toBeGreaterThanOrEqual(1);
    expect(bw.coverage.specialistLocalSources).toBeGreaterThanOrEqual(1);
    expect(bw.coverage.gaps.some((g) => g.slug === war.slug)).toBe(true); // a conflict with no dedicated source is a coverage gap
  });

  test("performance: bounded, cached, and never a dump of the world's events", async ({ request }) => {
    const t0 = Date.now();
    const res = await request.get("/api/countries/BW/intelligence");
    const body = await res.text();
    expect(res.ok()).toBe(true);
    const data = JSON.parse(body) as CountryIntelligence;
    expect(data.developments.length).toBeLessThanOrEqual(8);
    for (const s of Object.values(data.sections)) expect(s.length).toBeLessThanOrEqual(6);
    for (const g of Object.values(data.actors)) expect(g.length).toBeLessThanOrEqual(12);
    expect(body.length).toBeLessThan(400_000);
    const again = await request.get("/api/countries/BW/intelligence");
    expect(again.ok()).toBe(true);
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(data.meta.conflictsScored).toBeLessThan(200);
    // The second call reuses the brief universe (see the briefing spec for cache semantics): one server aggregation, no fan-out.
    const brief = (await request.get("/api/brief?country=BW&window=6h").then((r) => r.json())) as { meta: { cached: boolean } };
    expect(brief.meta.cached).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
async function openCountry(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId("country-page")).toBeVisible({ timeout: 90_000 });
}

test.describe.serial("Country page UI", () => {
  let slug = "";
  test.beforeAll(async ({ request }) => {
    slug = `ci-${unique()}`;
    const c = (await request.post("/api/admin/conflicts", { data: { slug, name: "CI Namibia War", region: "Africa", status: "active", severity: "severe", intensity: 80, lat: -22, lng: 17, fightingCountries: ["NA"], fullScaleWar: false } }).then((r) => r.json())) as { id: string };
    const partySource = `CI MoD ${unique()}`;
    await request.post("/api/admin/sources", { data: { name: partySource, type: "manual", independenceClass: "official_military", claimPolicy: "party_claim", perspective: "Ministry of Defence" } });
    const ev = (over: Record<string, unknown>) => request.post("/api/admin/events", { data: { title: `CI ui ${unique()}`, summary: "Fighting.", eventType: "artillery", latitude: -22.5, longitude: 17.1, occurredAt: ago(1), severity: "severe", importance: 88, published: true, sourceName: `CI Wire ${unique()}`, conflictId: c.id, countryCode: "NA", ...over } });
    await ev({ title: "CI Namibia strike" });
    await ev({ title: "CI Namibia claim", sourceName: partySource });
    await ingest(request, "usgs_earthquakes", "usgs-jp");
    await ingest(request, "faa_nas_status", "faa");
  });

  test("the page renders real data: overview, exposure reasoning, domestic conflict, latest developments, coverage, freshness", async ({ page }) => {
    await openCountry(page, "/country/NA");
    await expect(page.getByTestId("country-name")).toHaveText("Namibia");
    await expect(page.getByTestId("country-identity")).toContainText("Windhoek");
    await expect(page.getByTestId("country-identity")).toContainText("NAM");
    await expect(page.getByTestId("overview-exposure")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("overview-status")).toContainText("active conflict");
    await expect(page.getByTestId("stat-domestic")).toContainText(/[1-9]/);
    await expect(page.getByTestId("country-neighbours")).toContainText("Botswana");
    await expect(page.getByTestId("domestic-conflict").filter({ hasText: "CI Namibia War" })).toBeVisible();
    await expect(page.getByTestId("exposure-reason").first()).toBeVisible();
    await expect(page.getByTestId("developments-list").getByTestId("development-card").filter({ hasText: "CI Namibia strike" })).toBeVisible();
    await expect(page.getByTestId("freshness-conflict_events")).toContainText("Latest conflict event");
    await expect(page.getByTestId("exposure-insufficient-trade")).toBeVisible(); // no evidence: no number
    await expect(page.getByTestId("section-transport")).toHaveCount(0); // nothing to say: no filler section
    await expect(page.getByTestId("section-maritime")).toHaveCount(0); // landlocked
    await expect(page.getByTestId("section-brief")).toBeVisible();
    await expect(page.getByTestId("full-country-brief")).toHaveAttribute("href", "/brief/country/NA");
  });

  test("country brief window switching uses the same brief engine", async ({ page }) => {
    await openCountry(page, "/country/NA");
    const brief = page.getByTestId("section-brief");
    await expect(brief.getByTestId("brief-headline")).toContainText("Last 6 hours", { timeout: 60_000 });
    await expect(brief.getByTestId("window-custom")).toHaveCount(0);
    await brief.getByTestId("window-24h").click();
    await expect(brief.getByTestId("brief-headline")).toContainText("Last 24 hours");
    await expect(brief.getByTestId("development-card").filter({ hasText: "CI Namibia strike" }).first()).toBeVisible();
  });

  test("party claims: hidden and counted by default; shown, labelled and separate when the setting is on", async ({ page }) => {
    await openCountry(page, "/country/NA");
    await page.getByTestId("section-coverage").locator("summary").click();
    await expect(page.getByTestId("claims-hidden")).toContainText("party claim");
    await expect(page.getByTestId("party-claims-list")).toHaveCount(0);
    const on = await page.context().newPage();
    await on.addInitScript(() => localStorage.setItem("vigil-preferences", JSON.stringify({ state: { showPartyClaims: true }, version: 3 })));
    await openCountry(on, "/country/NA");
    await on.getByTestId("section-coverage").locator("summary").click();
    await expect(on.getByTestId("claims-shown")).toBeVisible();
    const list = on.getByTestId("party-claims-list");
    await expect(list.getByTestId("development-card").first()).toContainText("PARTY CLAIM");
    await expect(list).toContainText("CI Namibia claim");
    // The independent-report count never includes the claim.
    await expect(on.getByTestId("claims-summary")).toContainText("independent report");
    await on.close();
  });

  test("hazard, aviation and internet sections appear only where there is data; empty countries stay clean", async ({ page }) => {
    await openCountry(page, "/country/JP");
    await expect(page.getByTestId("section-hazards")).toBeVisible();
    await expect(page.getByTestId("hazards-list")).toContainText("M6.9");
    await openCountry(page, "/country/US");
    await expect(page.getByTestId("section-aviation")).toContainText("significant aviation disruption");
    await expect(page.getByTestId("aviation-list")).toContainText("O'Hare");
    await openCountry(page, "/country/IS");
    await expect(page.getByTestId("section-domestic")).toHaveCount(0);
    await expect(page.getByTestId("section-actors")).toHaveCount(0);
    await expect(page.getByTestId("no-infrastructure-events")).toBeVisible();
    await expect(page.getByTestId("overview-status")).toContainText("No active conflict recorded inside Iceland");
  });

  test("aliases redirect to the canonical page; unknown countries 404", async ({ page }) => {
    await page.goto("/country/FIN");
    await expect(page).toHaveURL(/\/country\/FI$/, { timeout: 90_000 });
    await expect(page.getByTestId("country-name")).toHaveText("Finland");
    await page.goto("/country/Suomi");
    await expect(page).toHaveURL(/\/country\/FI$/);
    const res = await page.goto("/country/ZZ");
    expect(res?.status()).toBe(404);
  });

  test("Follow country uses the existing watch system with major-only defaults and lists what it monitors", async ({ page, request }) => {
    await openCountry(page, "/country/NA");
    await page.getByTestId("section-watch").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("watch-rules")).toContainText("Airport closure");
    const button = page.getByTestId("section-watch").getByRole("button", { name: /follow/i }).first();
    await button.click();
    await expect(page.getByTestId("watch-mode")).toHaveText("Major only", { timeout: 30_000 });
    const id = await page.evaluate(() => localStorage.getItem("vigil-client-id"));
    const watches = (await request.get("/api/me/watches", { headers: { "x-vigil-client": id! } }).then((r) => r.json())) as { entityType: string; entityKey: string; mode: string; effectiveRules: Record<string, unknown> }[];
    const w = watches.find((x) => x.entityType === "country" && x.entityKey === "NA")!;
    expect(w.mode).toBe("major");
    // Alert linkage: a conflict development for a war in Namibia reaches this watcher (impact 100 there).
    const { prisma } = await import("@/lib/db/client");
    const c = await prisma.conflict.findUniqueOrThrow({ where: { slug } });
    await request.post("/api/admin/events", { data: { title: "CI Namibia big offensive", summary: "Major offensive.", eventType: "ground", latitude: -22.6, longitude: 17.2, occurredAt: new Date().toISOString(), severity: "extreme", importance: 96, published: true, sourceName: `CI Wire ${unique()}`, conflictId: c.id, countryCode: "NA" } });
    const feed = (await request.get("/api/me/notifications", { headers: { "x-vigil-client": id! } }).then((r) => r.json())) as { items: { title: string; category: string }[] };
    expect(feed.items.some((n) => n.title.includes("Namibia big offensive"))).toBe(true);
  });

  test("navigation: conflict geography, event country, brief cards and hazards link to the canonical country page; the map opens /world with context", async ({ page }) => {
    await page.goto(`/conflict/${slug}`);
    const link = page.getByTestId("geo-fighting").getByTestId("geo-country-link").first();
    await expect(link).toHaveAttribute("href", "/country/NA", { timeout: 90_000 });
    await link.click();
    await expect(page).toHaveURL(/\/country\/NA$/);
    await page.getByTestId("section-map").locator("summary").click().catch(() => undefined);
    const open = page.getByTestId("open-in-world");
    await expect(open).toHaveAttribute("href", /^\/world\?focus=-?\d+\.\d+,-?\d+\.\d+,[\d.]+&territory=1&country=NA$/);
    await page.getByTestId("show-country-map").click();
    await page.getByTestId("country-map-layers").getByRole("button", { name: "Earthquakes" }).click();
    await expect(open).toHaveAttribute("href", /layers=earthquakes/);
    await open.click();
    await expect(page).toHaveURL(/\/world\?layers=earthquakes&focus=.+&territory=1&country=NA/, { timeout: 90_000 });
    await expect(page.getByTestId("back-to-country")).toContainText("Namibia");
    // Brief items link to their country too.
    await page.goto("/brief");
    await expect(page.getByTestId("brief-body")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("dev-country-link").first()).toHaveAttribute("href", /^\/country\/[A-Z]{2}$/);
  });

  test("mobile-friendly: long sections collapse and the overview comes first", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openCountry(page, "/country/NA");
    await expect(page.getByTestId("country-overview")).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const territory = page.getByTestId("section-actors");
    if (await territory.count()) expect(await territory.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(page.getByTestId("section-coverage").evaluate((el) => (el as HTMLDetailsElement).open)).resolves.toBe(false);
  });
});
