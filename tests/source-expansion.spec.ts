import { test, expect, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { SOURCE_ROLES } from "@/lib/types/db";
import { SOURCE_TIERS, emptyTierCounts, isGroundedTier, sourceTierOf, tierDiversity } from "@/lib/registry/source-tiers";
import { COVERAGE_THRESHOLDS, classifySource, computeCoverage, type CoverageSource } from "@/lib/registry/coverage";
import { compareCoverage, stillUndercovered, type CoverageSnapshotRow } from "@/lib/registry/coverage-diff";
import { extractUpstreamSource, upstreamMetadata } from "@/lib/ingestion/upstream";
import { independentSourceCount } from "@/lib/data/independence";
import { REGISTRY_CONFLICTS } from "@/lib/registry/conflict-registry";
import { getTelegramFixture } from "@/lib/testing/telegram-fixtures";

// Coverage-Driven Source Expansion: source tiers, conflict relevance, aggregator
// independence, coverage improvement, provenance and duplicate protection.

const expansion = JSON.parse(readFileSync("data/source-expansion.json", "utf8")) as {
  sources: { name: string; url?: string; type: string; telegramHandle?: string; country?: string; sourceRole: string; enabled?: boolean; links: { conflict: string; scope: string }[] }[];
  candidateUpdates: { name: string; status: string }[];
};

// ---------------------------------------------------------------------------
test.describe("Source tiers", () => {
  test("every trust-model role maps to exactly one tier; unclassified sources earn no specialist credit", () => {
    expect(sourceTierOf("official")).toBe("official");
    expect(sourceTierOf("local_media")).toBe("local_media");
    expect(sourceTierOf("eyewitness_community")).toBe("local_media");
    expect(sourceTierOf("specialist_research")).toBe("specialist");
    expect(sourceTierOf("aggregator")).toBe("aggregator");
    expect(sourceTierOf("relay")).toBe("aggregator");
    expect(sourceTierOf("originating")).toBe("global_media");
    expect(sourceTierOf(null)).toBe("global_media");
    for (const role of SOURCE_ROLES) expect(SOURCE_TIERS).toContain(sourceTierOf(role));
  });

  test("only local and specialist tiers are 'grounded'; aggregators add discovery, not tier diversity", () => {
    expect(isGroundedTier("local_media")).toBe(true);
    expect(isGroundedTier("specialist")).toBe(true);
    for (const t of ["official", "global_media", "aggregator"] as const) expect(isGroundedTier(t)).toBe(false);
    const counts = { ...emptyTierCounts(), aggregator: 9, local_media: 2 };
    expect(tierDiversity(counts)).toBe(1);
    expect(tierDiversity({ ...counts, specialist: 1, official: 1, global_media: 1 })).toBe(4);
  });

  test("a specialist/research source counts as specialised coverage in the coverage calculation", () => {
    expect(classifySource({ link: "derived", sourceRole: "specialist_research" })).toBe("specialist_local");
    expect(classifySource({ link: "general", sourceRole: "local_media" })).toBe("specialist_local");
    expect(classifySource({ link: "general", sourceRole: "originating" })).toBe("general");
    expect(classifySource({ link: "dedicated", sourceRole: "aggregator" })).toBe("dedicated");
  });
});

// ---------------------------------------------------------------------------
const NOW = new Date("2026-09-20T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const src = (id: string, role: string | null, over: Partial<CoverageSource> = {}): CoverageSource => ({ id, name: id, enabled: true, sourceRole: role, link: "derived", lastSuccessfulIngestion: hoursAgo(1), ...over });
const base = { status: "active", latestEventAt: null, territorialAreas: 0, actorCount: 2, geography: { fighting: ["ZZ"], participants: ["ZZ"], supporters: [], basis: "curated" } };

test.describe("Coverage quality is diversity, not volume", () => {
  test("recent reports from conflict-specific sources make coverage healthy without a published event; one aggregator never does", () => {
    const grounded = [src("local", "local_media"), src("monitor", "specialist_research")];
    const c = computeCoverage({ ...base, sources: grounded, latestReportAt: hoursAgo(2) }, NOW);
    expect(c.health).toBe("healthy");
    expect(c.tiers).toMatchObject({ local_media: 1, specialist: 1 });
    expect(c.tierDiversity).toBe(2);

    // Same reports but only aggregators, however many: weak.
    const aggregators = Array.from({ length: 8 }, (_, i) => src(`agg${i}`, "aggregator"));
    const weak = computeCoverage({ ...base, sources: aggregators, latestReportAt: hoursAgo(1) }, NOW);
    expect(weak.health).toBe("weak");
    expect(weak.independentSources).toBe(1);
    expect(weak.tierDiversity).toBe(0);

    // No reports and no events at all -> weak, and it says so.
    expect(computeCoverage({ ...base, sources: grounded }, NOW).reasons.join(" ")).toMatch(/No events or reports recorded/);
    // Stale reports (older than the window) don't count as fresh activity.
    expect(computeCoverage({ ...base, sources: grounded, latestReportAt: hoursAgo(24 * 10) }, NOW).health).toBe("weak");
  });

  test("a global feed that merely mentions a conflict needs sustained contribution before it counts (threshold constant)", () => {
    expect(COVERAGE_THRESHOLDS.minContributedEvents).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
const row = (over: Partial<CoverageSnapshotRow> & { slug: string }): CoverageSnapshotRow => ({
  status: "active", severity: "high", intensity: 70, health: "no_source", enabledSources: 0, dedicatedSources: 0, specialistSources: 0, generalSources: 0, aggregatorSources: 0, independentSources: 0, ...over,
});

test.describe("Coverage improvement report", () => {
  test("improved / unchanged / regressed are judged on independent and grounded sources and health — not raw source counts", () => {
    const before = [row({ slug: "a" }), row({ slug: "b", health: "weak", enabledSources: 1, generalSources: 1, independentSources: 1 }), row({ slug: "c", health: "healthy", enabledSources: 3, specialistSources: 2, generalSources: 1, independentSources: 3 }), row({ slug: "d", health: "weak", enabledSources: 1, independentSources: 1, generalSources: 1 })];
    const after = [
      row({ slug: "a", health: "weak", enabledSources: 2, specialistSources: 2, independentSources: 2 }), // no source -> covered
      row({ slug: "b", health: "weak", enabledSources: 6, aggregatorSources: 5, generalSources: 1, independentSources: 2 }), // only aggregators added: independent 1 -> 2 (aggregators count once)
      row({ slug: "c", health: "stale", enabledSources: 3, specialistSources: 2, generalSources: 1, independentSources: 3 }), // went stale
      row({ slug: "d", health: "weak", enabledSources: 1, independentSources: 1, generalSources: 1 }),
    ];
    const byslug = Object.fromEntries(compareCoverage(before, after).map((c) => [c.slug, c]));
    expect(byslug.a!.movement).toBe("improved");
    expect(byslug.a!.reasons.join(" ")).toMatch(/independent sources 0 → 2/);
    expect(byslug.c!.movement).toBe("regressed");
    expect(byslug.d!.movement).toBe("unchanged");
    // b gained only aggregators: its independent count moved by exactly the one-aggregator credit, no grounded sources gained.
    expect(byslug.b!.reasons.join(" ")).not.toMatch(/dedicated\/local\/specialist/);
  });

  test("still-undercovered lists live conflicts only, worst severity first, with reasons", () => {
    const rows = [
      row({ slug: "mild", severity: "guarded", intensity: 30 }),
      row({ slug: "war", severity: "severe", intensity: 88, health: "weak", enabledSources: 1, generalSources: 1, independentSources: 1 }),
      row({ slug: "sleepy", status: "dormant", severity: "extreme", intensity: 99 }),
      row({ slug: "ok", severity: "high", health: "healthy", enabledSources: 3, specialistSources: 2, independentSources: 3 }),
      row({ slug: "high", severity: "high", intensity: 70 }),
    ];
    const list = stillUndercovered(rows);
    expect(list.map((r) => r.slug)).toEqual(["war", "high", "mild"]);
    expect(list[0]!.problems).toEqual(expect.arrayContaining(["weak diversity", "no dedicated/local/specialist source"]));
    expect(list.find((r) => r.slug === "high")!.problems).toEqual(["no source"]);
  });
});

// ---------------------------------------------------------------------------
test.describe("Upstream provenance for aggregator posts", () => {
  test("keeps the aggregator's own link and the named / linked upstream, deterministically", () => {
    const info = extractUpstreamSource("Kharkiv region: Fixtown was captured. Source: Fixland General Staff https://example-upstream.test/report/1 https://liveuamap.com/en/2026/x");
    expect(info).toEqual({ upstreamSource: "Fixland General Staff", upstreamUrl: "https://example-upstream.test/report/1", aggregatorUrl: "https://liveuamap.com/en/2026/x" });
    expect(extractUpstreamSource("Explosions reported. via Fixcity Local News https://liveuamap.com/en/y")).toMatchObject({ upstreamSource: "Fixcity Local News", aggregatorUrl: "https://liveuamap.com/en/y" });
    expect(extractUpstreamSource("Update: nothing new.")).toEqual({});
    // A t.me link back to the channel and a URL after "Source:" are not upstream NAMES.
    expect(extractUpstreamSource("See https://t.me/somechannel/9. Source: https://example.org/a")).toEqual({ upstreamUrl: "https://example.org/a" });
    expect(upstreamMetadata(null)).toEqual({});
  });

  test("the fixture Liveuamap-style channel has a post with an upstream, one with a named source, and one with neither", () => {
    const posts = getTelegramFixture("@vigil_fixture_aggregator")!;
    expect(posts).toHaveLength(3);
    expect(Object.keys(upstreamMetadata(posts[2]!.text))).toHaveLength(0);
    expect(upstreamMetadata(posts[0]!.text).upstreamSource).toBe("Fixland General Staff");
  });
});

test.describe("Independent source counting (aggregators)", () => {
  const link = (role: string | null, originating = true) => ({ isOriginatingSource: originating, rawIngestionItem: { source: { sourceRole: role } } });
  test("an aggregator is never an independent confirmation, alone or beside the upstream it cites", () => {
    expect(independentSourceCount([])).toBe(0);
    expect(independentSourceCount([link("aggregator")])).toBe(1); // a report exists behind it, but not an independent one
    expect(independentSourceCount([link("aggregator"), link("local_media")])).toBe(1); // aggregator + upstream = ONE
    expect(independentSourceCount([link("aggregator"), link("local_media"), link("specialist_research")])).toBe(2);
    expect(independentSourceCount([link("relay"), link("aggregator"), link("aggregator")])).toBe(1);
    expect(independentSourceCount([link("local_media"), link("originating", false)])).toBe(1); // relays link with isOriginating false
  });
});

// ---------------------------------------------------------------------------
test.describe("Source expansion data", () => {
  test("no duplicate sources, only public feeds, valid roles, and every conflict link points at a registry conflict", () => {
    const urls = expansion.sources.filter((s) => s.url).map((s) => s.url!);
    expect(new Set(urls).size).toBe(urls.length);
    const names = expansion.sources.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    const slugs = new Set(REGISTRY_CONFLICTS.map((c) => c.slug));
    for (const s of expansion.sources) {
      expect(SOURCE_ROLES as readonly string[], s.name).toContain(s.sourceRole);
      expect(s.links.length, `${s.name} links`).toBeGreaterThan(0);
      for (const l of s.links) expect(slugs.has(l.conflict), `${s.name} -> ${l.conflict}`).toBe(true);
      if (s.type === "rss") expect(s.url, s.name).toMatch(/^https:\/\//);
    }
    expect(expansion.sources.length).toBeGreaterThanOrEqual(30);
  });

  test("multi-conflict feeds are linked explicitly and carry no country, so they are never derived as coverage for every conflict", () => {
    for (const name of ["InSight Crime", "The New Humanitarian", "FDD's Long War Journal"]) {
      const s = expansion.sources.find((x) => x.name === name)!;
      expect(s.country, name).toBeUndefined();
      expect(s.links.length, name).toBeGreaterThan(3);
      expect(s.links.every((l) => l.scope === "general")).toBe(true);
    }
  });

  test("the prioritised gaps each gained a local or specialist source", () => {
    const covered = new Set(expansion.sources.filter((s) => s.sourceRole !== "aggregator").flatMap((s) => s.links.map((l) => l.conflict)));
    for (const slug of ["sudan", "drc", "sahel", "syria", "haiti", "nigeria-insurgencies", "ethiopia", "afghanistan-pakistan", "mexico-cartel", "colombia", "ecuador", "russia-ukraine", "israel-palestine", "myanmar"]) {
      expect(covered.has(slug), slug).toBe(true);
    }
  });

  test("Liveuamap's Telegram channel is an aggregator, disabled without credentials, and never a dedicated source", () => {
    const live = expansion.sources.find((s) => s.telegramHandle === "@liveuamap")!;
    expect(live).toMatchObject({ type: "telegram", sourceRole: "aggregator", enabled: false });
    expect(live.links.every((l) => l.scope === "general")).toBe(true);
  });

  test("the recorded real-source verification covers every expansion source and all of them passed", () => {
    const report = JSON.parse(readFileSync("data/source-verification.json", "utf8")) as { total: number; passed: number; results: { name: string; ok: boolean; checks: Record<string, boolean>; sample?: { url: string } }[] };
    expect(report.results.map((r) => r.name).sort()).toEqual(expansion.sources.map((s) => s.name).sort());
    expect(report.passed).toBe(report.total);
    for (const r of report.results) {
      expect(r.ok, r.name).toBe(true);
      if (r.sample) expect(r.sample.url, r.name).toMatch(/^https?:\/\//);
    }
  });
});

// ---------------------------------------------------------------------------
type Api = APIRequestContext;
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.event.deleteMany({ where: { title: { startsWith: "EXP " } } });
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "exp-" } } });
  await prisma.source.deleteMany({ where: { name: { startsWith: "EXP " } } });
});

const FIXTURE = "http://localhost:3100/api/test-fixtures/rss";

async function makeConflict(request: Api, fighting: string[]) {
  const tag = unique();
  const res = await request.post("/api/admin/conflicts", {
    data: { slug: `exp-${tag}`, name: `EXP ${tag}`, region: "Africa", status: "active", severity: "high", intensity: 70, lat: 5, lng: 5, fightingCountries: fighting, participantCountries: fighting },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; slug: string };
}

async function makeSource(request: Api, over: Record<string, unknown>) {
  const res = await request.post("/api/admin/sources", { data: { name: `EXP ${unique()}`, type: "rss", enabled: true, autoIngest: false, autoProcessing: true, permissionStatus: "authorized", ...over } });
  expect(res.ok()).toBe(true);
  return (await res.json()) as { id: string; name: string };
}

const fetchNow = (request: Api, id: string) => request.post(`/api/admin/sources/${id}/fetch`).then((r) => r.json()) as Promise<{ fetched: number; new: number; errors: number; error?: string }>;
const itemsOf = (request: Api, id: string) => request.get(`/api/admin/incoming?sourceId=${id}`).then((r) => r.json()) as Promise<Record<string, any>[]>;
const coverageRow = async (request: Api, slug: string) => ((await request.get("/api/admin/conflict-coverage").then((r) => r.json())).rows as Record<string, any>[]).find((r) => r.conflict.slug === slug)!;

test.describe("Seeded expansion sources", () => {
  test("every expansion source exists exactly once with its declared role", async ({ request }) => {
    const list = async () => (await request.get("/api/admin/sources").then((r) => r.json())) as { id: string; name: string; url: string | null; telegramHandle: string | null; sourceRole: string | null; enabled: boolean }[];
    const before = await list();
    for (const s of expansion.sources) {
      // Other specs may add their own rows with a real feed URL; the seeder's record is the one carrying the seeded name.
      const matches = before.filter((x) => x.name === s.name && (s.type === "telegram" ? x.telegramHandle === s.telegramHandle : x.url === s.url));
      expect(matches, s.name).toHaveLength(1);
      expect(matches[0]!.sourceRole).toBe(s.sourceRole);
      expect(matches[0]!.enabled).toBe(s.enabled ?? true);
    }
  });

  test("relevance is explicit: a multi-conflict specialist appears only where it is linked, a global feed appears nowhere by default", async ({ request }) => {
    const rows = ((await request.get("/api/admin/conflict-coverage").then((r) => r.json())).rows as Record<string, any>[]);
    const namesIn = (slug: string) => rows.find((r) => r.conflict.slug === slug)!.sources.map((s: { name: string }) => s.name);
    expect(namesIn("haiti")).toEqual(expect.arrayContaining(["InSight Crime", "The New Humanitarian", "Le Nouvelliste (Haiti)"]));
    expect(namesIn("myanmar")).not.toContain("InSight Crime");
    expect(namesIn("myanmar")).not.toContain("FDD's Long War Journal");
    for (const slug of ["haiti", "ecuador", "kurdish-iran", "libya"]) expect(namesIn(slug), slug).not.toContain("BBC World");
    // Tiers are reported per source.
    const dabanga = rows.find((r) => r.conflict.slug === "sudan")!.sources.find((s: { name: string }) => s.name === "Radio Dabanga");
    expect(dabanga).toMatchObject({ tier: "local_media", kind: "dedicated" });
    expect(rows.find((r) => r.conflict.slug === "yemen-red-sea")!.sources.find((s: { name: string }) => s.name === "Sana'a Center for Strategic Studies")).toMatchObject({ tier: "specialist" });
  });

  test("a source can cover a whole region: linking to a conflict family covers every member, and unlinking removes it", async ({ request }) => {
    const s = await makeSource(request, { name: `EXP Regional ${unique()}`, url: `${FIXTURE}/expansion-specialist-feed`, sourceRole: "specialist_research" });
    const link = await request.post("/api/admin/source-links", { data: { sourceId: s.id, familySlug: "kurdish-conflicts", scope: "general" } });
    expect(link.status()).toBe(201);
    expect((await link.json()).linked).toBe(3);
    for (const slug of ["kurdish-turkey-pkk", "kurdish-iran", "kurdish-syria-sdf"]) {
      expect((await coverageRow(request, slug)).sources.map((x: { id: string }) => x.id), slug).toContain(s.id);
    }
    expect((await coverageRow(request, "myanmar")).sources.map((x: { id: string }) => x.id)).not.toContain(s.id);
    await request.delete("/api/admin/source-links", { data: { sourceId: s.id, familySlug: "kurdish-conflicts" } });
    expect((await coverageRow(request, "kurdish-iran")).sources.map((x: { id: string }) => x.id)).not.toContain(s.id);
  });

  test("a global source only counts for a conflict it merely mentions after sustained contribution", async ({ request }) => {
    const c = await makeConflict(request, ["ZM"]);
    const global = await makeSource(request, { name: `EXP Global ${unique()}`, type: "manual", url: null, sourceRole: "originating" });
    const publishOne = async (n: number) => {
      const item = await request.post("/api/admin/incoming/manual", { data: { sourceId: global.id, externalId: `exp-${unique()}-${n}`, originalUrl: `https://fixture.test/exp/${unique()}`, originalTitle: `EXP mention ${n}`, originalText: "A passing mention.", publishedAt: new Date().toISOString() } }).then((r) => r.json());
      const res = await request.post(`/api/admin/incoming/${item.id}/publish`, { data: { title: `EXP mention ${n} ${unique()}`, summary: "s", eventType: "other", latitude: 5, longitude: 5, occurredAt: new Date().toISOString(), severity: "elevated", conflictId: c.id } });
      expect(res.status()).toBe(201);
    };
    const has = async () => (await coverageRow(request, c.slug)).sources.some((s: { id: string }) => s.id === global.id);
    await publishOne(1);
    await publishOne(2);
    expect(await has()).toBe(false); // two mentions: not coverage
    await publishOne(3);
    expect(await has()).toBe(true); // sustained: counted, as a general (not dedicated) source
    expect((await coverageRow(request, c.slug)).sources.find((s: { id: string }) => s.id === global.id)).toMatchObject({ kind: "general", tier: "global_media" });
  });
});

// ---------------------------------------------------------------------------
test.describe("Ingestion provenance and duplicate protection", () => {
  test("original URL, publication time and author survive; empty guids and dc:date feeds still dedupe correctly", async ({ request }) => {
    const c = await makeConflict(request, ["ZL"]);
    const s = await makeSource(request, { country: "ZL", language: "en", url: `${FIXTURE}/expansion-local-feed`, sourceRole: "local_media" });
    await request.post("/api/admin/source-links", { data: { sourceId: s.id, conflictId: c.id, scope: "dedicated" } });

    const first = await fetchNow(request, s.id);
    expect(first).toMatchObject({ fetched: 3, new: 3, errors: 0 });
    const items = await itemsOf(request, s.id);
    expect(items).toHaveLength(3); // empty <guid> did NOT collapse the feed
    const byUrl = Object.fromEntries(items.map((i) => [i.originalUrl, i]));
    const captured = byUrl["https://fixture.test/expansion/local/fixtown-captured"]!;
    expect(captured.originalUrl).toBe("https://fixture.test/expansion/local/fixtown-captured"); // exactly as the feed gave it
    expect(new Date(captured.publishedAt).toISOString()).toBe("2026-01-01T13:00:00.000Z");
    expect(captured.rawMetadata.author).toBe("Fixture Local Reporter");
    const market = byUrl["https://fixture.test/expansion/local/fixcity-market"]!;
    expect(new Date(market.publishedAt).toISOString()).toBe("2026-01-01T14:00:00.000Z"); // from dc:date
    expect(market.originalTitle).toBe("Café owners return to Fixcity market"); // numeric character reference decoded

    // Duplicate protection: a second fetch stores nothing new.
    expect(await fetchNow(request, s.id)).toMatchObject({ fetched: 3, new: 0, errors: 0 });
    expect(await itemsOf(request, s.id)).toHaveLength(3);
    const row = await coverageRow(request, c.slug);
    expect(row.sources.find((x: { id: string }) => x.id === s.id)).toMatchObject({ tier: "local_media", kind: "dedicated" });
  });

  test("coverage improves as independent local and specialist sources are added and ingest — and one fresh aggregator never makes it healthy", async ({ request }) => {
    const c = await makeConflict(request, ["ZK"]);
    expect((await coverageRow(request, c.slug)).health).toBe("no_source");

    // A high-volume aggregator: fresh, several items, but only one voice.
    const agg = await makeSource(request, { type: "telegram", url: null, telegramHandle: "@vigil_fixture_aggregator", sourceRole: "aggregator", enabled: true });
    await request.post("/api/admin/source-links", { data: { sourceId: agg.id, conflictId: c.id, scope: "general" } });
    expect(await fetchNow(request, agg.id)).toMatchObject({ new: 3, errors: 0 });
    let row = await coverageRow(request, c.slug);
    expect(row.health).toBe("weak");
    expect(row).toMatchObject({ aggregatorSources: 1, independentSources: 1, tierDiversity: 0 });

    // One local source: better, still a single independent voice beside an aggregator.
    const local = await makeSource(request, { country: "ZK", url: `${FIXTURE}/expansion-local-feed`, sourceRole: "local_media" });
    await fetchNow(request, local.id);
    row = await coverageRow(request, c.slug);
    expect(row.independentSources).toBe(2);
    expect(row.tiers).toMatchObject({ local_media: 1, aggregator: 1 });

    // A specialist source completes it: fresh ingestion, reports, and 2+ independent grounded voices.
    const monitor = await makeSource(request, { url: `${FIXTURE}/expansion-specialist-feed`, sourceRole: "specialist_research" });
    await request.post("/api/admin/source-links", { data: { sourceId: monitor.id, conflictId: c.id, scope: "general" } });
    await fetchNow(request, monitor.id);
    row = await coverageRow(request, c.slug);
    expect(row.health).toBe("healthy");
    expect(row.tiers).toMatchObject({ local_media: 1, specialist: 1, aggregator: 1 });
    expect(row.tierDiversity).toBe(2);
    expect(row.latestReportAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
test.describe("Liveuamap Telegram (aggregator/discovery)", () => {
  test("the real @liveuamap source ships disabled, credential-gated, and reports the adapter as unavailable — nothing is scraped", async ({ request }) => {
    const sources = (await request.get("/api/admin/sources").then((r) => r.json())) as { id: string; telegramHandle: string | null; enabled: boolean; sourceRole: string; permissionStatus: string }[];
    const live = sources.find((s) => s.telegramHandle === "@liveuamap")!;
    expect(live).toMatchObject({ enabled: false, sourceRole: "aggregator", permissionStatus: "unauthorized" });
    const test = await request.post(`/api/admin/sources/${live.id}/test`).then((r) => r.json());
    expect(test.ok).toBe(false);
    expect(test.message).toMatch(/no authorized credentials/i);
    const fetched = await fetchNow(request, live.id);
    expect(fetched.fetched).toBe(0); // no credentials -> nothing fetched, and no fallback to scraping t.me
    expect((await itemsOf(request, live.id)).length).toBe(0);
    // Never a dedicated source for any conflict.
    const rows = ((await request.get("/api/admin/conflict-coverage").then((r) => r.json())).rows as Record<string, any>[]);
    for (const r of rows) expect(r.sources.find((s: { id: string }) => s.id === live.id)?.kind ?? "aggregator").not.toBe("dedicated");
  });

  test("through the (fixture) Telegram adapter, posts keep timestamp, permalink, Liveuamap URL and upstream, and dedupe on re-fetch", async ({ request }) => {
    const agg = await makeSource(request, { type: "telegram", url: null, telegramHandle: "@vigil_fixture_aggregator", sourceRole: "aggregator", country: "ZJ" });
    expect(await fetchNow(request, agg.id)).toMatchObject({ fetched: 3, new: 3, errors: 0 });
    const items = await itemsOf(request, agg.id);
    const byId = Object.fromEntries(items.map((i) => [i.externalId, i]));
    const first = byId["101"]!;
    expect(first.originalUrl).toBe("https://t.me/vigil_fixture_aggregator/101");
    expect(new Date(first.publishedAt).toISOString()).toBe("2026-01-01T10:00:00.000Z");
    expect(first.rawMetadata).toMatchObject({
      channel: "vigil_fixture_aggregator",
      messageId: 101,
      upstreamSource: "Fixland General Staff",
      upstreamUrl: "https://example-upstream.test/report/fixtown-101",
      aggregatorUrl: "https://liveuamap.com/en/2026/1-january-fixtown-captured",
    });
    expect(byId["102"]!.rawMetadata).toMatchObject({ upstreamSource: "Fixcity Local News", aggregatorUrl: "https://liveuamap.com/en/2026/1-january-fixcity-explosions" });
    expect(byId["103"]!.rawMetadata.upstreamSource).toBeUndefined();
    expect(await fetchNow(request, agg.id)).toMatchObject({ fetched: 3, new: 0, errors: 0 });
  });

  test("an aggregator post plus the upstream report it cites are ONE independent source, never two", async ({ request }) => {
    const c = await makeConflict(request, ["ZI"]);
    const agg = await makeSource(request, { type: "telegram", url: null, telegramHandle: "@vigil_fixture_aggregator", sourceRole: "aggregator" });
    const local = await makeSource(request, { country: "ZI", url: `${FIXTURE}/expansion-local-feed`, sourceRole: "local_media" });
    await fetchNow(request, agg.id);
    await fetchNow(request, local.id);
    const aggItem = (await itemsOf(request, agg.id)).find((i) => i.externalId === "102")!;
    const localItems = await itemsOf(request, local.id);
    const upstream = localItems.find((i) => i.originalUrl.endsWith("fixcity-market"))!;
    const another = localItems.find((i) => i.originalUrl.endsWith("fixridge-shelling"))!;

    // Publish from the aggregator's post.
    const published = await request.post(`/api/admin/incoming/${aggItem.id}/publish`, {
      data: { title: `EXP Fixcity explosions ${unique()}`, summary: "s", eventType: "explosion", latitude: 5, longitude: 5, occurredAt: new Date().toISOString(), severity: "elevated", conflictId: c.id },
    }).then((r) => r.json());
    const countOf = async () => ((await request.get("/api/events").then((r) => r.json())) as { id: string; sourceCount: number; sources: { note?: string }[] }[]).find((e) => e.id === published.id)!;
    expect((await countOf()).sourceCount).toBe(1);

    // The upstream independent report is merged: still ONE independent source (the aggregator adds none).
    await request.post(`/api/admin/incoming/${upstream.id}/merge`, { data: { eventId: published.id, relationship: "corroborating" } });
    expect((await countOf()).sourceCount).toBe(1);

    // A second aggregator post asked to be "corroborating" is stored as a relay regardless.
    const second = (await itemsOf(request, agg.id)).find((i) => i.externalId === "103")!;
    await request.post(`/api/admin/incoming/${second.id}/merge`, { data: { eventId: published.id, relationship: "corroborating" } });
    let event = await countOf();
    expect(event.sourceCount).toBe(1);
    expect(event.sources.filter((s) => s.note?.includes("Relay")).length).toBeGreaterThanOrEqual(1);

    // A genuinely different independent report raises it to 2.
    await request.post(`/api/admin/incoming/${another.id}/merge`, { data: { eventId: published.id, relationship: "corroborating" } });
    event = await countOf();
    expect(event.sourceCount).toBe(2);
  });

  test("an aggregator-only territorial claim can't change territory; independent corroboration makes it reviewable", async ({ request }) => {
    const c = await makeConflict(request, ["ZH"]);
    const agg = await makeSource(request, { type: "telegram", url: null, telegramHandle: "@vigil_fixture_aggregator", sourceRole: "aggregator", country: "ZH" });
    await fetchNow(request, agg.id);
    const listCandidates = async () => ((await request.get(`/api/admin/territorial-change-candidates?conflictId=${c.id}`).then((r) => r.json())) as Record<string, any>[]);
    let candidates = await listCandidates();
    expect(candidates).toHaveLength(1);
    const cand = candidates[0]!;
    expect(cand).toMatchObject({ locationName: "Fixtown", claimedActorName: "Fixland", sourceRole: "aggregator" });
    expect(cand.confidence).toBeLessThanOrEqual(0.3); // an aggregator lead is capped low
    expect(cand.evidence).toContain("AGGREGATOR SOURCE");

    const refused = await request.post(`/api/admin/territorial-change-candidates/${cand.id}/review`, { data: { action: "approve" } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toMatch(/Aggregator-only evidence/);
    const geometry = await request.post(`/api/admin/territorial-change-candidates/${cand.id}/apply-geometry`, { data: { geometry: { type: "Polygon", coordinates: [[[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]] }, confirm: true } });
    expect(geometry.status()).toBe(409);
    expect(((await request.get("/api/admin/territorial-control").then((r) => r.json())) as { conflictId: string }[]).filter((t) => t.conflictId === c.id)).toHaveLength(0);
    // Rejecting or marking uncertain is still allowed.
    expect((await request.post(`/api/admin/territorial-change-candidates/${cand.id}/review`, { data: { action: "uncertain" } })).status()).toBe(200);

    // An independent local report states the same claim: it corroborates the candidate.
    const local = await makeSource(request, { country: "ZH", url: `${FIXTURE}/expansion-local-feed`, sourceRole: "local_media" });
    await fetchNow(request, local.id);
    candidates = await listCandidates();
    expect(candidates).toHaveLength(1); // same underlying claim: no duplicate proposal
    expect(candidates[0]!.corroboration.map((x: { sourceRole: string }) => x.sourceRole)).toContain("local_media");
    const ok = await request.post(`/api/admin/territorial-change-candidates/${cand.id}/review`, { data: { action: "approve" } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).status).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
test.describe("Coverage dashboard shows the expansion", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "Mobile", "Admin dashboard is a desktop workflow");
  });
  test.use({ isMobile: false });

  test("improvement report, still-undercovered list and per-source tiers", async ({ page, request }) => {
    const report = await request.get("/api/admin/conflict-coverage/improvements").then((r) => r.json());
    expect(report.baseline.label).toBe("pre-source-expansion");
    expect(report.improved.map((c: { slug: string }) => c.slug)).toEqual(expect.arrayContaining(["sudan", "haiti", "drc", "afghanistan-pakistan"]));
    const under = report.stillUndercovered.map((c: { slug: string }) => c.slug);
    expect(under).toEqual(expect.arrayContaining(["kurdish-iran", "kurdish-turkey-pkk"])); // thin or no feeds found for these
    // Worst first.
    const order = ["stable", "guarded", "elevated", "high", "severe", "extreme"];
    const severities = report.stillUndercovered.map((c: { severity: string }) => order.indexOf(c.severity));
    expect([...severities].sort((a, b) => b - a)).toEqual(severities);

    await page.goto("/admin/conflict-coverage");
    await expect(page.getByTestId("cov-improvements")).toBeVisible();
    await expect(page.getByTestId("cov-improvements-baseline")).toContainText("pre-source-expansion");
    await expect(page.getByTestId("cov-improved-sudan")).toBeVisible();
    await expect(page.getByTestId("cov-undercovered-kurdish-iran")).toContainText(/source|stale|weak/);

    await page.getByTestId("cov-row-sudan").click();
    await expect(page.getByTestId("cov-sources")).toContainText("Radio Dabanga");
    await expect(page.getByTestId("cov-sources")).toContainText("Local / originating media");
    await expect(page.getByTestId("cov-sources")).toContainText("Specialist / research"); // The New Humanitarian
  });
});
