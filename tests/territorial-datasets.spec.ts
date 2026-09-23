import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { matchesDatasetFilter } from "@/lib/territory/dataset-types";
import { disableTerritory, enableTerritory } from "./helpers/territory";

// Territorial Control v2: the selector lists only datasets that actually have published geometry (from the registry,
// not hard-coded), geometry is loaded on demand per dataset and per timeline moment, control and presence stay distinct,
// provenance is kept, and a conflict with no data gets a clean empty state.

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const BOX = (lng: number, lat: number) => ({ type: "Polygon", coordinates: [[[lng, lat], [lng + 4, lat], [lng + 4, lat + 4], [lng, lat + 4], [lng, lat]]] });

async function setup(request: APIRequestContext, opts: { type: "TERRITORIAL_CONTROL" | "PRESENCE"; publish: boolean; lng?: number; lat?: number }) {
  const key = uid();
  const conflict = await (await request.post("/api/admin/conflicts", { data: { slug: `td-${key}`, name: `Dataset Conflict ${key}`, region: "Africa", severity: "guarded", intensity: 30 } })).json();
  const actor = await (await request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: `Actor ${key}` } })).json();
  const dataset = await (
    await request.post("/api/admin/territorial-datasets", {
      data: { slug: `ds-${key}`, name: `Dataset ${key}`, conflictId: conflict.id, countryCodes: ["ZZ"], datasetType: opts.type, provider: "Test provider", sourceUrl: "https://provider.example-source.test/data", license: "CC BY", attribution: "Test provider", reviewStatus: opts.publish ? "approved" : "pending_review", geometryAvailability: opts.publish ? "published" : "draft" },
    })
  ).json();
  const kind = opts.type === "PRESENCE" ? "presence" : "control";
  const make = async (validFrom: string, validTo: string | null, lng: number) => {
    const draft = await (
      await request.post("/api/admin/territorial-control", {
        data: { conflictId: conflict.id, actorId: actor.id, status: kind === "presence" ? "uncertain" : "controlled", territoryKind: kind, datasetId: dataset.id, confidence: 0.7, geometry: BOX(lng, opts.lat ?? 5), sourceName: `Snapshot ${validFrom.slice(0, 10)}`, sourceUrl: "https://provider.example-source.test/snapshot", validFrom, validTo },
      })
    ).json();
    if (opts.publish) expect((await request.post(`/api/admin/territorial-control/${draft.id}/publish`)).ok()).toBe(true);
    return draft;
  };
  const old = await make("2024-01-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z", opts.lng ?? 10);
  const current = await make("2025-01-01T00:00:00.000Z", null, (opts.lng ?? 10) + 8);
  return { key, conflict, actor, dataset, old, current };
}

const datasets = async (request: APIRequestContext) => ((await (await request.get("/api/territorial-control/datasets")).json()) as { datasets: { id: string; name: string; datasetType: string; kind: string; provider: string; sourceUrl: string | null; license: string | null; hasHistory: boolean; versionCount: number; actors: string[] }[] }).datasets;
const geometry = async (request: APIRequestContext, ids: string[], at?: string) => ((await (await request.get(`/api/territorial-control?datasets=${ids.join(",")}${at ? `&at=${encodeURIComponent(at)}` : ""}`)).json()) as GeoJSON.FeatureCollection).features;

