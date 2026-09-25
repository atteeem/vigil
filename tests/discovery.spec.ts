import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { SearchResult } from "@/lib/public/search-types";
import { SEARCH_GROUPS } from "@/lib/public/search-types";
import { activeNavHref, NAV_ITEMS } from "@/lib/discovery/nav";
import type { DirectoryRow } from "@/lib/public/conflict-directory";

// Global Discovery & Navigation: canonical entity search (aliases, groups, routing), the search palette (keyboard,
// recent / watching / trending shortcuts, mobile sheet), For You reasons, Watch buttons, header nav and the conflict
// directory. Fixture data goes through the real write paths; nothing asserts on global totals.

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const search = async (request: APIRequestContext, q: string) => (await request.get(`/api/public/search?q=${encodeURIComponent(q)}`).then((r) => r.json())) as SearchResult[];
const titles = (r: SearchResult[], group?: string) => r.filter((x) => !group || x.group === group).map((x) => x.title);

test.describe.configure({ timeout: 150_000 });

let rsfAliasId: string | null = null;
test.beforeAll(async () => {
  // The seeded registry names the Sudan belligerent in full; the common abbreviation is an alias record.
  const { prisma } = await import("@/lib/db/client");
  const rsf = await prisma.militaryUnit.findFirst({ where: { name: "Rapid Support Forces" }, select: { id: true } });
  if (rsf && !(await prisma.entityAlias.findFirst({ where: { entityId: rsf.id, normalized: "rsf" } }))) {
    rsfAliasId = (await prisma.entityAlias.create({ data: { entityKind: "unit", entityId: rsf.id, alias: "RSF", normalized: "rsf", aliasType: "abbreviation" } })).id;
  }
});
test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  if (rsfAliasId) await prisma.entityAlias.delete({ where: { id: rsfAliasId } }).catch(() => {});
});

