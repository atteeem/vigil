import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { closeWorldControls, openWorldControls } from "./helpers/world-controls";
import { enableTerritory } from "./helpers/territory";
import { planarArea, sameArea } from "@/lib/territory/geometry";
import type { TerritorialGeometry } from "@/lib/types/territorial-control";

// The visual territory editor in /admin/territorial-control: drawing, vertex
// editing, validation, publishing with confirmation, partial (split) changes,
// the territorial-change candidate hand-off, and that the results still render
// on the public map. Desktop only (wide admin layout, real mouse drags).

test.use({ isMobile: false });
// Drawing needs the wide admin layout and real pixel coordinates; like the other
// admin-table specs this runs on the Desktop project only.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === "Mobile", "Admin drawing tools are a desktop workflow");
});

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const square = (x0: number, y0: number, x1: number, y1: number): TerritorialGeometry => ({
  type: "Polygon",
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

type Api = APIRequestContext;

test.afterAll(async () => {
  const { prisma } = await import("@/lib/db/client");
  await prisma.conflict.deleteMany({ where: { slug: { startsWith: "ui-te-" } } });
});

async function makeConflict(request: Api) {
  const tag = unique();
  const conflict = await request.post("/api/admin/conflicts", { data: { slug: `ui-te-${tag}`, name: `UI TE ${tag}`, region: "Asia", severity: "guarded", intensity: 30 } }).then((r) => r.json());
  const a = await request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: `Alpha ${tag}` } }).then((r) => r.json());
  const b = await request.post("/api/admin/actors", { data: { conflictId: conflict.id, name: `Bravo ${tag}` } }).then((r) => r.json());
  return { conflict: conflict as { id: string; name: string }, a: a as { id: string; name: string }, b: b as { id: string; name: string }, tag };
}

async function publishedBase(request: Api, w: Awaited<ReturnType<typeof makeConflict>>, geometry = square(-60, -30, -50, -20)) {
  const draft = await request
    .post("/api/admin/territorial-control", {
      data: { conflictId: w.conflict.id, actorId: w.a.id, status: "controlled", confidence: 0.8, geometry, sourceName: "Original mapper", validFrom: new Date(Date.now() - 72 * 3600_000).toISOString() },
    })
    .then((r) => r.json());
  await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
  return draft as { id: string };
}

async function rows(request: Api, conflictId: string) {
  const all = (await request.get("/api/admin/territorial-control").then((r) => r.json())) as Record<string, any>[];
  return all.filter((t) => t.conflictId === conflictId);
}

// ---- editor helpers ----------------------------------------------------------

async function editorReady(page: Page) {
  await page.waitForFunction(() => {
    const map = (window as unknown as { __vigilEditorMap?: { getSource: (s: string) => unknown } }).__vigilEditorMap;
    return Boolean(map && map.getSource("ed-draft"));
  });
  await page.getByTestId("territory-editor-map").scrollIntoViewIfNeeded();
}

async function px(page: Page, lng: number, lat: number) {
  // Centre the whole map in the viewport so every projected point is on screen.
  await page.getByTestId("territory-editor-map").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = await page.locator("[data-testid=territory-editor-map] canvas.maplibregl-canvas").boundingBox();
  if (!box) throw new Error("editor canvas not found");
  const p = await page.evaluate(([x, y]) => (window as unknown as { __vigilEditorMap: { project: (c: [number, number]) => { x: number; y: number } } }).__vigilEditorMap.project([x!, y!]), [lng, lat]);
  return { x: box.x + p.x, y: box.y + p.y };
}

const renderedCount = (page: Page, layer: string) =>
  page.evaluate((l) => (window as unknown as { __vigilEditorMap: { queryRenderedFeatures: (o: object) => unknown[] } }).__vigilEditorMap.queryRenderedFeatures({ layers: [l] }).length, layer);

async function clickAt(page: Page, lng: number, lat: number) {
  const p = await px(page, lng, lat);
  await page.mouse.click(p.x, p.y);
}

