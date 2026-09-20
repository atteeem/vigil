import { test, expect, type APIRequestContext } from "@playwright/test";
import { canonicalizeActor } from "@/lib/actors/registry";
import { REGISTRY_CONFLICTS } from "@/lib/registry/conflict-registry";

// Global Conflict Registry against the real database (seeded from
// data/conflict-registry.json): preserved conflicts, geography in scoring,
// coverage health from real sources, filters, candidates, families, actors.

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
type Api = APIRequestContext;

// The 14 conflicts that existed before the registry, with their original names.
const ORIGINAL: Record<string, string> = {
  "russia-ukraine": "Russia–Ukraine War",
  "israel-palestine": "Israel–Palestine Conflict",
  "israel-lebanon": "Israel–Lebanon Border Conflict",
  "taiwan-strait": "Taiwan Strait Tensions",
};
const ORIGINAL_SLUGS = ["russia-ukraine", "israel-palestine", "israel-lebanon", "syria", "persian-gulf-iran", "yemen-red-sea", "sudan", "drc", "somalia", "sahel", "myanmar", "india-pakistan", "korean-peninsula", "taiwan-strait"];

test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "cov-" } } });
  await prisma.source.deleteMany({ where: { name: { startsWith: "COV " } } });
  await prisma.sourceCandidate.deleteMany({ where: { name: { startsWith: "COV " } } });
});

async function conflicts(request: Api) {
  return (await request.get("/api/admin/conflicts").then((r) => r.json())) as Record<string, any>[];
}

async function coverage(request: Api, query = "") {
  return (await request.get(`/api/admin/conflict-coverage${query}`).then((r) => r.json())) as { summary: Record<string, number>; rows: Record<string, any>[]; matched: number };
}

async function rowFor(request: Api, slug: string) {
  return (await coverage(request)).rows.find((r) => r.conflict.slug === slug)!;
}

