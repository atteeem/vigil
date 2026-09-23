import { test, expect } from "@playwright/test";
import { disableTerritory, enableTerritory } from "./helpers/territory";

// Real-browser coverage for Territorial Control Mode's public /world map
// integration — the mode toggle, legend, click-to-inspect panel, and
// timeline/playback integration. Fixture data is created per-test via the
// admin API (same style as tests/world-timeline-api.spec.ts), centered on
// a deliberately distinctive coordinate so it's easy to reason about
// which fixture is being asserted on.
//
// A taller-than-default viewport: the tests that click the map canvas at
// its own geometric center rely on that pixel actually being map canvas,
// not the floating Timeline/Filters/Legend overlay stack — which grows
// tall enough (three stacked cards once the territory legend is showing)
// to cover the vertical center of the default 1280x720 Desktop Chrome
// viewport. A taller viewport pushes the canvas's true center safely
// below that overlay without changing anything about how the overlay or
// the map itself are built.
test.use({ viewport: { width: 1280, height: 1000 } });

function unique() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type APIRequestContext = import("@playwright/test").APIRequestContext;

// A generous box around [20, 25] — comfortably containing that exact
// point, which is what mapPixel()/waitForFeatureAt() below target.
const CENTER_BOX = { type: "Polygon", coordinates: [[[15, 20], [25, 20], [25, 30], [15, 30], [15, 20]]] };
const CENTER_LNG = 20;
const CENTER_LAT = 25;