test.describe("availability comes from published geometry", () => {
  test("a published dataset is listed with its provider, licence and history; a draft-only dataset and a candidate are not", async ({ request }) => {
    const published = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true });
    const draftOnly = await setup(request, { type: "TERRITORIAL_CONTROL", publish: false });
    const candidate = await (await request.post("/api/admin/territorial-datasets", { data: { slug: `cand-${uid()}`, name: `Candidate ${uid()}`, datasetType: "PRESENCE", provider: "Somewhere", reviewStatus: "candidate", geometryAvailability: "none" } })).json();

    const list = await datasets(request);
    const mine = list.find((d) => d.id === published.dataset.id)!;
    expect(mine).toMatchObject({ datasetType: "TERRITORIAL_CONTROL", kind: "control", provider: "Test provider", license: "CC BY", hasHistory: true, versionCount: 2 });
    expect(mine.actors).toEqual([`Actor ${published.key}`]);
    expect(list.some((d) => d.id === draftOnly.dataset.id)).toBe(false);
    expect(list.some((d) => d.id === candidate.id)).toBe(false);
  });

  test("approving an imported dataset publishes its drafts through the review step, and only then does it become available", async ({ request }) => {
    const d = await setup(request, { type: "TERRITORIAL_CONTROL", publish: false });
    expect((await datasets(request)).some((x) => x.id === d.dataset.id)).toBe(false);
    const res = await request.post(`/api/admin/territorial-datasets/${d.dataset.id}/publish`);
    expect((await res.json()).published).toBe(2);
    expect((await datasets(request)).some((x) => x.id === d.dataset.id)).toBe(true);
    const coverage = (await (await request.get("/api/admin/territorial-datasets")).json()) as { rows: { conflictId: string; state: string }[] };
    expect(coverage.rows.find((r) => r.conflictId === d.conflict.id)?.state).toBe("HAS_CONTROL_DATA");
  });

  test("the admin coverage view separates control data, presence data, pending review and no data", async ({ request }) => {
    const control = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true });
    const presence = await setup(request, { type: "PRESENCE", publish: true });
    const pending = await setup(request, { type: "TERRITORIAL_CONTROL", publish: false });
    const empty = await (await request.post("/api/admin/conflicts", { data: { slug: `empty-${uid()}`, name: `No Data ${uid()}`, region: "Africa", severity: "guarded", intensity: 10 } })).json();
    const coverage = (await (await request.get("/api/admin/territorial-datasets")).json()) as { rows: { conflictId: string; state: string; datasets: { license: string | null; provider: string }[] }[] };
    const state = (id: string) => coverage.rows.find((r) => r.conflictId === id);
    expect(state(control.conflict.id)?.state).toBe("HAS_CONTROL_DATA");
    expect(state(presence.conflict.id)?.state).toBe("HAS_PRESENCE_DATA");
    expect(state(pending.conflict.id)?.state).toBe("PENDING_REVIEW");
    expect(state(empty.id)?.state).toBe("NO_DATA");
    expect(state(control.conflict.id)?.datasets[0]).toMatchObject({ provider: "Test provider", license: "CC BY" });
  });
});

test.describe("geometry is loaded on demand", () => {
  test("nothing is returned without a dataset selection; a selection returns only that dataset", async ({ request }) => {
    const a = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true, lng: 10 });
    const b = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true, lng: 60 });
    expect(await geometry(request, [])).toHaveLength(0);
    expect(((await (await request.get("/api/territorial-control")).json()) as GeoJSON.FeatureCollection).features).toHaveLength(0);
    const onlyA = await geometry(request, [a.dataset.id]);
    expect(onlyA.length).toBeGreaterThan(0);
    expect(onlyA.every((f) => (f.properties as { datasetId: string }).datasetId === a.dataset.id)).toBe(true);
    const both = await geometry(request, [a.dataset.id, b.dataset.id]);
    expect(both.length).toBe(onlyA.length + (await geometry(request, [b.dataset.id])).length);
  });

  test("the timeline picks the version valid at that moment and never fabricates history before the first version", async ({ request }) => {
    const d = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true });
    const at = async (iso: string) => (await geometry(request, [d.dataset.id], iso)).map((f) => (f.properties as { sourceName: string }).sourceName);
    expect(await at("2024-06-01T00:00:00.000Z")).toEqual(["Snapshot 2024-01-01"]);
    expect(await at("2025-06-01T00:00:00.000Z")).toEqual(["Snapshot 2025-01-01"]);
    expect(await at("2023-01-01T00:00:00.000Z")).toEqual([]); // before the provider's first version: nothing, not an invented past
  });

  test("control and presence stay distinct and provenance is preserved on every feature", async ({ request }) => {
    const control = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true });
    const presence = await setup(request, { type: "PRESENCE", publish: true });
    const c = (await geometry(request, [control.dataset.id]))[0]!.properties as Record<string, unknown>;
    const p = (await geometry(request, [presence.dataset.id]))[0]!.properties as Record<string, unknown>;
    expect(c.kind).toBe("control");
    expect(p.kind).toBe("presence");
    expect(p.status).not.toBe("controlled"); // presence is never stored or served as controlled
    for (const props of [c, p]) {
      expect(props.sourceName).toMatch(/^Snapshot /);
      expect(props.sourceUrl).toBe("https://provider.example-source.test/snapshot");
      expect(props.validFrom).toBeTruthy();
      expect(props.confidence).toBe(0.7);
      expect(props.conflictSlug).toBeTruthy();
    }
    expect((await datasets(request)).find((d) => d.id === presence.dataset.id)).toMatchObject({ datasetType: "PRESENCE", kind: "presence" });
  });
});

