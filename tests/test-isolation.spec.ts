import { test, expect } from "@playwright/test";
import { disableTerritory, enableTerritory } from "./helpers/territory";
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
    // The database runs in WAL mode: recent writes live in the -wal file until a checkpoint moves them into the main file.
    const bytesOf = (file: string) => [file, `${file}-wal`].filter((f) => existsSync(f)).map((f) => readFileSync(f));
    expect(bytesOf("prisma/test.db").some((b) => b.includes(marker))).toBe(true);
    expect(bytesOf("prisma/dev.db").some((b) => b.includes(marker))).toBe(false);
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
  // Desktop layout (the phone layout moves the selector and legend into sheets; covered by mobile-world-sheets.spec.ts).
  test.use({ isMobile: false, viewport: { width: 1280, height: 800 } });

  test("With no territorial datasets the selector says so, draws nothing and requests no geometry", async ({ page }) => {
    let geometryRequests = 0;
    await page.route("**/api/territorial-control/datasets", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ datasets: [] }) }));
    await page.route("**/api/territorial-control?**", (route) => {
      geometryRequests++;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ type: "FeatureCollection", features: [] }) });
    });
    await page.goto("/world");
    await page.getByTestId("territorial-toggle").click();
    await expect(page.getByTestId("territory-no-datasets")).toHaveText("No territorial datasets are currently available.");
    await expect(page.getByTestId("territory-dataset-list")).toHaveCount(0);
    await expect(page.getByTestId("territory-legend")).toHaveCount(0);
    expect(geometryRequests).toBe(0);
  });
});

test.describe("Territorial Control actually renders when toggled", () => {
  // Desktop layout (the phone layout moves the selector and legend into sheets; covered by mobile-world-sheets.spec.ts).
  test.use({ isMobile: false, viewport: { width: 1280, height: 800 } });

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
    await enableTerritory(page, `Render ${unique}`);
    await expect(page.getByTestId(`territory-legend-actor-Render Actor ${unique}`)).toBeVisible();
    const visibility = () => page.evaluate(() => (window as unknown as { __vigilMap: { getLayoutProperty: (l: string, p: string) => string } }).__vigilMap.getLayoutProperty("territory-fill", "visibility"));
    await expect.poll(visibility).toBe("visible");
    // ...and the polygon is genuinely in the rendered map, not just flagged visible.
    await page.evaluate(() => (window as unknown as { __vigilMap: { jumpTo: (o: object) => void } }).__vigilMap.jumpTo({ center: [-145, -45], zoom: 5 }));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __vigilMap: { queryRenderedFeatures: (o: object) => unknown[] } }).__vigilMap.queryRenderedFeatures({ layers: ["territory-fill"] }).length))
      .toBeGreaterThan(0);
    // Turning the dataset off hides it again.
    await disableTerritory(page);
    await expect.poll(visibility).toBe("none");
  });
});