async function makeConflict(request: Api, over: Record<string, unknown> = {}) {
  const tag = unique();
  const res = await request.post("/api/admin/conflicts", {
    data: { slug: `cov-${tag}`, name: `COV ${tag}`, region: "Asia", status: "active", severity: "extreme", intensity: 95, lat: 48.5, lng: 37.0, ...over },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; slug: string };
}

async function makeSource(request: Api, over: Record<string, unknown>) {
  const res = await request.post("/api/admin/sources", { data: { name: `COV ${unique()}`, type: "rss", url: "http://localhost:1/never-fetched", enabled: true, autoIngest: false, ...over } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string };
}

async function setLastIngest(sourceId: string, when: Date) {
  const { prisma } = await import("@/lib/db/client");
  await prisma.source.update({ where: { id: sourceId }, data: { lastSuccessfulIngestion: when } });
}

test.describe("Existing conflicts preserved, registry populated", () => {
  test("all 14 pre-registry conflicts remain with their original names and legacy country lists", async ({ request }) => {
    const list = await conflicts(request);
    for (const slug of ORIGINAL_SLUGS) expect(list.some((c) => c.slug === slug), slug).toBe(true);
    for (const [slug, name] of Object.entries(ORIGINAL)) expect(list.find((c) => c.slug === slug)!.name).toBe(name);
    expect(list.find((c) => c.slug === "russia-ukraine")!.countries.sort()).toEqual(["RU", "UA"]);
    expect(list.find((c) => c.slug === "russia-ukraine")!).toMatchObject({ severity: "severe", intensity: 88, status: "active" });
  });

  test("every registry conflict is in the database with curated geography, classification and provenance", async ({ request }) => {
    const list = await conflicts(request);
    for (const entry of REGISTRY_CONFLICTS) {
      const c = list.find((x) => x.slug === entry.slug)!;
      expect(c, entry.slug).toBeTruthy();
      expect(c.fightingCountries, entry.slug).toEqual(entry.fightingCountries);
      expect(c.participantCountries).toEqual(entry.participantCountries);
      expect(c.supporterCountries).toEqual(entry.supporterCountries);
      expect(c.geographyBasis).toBe("curated");
      expect(c.classificationConfidence).toBe(entry.classification.confidence);
      expect(c.fullScaleWar).toBe(entry.fullScaleWar);
    }
    const detail = await request.get(`/api/admin/conflict-coverage/${list.find((c) => c.slug === "drc")!.id}`).then((r) => r.json());
    expect(detail.provenance.length).toBeGreaterThan(3);
    expect(detail.provenance.every((p: { sourceName: string; sourceUrl: string | null }) => p.sourceName && p.sourceUrl?.startsWith("https://"))).toBe(true);
  });

  test("tensions are audited to 'dormant' with no fighting venue instead of counting as active armed conflicts", async ({ request }) => {
    const list = await conflicts(request);
    for (const slug of ["korean-peninsula", "taiwan-strait", "armenia-azerbaijan"]) {
      expect(list.find((c) => c.slug === slug)!, slug).toMatchObject({ status: "dormant", fightingCountries: [], classificationConfidence: "uncertain" });
    }
    // Rwanda participates in DRC/M23 but the fighting is only in the DRC.
    const drc = list.find((c) => c.slug === "drc")!;
    expect(drc.participantCountries).toContain("RW");
    expect(drc.fightingCountries).toEqual(["CD"]);
  });

  test("families group related conflicts while keeping each one a separate record", async ({ request }) => {
    const families = (await request.get("/api/admin/conflict-families").then((r) => r.json())) as { slug: string; conflicts: { slug: string }[] }[];
    const bySlug = Object.fromEntries(families.map((f) => [f.slug, f.conflicts.map((c) => c.slug).sort()]));
    expect(bySlug["sahel-insurgency"]).toEqual(["burkina-faso", "niger", "sahel"]);
    expect(bySlug["kurdish-conflicts"]).toEqual(["kurdish-iran", "kurdish-syria-sdf", "kurdish-turkey-pkk"]);
    expect(bySlug["israel-regional"]).toEqual(expect.arrayContaining(["israel-lebanon", "israel-palestine", "persian-gulf-iran"]));
    const row = await rowFor(request, "niger");
    expect(row.family.slug).toBe("sahel-insurgency");
    expect(row.geography.fighting).toEqual(["NE"]); // its own geography, not the family's
  });

  test("re-running the seed keeps names, statuses and geography stable (idempotent, no duplicated links)", async ({ request }) => {
    const before = await conflicts(request);
    const { execFileSync } = await import("node:child_process");
    execFileSync("node", ["prisma/seed.mjs"], { env: { ...process.env }, stdio: "pipe", shell: true });
    const after = await conflicts(request);
    expect(after.length).toBe(before.length);
    for (const a of after) {
      const b = before.find((x) => x.slug === a.slug)!;
      expect({ name: a.name, status: a.status, fighting: a.fightingCountries }).toEqual({ name: b.name, status: b.status, fighting: b.fightingCountries });
    }
    const myanmar = await rowFor(request, "myanmar");
    expect(myanmar.actors.filter((x: { name: string }) => x.name === "Tatmadaw")).toHaveLength(1);
  });
});

test.describe("Scoring reads conflict geography, not participants", () => {
  test("only fighting countries get the same-country floor; participants, supporters and non-fighting neighbours do not", async ({ request }) => {
    const c = await makeConflict(request, {
      fightingCountries: ["UA"],
      participantCountries: ["UA", "RU", "IR"],
      supporterCountries: ["US"],
      countries: ["UA", "RU", "IR", "US"],
    });
    const score = async (code: string) => (await request.get(`/api/admin/conflicts/${c.id}/score?countryCode=${code}`).then((r) => r.json())).impact as { impactScore: number; reasons: string[] };

    const ua = await score("UA");
    expect(ua.impactScore).toBe(100);
    expect(ua.reasons).toContain("Active war is happening inside your country");

    // Participant (Iran) that is neither fighting nor bordering: no floor at all.
    const ir = await score("IR");
    expect(ir.impactScore).toBeLessThan(75);
    expect(ir.reasons).not.toContain("Active war is happening inside your country");
    expect(ir.reasons).not.toContain("Conflict directly borders your country");

    // External supporter: no floor.
    const us = await score("US");
    expect(us.impactScore).toBeLessThan(75);

    // Russia is a participant, NOT a fighting country here: no same-country 100,
    // but it borders Ukraine (fighting) so the bordering floor applies.
    const ru = await score("RU");
    expect(ru.impactScore).toBeGreaterThanOrEqual(75);
    expect(ru.impactScore).toBeLessThan(100);
    expect(ru.reasons).toContain("Conflict directly borders your country");

    // Finland borders Russia — a participant, not a fighting country — so NO border floor.
    const fi = await score("FI");
    expect(fi.impactScore).toBeLessThan(75);
    expect(fi.reasons).not.toContain("Conflict directly borders your country");

    // Poland borders Ukraine (fighting): floor.
    const pl = await score("PL");
    expect(pl.impactScore).toBeGreaterThanOrEqual(75);
    expect(pl.reasons).toContain("Conflict directly borders your country");
  });

  test("a conflict created with only the legacy country list uses it as fighting geography but is flagged as unreviewed until an admin sets it", async ({ request }) => {
    const c = await makeConflict(request, { countries: ["UA", "RU"] });
    const created = (await conflicts(request)).find((x) => x.id === c.id)!;
    expect(created).toMatchObject({ fightingCountries: ["UA", "RU"], geographyBasis: "legacy_countries" });
    expect((await rowFor(request, c.slug)).flags.unreviewedGeography).toBe(true);

    const patched = await request.patch(`/api/admin/conflicts/${c.id}`, { data: { fightingCountries: ["UA"], participantCountries: ["UA", "RU"], supporterCountries: [], fullScaleWar: true } }).then((r) => r.json());
    expect(patched).toMatchObject({ fightingCountries: ["UA"], participantCountries: ["UA", "RU"], geographyBasis: "admin", fullScaleWar: true });
    expect(patched.countries).toEqual(["UA", "RU"]); // legacy list untouched
    expect((await rowFor(request, c.slug)).flags.unreviewedGeography).toBe(false);
  });
});

test.describe("Coverage health from real sources", () => {
  test("no source -> stale -> weak -> healthy, and aggregators never make diversity", async ({ request }) => {
    const c = await makeConflict(request, { fightingCountries: ["ZQ"], participantCountries: ["ZQ"] });
    expect((await rowFor(request, c.slug)).health).toBe("no_source");

    // A local source that stopped ingesting 10 days ago -> stale.
    const local = await makeSource(request, { country: "ZQ", sourceRole: "local_media" });
    await setLastIngest(local.id, new Date(Date.now() - 10 * 24 * 3600_000));
    let row = await rowFor(request, c.slug);
    expect(row).toMatchObject({ health: "stale", enabledSources: 1, specialistSources: 1 });

    // Fresh ingestion but a single source and no events -> weak.
    await setLastIngest(local.id, new Date());
    row = await rowFor(request, c.slug);
    expect(row.health).toBe("weak");
    expect(row.latestEventAt).toBeNull();

    // Four aggregators add sources, but together count as ONE independent source.
    for (let i = 0; i < 4; i++) {
      const agg = await makeSource(request, { country: "ZQ", sourceRole: "aggregator" });
      await setLastIngest(agg.id, new Date());
    }
    row = await rowFor(request, c.slug);
    expect(row).toMatchObject({ aggregatorSources: 4, specialistSources: 1, independentSources: 2 });

    // A recent published event whose report came from a general source -> healthy.
    const event = await request.post("/api/admin/events", {
      data: { title: `COV coverage event ${unique()}`, summary: "Coverage fixture.", eventType: "artillery", latitude: 48.5, longitude: 37, occurredAt: new Date().toISOString(), severity: "elevated", published: true, conflictId: c.id, sourceName: `COV Manual ${unique()}` },
    });
    expect(event.status()).toBe(201);
    row = await rowFor(request, c.slug);
    expect(row.latestEventAt).not.toBeNull();
    expect(row.health).toBe("healthy");
    // A general source that contributed a single event is NOT coverage of this conflict
    // (needs COVERAGE_THRESHOLDS.minContributedEvents), so the count stays local + aggregators.
    expect(row.independentSources).toBe(2);
  });

  test("a conflict covered only by many aggregator feeds stays weak however fresh they are", async ({ request }) => {
    const c = await makeConflict(request, { fightingCountries: ["ZR"], participantCountries: ["ZR"] });
    for (let i = 0; i < 6; i++) {
      const agg = await makeSource(request, { country: "ZR", sourceRole: i % 2 ? "aggregator" : "relay" });
      await setLastIngest(agg.id, new Date());
    }
    await request.post("/api/admin/events", {
      data: { title: `COV agg event ${unique()}`, summary: "s", eventType: "artillery", latitude: 1, longitude: 1, occurredAt: new Date().toISOString(), severity: "elevated", published: true, conflictId: c.id, sourceName: "COV Agg Manual" },
    });
    const row = await rowFor(request, c.slug);
    expect(row.aggregatorSources).toBe(6);
    expect(row.health).toBe("weak");
  });

  test("disabled sources don't count, and dormant conflicts are inactive rather than 'no source'", async ({ request }) => {
    const c = await makeConflict(request, { fightingCountries: ["ZS"], participantCountries: ["ZS"] });
    const s = await makeSource(request, { country: "ZS", sourceRole: "local_media", enabled: false });
    await setLastIngest(s.id, new Date());
    expect((await rowFor(request, c.slug)).health).toBe("no_source");
    await request.patch(`/api/admin/conflicts/${c.id}`, { data: { status: "dormant" } });
    expect((await rowFor(request, c.slug)).health).toBe("inactive");
  });

  test("dedicated links classify a source as dedicated; the filters narrow the table; the summary spans the whole registry", async ({ request }) => {
    const c = await makeConflict(request, { fightingCountries: ["ZT"], participantCountries: ["ZT"], region: "Africa" });
    const s = await makeSource(request, { country: "ZT", sourceRole: "originating" });
    await setLastIngest(s.id, new Date());
    expect((await rowFor(request, c.slug)).hasDedicatedSource).toBe(false);
    expect((await request.post("/api/admin/source-links", { data: { sourceId: s.id, conflictId: c.id, scope: "dedicated" } })).status()).toBe(201);
    const territory = await request
      .post("/api/admin/territorial-control", {
        data: { conflictId: c.id, status: "uncertain", confidence: 0.4, geometry: { type: "Polygon", coordinates: [[[-100, 10], [-99, 10], [-99, 11], [-100, 11], [-100, 10]]] }, validFrom: new Date(Date.now() - 3600_000).toISOString() },
      })
      .then((r) => r.json());
    await request.post(`/api/admin/territorial-control/${territory.id}/publish`);

    const row = await rowFor(request, c.slug);
    expect(row).toMatchObject({ hasDedicatedSource: true, dedicatedSources: 1, hasTerritorialData: true });

    const all = await coverage(request);
    const ded = await coverage(request, "?dedicated=true");
    const noDed = await coverage(request, "?dedicated=false");
    expect(ded.rows.some((r) => r.conflict.slug === c.slug)).toBe(true);
    expect(ded.rows.every((r) => r.hasDedicatedSource)).toBe(true);
    expect(ded.rows.some((r) => r.conflict.slug === "myanmar")).toBe(true); // seeded dedicated (Myanmar Now)
    expect(noDed.rows.every((r) => !r.hasDedicatedSource)).toBe(true);
    expect(ded.matched + noDed.matched).toBe(all.matched);

    const terr = await coverage(request, "?territorial=true");
    expect(terr.rows.some((r) => r.conflict.slug === c.slug)).toBe(true);
    expect(terr.rows.every((r) => r.hasTerritorialData)).toBe(true);
    expect((await coverage(request, "?territorial=false")).rows.some((r) => r.conflict.slug === c.slug)).toBe(false);

    const africa = await coverage(request, "?region=Africa");
    expect(africa.matched).toBeGreaterThan(5);
    expect(africa.rows.every((r) => r.conflict.region === "Africa")).toBe(true);
    const dormant = await coverage(request, "?status=dormant");
    expect(dormant.rows.map((r) => r.conflict.slug)).toEqual(expect.arrayContaining(["korean-peninsula", "taiwan-strait", "armenia-azerbaijan"]));
    expect(dormant.rows.every((r) => r.status === "dormant")).toBe(true);
    const extreme = await coverage(request, "?severity=extreme");
    expect(extreme.rows.every((r) => r.conflict.severity === "extreme")).toBe(true);
    const none = await coverage(request, "?health=no_source");
    // Source expansion covered most conflicts; the ones with no feed found remain.
    expect(none.rows.length).toBeGreaterThanOrEqual(1);
    expect(none.rows.every((r) => r.health === "no_source")).toBe(true);
    expect(none.rows.some((r) => r.conflict.slug === "kurdish-turkey-pkk")).toBe(true);
    const combined = await coverage(request, "?region=Africa&status=active&health=no_source");
    expect(combined.rows.every((r) => r.conflict.region === "Africa" && r.status === "active" && r.health === "no_source")).toBe(true);

    // The summary is registry-wide (unaffected by the filter) and internally consistent.
    expect(africa.summary).toEqual(all.summary);
    expect(all.summary.total).toBe(all.matched);
    expect(all.summary.activeTracked).toBeGreaterThan(15);
    expect(all.summary.noSource).toBeGreaterThanOrEqual(1);
    expect(all.summary.withDedicatedSources).toBeGreaterThanOrEqual(2);
  });

  test("seeded specialist sources are dedicated to their conflicts; general feeds are not dedicated anywhere", async ({ request }) => {
    const ua = await rowFor(request, "russia-ukraine");
    expect(ua.hasDedicatedSource).toBe(true);
    expect(ua.sources.filter((s: { kind: string }) => s.kind === "dedicated").map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(["MilitaryLand News"]));
    const mm = await rowFor(request, "myanmar");
    expect(mm.sources.some((s: { name: string; kind: string }) => s.name === "Myanmar Now" && s.kind === "dedicated")).toBe(true);
    for (const row of (await coverage(request)).rows) {
      for (const s of row.sources) if (["BBC World", "Al Jazeera English", "The Guardian — World"].includes(s.name)) expect(s.kind).not.toBe("dedicated");
    }
  });
});

test.describe("Candidate source backlog", () => {
  test("stores candidates with status and notes, validates input, and never fetches the URL", async ({ request }) => {
    const c = (await conflicts(request)).find((x) => x.slug === "haiti")!;
    const seeded = (await request.get(`/api/admin/source-candidates?conflictId=${c.id}`).then((r) => r.json())) as { name: string; status: string }[];
    expect(seeded.map((s) => s.name)).toEqual(expect.arrayContaining(["Le Nouvelliste"]));
    expect(seeded.every((s) => s.status === "candidate" || ["approved", "integrated", "rejected"].includes(s.status))).toBe(true);

    expect((await request.post("/api/admin/source-candidates", { data: { conflictId: c.id } })).status()).toBe(400); // name required
    expect((await request.post("/api/admin/source-candidates", { data: { name: "COV bad", status: "maybe" } })).status()).toBe(400);
    expect((await request.post("/api/admin/source-candidates", { data: { name: "COV bad url", url: "ftp://example.com" } })).status()).toBe(400);

    const before = await request.get("/api/admin/incoming").then((r) => r.json());
    const created = await request.post("/api/admin/source-candidates", {
      data: { conflictId: c.id, name: `COV Candidate ${unique()}`, url: "http://localhost:1/never-scraped", sourceType: "local_media", language: "fr", notes: "Worth integrating." },
    });
    expect(created.status()).toBe(201);
    const cand = await created.json();
    expect(cand).toMatchObject({ status: "candidate", sourceType: "local_media", language: "fr", notes: "Worth integrating." });

    for (const status of ["approved", "integrated", "rejected"]) {
      const patched = await request.patch(`/api/admin/source-candidates/${cand.id}`, { data: { status } }).then((r) => r.json());
      expect(patched.status).toBe(status);
    }
    expect((await request.patch(`/api/admin/source-candidates/${cand.id}`, { data: { status: "bogus" } })).status()).toBe(400);
    // Nothing was ingested or created as a Source by storing/updating a candidate.
    expect(await request.get("/api/admin/incoming").then((r) => r.json())).toEqual(before);
    const sources = (await request.get("/api/admin/sources").then((r) => r.json())) as { name: string }[];
    expect(sources.some((s) => s.name === cand.name)).toBe(false);

    expect((await request.delete(`/api/admin/source-candidates/${cand.id}`)).ok()).toBe(true);
    expect((await request.delete(`/api/admin/source-candidates/${cand.id}`)).status()).toBe(404);
  });

  test("under-covered conflicts are the ones with candidate sources and no live coverage", async ({ request }) => {
    const row = await rowFor(request, "kurdish-turkey-pkk");
    expect(row.health).toBe("no_source");
    expect(row.candidateSourceCount).toBeGreaterThan(0);
  });
});

test.describe("Actor deduplication", () => {
  test("spelling variants create/return ONE unit row, and no stored unit is a variant of a registered actor", async ({ request }) => {
    const a = await request.post("/api/admin/military-units", { data: { name: "Israel Defense Forces" } }).then((r) => r.json());
    const b = await request.post("/api/admin/military-units", { data: { name: "IDF" } }).then((r) => r.json());
    const c = await request.post("/api/admin/military-units", { data: { name: "Israel" } }).then((r) => r.json());
    expect(a.name).toBe("Israel");
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    const kndf = await request.post("/api/admin/military-units", { data: { name: "Karenni Nationalities Defence Force" } }).then((r) => r.json());
    expect(kndf.name).toBe("KNDF");

    const units = (await request.get("/api/admin/military-units").then((r) => r.json())) as { name: string }[];
    expect(units.filter((u) => u.name === "Israel")).toHaveLength(1);
    for (const u of units) {
      const canonical = canonicalizeActor(u.name);
      if (canonical) expect(canonical, `unit "${u.name}" duplicates registered actor "${canonical}"`).toBe(u.name);
    }
  });

  test("conflict actors are linked to the canonical unit rows, once each", async ({ request }) => {
    const row = await rowFor(request, "israel-lebanon");
    expect(row.actors.map((a: { name: string }) => a.name).sort()).toEqual(["Hezbollah", "Israel"]);
    const gaza = await rowFor(request, "israel-palestine");
    const israelUnits = [row, gaza].flatMap((r) => r.actors.filter((a: { name: string }) => a.name === "Israel"));
    expect(israelUnits).toHaveLength(2); // one link per conflict...
    const units = (await request.get("/api/admin/military-units").then((r) => r.json())) as { name: string }[];
    expect(units.filter((u) => u.name === "Israel")).toHaveLength(1); // ...to a single unit
  });
});

test.describe("Coverage dashboard", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "Mobile", "Admin dashboard is a desktop workflow");
  });
  test.use({ isMobile: false });

  test("shows the summary cards and a table of tracked conflicts, with filters that narrow it", async ({ page }) => {
    await page.goto("/admin/conflict-coverage");
    await expect(page.getByTestId("conflict-coverage-page")).toBeVisible();
    await expect(page.getByTestId("cov-row-russia-ukraine")).toBeVisible();
    for (const key of ["active", "dedicated", "territorial", "updated6h", "updated24h", "weak", "stale", "nosource", "noactors", "nogeo"]) {
      await expect(page.getByTestId(`cov-card-${key}-value`)).toHaveText(/^\d+$/);
    }
    const total = await page.locator("[data-testid^=cov-row-]").count();
    expect(total).toBeGreaterThan(25);

    await page.getByTestId("cov-filter-status").selectOption("dormant");
    await expect(page.getByTestId("cov-row-korean-peninsula")).toBeVisible();
    await expect(page.getByTestId("cov-row-russia-ukraine")).toHaveCount(0);
    await expect(page.getByTestId("cov-status-taiwan-strait")).toHaveText("Dormant");
    await page.getByTestId("cov-filter-reset").click();

    await page.getByTestId("cov-filter-health").selectOption("no_source");
    await expect(page.getByTestId("cov-row-kurdish-turkey-pkk")).toBeVisible();
    await expect(page.getByTestId("cov-health-kurdish-turkey-pkk")).toHaveText("No source");
    await page.getByTestId("cov-filter-dedicated").selectOption("true");
    await expect(page.getByTestId("cov-row-kurdish-turkey-pkk")).toHaveCount(0);
    await page.getByTestId("cov-filter-reset").click();

    await page.getByTestId("cov-filter-dedicated").selectOption("true");
    await expect(page.getByTestId("cov-row-myanmar")).toBeVisible();
    await expect(page.getByTestId("cov-row-russia-ukraine")).toBeVisible();
    await expect(page.getByTestId("cov-row-kurdish-turkey-pkk")).toHaveCount(0);
  });

  test("a row expands to fighting vs participants vs supporters, family, actors, sources, provenance and candidates; a candidate can be added", async ({ page }) => {
    await page.goto("/admin/conflict-coverage");
    await page.getByTestId("cov-row-drc").click();
    await expect(page.getByTestId("cov-geo-fighting")).toContainText("CD");
    await expect(page.getByTestId("cov-geo-participants")).toContainText("RW");
    await expect(page.getByTestId("cov-geo-fighting")).not.toContainText("RW");
    await expect(page.getByTestId("cov-classification")).toContainText("Rwanda");
    await expect(page.getByTestId("cov-actors")).toContainText("M23");
    await expect(page.getByTestId("cov-provenance")).toContainText("UCDP");
    await expect(page.getByTestId("cov-candidates")).toContainText("Radio Okapi");

    const name = `COV UI candidate ${unique()}`;
    await page.getByTestId("cov-candidate-name").fill(name);
    await page.getByTestId("cov-candidate-url").fill("https://example.org/never-fetched");
    await page.getByTestId("cov-candidate-add").click();
    await expect(page.getByTestId(`cov-candidate-${name}`)).toBeVisible();

    await page.getByTestId("cov-row-sahel").click();
    await expect(page.getByTestId("cov-family")).toContainText("Sahel jihadist insurgency");
    await expect(page.getByTestId("cov-family")).toContainText("Burkina Faso");
  });
});