async function drawPolygon(page: Page, points: [number, number][]) {
  // An empty editor sits on the default world view; bring the drawing area on screen first.
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const center = [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
  await page.evaluate((c) => (window as unknown as { __vigilEditorMap: { jumpTo: (o: object) => void } }).__vigilEditorMap.jumpTo({ center: c, zoom: 3 }), center);
  await page.getByTestId("editor-draw").click();
  for (const [lng, lat] of points) await clickAt(page, lng, lat);
  await page.getByTestId("editor-finish").click();
}

const geometryInText = async (page: Page): Promise<TerritorialGeometry | null> => {
  const text = await page.getByTestId("territory-geometry-input").inputValue();
  return text.trim() ? (JSON.parse(text) as TerritorialGeometry) : null;
};

async function openNewForm(page: Page, w: Awaited<ReturnType<typeof makeConflict>>) {
  await page.goto("/admin/territorial-control");
  await page.getByTestId("territory-create-button").click();
  const form = page.getByTestId("territory-form");
  await form.getByLabel("Conflict").selectOption({ label: w.conflict.name });
  await expect(form.getByLabel("Controlling actor")).toBeEnabled();
  await form.getByLabel("Controlling actor").selectOption({ label: w.a.name });
  await editorReady(page);
  return form;
}

// ------------------------------------------------------------------------------

test.describe("Drawing and editing", () => {
  test("draw a new polygon with clicks, see it in the JSON box, and save it as a draft", async ({ page, request }) => {
    const w = await makeConflict(request);
    await openNewForm(page, w);

    await drawPolygon(page, [[-50, -25], [-40, -25], [-40, -15], [-50, -15]]);
    await expect(page.getByTestId("editor-summary")).toContainText("1 polygon, 4 vertices");
    const g = (await geometryInText(page))!;
    expect(g.type).toBe("Polygon");
    expect((g.coordinates as number[][][])[0]).toHaveLength(5); // closed ring
    expect(sameArea(g, square(-50, -25, -40, -15), 6)).toBe(true); // clicked pixels, so within rounding

    await page.getByTestId("territory-form-submit").click();
    await expect(page.getByTestId("territory-form")).not.toBeVisible();
    const mine = await rows(request, w.conflict.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ published: false, actorId: w.a.id, status: "controlled" });
    expect(sameArea(mine[0]!.geometry, g)).toBe(true);
  });

  test("a second drawn polygon makes a MultiPolygon", async ({ page, request }) => {
    const w = await makeConflict(request);
    await openNewForm(page, w);
    await drawPolygon(page, [[-50, -25], [-40, -25], [-40, -15], [-50, -15]]);
    await drawPolygon(page, [[20, 10], [30, 10], [30, 20], [20, 20]]);
    await expect(page.getByTestId("editor-summary")).toContainText("2 polygons, 8 vertices");
    expect((await geometryInText(page))!.type).toBe("MultiPolygon");
  });

  test("move, add and remove vertices of a draft polygon, then delete it", async ({ page, request }) => {
    const w = await makeConflict(request);
    const draft = await request
      .post("/api/admin/territorial-control", {
        data: { conflictId: w.conflict.id, actorId: w.a.id, status: "controlled", confidence: 0.5, geometry: square(-50, -25, -40, -15), validFrom: new Date().toISOString() },
      })
      .then((r) => r.json());
    await page.goto("/admin/territorial-control");
    await page.getByTestId(`territory-edit-${draft.id}`).click();
    await editorReady(page);
    await expect(page.getByTestId("editor-summary")).toContainText("1 polygon, 4 vertices");
    await expect.poll(() => renderedCount(page, "ed-verts")).toBe(4);

    // Move: drag the top-right corner outwards.
    const from = await px(page, -40, -15);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 25, from.y - 20, { steps: 6 });
    await page.mouse.up();
    let g = (await geometryInText(page))!;
    const ring = (g.coordinates as number[][][])[0]!;
    expect(ring[2]![0]).toBeGreaterThan(-40); // moved east
    expect(ring[2]![1]).toBeGreaterThan(-15); // moved north
    expect(ring[0]).toEqual([-50, -25]); // others untouched
    expect(planarArea(g)).toBeGreaterThan(100);

    // Add: click the midpoint handle of the bottom edge.
    const mid = await px(page, -45, -25);
    await page.mouse.click(mid.x, mid.y);
    await expect(page.getByTestId("editor-summary")).toContainText("5 vertices");
    g = (await geometryInText(page))!;
    expect((g.coordinates as number[][][])[0]).toHaveLength(6);

    // Remove: double-click the new vertex.
    const added = await px(page, -45, -25);
    await page.mouse.dblclick(added.x, added.y);
    await expect(page.getByTestId("editor-summary")).toContainText("4 vertices");

    // Remove via the toolbar: select a vertex, press Remove vertex.
    const corner = await px(page, -50, -15);
    await page.mouse.click(corner.x, corner.y);
    await page.getByTestId("editor-remove-vertex").click();
    await expect(page.getByTestId("editor-summary")).toContainText("3 vertices");
    // A triangle can't lose another vertex.
    const v = await px(page, -50, -25);
    await page.mouse.dblclick(v.x, v.y);
    await expect(page.getByTestId("editor-summary")).toContainText("3 vertices");

    // Delete the draft geometry.
    await page.getByTestId("editor-clear").click();
    await expect(page.getByTestId("editor-summary")).toContainText("0 polygons");
    expect(await geometryInText(page)).toBeNull();

    // Revert restores the saved geometry.
    await page.getByTestId("territory-revert").click();
    await expect(page.getByTestId("editor-summary")).toContainText("1 polygon, 4 vertices");
  });

  test("editing the advanced JSON updates the map, and an invalid (self-crossing) drawing is rejected with a clear message", async ({ page, request }) => {
    const w = await makeConflict(request);
    await openNewForm(page, w);
    const before = (await rows(request, w.conflict.id)).length;

    // A bow-tie: clicks that cross.
    await drawPolygon(page, [[-50, -25], [-40, -15], [-40, -25], [-50, -15]]);
    await expect(page.getByTestId("editor-invalid")).toContainText("crosses itself");
    await expect(page.getByTestId("territory-validation-errors")).toContainText("crosses itself");

    await page.getByTestId("territory-preview").click();
    await expect(page.getByTestId("territory-preview-status")).toContainText("cannot publish");
    await page.getByTestId("territory-form-submit").click();
    await expect(page.getByTestId("territory-form-error")).toContainText("crosses itself");
    expect((await rows(request, w.conflict.id)).length).toBe(before);

    // Fix it through the JSON box: the editor follows.
    await page.getByTestId("territory-geometry-input").fill(JSON.stringify(square(-50, -25, -40, -15)));
    await expect(page.getByTestId("editor-summary")).toContainText("1 polygon, 4 vertices");
    await expect(page.getByTestId("territory-validation-errors")).toHaveCount(0);
  });

  test("publishing requires confirmation and then makes the territory live", async ({ page, request }) => {
    const w = await makeConflict(request);
    const form = await openNewForm(page, w);
    await form.getByLabel("Source name").fill("Field report");
    await drawPolygon(page, [[-50, -25], [-40, -25], [-40, -15], [-50, -15]]);

    await expect(page.getByTestId("territory-publish")).toBeDisabled();
    await page.getByTestId("territory-preview").click();
    await expect(page.getByTestId("territory-preview-status")).toContainText("valid");
    await page.getByTestId("territory-confirm").check();
    await page.getByTestId("territory-publish").click();
    await expect(page.getByTestId("territory-form")).not.toBeVisible();

    const mine = await rows(request, w.conflict.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ published: true, actorName: w.a.name, sourceName: "Field report", validTo: null });
  });
});

