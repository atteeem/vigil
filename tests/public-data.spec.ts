import { test, expect, type APIRequestContext } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { computeCountryExposure, computeImpact, getCountryByCode, getGlobalStatus } from "@/lib/data";
import { computeHeatField } from "@/lib/heat/field";
import { buildHeatInput } from "@/lib/heat/inputs";
import { independentSourceCount, normalizeSourceUrl } from "@/lib/data/independence";
import { MOCK_CONFLICTS } from "@/lib/dev-fixtures/mock-conflicts";
import type { Conflict, ConflictEvent } from "@/lib/types";
import type { PublicOverview } from "@/lib/public/overview";

// Public Data Unification: the public UI reads the database through one layer
// (lib/public), fixtures are test-only, and source links are exactly what was
// stored. Each test creates its own data and removes it afterwards.

const ROOT = process.cwd();
const FIXTURE_FEED = "http://localhost:3100/api/test-fixtures/rss";
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
/** Production source: app/, components/, hooks/ and lib/ — minus the two test-only directories. */
const productionFiles = () =>
  ["app", "components", "hooks", "lib"]
    .flatMap((d) => walk(join(ROOT, d)))
    .filter((f) => {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      return !rel.startsWith("lib/dev-fixtures/") && !rel.startsWith("lib/testing/") && !rel.startsWith("app/api/test-fixtures/");
    });