// A taller viewport keeps the canvas centre clear of the floating filter / legend overlays (same as territorial-control-ui.spec.ts).
test.describe("the selector", () => {
  test.use({ viewport: { width: 1280, height: 1000 } });
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, "desktop overlay");
  });

  async function openWorld(page: Page) {
    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
  }
  const features = (page: Page) => page.evaluate(() => (window as unknown as { __vigilMap: { querySourceFeatures: (s: string) => unknown[] } }).__vigilMap.querySourceFeatures("territory").length);

  test("lists only available datasets, labels control vs presence, and enabling / disabling draws / removes the geometry", async ({ page, request }) => {
    const control = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true, lng: 30, lat: 10 });
    const presence = await setup(request, { type: "PRESENCE", publish: true, lng: 60, lat: 10 });
    const draft = await setup(request, { type: "TERRITORIAL_CONTROL", publish: false });
    await openWorld(page);
    expect(await features(page)).toBe(0); // nothing drawn, nothing fetched, until a dataset is chosen

    await page.getByTestId("territorial-toggle").click();
    await expect(page.getByTestId(`territory-dataset-${control.dataset.id}`)).toBeVisible();
    await expect(page.getByTestId(`territory-dataset-${draft.dataset.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`territory-dataset-${control.dataset.id}`).getByTestId("territory-dataset-type")).toHaveText("Territorial control");
    await expect(page.getByTestId(`territory-dataset-${presence.dataset.id}`).getByTestId("territory-dataset-type")).toHaveText("Presence");
    await expect(page.getByTestId(`territory-dataset-${presence.dataset.id}`)).toContainText("not territorial control");

    await page.getByTestId(`territory-check-${control.dataset.id}`).check();
    await expect.poll(() => features(page)).toBeGreaterThan(0);
    await expect(page.getByTestId("territory-legend")).toBeVisible();
    await page.getByTestId(`territory-check-${presence.dataset.id}`).check();
    await expect(page.getByTestId("territory-legend-presence-row")).toContainText("not control");

    await page.getByTestId(`territory-check-${control.dataset.id}`).uncheck();
    await page.getByTestId(`territory-check-${presence.dataset.id}`).uncheck();
    await expect.poll(() => features(page)).toBe(0);
    await expect(page.getByTestId("territorial-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  test("the type filter and search narrow the list", async ({ page, request }) => {
    const control = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true });
    const presence = await setup(request, { type: "PRESENCE", publish: true });
    await openWorld(page);
    await page.getByTestId("territorial-toggle").click();
    await page.getByTestId("territory-filter-influence").click();
    await expect(page.getByTestId(`territory-dataset-${presence.dataset.id}`)).toBeVisible();
    await expect(page.getByTestId(`territory-dataset-${control.dataset.id}`)).toHaveCount(0);
    await page.getByTestId("territory-filter-all").click();
    await page.getByTestId("territory-search").fill(control.key);
    await expect(page.getByTestId(`territory-dataset-${control.dataset.id}`)).toBeVisible();
    await expect(page.getByTestId(`territory-dataset-${presence.dataset.id}`)).toHaveCount(0);
    expect(matchesDatasetFilter("PRESENCE", "influence")).toBe(true);
    expect(matchesDatasetFilter("TERRITORIAL_CONTROL", "influence")).toBe(false);
  });

  test("clicking an area shows its kind, actor, validity and source; the timeline switches the version", async ({ page, request }) => {
    const d = await setup(request, { type: "TERRITORIAL_CONTROL", publish: true, lng: 120, lat: 10 });
    await openWorld(page);
    await enableTerritory(page, d.key);
    // current version sits at lng 128..132
    await page.evaluate(() => (window as unknown as { __vigilMap: { jumpTo: (o: object) => void } }).__vigilMap.jumpTo({ center: [130, 12], zoom: 5 }));
    await expect.poll(() => page.evaluate(() => (window as unknown as { __vigilMap: { queryRenderedFeatures: (o: object) => unknown[] } }).__vigilMap.queryRenderedFeatures({ layers: ["territory-fill"] }).length)).toBeGreaterThan(0);
    const point = await page.evaluate(() => (window as unknown as { __vigilMap: { project: (c: [number, number]) => { x: number; y: number } } }).__vigilMap.project([130, 12]));
    const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
    await page.mouse.click(box.x + point.x, box.y + point.y);
    const panel = page.getByTestId("territory-detail-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("territory-kind-badge")).toHaveText("Control");
    await expect(panel).toContainText(`Actor ${d.key}`);
    await expect(panel.getByTestId("territory-open-conflict")).toHaveAttribute("href", `/conflict/${d.conflict.slug}`);
    await expect(panel).toContainText("Snapshot 2025-01-01");
    await expect(panel.locator('a[href="https://provider.example-source.test/snapshot"]')).toBeVisible();
    await disableTerritory(page);
  });
});