test.describe("Partial (split) control change", () => {
  test("draw only the affected area: preview old vs new, confirm, publish — the rest stays with the old controller", async ({ page, request }) => {
    const w = await makeConflict(request);
    const base = await publishedBase(request, w);
    await page.goto("/admin/territorial-control");
    await page.getByTestId(`territory-split-${base.id}`).click();
    await expect(page.getByTestId("territory-split-explainer")).toContainText(w.a.name);
    await editorReady(page);

    const form = page.getByTestId("territory-form");
    await form.getByLabel("Controlling actor").selectOption({ label: w.b.name });
    await form.getByLabel("Source name").fill("Change report");
    await drawPolygon(page, [[-55, -35], [-45, -35], [-45, -15], [-55, -15]]); // right/left half of base + beyond

    await page.getByTestId("territory-preview").click();
    await expect(page.getByTestId("territory-preview-status")).toContainText("valid");
    await expect(page.getByTestId("territory-preview-affected")).toContainText(`${w.b.name}`);
    await expect(page.getByTestId("territory-preview-affected")).toContainText("50%");
    await expect(page.getByTestId("territory-preview-remainder")).toContainText(`Stays with ${w.a.name}`);
    await expect(page.getByTestId("territory-preview-panel")).toContainText("outside the current territory");
    // Old vs proposed are both on the map: remainder + affected overlays.
    await expect.poll(() => renderedCount(page, "ed-overlay-fill")).toBeGreaterThan(0);

    // Nothing is published until confirmed.
    await expect(page.getByTestId("territory-publish")).toBeDisabled();
    expect((await rows(request, w.conflict.id)).length).toBe(1);
    await page.getByTestId("territory-confirm").check();
    await page.getByTestId("territory-publish").click();
    await expect(page.getByTestId("territory-form")).not.toBeVisible();

    const all = await rows(request, w.conflict.id);
    expect(all).toHaveLength(3);
    const old = all.find((t) => t.id === base.id)!;
    expect(old.validTo).not.toBeNull();
    expect(old.geometry).toEqual(square(-60, -30, -50, -20));
    const affected = all.find((t) => t.actorId === w.b.id)!;
    const remainder = all.find((t) => t.id !== base.id && t.actorId === w.a.id)!;
    expect(affected).toMatchObject({ status: "controlled", sourceName: "Change report", validTo: null, splitFromId: base.id });
    expect(sameArea(affected.geometry, square(-55, -30, -50, -20), 2)).toBe(true);
    expect(remainder).toMatchObject({ sourceName: "Original mapper", validTo: null, splitFromId: base.id });
    expect(sameArea(remainder.geometry, square(-60, -30, -55, -20), 2)).toBe(true);
    await expect(page.getByTestId(`territory-split-tag-${affected.id}`)).toBeVisible();
  });

  test("a partial change can be saved as a draft, reopened, and published later", async ({ page, request }) => {
    const w = await makeConflict(request);
    const base = await publishedBase(request, w);
    await page.goto("/admin/territorial-control");
    await page.getByTestId(`territory-split-${base.id}`).click();
    await editorReady(page);
    await page.getByTestId("territory-form").getByLabel("Controlling actor").selectOption({ label: w.b.name });
    await drawPolygon(page, [[-58, -28], [-52, -28], [-52, -22], [-58, -22]]);
    await page.getByTestId("territory-form-submit").click(); // Save Draft
    await expect(page.getByTestId("territory-form")).not.toBeVisible();

    let all = await rows(request, w.conflict.id);
    expect(all).toHaveLength(2);
    const draft = all.find((t) => t.id !== base.id)!;
    expect(draft).toMatchObject({ published: false, splitFromId: base.id, actorId: w.b.id });
    expect(all.find((t) => t.id === base.id)!.validTo).toBeNull(); // the draft changed nothing

    await page.reload();
    await page.getByTestId(`territory-edit-${draft.id}`).click();
    await expect(page.getByTestId("territory-split-explainer")).toBeVisible();
    await editorReady(page);
    await page.getByTestId("territory-confirm").check();
    await page.getByTestId("territory-publish").click();
    await expect(page.getByTestId("territory-form")).not.toBeVisible();
    all = await rows(request, w.conflict.id);
    expect(all).toHaveLength(3);
    expect(all.find((t) => t.id === base.id)!.validTo).not.toBeNull();
  });

  test("reshaping a whole polygon publishes a new version and keeps the old geometry", async ({ page, request }) => {
    const w = await makeConflict(request);
    const base = await publishedBase(request, w);
    await page.goto("/admin/territorial-control");
    await page.getByTestId(`territory-supersede-${base.id}`).click();
    await editorReady(page);
    await expect.poll(() => renderedCount(page, "ed-verts")).toBe(4);

    const corner = await px(page, -50, -20);
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x + 30, corner.y, { steps: 6 });
    await page.mouse.up();
    await page.getByTestId("territory-confirm").check();
    await page.getByTestId("territory-form-submit").click();
    await expect(page.getByTestId("territory-form")).not.toBeVisible();

    const all = await rows(request, w.conflict.id);
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.id === base.id)!.geometry).toEqual(square(-60, -30, -50, -20));
    const next = all.find((t) => t.id !== base.id)!;
    expect(planarArea(next.geometry)).toBeGreaterThan(100);
  });
});

