import { test, expect, type Page } from "@playwright/test";
import { buildSignals, buildTicker, HIGH_TENSION_MIN_SCORE, liveState, rankEntities } from "@/lib/world/derive";
import type { CommandCenter, WorldItem } from "@/lib/world/types";

// World Command Center: the derivation rules (pure), the aggregated endpoint, and the /world UI. UI behaviour is
// driven by a mocked aggregate payload so it does not depend on which rows other specs left in the shared test
// database; the endpoint itself is exercised for real in "the aggregate endpoint".

const NOW = new Date("2026-09-21T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function item(over: Partial<WorldItem> & { id: string }): WorldItem {
  return { category: "conflict", developmentType: "conflict_event", headline: `Headline ${over.id}`, summary: "", occurredAt: ago(30), place: null, countryCode: null, source: "Reuters", confidence: 70, confidenceLabel: "medium", significance: 70, badges: [], isPartyClaim: false, conflictSlug: null, conflictName: null, lat: null, lng: null, zoom: null, layers: [], eventId: null, hazardId: null, territory: false, deepLink: "/brief", ...over };
}

test.describe("derivation rules (pure)", () => {
  test("live state reflects real ingestion freshness", () => {
    expect(liveState(ago(10), NOW).state).toBe("live");
    expect(liveState(ago(60 * 5), NOW).state).toBe("delayed");
    expect(liveState(ago(60 * 24 * 5), NOW).state).toBe("stale");
    expect(liveState(null, NOW)).toEqual({ state: "no-data", label: "NO DATA" });
    expect(HIGH_TENSION_MIN_SCORE).toBe(70);
  });

  test("ticker de-duplicates, drops party claims and low significance, and is newest first", () => {
    const list = [
      item({ id: "a", headline: "Strike on depot", conflictSlug: "x", place: "Kharkiv", occurredAt: ago(10), significance: 80 }),
      item({ id: "a", headline: "Strike on depot", conflictSlug: "x", place: "Kharkiv", occurredAt: ago(10), significance: 80 }), // same id
      item({ id: "b", headline: "Strike  on depot!", conflictSlug: "y", place: "Elsewhere", occurredAt: ago(20), significance: 75 }), // same normalised headline + type
      item({ id: "c", headline: "Second strike", conflictSlug: "x", place: "kharkiv", occurredAt: ago(15), significance: 90 }), // same conflict + type + place
      item({ id: "d", headline: "Party claim", isPartyClaim: true, significance: 95, occurredAt: ago(5) }),
      item({ id: "e", headline: "Minor", significance: 55, occurredAt: ago(2) }),
      item({ id: "f", headline: "Earthquake M6.2", category: "hazard", developmentType: "earthquake", occurredAt: ago(40), significance: 85 }),
    ];
    const out = buildTicker(list);
    expect(out.map((i) => i.id)).toEqual(["a", "f"]);
  });

  test("top entities rank distinct developments; a syndicated story cannot dominate", () => {
    // One story republished by ten outlets is ONE development; another conflict has three distinct ones.
    const syndicated = item({ id: "s1", conflictSlug: "syn", conflictName: "Syndicated", significance: 90, occurredAt: ago(20) });
    const distinct = ["d1", "d2", "d3"].map((id) => item({ id, conflictSlug: "solid", conflictName: "Solid", significance: 70, occurredAt: ago(30) }));
    const r = rankEntities([syndicated, ...distinct], NOW, () => null);
    expect(r["6h"][0]).toMatchObject({ key: "solid", developments: 3 });
    expect(r["6h"][1]).toMatchObject({ key: "syn", developments: 1 });
    // 1h window excludes items older than one hour; party claims never count.
    expect(rankEntities([item({ id: "old", conflictSlug: "z", conflictName: "Z", occurredAt: ago(90) }), item({ id: "pc", conflictSlug: "z", conflictName: "Z", isPartyClaim: true, occurredAt: ago(5) })], NOW, () => null)["1h"]).toEqual([]);
  });

  test("global signals group by domain and are empty (not invented) when nothing happened", () => {
    const signals = buildSignals([item({ id: "q", category: "hazard", developmentType: "earthquake" }), item({ id: "p", category: "infrastructure", developmentType: "airport" })]);
    expect(signals.find((s) => s.key === "hazards")?.count).toBe(1);
    expect(signals.find((s) => s.key === "aviation")?.count).toBe(1);
    expect(signals.find((s) => s.key === "internet")).toMatchObject({ count: 0, items: [] });
  });
});