async function createConflict(request: APIRequestContext) {
  const res = await request.post("/api/admin/conflicts", {
    data: { slug: `territorial-ui-${unique()}`, name: `Territorial UI Test ${unique()}`, region: "Europe", severity: "guarded", intensity: 40 },
  });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function createActor(request: APIRequestContext, conflictId: string, name: string) {
  const res = await request.post("/api/admin/actors", { data: { conflictId, name } });
  expect(res.ok()).toBe(true);
  return res.json();
}

async function publishTerritory(request: APIRequestContext, data: Record<string, unknown>) {
  const draftRes = await request.post("/api/admin/territorial-control", { data });
  expect(draftRes.ok()).toBe(true);
  const draft = await draftRes.json();
  const publishRes = await request.post(`/api/admin/territorial-control/${draft.id}/publish`);
  expect(publishRes.ok()).toBe(true);
  return draft;
}

// world-map.tsx exposes the live MapLibre instance as window.__vigilMap in
// non-production builds specifically so tests can compute an exact click
// pixel via the map's own project() rather than guessing screen
// coordinates against a canvas that floating overlay panels (timeline/
// filters/legend) make unreliable to eyeball, and can positively confirm
// (via queryRenderedFeatures) that a feature is actually paintable at that
// pixel before clicking — never referenced by production code.
type Page = import("@playwright/test").Page;

async function mapPixel(page: Page, lng: number, lat: number) {
  const canvas = page.locator(".maplibregl-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas not found");
  const local = await page.evaluate(
    ([lng, lat]) => {
      const map = (window as unknown as { __vigilMap?: { project: (c: [number, number]) => { x: number; y: number } } }).__vigilMap;
      if (!map) throw new Error("window.__vigilMap not set — is NODE_ENV production?");
      return map.project([lng, lat]);
    },
    [lng, lat] as [number, number],
  );
  return { x: box.x + local.x, y: box.y + local.y };
}

/** Waits until a feature on any of `layerIds` is actually paintable at
 * [lng, lat] — not just present in the source's data — before a test
 * clicks there, eliminating the render-timing race between toggling a
 * layer visible (or zooming across a layer's min/maxzoom threshold, e.g.
 * unclustered-point vs. unclustered-point-icon) and MapLibre's next paint
 * actually happening. */
async function waitForFeatureAt(page: Page, layerIds: string[], lng: number, lat: number) {
  await page.waitForFunction(
    ({ layerIds, lng, lat }) => {
      const map = (
        window as unknown as {
          __vigilMap?: {
            project: (c: [number, number]) => { x: number; y: number };
            queryRenderedFeatures: (p: [number, number], o: { layers: string[] }) => unknown[];
          };
        }
      ).__vigilMap;
      if (!map) return false;
      const p = map.project([lng, lat]);
      return map.queryRenderedFeatures([p.x, p.y], { layers: layerIds }).length > 0;
    },
    { layerIds, lng, lat },
  );
}

// Territorial Control is now chosen dataset by dataset (see tests/helpers/territory.ts): "toggling" means ticking every
// available dataset, or unticking them all.
async function toggleTerritorial(page: Page) {
  const wasPressed = (await page.getByTestId("territorial-toggle").getAttribute("aria-pressed")) === "true";
  if (wasPressed) await disableTerritory(page);
  else await enableTerritory(page);
}

test("1. Toggling Territorial Control on/off shows and hides the legend", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflict = await createConflict(page.request);
  const actor = await createActor(page.request, conflict.id, `Legend Actor ${unique()}`);
  await publishTerritory(page.request, {
    conflictId: conflict.id,
    actorId: actor.id,
    status: "controlled",
    confidence: 0.8,
    geometry: CENTER_BOX,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
  });

  await page.goto("/world");
  await expect(page.getByTestId("territory-legend")).not.toBeVisible();
  await toggleTerritorial(page);
  await expect(page.getByTestId("territory-legend")).toBeVisible();
  await expect(page.getByTestId("territorial-toggle")).toHaveAttribute("aria-pressed", "true");

  await toggleTerritorial(page);
  await expect(page.getByTestId("territory-legend")).not.toBeVisible();

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("2. The legend shows the actual controlling actor's name, not a generic placeholder", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflict = await createConflict(page.request);
  const actorName = `Distinctive Actor Name ${unique()}`;
  const actor = await createActor(page.request, conflict.id, actorName);
  await publishTerritory(page.request, {
    conflictId: conflict.id,
    actorId: actor.id,
    status: "controlled",
    confidence: 0.8,
    geometry: CENTER_BOX,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
  });

  await page.goto("/world");
  await toggleTerritorial(page);
  await expect(page.getByTestId(`territory-legend-actor-${actorName}`)).toBeVisible();
  await expect(page.getByText("Party A")).not.toBeVisible();

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("3. Clicking a territorial polygon opens a detail panel with status, confidence, and source", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflict = await createConflict(page.request);
  const actorName = `Click Test Actor ${unique()}`;
  const actor = await createActor(page.request, conflict.id, actorName);
  await publishTerritory(page.request, {
    conflictId: conflict.id,
    actorId: actor.id,
    status: "contested",
    confidence: 0.55,
    geometry: CENTER_BOX,
    sourceName: `Click test source ${unique()}`,
    // Well outside the 24h "recently changed" display window (see
    // lib/data/territorial-control.ts) — this test checks the ASSIGNED
    // status renders, not the derived recently-changed override.
    validFrom: new Date(Date.now() - 48 * 3600_000).toISOString(),
  });

  await page.goto("/world");
  // Heatmap mode (rather than the default Markers) so no marker layer
  // — hidden, but still shared screen real estate with any OTHER test's
  // leftover fixture event that might coincidentally fall within this
  // wide 10°x10° box — can intercept the click via this suite's own
  // marker-takes-priority guard (see world-map.tsx's territory-fill
  // click handler). Test 4 covers that priority guard directly with its
  // own dedicated marker; this test is purely about the territory click.
  await page.getByRole("button", { name: "Heatmap" }).click();
  await toggleTerritorial(page);
  await waitForFeatureAt(page, ["territory-fill"], CENTER_LNG, CENTER_LAT);
  const { x, y } = await mapPixel(page, CENTER_LNG, CENTER_LAT);
  await page.mouse.click(x, y);

  // Rendered both in the desktop sidebar and (hidden, sm:hidden) in the
  // mobile BottomSheet — same dual-render EventDetailPanel already has —
  // so scope to the first (desktop-visible) match rather than matching
  // both testid instances in strict mode.
  const panel = page.getByTestId("territory-detail-panel").first();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(actorName);
  await expect(panel.getByTestId("territory-status-badge")).toContainText("Contested");
  await expect(panel).toContainText("55%");
  // Never presented as a legal/sovereignty determination (spec §2/§9).
  await expect(panel).toContainText("not a legal determination of sovereignty");

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("4. An event marker sitting on top of a territory polygon stays clickable and takes priority", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflict = await createConflict(page.request);
  const actor = await createActor(page.request, conflict.id, `Priority Test Actor ${unique()}`);
  await publishTerritory(page.request, {
    conflictId: conflict.id,
    actorId: actor.id,
    status: "controlled",
    confidence: 0.7,
    geometry: CENTER_BOX,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
  });
  const eventTitle = `Priority test event ${unique()}`;
  const eventRes = await page.request.post("/api/admin/events", {
    data: {
      title: eventTitle,
      summary: "Marker placed exactly at the map's own default center to test click priority over a territory polygon.",
      eventType: "conflict",
      latitude: 25,
      longitude: 20,
      countryCode: null,
      region: "Europe",
      occurredAt: new Date().toISOString(),
      severity: "elevated",
      sourceName: `Priority test source ${unique()}`,
    },
  });
  expect(eventRes.ok()).toBe(true);
  const event = await eventRes.json();
  await page.request.post(`/api/admin/events/${event.id}/publish`);

  await page.goto("/world");
  await toggleTerritorial(page);
  await waitForFeatureAt(page, ["territory-fill"], CENTER_LNG, CENTER_LAT);
  // The map's default zoom (1.6) is below clusterMaxZoom (7 —
  // components/map/world-map.tsx), so at the default zoom this event
  // could get merged into a cluster circle with any other nearby event
  // (a cluster click just zooms in, it doesn't select anything). Zoom in
  // by scrolling AT the target pixel rather than clicking the map's own
  // "+" nav control — that control sits underneath the page's fixed
  // header at this viewport size and isn't reliably clickable — which
  // also keeps the zoom centered exactly on the cursor position, so
  // [20, 25] (and this fixture) stays at the canvas center throughout.
  let { x, y } = await mapPixel(page, CENTER_LNG, CENTER_LAT);
  await page.mouse.move(x, y);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(80);
  }
  await waitForFeatureAt(page, ["unclustered-point", "unclustered-point-icon"], CENTER_LNG, CENTER_LAT);
  ({ x, y } = await mapPixel(page, CENTER_LNG, CENTER_LAT));
  await page.mouse.click(x, y);

  // The event's own detail panel opens — not the territory's.
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(page.getByTestId("territory-detail-panel").first()).not.toBeVisible();

  await page.request.delete(`/api/admin/events/${event.id}`);
  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("5. A future-dated territory is hidden on the live map", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflict = await createConflict(page.request);
  const actorName = `Future Actor ${unique()}`;
  const actor = await createActor(page.request, conflict.id, actorName);
  await publishTerritory(page.request, {
    conflictId: conflict.id,
    actorId: actor.id,
    status: "controlled",
    confidence: 0.8,
    geometry: CENTER_BOX,
    validFrom: new Date(Date.now() + 3600_000).toISOString(),
  });

  await page.goto("/world");
  await toggleTerritorial(page);
  await expect(page.getByTestId(`territory-legend-actor-${actorName}`)).not.toBeVisible();

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("6. Historical playback reconstructs a control change: the old actor shows before it, the new actor after", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const conflict = await createConflict(page.request);
  const oldActorName = `Old Controller ${unique()}`;
  const newActorName = `New Controller ${unique()}`;
  const oldActor = await createActor(page.request, conflict.id, oldActorName);
  const newActor = await createActor(page.request, conflict.id, newActorName);

  // The change itself happened recently (30 min ago) so it's still
  // within the "6H ago" historical window this test checks; the ORIGINAL
  // version has to have started well before that 6H-ago point, or it
  // wouldn't exist yet at that timestamp either.
  const changeTime = new Date(Date.now() - 30 * 60_000);
  const original = await publishTerritory(page.request, {
    conflictId: conflict.id,
    actorId: oldActor.id,
    status: "controlled",
    confidence: 0.8,
    geometry: CENTER_BOX,
    validFrom: new Date(changeTime.getTime() - 3 * 24 * 3600_000).toISOString(),
  });
  const supersedeRes = await page.request.post(`/api/admin/territorial-control/${original.id}/supersede`, {
    data: { actorId: newActor.id, status: "controlled", confidence: 0.85, geometry: CENTER_BOX, validFrom: changeTime.toISOString() },
  });
  expect(supersedeRes.ok()).toBe(true);

  await page.goto("/world");
  await toggleTerritorial(page);

  // Live: the new actor controls it.
  await expect(page.getByTestId(`territory-legend-actor-${newActorName}`)).toBeVisible();
  await expect(page.getByTestId(`territory-legend-actor-${oldActorName}`)).not.toBeVisible();

  // Historical (well before the change): the OLD actor controls it —
  // the same asOf the rest of the timeline/playback system already uses.
  const timeline = page.getByTestId("timeline-controls");
  await timeline.getByRole("radio", { name: "6H" }).click();
  await expect(page.getByTestId(`territory-legend-actor-${oldActorName}`)).toBeVisible();
  await expect(page.getByTestId(`territory-legend-actor-${newActorName}`)).not.toBeVisible();

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("7. Heatmap and Territorial Control can be active at the same time ('Both') with no console errors", async ({ page, isMobile }) => {
  test.skip(isMobile);
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  const conflict = await createConflict(page.request);
  const actor = await createActor(page.request, conflict.id, `Both Mode Actor ${unique()}`);
  await publishTerritory(page.request, {
    conflictId: conflict.id,
    actorId: actor.id,
    status: "controlled",
    confidence: 0.6,
    geometry: CENTER_BOX,
    validFrom: new Date(Date.now() - 60_000).toISOString(),
  });

  await page.goto("/world");
  await page.getByRole("button", { name: "Heatmap" }).click();
  await toggleTerritorial(page);
  await expect(page.getByRole("button", { name: "Heatmap" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("territorial-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);

  expect(errors).toEqual([]);
  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});

test("8. Uncertain and contested statuses render distinctly from controlled in the legend key", async ({ page, isMobile }) => {
  test.skip(isMobile);
  // The legend's status key only renders once there's at least one
  // territory feature to show (otherwise it's a "no data" placeholder) —
  // a fixture guarantees that regardless of what other tests have or
  // haven't left behind.
  const conflict = await createConflict(page.request);
  const actor = await createActor(page.request, conflict.id, `Legend Key Actor ${unique()}`);
  await publishTerritory(page.request, {
    conflictId: conflict.id,
    actorId: actor.id,
    status: "controlled",
    confidence: 0.8,
    geometry: CENTER_BOX,
    validFrom: new Date(Date.now() - 48 * 3600_000).toISOString(),
  });

  await page.goto("/world");
  await toggleTerritorial(page);
  const legend = page.getByTestId("territory-legend");
  await expect(legend).toContainText("Controlled");
  await expect(legend).toContainText("Contested");
  await expect(legend).toContainText("Uncertain");
  await expect(legend).toContainText("Recently changed");

  await page.request.delete(`/api/admin/conflicts/${conflict.id}`);
});