test.describe("From a territorial-change candidate", () => {
  async function candidateWorld(request: Api, opts: { approximate: boolean }) {
    const w = await makeConflict(request);
    const base = await publishedBase(request, w);
    const unitA = await request.post("/api/admin/military-units", { data: { name: w.a.name } }).then((r) => r.json());
    const unitB = await request.post("/api/admin/military-units", { data: { name: w.b.name } }).then((r) => r.json());
    const location = `Town ${unique()}`;
    const cand = await request
      .post("/api/admin/territorial-change-candidates", {
        data: {
          conflictId: w.conflict.id,
          description: "Bravo captured the town from Alpha",
          changeType: "captured",
          claimedActorId: unitB.id,
          previousActorId: unitA.id,
          locationName: location,
          lat: opts.approximate ? -25 : null,
          lng: opts.approximate ? -52 : null,
          precision: opts.approximate ? "approximate" : "unknown",
          sourceName: "Candidate wire",
          sourceUrl: "https://fixture.test/candidate-ui",
          observedAt: new Date(Date.now() - 3600_000).toISOString(),
        },
      })
      .then((r) => r.json());
    return { ...w, base, cand: cand as { id: string }, location };
  }

  test("reviewed candidate -> open in editor -> current vs proposed -> draw only the affected area -> confirm -> split", async ({ page, request }) => {
    const w2 = await candidateWorld(request, { approximate: true });
    await page.goto("/admin/territorial-changes");
    await page.getByTestId("tc-row").filter({ hasText: w2.location }).click();
    await page.getByTestId("tc-open-editor").click();

    await expect(page.getByTestId("territory-candidate-banner")).toContainText("Bravo captured the town");
    await expect(page.getByTestId("territory-candidate-states")).toContainText(`Current: controlled (${w2.a.name})`);
    await expect(page.getByTestId("territory-candidate-states")).toContainText(`Proposed: controlled (${w2.b.name})`);
    await expect(page.getByTestId("territory-source-select")).toHaveValue(w2.base.id);
    await editorReady(page);

    // The actor/status fields are the candidate's proposal, not free text.
    await expect(page.getByTestId("territory-form").getByLabel("Status")).toBeDisabled();

    await drawPolygon(page, [[-54, -26], [-50, -26], [-50, -22], [-54, -22]]);
    await page.getByTestId("territory-preview").click();
    await expect(page.getByTestId("territory-preview-status")).toContainText("valid");
    await expect(page.getByTestId("territory-preview-affected")).toContainText(/1[3-9]%/);
    await expect(page.getByTestId("territory-preview-remainder")).toContainText(/8[1-7]%/);

    await expect(page.getByTestId("territory-form-submit")).toBeDisabled(); // needs confirmation
    expect((await rows(request, w2.conflict.id)).length).toBe(1);
    await page.getByTestId("territory-confirm").check();
    await page.getByTestId("territory-form-submit").click();
    await expect(page.getByTestId("territory-form")).not.toBeVisible();

    const all = await rows(request, w2.conflict.id);
    expect(all).toHaveLength(3);
    const affected = all.find((t) => t.actorId === w2.b.id)!;
    expect(affected).toMatchObject({ sourceName: "Candidate wire", sourceUrl: "https://fixture.test/candidate-ui", status: "controlled", validTo: null });
    expect(sameArea(affected.geometry, square(-54, -26, -50, -22), 4)).toBe(true);
    const remainder = all.find((t) => t.id !== w2.base.id && t.actorId === w2.a.id)!;
    expect(planarArea(remainder.geometry)).toBeGreaterThan(80);
    expect(planarArea(remainder.geometry)).toBeLessThan(89);
    const detail = await request.get(`/api/admin/territorial-change-candidates/${w2.cand.id}`).then((r) => r.json());
    expect(detail).toMatchObject({ status: "approved", geometryPending: false, appliedTerritoryId: affected.id });
  });

  test("pending-geometry candidate -> edited -> published as a new territory (nothing derived from the article)", async ({ page, request }) => {
    const w = await candidateWorld(request, { approximate: false });
    await request.post(`/api/admin/territorial-change-candidates/${w.cand.id}/review`, { data: { action: "approve" } });
    const before = await rows(request, w.conflict.id);
    expect(before).toHaveLength(1); // approval alone created no geometry

    await page.goto("/admin/territorial-changes");
    await page.getByTestId("tc-tab-geometry").click();
    await page.getByTestId("tc-row").filter({ hasText: w.location }).click();
    await expect(page.getByTestId("tc-applied")).toContainText("Geometry is pending");
    await page.getByTestId("tc-open-editor").click();
    await expect(page.getByTestId("territory-candidate-banner")).toBeVisible();
    await expect(page.getByTestId("territory-source-select")).toHaveValue(""); // no current territory matched: a new area
    await editorReady(page);
    await drawPolygon(page, [[-40, -12], [-35, -12], [-35, -8], [-40, -8]]);
    await page.getByTestId("territory-confirm").check();
    await page.getByTestId("territory-form-submit").click();
    await expect(page.getByTestId("territory-form")).not.toBeVisible();

    const all = await rows(request, w.conflict.id);
    expect(all).toHaveLength(2);
    const created = all.find((t) => t.id !== w.base.id)!;
    expect(created).toMatchObject({ actorName: w.b.name, status: "controlled", published: true, sourceName: "Candidate wire" });
    expect(sameArea(created.geometry, square(-40, -12, -35, -8), 4)).toBe(true);
    const detail = await request.get(`/api/admin/territorial-change-candidates/${w.cand.id}`).then((r) => r.json());
    expect(detail).toMatchObject({ geometryPending: false, appliedTerritoryId: created.id });
  });
});

