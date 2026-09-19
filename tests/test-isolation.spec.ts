import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

// The Playwright suite must never write into the normal dev database. It runs
// its own server (port 3100, .next-test) against prisma/test.db, rebuilt from
// migrations + seed on every run (scripts/prepare-test-db.mjs). Regression:
// fixture actors ("Click Test Actor ...", "Priority Test Actor ...") and their
// territories used to accumulate in prisma/dev.db and show up in the normal
// /world Territorial Control legend.

test.describe("Test/dev database separation", () => {
  test("1. The test process is pointed at the disposable test DB, never dev.db", () => {
    expect(process.env.DATABASE_URL).toMatch(/test\.db$/);
    expect(process.env.DATABASE_URL).not.toMatch(/dev\.db$/);
  });

  test("2. Rows created through the API land in test.db and nowhere in dev.db", async ({ request }) => {
    const marker = `isolation-marker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await request.post("/api/admin/conflicts", {
      data: { slug: marker, name: `Isolation ${marker}`, region: "Europe", severity: "guarded", intensity: 10 },
    });
    expect(res.ok()).toBe(true);

    expect(existsSync("prisma/test.db")).toBe(true);
    expect(readFileSync("prisma/test.db").includes(marker)).toBe(true);
    if (existsSync("prisma/dev.db")) expect(readFileSync("prisma/dev.db").includes(marker)).toBe(false);
  });

  test("3. The test DB starts from migrations + seed exactly like a fresh dev DB: seed data present, no fixture actors at seed time", async () => {
    // Rebuild a scratch DB with the same script the webServer uses and inspect it,
    // so this holds regardless of what earlier tests in this run have created.
    const scratch = `prisma/isolation-scratch-${Date.now()}.test.db`;
    try {
      execFileSync("node", ["scripts/prepare-test-db.mjs"], { env: { ...process.env, DATABASE_URL: `file:./${scratch}` }, stdio: "pipe", shell: true });
      const bytes = readFileSync(scratch).toString("latin1");
      expect(bytes).toContain("russia-ukraine"); // seeded conflict
      expect(bytes).not.toContain("Click Test Actor");
      expect(bytes).not.toContain("Priority Test Actor");
    } finally {
      for (const suffix of ["", "-journal"]) {
        try {
          (await import("node:fs")).rmSync(`${scratch}${suffix}`, { force: true });
        } catch {
          /* best effort */
        }
      }
    }
  });

  test("4. The reset script refuses to run against a non-test database", () => {
    expect(() =>
      execFileSync("node", ["scripts/prepare-test-db.mjs"], { env: { ...process.env, DATABASE_URL: "file:./prisma/dev.db" }, stdio: "pipe" }),
    ).toThrow();
  });
});

test.describe("Territorial Control empty state", () => {
  test.use({ isMobile: false });

  test("With no territorial data the legend says so instead of showing an empty or bogus legend", async ({ page }) => {
    await page.route("**/api/territorial-control**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: [] }) }),
    );
    await page.goto("/world");
    await page.getByTestId("territorial-toggle").click();
    await expect(page.getByTestId("territory-empty-state")).toHaveText("No territorial control data available.");
    await expect(page.locator("[data-testid^=territory-legend-actor-]")).toHaveCount(0);
  });
});

test.describe("Territorial Control actually renders when toggled", () => {
  test.use({ isMobile: false });

  test("The toggle is applied even while the map reports its style as still loading (it used to be silently dropped, leaving the legend on and the polygons hidden)", async ({ page, request }) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const conflict = await request.post("/api/admin/conflicts", { data: { slug: `tc-render-${unique}`, name: `Render ${unique}`, region: "Asia", severity: "guarded", intensity: 20 } }).then((r) => r.json());
    const actor = await request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: `Render Actor ${unique}` } }).then((r) => r.json());
    const draft = await request
      .post("/api/admin/territorial-control", {
        data: { conflictId: conflict.id, actorId: actor.id, status: "controlled", confidence: 0.7, geometry: { type: "Polygon", coordinates: [[[-150, -50], [-140, -50], [-140, -40], [-150, -40], [-150, -50]]] }, validFrom: new Date(Date.now() - 48 * 3600_000).toISOString() },
      })
      .then((r) => r.json());
    await request.post(`/api/admin/territorial-control/${draft.id}/publish`);

    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    // MapLibre's isStyleLoaded() is false whenever any source is mid-load — simulate that moment.
    await page.evaluate(() => {
      (window as unknown as { __vigilMap: { isStyleLoaded: () => boolean } }).__vigilMap.isStyleLoaded = () => false;
    });
    await page.getByTestId("territorial-toggle").click();
    await expect(page.getByTestId(`territory-legend-actor-Render Actor ${unique}`)).toBeVisible();
    const visibility = () => page.evaluate(() => (window as unknown as { __vigilMap: { getLayoutProperty: (l: string, p: string) => string } }).__vigilMap.getLayoutProperty("territory-fill", "visibility"));
    await expect.poll(visibility).toBe("visible");
    // ...and the polygon is genuinely in the rendered map, not just flagged visible.
    await page.evaluate(() => (window as unknown as { __vigilMap: { jumpTo: (o: object) => void } }).__vigilMap.jumpTo({ center: [-145, -45], zoom: 5 }));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __vigilMap: { queryRenderedFeatures: (o: object) => unknown[] } }).__vigilMap.queryRenderedFeatures({ layers: ["territory-fill"] }).length))
      .toBeGreaterThan(0);
    // Toggling back off hides it again.
    await page.getByTestId("territorial-toggle").click();
    await expect.poll(visibility).toBe("none");
  });
});