test.describe("the aggregate endpoint", () => {
  test("returns every module in one payload with consistent counters and no party claims by default", async ({ request }) => {
    const res = await request.get("/api/world/command-center");
    expect(res.ok()).toBeTruthy();
    const cc = (await res.json()) as CommandCenter;
    expect(Object.keys(cc).sort()).toEqual(["conflicts", "generatedAt", "globalSignals", "meta", "pulse", "status", "ticker", "topEntities", "whatChanged"]);
    expect(cc.status.highTension).toBeLessThanOrEqual(cc.status.activeConflicts);
    expect(cc.status.activeConflicts).toBeGreaterThanOrEqual(cc.conflicts.length === 0 ? 0 : 1);
    expect(cc.ticker.every((i) => !i.isPartyClaim)).toBe(true);
    expect(cc.pulse.every((i) => !i.isPartyClaim)).toBe(true);
    expect(cc.meta.includePartyClaims).toBe(false);
    expect(new Set(cc.ticker.map((i) => i.id)).size).toBe(cc.ticker.length);
    expect(Object.keys(cc.topEntities)).toEqual(["1h", "6h", "24h"]);
    expect(cc.globalSignals.map((s) => s.key)).toEqual(["hazards", "aviation", "maritime", "energy", "internet"]);
    // Active conflicts, from the canonical registry.
    const overview = await (await request.get("/api/public/overview")).json();
    const active = (overview.conflicts as { status: string }[]).filter((c) => c.status === "active").length;
    expect(cc.status.activeConflicts).toBe(active);
  });

  test("the conflict context keeps severity, impact and confidence separate and rejects unknown slugs", async ({ request }) => {
    expect((await request.get("/api/world/conflict?slug=no-such-conflict")).status()).toBe(404);
    expect((await request.get("/api/world/conflict")).status()).toBe(400);
    const overview = await (await request.get("/api/public/overview")).json();
    const conflict = (overview.conflicts as { slug: string }[])[0];
    test.skip(!conflict, "no conflicts in the test database");
    const ctx = await (await request.get(`/api/world/conflict?slug=${conflict!.slug}&country=FI`)).json();
    expect(ctx.severity).toHaveProperty("score");
    expect(ctx.confidence).toHaveProperty("score");
    expect(ctx.impact).toMatchObject({ countryCode: "FI" });
    expect(ctx.href).toBe(`/conflict/${conflict!.slug}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
function payload(over: Partial<CommandCenter> = {}, claims = false): CommandCenter {
  const items: WorldItem[] = [
    item({ id: "strike", headline: "Missile strike reported near Kharkiv", place: "Kharkiv", countryCode: "UA", conflictSlug: "ukraine", conflictName: "Ukraine", lat: 49.99, lng: 36.23, zoom: 7, occurredAt: ago(12), significance: 88, confidenceLabel: "high", confidence: 82, badges: ["VERIFIED"] }),
    item({ id: "quake", category: "hazard", developmentType: "earthquake", headline: "M6.4 earthquake off the coast of Japan", place: "Honshu", countryCode: "JP", lat: 36, lng: 141, zoom: 6, layers: ["earthquakes"], hazardId: "hz-1", occurredAt: ago(25), significance: 80, badges: ["OFFICIAL", "HAZARD"] }),
    item({ id: "terr", category: "territory", developmentType: "territory_changed", headline: "Control of Bakhmut area changed", conflictSlug: "ukraine", conflictName: "Ukraine", lat: 48.6, lng: 38, zoom: 7, territory: true, occurredAt: ago(50), significance: 76, badges: ["TERRITORY"] }),
    item({ id: "airport", category: "infrastructure", developmentType: "airport", headline: "Airport operations disrupted at ODS", lat: 46.4, lng: 30.7, layers: ["aviation"], occurredAt: ago(70), significance: 65 }),
  ];
  if (claims) items.unshift(item({ id: "claim", headline: "Party says it destroyed a convoy", isPartyClaim: true, badges: ["PARTY CLAIM"], conflictSlug: "ukraine", conflictName: "Ukraine", lat: 49, lng: 37, occurredAt: ago(5), significance: 70, confidenceLabel: "low", confidence: 30 }));
  return {
    generatedAt: NOW.toISOString(),
    status: { activeConflicts: 7, highTension: 3, newDevelopments: 11, live: { state: "live", label: "LIVE", lastIngestionAt: ago(4), lastEventAt: ago(12) } },
    ticker: items.filter((i) => !i.isPartyClaim),
    pulse: items,
    whatChanged: items.slice(0, 2).filter((i) => !i.isPartyClaim),
    topEntities: { "1h": [], "6h": [{ kind: "conflict", key: "ukraine", label: "Ukraine", developments: 2, score: 164, lead: "Missile strike reported near Kharkiv" }, { kind: "country", key: "JP", label: "Japan", developments: 1, score: 80, lead: "M6.4 earthquake" }], "24h": [] },
    globalSignals: [
      { key: "hazards", label: "Hazards", count: 1, items: [items[1]!] },
      { key: "aviation", label: "Airports & airspace", count: 1, items: [items[3]!] },
      { key: "maritime", label: "Maritime", count: 0, items: [] },
      { key: "energy", label: "Energy", count: 0, items: [] },
      { key: "internet", label: "Internet", count: 0, items: [] },
    ],
    conflicts: [{ id: "c-ukraine", slug: "ukraine", name: "Ukraine", severity: "extreme", severityScore: 100, lat: 49, lng: 32, recent: true, latestTitle: "Missile strike reported near Kharkiv" }],
    meta: { revision: "t", computeMs: 1, includePartyClaims: claims, partyClaimsHidden: claims ? 0 : 1, thresholds: { highTensionMinScore: 70, liveMaxMinutes: 120 } },
    ...over,
  };
}

const CONFLICT_CTX = { slug: "ukraine", name: "Russia-Ukraine War", status: "active", statusLabel: "Active", severity: { label: "extreme", score: 100 }, confidence: { score: 74, reasons: [] }, impact: { countryCode: "FI", countryName: "Finland", score: 78, hardFloor: "bordering_war", reasons: ["Full-scale war in a bordering country"] }, summary: "Full-scale war.", latest: [], territory: { areas: 12, actors: [{ name: "Ukraine", areas: 7 }], lastChangeAt: null }, participants: [{ name: "Ukrainian Armed Forces", role: "Actor", href: null }], corroboratedSources: 5, lat: 49, lng: 32, href: "/conflict/ukraine" };

async function mockWorld(page: Page, opts: { claims?: boolean; data?: CommandCenter } = {}) {
  const seen: string[] = [];
  await page.route("**/api/world/command-center**", async (route) => {
    const claims = new URL(route.request().url()).searchParams.get("claims") === "1";
    seen.push(route.request().url());
    await route.fulfill({ json: opts.data ?? payload({}, claims) });
  });
  await page.route("**/api/world/conflict**", (route) => route.fulfill({ json: CONFLICT_CTX }));
  return seen;
}

const center = async (page: Page) => {
  await page.waitForFunction(() => !!(window as unknown as { __vigilMap?: unknown }).__vigilMap, undefined, { timeout: 30_000 });
  return page.evaluate(() => {
    const c = (window as unknown as { __vigilMap: { getCenter(): { lng: number; lat: number } } }).__vigilMap.getCenter();
    return { lng: c.lng, lat: c.lat };
  });
};

test.describe("World Command Center UI", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, "desktop layout; phone layout is covered below");
  });

  test("status counters, live indicator and one aggregated request", async ({ page }) => {
    const seen = await mockWorld(page);
    await page.goto("/world");
    await expect(page.getByTestId("stat-active")).toHaveText("7");
    await expect(page.getByTestId("stat-tension")).toHaveText("3");
    await expect(page.getByTestId("stat-new")).toHaveText("11");
    await expect(page.getByTestId("live-indicator")).toHaveAttribute("data-live-state", "live");
    await expect(page.getByTestId("live-indicator")).toContainText("LIVE");
    expect(seen.length).toBe(1); // every module reads the same aggregate; no per-module polling
  });

  test("a stale ingestion is not shown as LIVE", async ({ page }) => {
    const p = payload();
    p.status.live = { state: "stale", label: "STALE", lastIngestionAt: ago(60 * 24 * 5), lastEventAt: null };
    await mockWorld(page, { data: p });
    await page.goto("/world");
    await expect(page.getByTestId("live-indicator")).toHaveAttribute("data-live-state", "stale");
    await expect(page.getByTestId("live-indicator")).not.toContainText("LIVE");
  });

  test("ticker lists significant developments once each; hover pauses the animation", async ({ page }) => {
    await mockWorld(page);
    await page.goto("/world");
    const items = page.getByTestId("ticker-item");
    await expect(items).toHaveCount(4);
    const ids = await items.evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id")));
    expect(new Set(ids).size).toBe(ids.length);
    await expect(page.getByTestId("ticker")).not.toContainText("Party says");
    await page.getByTestId("ticker").hover(); // the moving items themselves are not stable targets
    await expect(page.getByTestId("ticker-track")).toHaveCSS("animation-play-state", "paused");
  });

  test("ticker click focuses the map and enables the layer (reduced motion: static, scrollable strip)", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockWorld(page);
    await page.goto("/world");
    await page.getByTestId("ticker-item").filter({ hasText: "Airport operations" }).click();
    await expect.poll(async () => (await center(page)).lat, { timeout: 5000 }).toBeCloseTo(46.4, 0);
    await expect(page.locator("[data-hazard-layers]")).toHaveAttribute("data-hazard-layers", /aviation/);
  });

  test("Pulse rows: badges, confidence tooltip, tabs and focus + conflict context", async ({ page }) => {
    await mockWorld(page);
    await page.goto("/world");
    const rows = page.getByTestId("pulse-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.first().getByTestId("pulse-badge")).toHaveText("VERIFIED");
    await expect(rows.first().getByTestId("confidence-badge")).toHaveAttribute("title", "Confidence reflects evidence/corroboration. It does not represent severity.");
    await page.getByTestId("pulse-tab-hazard").click();
    await expect(rows).toHaveCount(1);
    await page.getByTestId("pulse-tab-all").click();
    await rows.first().click();
    await expect(page.getByTestId("right-rail").getByTestId("conflict-context")).toBeVisible();
    await expect(rows.first()).toHaveAttribute("aria-current", "true");
    await expect.poll(async () => (await center(page)).lat, { timeout: 5000 }).toBeCloseTo(49.99, 0);
  });

  test("context switching: conflict, then country, then back to the default rail", async ({ page }) => {
    await mockWorld(page);
    await page.route("**/api/countries/JP/intelligence", (route) => route.fulfill({ json: { country: { code: "JP", name: "Japan", flag: "" }, overview: { exposureScore: 12, exposureLabel: "Low", activeDomesticConflicts: 0, highImpactNearbyConflicts: 0, significantDisruptions: 0, latestDevelopment: null, statusLine: "No active conflict inside Japan." }, domesticConflicts: [], nearbyConflicts: [], developments: [] } }));
    await page.goto("/world");
    await expect(page.getByTestId("world-rail")).toBeVisible();
    await page.getByTestId("entity-row").first().click(); // Ukraine (conflict)
    const ctx = page.getByTestId("right-rail").getByTestId("conflict-context");
    await expect(ctx).toBeVisible();
    // Severity, impact and confidence are three separate values; the confidence disclaimer is shown.
    await expect(page.getByTestId("right-rail").getByTestId("ctx-severity")).toHaveText("100");
    await expect(page.getByTestId("right-rail").getByTestId("ctx-impact")).toHaveText("78");
    await expect(page.getByTestId("right-rail").getByTestId("ctx-confidence")).toHaveText("74");
    await expect(ctx).toContainText("Confidence reflects evidence/corroboration. It does not represent severity.");
    await expect(page.getByTestId("right-rail").getByTestId("ctx-open-full")).toHaveAttribute("href", "/conflict/ukraine");
    await ctx.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("world-rail")).toBeVisible();
    await page.getByTestId("entity-row").nth(1).click(); // Japan (country)
    await expect(page.getByTestId("right-rail").getByTestId("country-context")).toBeVisible();
    await expect(page.getByTestId("right-rail").getByTestId("ctx-country-impact")).toHaveText("12");
    // World -> country: the panel opens the canonical country intelligence page (the same service it reads).
    await expect(page.getByTestId("right-rail").getByTestId("ctx-open-country")).toHaveText("Open Country Intelligence");
    await expect(page.getByTestId("right-rail").getByTestId("ctx-open-country")).toHaveAttribute("href", "/country/JP");
    await page.getByTestId("right-rail").getByTestId("country-context").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("world-rail")).toBeVisible();
  });

  test("party claims are hidden by default and shown, badged, only when the setting is on", async ({ page }) => {
    await mockWorld(page);
    await page.goto("/world");
    await expect(page.getByTestId("pulse-row")).toHaveCount(4);
    await expect(page.getByTestId("pulse-hidden-claims")).toContainText("1 party claim hidden");
    await page.addInitScript(() => localStorage.setItem("vigil-preferences", JSON.stringify({ state: { showPartyClaims: true }, version: 3 })));
    await page.reload();
    const claim = page.getByTestId("pulse-row").filter({ hasText: "Party says" });
    await expect(claim).toHaveCount(1);
    await expect(claim.getByTestId("pulse-badge")).toHaveText("PARTY CLAIM");
    await expect(page.getByTestId("ticker")).not.toContainText("Party says"); // never in the ticker
  });

  test("empty states are honest", async ({ page }) => {
    const empty = payload({ ticker: [], pulse: [], whatChanged: [], topEntities: { "1h": [], "6h": [], "24h": [] }, globalSignals: [], conflicts: [], status: { activeConflicts: 0, highTension: 0, newDevelopments: 0, live: { state: "no-data", label: "NO DATA", lastIngestionAt: null, lastEventAt: null } } });
    await mockWorld(page, { data: empty });
    await page.goto("/world");
    await expect(page.getByTestId("ticker-empty")).toHaveText("No major developments in this window.");
    await expect(page.getByTestId("pulse-empty")).toHaveText("No major developments in this window.");
    await expect(page.getByTestId("rail-what-changed")).toContainText("No major developments in this window.");
    await expect(page.getByTestId("stat-active")).toHaveText("0");
    await expect(page.getByTestId("live-indicator")).toContainText("NO DATA");
    await expect(page.getByTestId("live-view-button")).toBeDisabled();
  });

  test("Live View is opt-in, cycles developments, pauses on manual interaction and resumes", async ({ page }) => {
    await mockWorld(page);
    await page.goto("/world");
    await expect(page.getByTestId("ticker-item").first()).toBeVisible();
    await page.waitForTimeout(2200); // longer than one step: it must not start by itself
    await expect(page.getByTestId("live-view-button")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("live-view-pause")).toHaveCount(0);

    await page.getByTestId("live-view-button").click();
    await expect(page.getByTestId("live-view-button")).toHaveAttribute("aria-pressed", "true");
    // First development (newest: the strike) is focused straight away; the next step follows on the timer.
    await expect.poll(async () => (await center(page)).lat, { timeout: 5000 }).toBeCloseTo(49.99, 0);
    await expect.poll(async () => (await center(page)).lat, { timeout: 8000 }).toBeLessThan(45); // moved on to the earthquake (36 N)

    await page.getByTestId("live-view-pause").click();
    await expect(page.getByTestId("live-view-pause")).toHaveText("Resume");
    const paused = await center(page);
    await page.waitForTimeout(3500);
    const later = await center(page);
    expect(later.lat).toBeCloseTo(paused.lat, 1);

    await page.getByTestId("live-view-pause").click(); // resume
    await expect(page.getByTestId("live-view-pause")).toHaveText("Pause");

    // Manual interaction on the map pauses it.
    await page.locator(".maplibregl-canvas").dispatchEvent("pointerdown");
    await expect(page.getByTestId("live-view-pause")).toHaveText("Resume");
    await page.getByTestId("live-view-button").click(); // stop
    await expect(page.getByTestId("live-view-pause")).toHaveCount(0);
  });

  test("deep links still focus the map and the rail stays inside the viewport at 1440 and 1280", async ({ page }) => {
    await mockWorld(page);
    for (const width of [1440, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/world?focus=50,10,4");
      await expect(page.getByTestId("status-bar")).toBeVisible();
      await expect.poll(async () => (await center(page)).lat, { timeout: 5000 }).toBeCloseTo(50, 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      for (const id of ["left-column", "right-rail", "ticker"]) await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("tablet: one drawer for Pulse, no horizontal overflow", async ({ page }) => {
    await mockWorld(page);
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto("/world");
    await expect(page.getByTestId("left-column")).toBeHidden();
    await page.getByTestId("drawer-pulse").click();
    await expect(page.getByTestId("drawer-panel").getByTestId("pulse-row").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("World Command Center on a phone", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(!isMobile, "phone viewport only");
  });

  test("map first, Pulse in a bottom sheet, no horizontal overflow", async ({ page }) => {
    await mockWorld(page);
    await page.goto("/world");
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByTestId("stat-active")).toHaveText("7");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByTestId("drawer-pulse").click();
    await page.getByTestId("drawer-panel").getByTestId("pulse-row").first().click();
    await expect(page.getByTestId("drawer-panel")).toBeHidden();
  });
});