test.describe("Public map", () => {
  test("a split territory renders as two actors in Territorial Control mode, alongside Heatmap ('Both'), with markers still on top", async ({ page, request }) => {
    const w = await makeConflict(request);
    const base = await publishedBase(request, w);
    const draft = await request
      .post("/api/admin/territorial-control", {
        data: { conflictId: w.conflict.id, actorId: w.b.id, status: "controlled", confidence: 0.6, geometry: square(-58, -28, -52, -22), validFrom: new Date(Date.now() - 3600_000).toISOString(), splitFromId: base.id },
      })
      .then((r) => r.json());
    expect((await request.post(`/api/admin/territorial-control/${draft.id}/publish`)).ok()).toBe(true);

    await page.goto("/world");
    await page.waitForFunction(() => Boolean((window as unknown as { __vigilMap?: unknown }).__vigilMap));
    await enableTerritory(page);
    await expect(page.getByTestId(`territory-legend-actor-${w.a.name}`)).toBeVisible();
    await expect(page.getByTestId(`territory-legend-actor-${w.b.name}`)).toBeVisible();
    await page.evaluate(() => (window as unknown as { __vigilMap: { jumpTo: (o: object) => void } }).__vigilMap.jumpTo({ center: [-55, -25], zoom: 5 }));
    await expect
      .poll(() =>
        page.evaluate((conflictId) => {
          const map = (window as unknown as { __vigilMap: { querySourceFeatures: (s: string) => { properties: Record<string, any> }[] } }).__vigilMap;
          return [...new Set(map.querySourceFeatures("territory").filter((f) => f.properties.conflictId === conflictId).map((f) => f.properties.actorName))].sort();
        }, w.conflict.id),
      )
      .toEqual([w.a.name, w.b.name].sort());

    // "Both": heatmap on with territory still visible, and marker layers stay above the territory layers.
    await openWorldControls(page, "map");
    await page.getByRole("button", { name: "Heatmap" }).click();
    await closeWorldControls(page);
    const order = await page.evaluate(() => {
      const map = (window as unknown as { __vigilMap: { getStyle: () => { layers: { id: string }[] }; getLayoutProperty: (l: string, p: string) => string } }).__vigilMap;
      const ids = map.getStyle().layers.map((l) => l.id);
      return { fill: ids.indexOf("territory-fill"), marker: ids.indexOf("unclustered-point"), heat: ids.indexOf("heat-surface"), vis: map.getLayoutProperty("territory-fill", "visibility") };
    });
    expect(order.vis).toBe("visible");
    expect(order.fill).toBeGreaterThan(-1);
    expect(order.marker).toBeGreaterThan(order.fill);
    // The continuous heat surface sits BENEATH the territory polygons (which stay readable on top of it).
    expect(order.heat).toBeGreaterThan(-1);
    expect(order.heat).toBeLessThan(order.fill);
  });

  test("timeline: before the change the whole old polygon renders, after it the split halves", async ({ page, request }) => {
    const w = await makeConflict(request);
    const base = await publishedBase(request, w);
    const changeAt = new Date(Date.now() - 3600_000);
    const draft = await request
      .post("/api/admin/territorial-control", {
        data: { conflictId: w.conflict.id, actorId: w.b.id, status: "controlled", confidence: 0.6, geometry: square(-58, -28, -52, -22), validFrom: changeAt.toISOString(), splitFromId: base.id },
      })
      .then((r) => r.json());
    await request.post(`/api/admin/territorial-control/${draft.id}/publish`);

    // The exact endpoint the map's asOf timeline reads.
    const at = async (d: Date) => {
      const c = await request.get(`/api/territorial-control?at=${encodeURIComponent(d.toISOString())}`).then((r) => r.json());
      return (c.features as { id: string; geometry: TerritorialGeometry; properties: Record<string, any> }[]).filter((f) => f.properties.conflictId === w.conflict.id);
    };
    const before = await at(new Date(changeAt.getTime() - 60_000));
    expect(before.map((f) => f.id)).toEqual([base.id]);
    expect(sameArea(before[0]!.geometry, square(-60, -30, -50, -20))).toBe(true);
    const after = await at(new Date());
    expect(after).toHaveLength(2);
    expect(after.map((f) => f.properties.actorName).sort()).toEqual([w.a.name, w.b.name].sort());
    expect(after.reduce((n, f) => n + planarArea(f.geometry), 0)).toBeCloseTo(100, 6);
  });
});