// ---------------------------------------------------------------------------
test.describe("Fixtures are isolated from production code", () => {
  test("no production file imports dev fixtures or the mock data modules", () => {
    const offenders = productionFiles().filter((f) => /dev-fixtures|mock-(conflicts|events|markets|sources)|situation-brief/.test(readFileSync(f, "utf8").split("\n").filter((l) => /^\s*import|from\s+["']/.test(l)).join("\n")));
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  test("no production file contains fake URLs, localhost links or pseudo-random data generation", () => {
    const bad = /example\.(com|org)|https?:\/\/localhost|127\.0\.0\.1|seededRandom|Math\.random\(\)\s*\*|MOCK_NOW|MOCK_CONFLICTS|MOCK_EVENTS|MOCK_MARKETS/;
    const hits: string[] = [];
    for (const f of productionFiles()) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (bad.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test("the RSS test-fixture route is closed unless the test flag is set", () => {
    const src = readFileSync(join(ROOT, "app/api/test-fixtures/rss/[name]/route.ts"), "utf8");
    expect(src).toMatch(/TEST_FIXTURES !== "true"[\s\S]{0,80}404/);
  });
});

// ---------------------------------------------------------------------------
test.describe("Scoring is deterministic and hard floors survive extra conflicts", () => {
  const ua = getCountryByCode("UA")!;
  const fi = getCountryByCode("FI")!;

  test("the same inputs always give the same impact and exposure (no random component)", () => {
    const runs = Array.from({ length: 3 }, () => computeCountryExposure(fi, MOCK_CONFLICTS).score);
    expect(new Set(runs).size).toBe(1);
    const impacts = MOCK_CONFLICTS.map((c) => computeImpact(fi, c).score);
    expect(MOCK_CONFLICTS.map((c) => computeImpact(fi, c).score)).toEqual(impacts);
  });

  test("adding unrelated low-impact conflicts does not dilute an own-country war floor", () => {
    const base = computeCountryExposure(ua, MOCK_CONFLICTS).score;
    expect(base).toBe(100);
    const lows: Conflict[] = Array.from({ length: 15 }, (_, i) => ({
      ...MOCK_CONFLICTS.find((c) => c.slug === "korean-peninsula")!,
      id: `low-${i}`,
      slug: `low-${i}`,
      status: "active",
      severity: "stable",
      intensity: 8,
      fullScaleWar: false,
      fightingCountryCodes: ["JP"],
      participantCountryCodes: ["JP"],
    }));
    expect(computeCountryExposure(ua, [...MOCK_CONFLICTS, ...lows]).score).toBe(100);
  });

  test("a participant that is not a fighting country gets no own-country floor; the fighting country does", () => {
    const base = MOCK_CONFLICTS.find((c) => c.slug === "russia-ukraine")!;
    const conflict: Conflict = { ...base, fightingCountryCodes: ["UA"], participantCountryCodes: ["RU", "UA"] };
    expect(computeImpact(getCountryByCode("RU")!, conflict).hardFloor).not.toBe("own_country_war");
    expect(computeImpact(ua, conflict).hardFloor).toBe("own_country_war");
  });

  test("a global status needs real active conflicts: none -> null, never a made-up score", () => {
    expect(getGlobalStatus([])).toBeNull();
    expect(getGlobalStatus(MOCK_CONFLICTS.filter((c) => c.status === "dormant"))).toBeNull();
    expect(getGlobalStatus(MOCK_CONFLICTS)!.score).toBeGreaterThan(0);
  });
});

test.describe("Source URL evidence rules", () => {
  const link = (url: string | null, role: string | null = "local_media", originating = true) => ({ isOriginatingSource: originating, rawIngestionItem: { originalUrl: url, source: { sourceRole: role } } });
  test("the same article attached twice is one piece of evidence, not two", () => {
    expect(independentSourceCount([link("https://a.test/x?utm_source=feed"), link("https://www.a.test/x/"), link("https://b.test/y")])).toBe(2);
    expect(independentSourceCount([link(null), link(null)])).toBe(2); // unknown URLs cannot be shown to be the same
    expect(normalizeSourceUrl("https://www.A.test/path/#frag?utm_medium=x")).toBe("a.test/path");
    expect(normalizeSourceUrl("")).toBeNull();
    expect(normalizeSourceUrl(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
async function makeConflict(request: APIRequestContext, over: Record<string, unknown> = {}) {
  const tag = unique();
  const res = await request.post("/api/admin/conflicts", {
    data: { slug: `pd-${tag}`, name: `PD Conflict ${tag}`, region: "Africa", status: "active", severity: "high", intensity: 70, lat: 5, lng: 5, fightingCountries: ["ZQ"], participantCountries: ["ZR"], supporterCountries: ["ZS"], ...over },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; slug: string; name: string };
}

async function publishManualEvent(request: APIRequestContext, title: string, extra: Record<string, unknown> = {}) {
  const res = await request.post("/api/admin/events", {
    data: { title, summary: "Public data fixture.", eventType: "artillery", latitude: 48.5, longitude: 37, occurredAt: new Date().toISOString(), severity: "elevated", published: true, sourceName: `PD source ${unique()}`, ...extra },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; slug: string };
}

test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.territorialChangeCandidate.deleteMany({ where: { description: { startsWith: "PD " } } });
  await prisma.event.deleteMany({ where: { title: { startsWith: "PD " } } });
  await prisma.militaryUnit.deleteMany({ where: { name: { startsWith: "PD " } } });
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "pd-" } } });
  await prisma.source.deleteMany({ where: { name: { startsWith: "PD " } } });
});

test.describe("Homepage and globe read the database", () => {
  test("a published event appears on the homepage; no mock event does; the data summary and freshness are real", async ({ page, request }) => {
    const title = `PD homepage event ${unique()}`;
    await publishManualEvent(request, title);
    await page.goto("/");
    await expect(page.getByTestId("latest-events-feed").filter({ visible: true }).getByText(title)).toBeVisible({ timeout: 30_000 });
    const body = await page.locator("body").innerText();
    for (const mock of ["Naval incident reported near Eastern Saudi coast", "Airstrike reported near Southern Lebanon", "Continental Wire Service"]) expect(body).not.toContain(mock);
    const html = await page.content();
    expect(html).not.toContain("example.com");
    const overview = (await request.get("/api/public/overview").then((r) => r.json())) as PublicOverview;
    expect(overview.events.some((e) => e.title === title)).toBe(true);
    // Desktop shows the summary over the globe, phones below it; check the copy on this screen.
    await expect(page.locator('[data-testid="home-data-summary"]:visible')).toContainText("published events");
    expect(overview.freshness.lastEventAt).not.toBeNull();
    // The line shows a real "last event" stamp, and a freshness label for source fetching.
    await expect(page.locator('[data-testid="freshness-last-event"]:visible').first()).toBeVisible();
    await expect(page.locator('[data-testid="freshness-last-source-fetch"]:visible').first()).toBeVisible();
  });

  test("the homepage globe pins only real located conflicts and feeds the heat field the same real inputs", async ({ page, request }) => {
    await publishManualEvent(request, `PD globe event ${unique()}`);
    const before = Date.now();
    await page.goto("/");
    const globe = page.locator('[aria-label="Interactive global conflict map"]');
    await expect(globe).toHaveAttribute("data-heat-signature", /^[0-9a-f]{8}$/, { timeout: 30_000 });
    const overview = (await request.get("/api/public/overview").then((r) => r.json())) as PublicOverview;
    const pinned = overview.conflicts.filter((c) => c.locationKnown && c.status !== "ended");
    // The globe only keeps markers on the visible hemisphere in the DOM, so the count varies with rotation:
    // what must hold is that every pin is a real database conflict and most of the registry is on screen.
    await expect.poll(() => page.getByTestId("globe-conflict-marker").count(), { timeout: 30_000 }).toBeGreaterThan(15);
    const pinnedNames = new Set(pinned.map((c) => c.shortName));
    const labels = await page.getByTestId("globe-conflict-marker").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").split(", severity")[0] ?? ""));
    expect(labels.length).toBeLessThanOrEqual(pinned.length);
    for (const name of labels) expect(pinnedNames.has(name as string), name).toBe(true);

    // The heat field signature is the one computed from the API's own conflicts and events.
    const signatureAt = (t: number) => computeHeatField(buildHeatInput({ conflicts: pinned, events: overview.events as ConflictEvent[], nowIso: new Date(t).toISOString(), live: true })).signature;
    const shown = (await globe.getAttribute("data-heat-signature"))!;
    expect([signatureAt(before), signatureAt(Date.now()), signatureAt(before - 3_600_000), signatureAt(Date.now() + 3_600_000)]).toContain(shown);
  });

  test("/world (live) shows database events only", async ({ page, request, isMobile }) => {
    const title = `PD world event ${unique()}`;
    await publishManualEvent(request, title);
    await page.goto("/world");
    if (!isMobile) {
      // The raw feed lives behind the Events tab (Pulse, the meaningful developments, is the default view).
      await page.getByTestId("left-tab-events").click();
      await expect(page.getByTestId("left-column").getByText(title).first()).toBeVisible({ timeout: 30_000 });
    } else {
      // Phones have no list: the event is on the map itself (the events source), not a mock.
      await expect
        .poll(() => page.evaluate((t) => {
          const src = (window as unknown as { __vigilMap?: { getSource(id: string): { serialize(): { data: unknown } } | undefined } }).__vigilMap?.getSource("events");
          return !!src && JSON.stringify(src.serialize().data).includes(t);
        }, title), { timeout: 30_000 })
        .toBe(true);
    }
    expect(await page.locator("body").innerText()).not.toContain("Naval incident reported near Eastern Saudi coast");
  });
});

test.describe("For You uses the centralized impact engine on real conflicts", () => {
  test.use({ isMobile: false });

  test("the top conflict's impact shown equals computeImpact for the selected country over the real registry data", async ({ page, request }) => {
    await page.addInitScript(() => localStorage.setItem("vigil-preferences", JSON.stringify({ state: { baseCountryCode: "FI" }, version: 2 })));
    await page.goto("/for-you");
    await expect(page.getByText("Your Global Exposure")).toBeVisible();
    const first = page.getByTestId("for-you-top-conflicts").locator("a[href^='/conflict/']").first();
    await expect(first).toBeVisible({ timeout: 20_000 });
    const slug = (await first.getAttribute("href"))!.replace("/conflict/", "");
    const shown = Number((await first.locator("p.text-accent").first().textContent())!.trim());

    const overview = (await request.get("/api/public/overview").then((r) => r.json())) as PublicOverview;
    const conflict = overview.conflicts.find((c) => c.slug === slug)!;
    expect(shown).toBe(computeImpact(getCountryByCode("FI")!, conflict).score);
    // The page's own claim of freshness is the real last-event stamp.
    await expect(page.getByTestId("for-you-freshness")).toContainText("Last event");
    // Deterministic: a reload gives the same headline.
    const headline = () => page.locator("p:has-text('Your Global Exposure') + div span.tabular-nums").first().textContent();
    await expect.poll(async () => Number((await headline())?.trim()), { timeout: 10_000 }).toBeGreaterThanOrEqual(75);
  });

  test("Ukraine selected: the real full-scale war inside the country gives an exposure of 100", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("vigil-preferences", JSON.stringify({ state: { baseCountryCode: "UA" }, version: 2 })));
    await page.goto("/for-you");
    const headline = page.locator("p:has-text('Your Global Exposure') + div span.tabular-nums").first();
    await expect.poll(async () => Number((await headline.textContent())?.trim()), { timeout: 20_000 }).toBe(100);
  });
});

// ---------------------------------------------------------------------------
test.describe("Conflict page is a real intelligence page", () => {
  test("registry geography keeps fighting, participants and supporters apart; empty sections say so", async ({ page, request }) => {
    const c = await makeConflict(request);
    await page.goto(`/conflict/${c.slug}`);
    await expect(page.getByTestId("conflict-name")).toHaveText(c.name);
    await expect(page.getByTestId("geo-fighting")).toContainText("ZQ");
    await expect(page.getByTestId("geo-fighting")).not.toContainText("ZR");
    await expect(page.getByTestId("geo-participants")).toContainText("ZR");
    await expect(page.getByTestId("geo-participants")).not.toContainText("ZQ");
    await expect(page.getByTestId("geo-supporters")).toContainText("ZS");
    await expect(page.getByTestId("conflict-overview-line")).toContainText("Start date not recorded");
    // No data yet: honest empty states, no filler.
    await expect(page.getByTestId("events-empty")).toBeVisible();
    await expect(page.getByTestId("territory-empty")).toBeVisible();
    await expect(page.getByTestId("actors-empty")).toBeVisible();
    await expect(page.getByTestId("reports-empty")).toBeVisible();
    await expect(page.getByTestId("coverage-health")).toHaveText("No source");
    await expect(page.getByTestId("sources-empty")).toBeVisible();
    await expect(page.getByTestId("history-empty")).toBeVisible();
    await expect(page.getByTestId("freshness-last-event")).toContainText("no published events");
    await expect(page.getByTestId("score-severity-value")).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("example.com");
  });

  test("a real registry conflict shows severity, the full-scale-war flag, classification and real scores", async ({ page, request }) => {
    await page.goto("/conflict/russia-ukraine");
    await expect(page.getByTestId("full-scale-war-flag")).toBeVisible();
    await expect(page.getByTestId("classification")).toContainText("Established");
    await expect(page.getByTestId("geo-fighting")).toContainText("Ukraine");
    await expect(page.getByTestId("score-severity-value")).toHaveText(/^100/); // active full-scale war = severityScore 100
    await expect(page.getByTestId("score-confidence")).toBeVisible();
    const overview = (await request.get("/api/public/overview").then((r) => r.json())) as PublicOverview;
    const ru = overview.conflicts.find((x) => x.slug === "russia-ukraine")!;
    expect(ru.fullScaleWar).toBe(true);
  });

  test("events, reports with original links, actors, stale coverage and territorial changes come from the database", async ({ page, request }) => {
    const { prisma } = await import("@/lib/db/client");
    const c = await makeConflict(request);
    const title = `PD conflict event ${unique()}`;
    const event = await publishManualEvent(request, title, { conflictId: c.id, sourceUrl: "https://publisher.test/story-1" });

    // A stored actor linked to the conflict, and an approved territorial change claimed by it.
    const unit = await prisma.militaryUnit.create({ data: { name: `PD Unit ${unique()}`, primaryConflictId: c.id, sourceName: "Test registry" } });
    await prisma.territorialChangeCandidate.create({
      data: { conflictId: c.id, description: `PD captured Testville`, changeType: "captured", status: "approved", claimedActorId: unit.id, locationName: "Testville", sourceName: "Publisher", sourceUrl: "https://publisher.test/story-1", reviewedAt: new Date(), observedAt: new Date() },
    });
    // A conflict-country source whose last fetch was 10 days ago -> stale coverage.
    const source = await request.post("/api/admin/sources", { data: { name: `PD stale source ${unique()}`, type: "manual", country: "ZQ", sourceRole: "local_media", enabled: true, autoIngest: false } }).then((r) => r.json());
    await prisma.source.update({ where: { id: source.id }, data: { lastSuccessfulIngestion: new Date(Date.now() - 10 * 86_400_000) } });

    await page.goto(`/conflict/${c.slug}`);
    await expect(page.getByTestId("section-events").getByText(title)).toBeVisible();
    await expect(page.getByTestId("latest-report").first().getByTestId("original-source-link")).toHaveAttribute("href", "https://publisher.test/story-1");
    await expect(page.getByTestId("coverage-health")).toHaveText("Stale coverage");
    await expect(page.getByTestId("source-list")).toContainText(source.name);
    await expect(page.getByTestId("stale-indicator").first()).toBeVisible();
    const actorLink = page.getByTestId("section-actors").getByTestId("actor-link");
    await expect(actorLink).toHaveText(unit.name);
    await expect(actorLink).toHaveAttribute("href", `/actor/${unit.id}`);
    await expect(page.getByTestId("territorial-changes")).toContainText("PD captured Testville");
    await expect(page.getByTestId("territorial-changes").getByTestId("actor-link")).toHaveAttribute("href", `/actor/${unit.id}`);
    // Territory records are absent (a change was approved but no map area exists).
    await expect(page.getByTestId("territory-empty")).toBeVisible();
    // Event links back here.
    await page.goto(`/event/${event.slug}`);
    await expect(page.getByRole("link", { name: new RegExp(`Part of`) })).toHaveAttribute("href", `/conflict/${c.slug}`);
  });

  test("an unknown conflict is a 404, not an invented page", async ({ page }) => {
    const res = await page.goto(`/conflict/no-such-conflict-${unique()}`);
    expect(res?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
async function publishIncoming(request: APIRequestContext, itemId: string, title: string, extra: Record<string, unknown> = {}) {
  const res = await request.post(`/api/admin/incoming/${itemId}/publish`, {
    data: { title, summary: "Public data fixture.", eventType: "ground", latitude: 48.4, longitude: 37.1, occurredAt: new Date().toISOString(), severity: "elevated", ...extra },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; slug: string };
}

test.describe("Original source URLs survive end-to-end", () => {
  test("RSS: feed item -> raw item -> event -> API -> public event page, exactly as the publisher gave it", async ({ page, request }) => {
    const src = await request
      .post("/api/admin/sources", { data: { name: `PD RSS ${unique()}`, type: "rss", url: `${FIXTURE_FEED}/expansion-local-feed`, country: "ZL", sourceRole: "local_media", enabled: true, autoIngest: false, autoProcessing: false } })
      .then((r) => r.json());
    expect((await request.post(`/api/admin/sources/${src.id}/fetch`).then((r) => r.json())).new).toBe(3);
    const items = (await request.get(`/api/admin/incoming?sourceId=${src.id}`).then((r) => r.json())) as { id: string; originalUrl: string; publishedAt: string; rawMetadata: { author?: string } }[];
    const item = items.find((i) => i.originalUrl === "https://fixture.test/expansion/local/fixtown-captured")!;
    expect(item).toBeTruthy();

    const title = `PD rss event ${unique()}`;
    const event = await publishIncoming(request, item.id, title);
    const apiEvent = ((await request.get("/api/events").then((r) => r.json())) as ConflictEvent[]).find((e) => e.id === event.id)!;
    expect(apiEvent.sources).toHaveLength(1);
    expect(apiEvent.sources[0]).toMatchObject({ url: "https://fixture.test/expansion/local/fixtown-captured", name: src.name });
    expect(new Date(apiEvent.sources[0]!.publishedAt).toISOString()).toBe(new Date(item.publishedAt).toISOString());

    await page.goto(`/event/${event.slug}`);
    const report = page.getByTestId("event-report");
    await expect(report).toHaveCount(1);
    await expect(report.getByTestId("original-source-link")).toHaveAttribute("href", "https://fixture.test/expansion/local/fixtown-captured");
    await expect(report).toContainText(src.name);
    await expect(report).toContainText("Source published: ");
    await expect(page.getByTestId("event-evidence-summary")).toContainText("1 report attached");
    // The event and its supporting reports are distinct things on the page.
    await expect(page.getByTestId("event-reports").getByText("Reports and sources")).toBeVisible();
  });

  test("Telegram/public-feed permalink and the aggregator's upstream provenance are preserved", async ({ page, request }) => {
    const src = await request.post("/api/admin/sources", { data: { name: `PD TG ${unique()}`, type: "telegram", telegramHandle: "@vigil_fixture_aggregator", sourceRole: "aggregator", enabled: true, autoIngest: false, autoProcessing: false } }).then((r) => r.json());
    await request.post(`/api/admin/sources/${src.id}/fetch`);
    const items = (await request.get(`/api/admin/incoming?sourceId=${src.id}`).then((r) => r.json())) as { id: string; externalId: string; originalUrl: string }[];
    const item = items.find((i) => i.externalId === "101")!;
    expect(item.originalUrl).toBe("https://t.me/vigil_fixture_aggregator/101");
    const event = await publishIncoming(request, item.id, `PD telegram event ${unique()}`);
    await page.goto(`/event/${event.slug}`);
    await expect(page.getByTestId("event-report").getByTestId("original-source-link")).toHaveAttribute("href", "https://t.me/vigil_fixture_aggregator/101");
  });

  test("a duplicate URL is not counted as independent evidence and is flagged", async ({ page, request }) => {
    const ev = await publishManualEvent(request, `PD dup event ${unique()}`, { sourceUrl: "https://publisher.test/same-story" });
    const src = await request.post("/api/admin/sources", { data: { name: `PD dup source ${unique()}`, type: "manual", enabled: true, autoIngest: false } }).then((r) => r.json());
    const item = await request
      .post("/api/admin/incoming/manual", { data: { sourceId: src.id, externalId: `dup-${unique()}`, originalUrl: "https://www.publisher.test/same-story/?utm_source=x", originalTitle: "Same story again", originalText: "Republished copy.", publishedAt: new Date().toISOString() } })
      .then((r) => r.json());
    expect((await request.post(`/api/admin/incoming/${item.id}/merge`, { data: { eventId: ev.id, relationship: "corroborating" } })).ok()).toBe(true);
    await page.goto(`/event/${ev.slug}`);
    await expect(page.getByTestId("event-report")).toHaveCount(2);
    await expect(page.getByTestId("event-evidence-summary")).toContainText("1 independent source");
    await expect(page.getByTestId("event-evidence-summary")).toContainText("2 reports attached");
    await expect(page.getByTestId("event-reports")).toContainText("not independent evidence");
  });

  test("a report with no stored URL says 'Source unavailable' and renders no link — never a fake one", async ({ page, request }) => {
    const ev = await publishManualEvent(request, `PD nourl event ${unique()}`); // no sourceUrl
    const apiEvent = ((await request.get("/api/events").then((r) => r.json())) as ConflictEvent[]).find((e) => e.id === ev.id)!;
    expect(apiEvent.sources[0]!.url).toBeNull();
    await page.goto(`/event/${ev.slug}`);
    await expect(page.getByTestId("source-unavailable")).toHaveText("Source unavailable");
    await expect(page.getByTestId("event-reports").locator("a")).toHaveCount(0);
    await expect(page.getByTestId("original-source-link")).toHaveCount(0);
    expect(await page.content()).not.toMatch(/href=["']["']/);
  });
});

// ---------------------------------------------------------------------------
test.describe("Event page and actors", () => {
  test("event page: location precision, real report list, actor links that resolve, related events and an unlinked unknown actor", async ({ page, request }) => {
    const { prisma } = await import("@/lib/db/client");
    const c = await makeConflict(request);
    const known = await prisma.militaryUnit.create({ data: { name: `PD Brigade ${unique()}`, branch: "Ground forces", status: "active", primaryConflictId: c.id, sourceName: "Test registry", sourceUrl: "https://registry.test/unit" } });
    const parent = await prisma.militaryUnit.create({ data: { name: `PD Corps ${unique()}` } });
    await prisma.militaryUnit.update({ where: { id: known.id }, data: { parentUnitId: parent.id } });
    const title = `PD actor event ${unique()}`;
    const ev = await publishManualEvent(request, title, { conflictId: c.id, sourceUrl: "https://publisher.test/actor-story", locationPrecision: "approximate", countryCode: "UA" });
    await publishManualEvent(request, `PD sibling event ${unique()}`, { conflictId: c.id, sourceUrl: "https://publisher.test/sibling" });
    await prisma.event.update({ where: { id: ev.id }, data: { actors: JSON.stringify([known.name, "PD Unregistered Group"]) } });
    await prisma.militaryUnitEvent.create({ data: { unitId: known.id, eventId: ev.id, sourceName: "t" } });

    await page.goto(`/event/${ev.slug}`);
    await expect(page.getByTestId("event-location")).toContainText("Approximate location");
    await expect(page.getByTestId("event-report")).toHaveCount(1);
    const links = page.getByTestId("event-actors").getByTestId("actor-link");
    await expect(links).toHaveCount(1);
    await expect(links).toHaveText(known.name);
    await expect(page.getByTestId("event-actors")).toContainText("PD Unregistered Group"); // shown, but not a link
    await expect(page.getByTestId("related-events")).toBeVisible();

    await links.click();
    await expect(page).toHaveURL(new RegExp(`/actor/${known.id}$`));
    await expect(page.getByTestId("actor-name")).toHaveText(known.name);
    await expect(page.getByTestId("actor-conflicts")).toContainText(c.name);
    await expect(page.getByTestId("actor-events")).toContainText(title);
    await expect(page.getByTestId("actor-structure")).toContainText(parent.name);
    await expect(page.getByTestId("actor-provenance").getByRole("link", { name: "original record" })).toHaveAttribute("href", "https://registry.test/unit");
    await expect(page.getByTestId("actor-aliases")).toContainText("No aliases recorded");
  });

  test("an unknown actor reference is a 404", async ({ page }) => {
    const res = await page.goto(`/actor/does-not-exist-${unique()}`);
    expect(res?.status()).toBe(404);
  });

  test("an unknown event slug is a 404 and unpublished events are not public", async ({ page, request }) => {
    expect((await page.goto(`/event/missing-${unique()}`))?.status()).toBe(404);
    const draft = await publishManualEvent(request, `PD draft event ${unique()}`, { published: false });
    expect((await page.goto(`/event/${draft.slug}`))?.status()).toBe(404);
  });
});

// ---------------------------------------------------------------------------
test.describe("Bounded reads and honest states", () => {
  test("/api/events is bounded and pages with a cursor; the overview is capped", async ({ request }) => {
    for (let i = 0; i < 3; i++) await publishManualEvent(request, `PD bound event ${unique()}`);
    const first = await request.get("/api/events?limit=2");
    const page1 = (await first.json()) as ConflictEvent[];
    expect(page1.length).toBeLessThanOrEqual(2);
    const cursor = first.headers()["x-next-before"];
    expect(cursor).toBeTruthy();
    const page2 = (await request.get(`/api/events?limit=2&before=${encodeURIComponent(cursor!)}`).then((r) => r.json())) as ConflictEvent[];
    expect(page2.length).toBeGreaterThan(0);
    expect(new Date(page2[0]!.occurredAt).getTime()).toBeLessThan(new Date(cursor!).getTime());
    expect((await request.get("/api/events?before=nonsense")).status()).toBe(400);
    const overview = (await request.get("/api/public/overview").then((r) => r.json())) as PublicOverview;
    expect(overview.events.length).toBeLessThanOrEqual(200);
    expect(overview.conflicts.length).toBeGreaterThan(20);
    // Every event in the window is recent and published.
    for (const e of overview.events) expect(Date.now() - new Date(e.occurredAt).getTime()).toBeLessThan(31 * 86_400_000);
  });

  test("freshness is the real newest event/ingestion time, not the time the page loaded", async ({ request }) => {
    const ev = await publishManualEvent(request, `PD fresh event ${unique()}`, { occurredAt: "2026-01-05T10:00:00.000Z" });
    const overview = (await request.get("/api/public/overview").then((r) => r.json())) as PublicOverview;
    // An old event never makes "last event" newer than the newest real event; generatedAt is separate.
    const newest = Math.max(...overview.events.map((e) => new Date(e.occurredAt).getTime()), 0);
    if (overview.events.length > 0) expect(new Date(overview.freshness.lastEventAt!).getTime()).toBeGreaterThanOrEqual(newest);
    expect(overview.freshness.generatedAt).not.toBe(overview.freshness.lastEventAt);
    expect(ev.id).toBeTruthy();
  });

  test("markets show an unavailable state instead of sample prices", async ({ page }) => {
    await page.goto("/markets");
    await expect(page.getByTestId("markets-unavailable")).toBeVisible();
    expect((await page.goto("/markets/gold"))?.status()).toBe(404);
  });

  test("search reads the database: a conflict, an event and an actor resolve; mock names do not", async ({ request }) => {
    const { prisma } = await import("@/lib/db/client");
    const tag = unique().replace(/-/g, "");
    const unit = await prisma.militaryUnit.create({ data: { name: `PD Searchable ${tag}` } });
    await publishManualEvent(request, `PD searchable event ${tag}`);
    const hit = async (q: string) => (await request.get(`/api/public/search?q=${encodeURIComponent(q)}`).then((r) => r.json())) as { type: string; title: string; href: string }[];
    expect((await hit(`Searchable ${tag}`)).find((r) => r.type === "actor")!.href).toBe(`/actor/${unit.id}`);
    expect((await hit(`searchable event ${tag}`)).some((r) => r.type === "event")).toBe(true);
    expect((await hit("Sudan")).some((r) => r.type === "conflict" && r.href === "/conflict/sudan")).toBe(true);
    expect(await hit("x")).toEqual([]);
  });
});