test.describe("Canonical search", () => {
  test("country aliases and codes resolve to one country record", async ({ request }) => {
    for (const q of ["Finland", "FI", "FIN", "Suomi"]) {
      const r = await search(request, q);
      const countries = r.filter((x) => x.group === "Countries");
      expect(countries.map((c) => c.href), q).toContain("/country/FI");
      expect(countries.filter((c) => c.href === "/country/FI"), `${q}: no duplicate`).toHaveLength(1);
    }
    // A 2-letter code is a code: no unrelated substring hits from other groups.
    const fi = await search(request, "FI");
    expect(fi.every((x) => x.group === "Countries" || x.group === "Infrastructure")).toBe(true);
  });

  test("conflict aliases resolve to the canonical conflict page", async ({ request }) => {
    for (const [q, slug] of <[string, string][]>[
      ["Ukraine war", "russia-ukraine"],
      ["Russia Ukraine", "russia-ukraine"],
      ["Russo-Ukrainian War", "russia-ukraine"],
      ["Gaza war", "israel-palestine"],
      ["Israel Palestine", "israel-palestine"],
    ]) {
      const conflicts = (await search(request, q)).filter((x) => x.group === "Conflicts");
      expect(conflicts[0]?.href, q).toBe(`/conflict/${slug}`);
      expect(conflicts.filter((c) => c.href === `/conflict/${slug}`), `${q}: no duplicate`).toHaveLength(1);
    }
  });

  test("actor aliases, grouping and canonical routes", async ({ request }) => {
    const rsf = await search(request, "RSF");
    const actor = rsf.find((x) => x.title === "Rapid Support Forces");
    expect(actor?.group).toBe("Actors");
    expect(actor?.href).toMatch(/^\/(actor|unit)\//);
    expect(titles(await search(request, "Rapid Support"), "Actors")).toContain("Rapid Support Forces");

    const myanmar = await search(request, "Myanmar");
    expect(titles(myanmar, "Countries")).toContain("Myanmar");
    expect(myanmar.find((x) => x.group === "Conflicts")?.href).toBe("/conflict/myanmar");
    // Results come back in the fixed group order, each with the display fields.
    const order = myanmar.map((x) => SEARCH_GROUPS.indexOf(x.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const x of myanmar) {
      expect(x.title).toBeTruthy();
      expect(x.kind).toBeTruthy();
      expect(x.href.startsWith("/")).toBe(true);
    }

    const zhytomyr = await search(request, "Zhytomyr");
    const region = zhytomyr.find((x) => x.group === "Places");
    expect(region?.title).toContain("Zhytomyr");
    expect(region?.context).toBe("Ukraine");
    expect(region?.href).toMatch(/^\/world\?focus=/);

    const jfk = await search(request, "JFK");
    expect(jfk.find((x) => x.type === "airport")?.title).toContain("Kennedy");
  });

  test("no-result query returns an empty list quickly", async ({ request }) => {
    expect(await search(request, "zzqxyv")).toEqual([]);
    await search(request, "Ukraine"); // warm
    const t = Date.now();
    await search(request, "Ukraine");
    expect(Date.now() - t).toBeLessThan(1500); // generous for CI; measured warm ≈ 5 ms locally
  });
});

test.describe("Navigation model", () => {
  test("active nav item resolution", () => {
    expect(NAV_ITEMS.map((n) => n.label)).toEqual(["Overview", "Live Map", "For You", "Conflicts", "Markets"]);
    expect(activeNavHref("/")).toBe("/");
    expect(activeNavHref("/world")).toBe("/world");
    expect(activeNavHref("/conflict/sudan")).toBe("/conflicts");
    expect(activeNavHref("/watchlist")).toBe("/for-you");
    expect(activeNavHref("/country/FI")).toBeNull();
  });
});

// Desktop and mobile layouts both render some modules; act on the one that is visible at this viewport.
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function openSearch(page: Page) {
  await page.locator('[data-testid="header-search"]:visible, [data-testid="mobile-search"]:visible').first().click();
  await expect(page.getByTestId("search-dialog")).toBeVisible();
}

test.describe("Search palette", () => {
  test("keyboard: Ctrl+K opens, arrows move, Enter opens the canonical page, Esc closes", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard shortcut is a desktop interaction");
    await page.goto("/conflicts");
    await expect(page.getByTestId("conflict-grid")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("search-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("search-dialog")).toHaveCount(0);

    await page.keyboard.press("Control+k");
    await page.getByTestId("search-input").fill("Gaza war");
    await expect(page.getByTestId("search-group-conflicts")).toBeVisible();
    const first = page.getByTestId("search-result").first();
    await expect(first).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/conflict\/israel-palestine/);

    // Recent now lists it; arrows move the selection through the shortcuts.
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("search-recent")).toContainText("Israel");
    await page.getByTestId("search-input").fill("Myanmar");
    await expect(page.getByTestId("search-group-countries")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("search-result").nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("search-result").first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
  });

  test("grouped results, no-result state, recent / watching / trending shortcuts", async ({ page }) => {
    await page.goto("/conflicts");
    await openSearch(page);
    await expect(page.getByTestId("search-recent-empty")).toHaveText("No recent searches.");
    await expect(page.getByTestId("search-watching-empty")).toHaveText("No watched entities yet.");
    await expect(page.getByTestId("search-trending")).toBeVisible();

    await page.getByTestId("search-input").fill("zzqxyv");
    await expect(page.getByTestId("search-empty")).toHaveText("No matching entities.");

    await page.getByTestId("search-input").fill("Suomi");
    const row = page.getByTestId("search-group-countries").getByTestId("search-result").first();
    await expect(row).toHaveAttribute("data-href", "/country/FI");
    await row.click();
    await expect(page).toHaveURL(/\/country\/FI/);
    await expect(page.getByTestId("context-trail")).toBeVisible();

    // Watch Finland from the country page: the button reads Watch → Watching, and search shows it under Watching.
    const watch = vis(page, "follow-button"); // the page-header Watch button (secondary sections collapse on mobile)
    await expect(watch).toHaveText(/^\s*Watch\s*$/);
    await watch.click();
    await expect(watch).toHaveAttribute("data-following", "true");
    await expect(watch).toContainText("Watching");
    await openSearch(page);
    await expect(page.getByTestId("search-watching")).toContainText("Finland");
    await expect(page.getByTestId("search-recent")).toContainText("Finland");
    await page.getByTestId("search-clear-recent").click();
    await expect(page.getByTestId("search-recent-empty")).toBeVisible();
  });

  test("mobile search is a full-width sheet without horizontal overflow", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile layout");
    await page.goto("/conflicts");
    await openSearch(page);
    const box = await page.getByTestId("search-dialog").boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.width).toBeGreaterThanOrEqual(vw - 2);
    await page.getByTestId("search-input").fill("Russia Ukraine");
    await expect(page.getByTestId("search-group-conflicts")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe("Header and Overview", () => {
  test("primary nav marks the active section; Overview is a landing summary", async ({ page, isMobile }) => {
    await page.goto("/");
    if (!isMobile) {
      const nav = page.getByTestId("primary-nav");
      for (const label of ["Overview", "Live Map", "For You", "Conflicts", "Markets"]) await expect(nav.getByRole("link", { name: label })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    }
    await expect(vis(page, "overview-status")).toBeVisible();
    await expect(vis(page, "overview-what-changed")).toBeVisible();
    await expect(vis(page, "overview-watching")).toBeVisible();
    await expect(vis(page, "overview-open-map")).toHaveAttribute("href", "/world");
    await expect(vis(page, "overview-brief-24h")).toHaveAttribute("href", "/brief?window=24h");
    await vis(page, "overview-changed-24H").click();
    await expect(page.locator('[data-testid="overview-changed-list"]:visible, [data-testid="overview-changed-empty"]:visible').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.goto("/conflict/sudan");
    if (!isMobile) await expect(page.getByTestId("primary-nav").getByRole("link", { name: "Conflicts" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("For You", () => {
  test("every development carries the reason it is shown", async ({ request }) => {
    const id = `fy-${crypto.randomUUID()}`; // client ids are 22-64 url-safe chars
    const headers = { "x-vigil-client": id };
    const empty = (await request.get("/api/me/for-you", { headers }).then((r) => r.json())) as { items: unknown[]; watches: number };
    expect(empty.watches).toBe(0);
    expect(empty.items).toEqual([]);

    const conflict = (await request.get("/api/conflicts/directory").then((r) => r.json())) as DirectoryRow[];
    const ua = conflict.find((c) => c.slug === "russia-ukraine")!;
    const title = `FY development ${unique()}`;
    await request.post("/api/admin/events", { data: { title, summary: "Strike on infrastructure.", eventType: "artillery", latitude: 49.5, longitude: 32, occurredAt: ago(1), severity: "severe", importance: 85, published: true, sourceName: `FY Wire ${unique()}`, conflictId: ua.id, countryCode: "UA" } });
    await request.post("/api/me/watches", { headers, data: { entityType: "country", entityKey: "UA" } });

    await expect
      .poll(async () => {
        const feed = (await request.get("/api/me/for-you", { headers }).then((r) => r.json())) as { items: { title: string; reasons: string[] }[] };
        return feed.items.find((i) => i.title === title)?.reasons ?? [];
      }, { timeout: 60_000 })
      .toContain("Because you follow Ukraine");
    const feed = (await request.get("/api/me/for-you", { headers }).then((r) => r.json())) as { items: { reasons: string[] }[] };
    expect(feed.items.every((i) => i.reasons.length > 0)).toBe(true);
  });

  test("For You page states the empty watch list", async ({ page }) => {
    await page.goto("/for-you");
    await expect(page.getByTestId("for-you-following")).toBeVisible();
    await expect(page.getByTestId("for-you-no-watches").or(page.getByTestId("for-you-feed")).first()).toBeVisible();
  });
});

test.describe("Conflict directory", () => {
  test("filters by status, region and text with a deterministic order", async ({ page, request }) => {
    const rows = (await request.get("/api/conflicts/directory").then((r) => r.json())) as DirectoryRow[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(typeof r.reportCount7d).toBe("number");
      expect(r.slug).toBeTruthy();
    }

    await page.goto("/conflicts");
    const list = page.getByTestId("conflict-row");
    await expect(list.first()).toBeVisible();
    for (const s of await list.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))) expect(["active", "reduced"]).toContain(s);
    const firstOrder = await list.evaluateAll((els) => els.map((e) => e.textContent));
    await page.reload();
    await expect(list.first()).toBeVisible();
    expect(await list.evaluateAll((els) => els.map((e) => e.textContent))).toEqual(firstOrder);

    await page.getByTestId("conflicts-filter").fill("sudan");
    await expect(list).toHaveCount(1);
    await expect(list.first()).toContainText("Sudan");
    await expect(list.first().getByTestId("conflict-confidence")).toBeVisible();
    await expect(list.first().getByTestId("conflict-report-count")).toBeVisible();
    await page.getByTestId("conflicts-filter").fill("zzqxyv");
    await expect(page.getByTestId("conflicts-empty")).toBeVisible();

    await page.getByTestId("conflicts-filter").fill("");
    await page.getByTestId("conflicts-status-filter").getByRole("radio", { name: "Ended" }).click();
    for (const s of await list.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))) expect(["ended", "resolved", "archived"]).toContain(s);
  });
});