// ------------------------------------------------------------------------------
// Editing tools: undo / redo, holes, merge, simplify, snapping (lib/territory/edit-tools.ts).

test.describe("Editing tools", () => {
  test("undo and redo step through vertex edits, by button and by Ctrl+Z / Ctrl+Y", async ({ page, request }) => {
    const w = await makeConflict(request);
    await openNewForm(page, w);
    await drawPolygon(page, [[-50, -25], [-40, -25], [-40, -15], [-50, -15]]);
    await expect(page.getByTestId("editor-summary")).toContainText("1 polygon, 4 vertices");

    const mid = await px(page, -45, -25);
    await page.mouse.click(mid.x, mid.y); // add a vertex on the bottom edge
    await expect(page.getByTestId("editor-summary")).toContainText("5 vertices");

    await page.getByTestId("editor-undo").click();
    await expect(page.getByTestId("editor-summary")).toContainText("4 vertices");
    await page.getByTestId("editor-redo").click();
    await expect(page.getByTestId("editor-summary")).toContainText("5 vertices");

    await page.getByTestId("territory-editor-map").focus();
    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("editor-summary")).toContainText("4 vertices");
    await page.keyboard.press("Control+y");
    await expect(page.getByTestId("editor-summary")).toContainText("5 vertices");
    // Undo all the way: back to the drawn square, then to nothing (the draw itself is a step).
    await page.getByTestId("editor-undo").click();
    await page.getByTestId("editor-undo").click();
    await expect(page.getByTestId("editor-summary")).toContainText("0 polygons");
    await expect(page.getByTestId("editor-undo")).toBeDisabled();
    // The JSON box follows the history.
    expect(await geometryInText(page)).toBeNull();
    await page.getByTestId("editor-redo").click();
    await expect(page.getByTestId("editor-summary")).toContainText("1 polygon, 4 vertices");
  });

  test("cut a hole: the polygon keeps an interior ring, the area drops, and it can be undone", async ({ page, request }) => {
    const w = await makeConflict(request);
    await openNewForm(page, w);
    await drawPolygon(page, [[-50, -25], [-40, -25], [-40, -15], [-50, -15]]);
    const before = (await geometryInText(page))!;
    await page.getByTestId("editor-hole").click();
    for (const [lng, lat] of [[-47, -22], [-43, -22], [-43, -18], [-47, -18]] as [number, number][]) await clickAt(page, lng, lat);
    await page.getByTestId("editor-finish").click();
    const after = (await geometryInText(page))!;
    expect(after.type).toBe("Polygon");
    expect((after.coordinates as number[][][]).length).toBe(2); // outer ring + one hole
    expect(planarArea(after)).toBeCloseTo(planarArea(before) - 16, 0);
    await page.getByTestId("editor-undo").click();
    expect(((await geometryInText(page))!.coordinates as number[][][]).length).toBe(1);
  });

  test("a hole ring that misses the polygon says so and changes nothing", async ({ page, request }) => {
    const w = await makeConflict(request);
    await openNewForm(page, w);
    await drawPolygon(page, [[-50, -25], [-40, -25], [-40, -15], [-50, -15]]);
    await page.getByTestId("editor-hole").click();
    for (const [lng, lat] of [[-30, -25], [-26, -25], [-26, -21]] as [number, number][]) await clickAt(page, lng, lat);
    await page.getByTestId("editor-finish").click();
    await expect(page.getByTestId("editor-notice")).toContainText("nothing was cut");
    expect(((await geometryInText(page))!.coordinates as number[][][]).length).toBe(1);
  });

  test("merge fuses overlapping polygons into one", async ({ page, request }) => {
    const w = await makeConflict(request);
    await openNewForm(page, w);
    await drawPolygon(page, [[-50, -25], [-42, -25], [-42, -15], [-50, -15]]);
    await drawPolygon(page, [[-45, -22], [-38, -22], [-38, -12], [-45, -12]]);
    await expect(page.getByTestId("editor-summary")).toContainText("2 polygons");
    await page.getByTestId("editor-merge").click();
    await expect(page.getByTestId("editor-summary")).toContainText("1 polygon");
    expect((await geometryInText(page))!.type).toBe("Polygon");
    await page.getByTestId("editor-undo").click();
    await expect(page.getByTestId("editor-summary")).toContainText("2 polygons");
  });

  test("simplify removes redundant vertices from a dense outline and keeps it valid", async ({ page, request }) => {
    const w = await makeConflict(request);
    // A square whose sides carry 24 almost-collinear extra points each (typical of a traced border).
    const side = (a: [number, number], b: [number, number]) => Array.from({ length: 24 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 24 + (i % 2 ? 0.0001 : 0), a[1] + ((b[1] - a[1]) * i) / 24 + (i % 2 ? 0.0001 : 0)]);
    const ring = [...side([-50, -25], [-40, -25]), ...side([-40, -25], [-40, -15]), ...side([-40, -15], [-50, -15]), ...side([-50, -15], [-50, -25])];
    ring.push(ring[0]!);
    const draft = await request.post("/api/admin/territorial-control", { data: { conflictId: w.conflict.id, actorId: w.a.id, status: "controlled", confidence: 0.5, geometry: { type: "Polygon", coordinates: [ring] }, validFrom: new Date().toISOString() } }).then((r) => r.json());
    await page.goto("/admin/territorial-control");
    await page.getByTestId(`territory-edit-${draft.id}`).click();
    await editorReady(page);
    await expect(page.getByTestId("editor-summary")).toContainText("96 vertices");
    await page.getByTestId("editor-simplify").click();
    await expect(page.getByTestId("editor-notice")).toContainText("96 →");
    await expect(page.getByTestId("editor-summary")).not.toContainText("96 vertices");
    const g = (await geometryInText(page))!;
    expect((g.coordinates as number[][][])[0]!.length).toBeLessThan(30);
    expect(planarArea(g)).toBeCloseTo(100, 0);
    await expect(page.getByTestId("editor-invalid")).toHaveCount(0);
  });

  test("snapping: a point placed near an existing vertex lands exactly on it; with snapping off it does not", async ({ page, request }) => {
    const w = await makeConflict(request);
    await openNewForm(page, w);
    await drawPolygon(page, [[-50, -25], [-40, -25], [-40, -15], [-50, -15]]);
    const first = (await geometryInText(page))!;
    const cornerVertex = (first.coordinates as number[][][])[0]![2]!; // the clicked top-right corner, exactly as stored
    const startSecond = async () => {
      await page.getByTestId("editor-draw").click();
      const corner = await px(page, cornerVertex[0]!, cornerVertex[1]!); // measured after the toolbar click: the page may have scrolled
      await page.mouse.click(corner.x + 4, corner.y + 3); // a few pixels off the corner
      await expect(page.getByTestId("editor-hint")).toContainText("1 point placed");
      await clickAt(page, -36, -15); // the camera is fitted to the 10-degree square: keep every click on screen
      await expect(page.getByTestId("editor-hint")).toContainText("2 points placed");
      await clickAt(page, -36, -11);
      await expect(page.getByTestId("editor-hint")).toContainText("first point");
      await page.getByTestId("editor-finish").click();
    };
    await startSecond();
    let g = (await geometryInText(page))!;
    expect(g.type).toBe("MultiPolygon");
    expect((g.coordinates as number[][][][])[1]![0]![0]).toEqual(cornerVertex);
    await page.getByTestId("editor-undo").click();
    await page.getByTestId("editor-snap").uncheck();
    await startSecond();
    g = (await geometryInText(page))!;
    expect((g.coordinates as number[][][][])[1]![0]![0]).not.toEqual(cornerVertex);
  });
});
