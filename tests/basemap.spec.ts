import { test, expect, type Page } from "@playwright/test";
import { openWorldControls } from "./helpers/world-controls";
import { readBasemapConfig, resolveBasemap, safeReason, type BasemapConfig } from "@/lib/map/basemap";
import { buildBundledStyle, buildPmtilesStyle, BASEMAP_LAYER_PREFIX } from "@/lib/map/vigil-style";
import { ensurePmtilesProtocol, probeArchive, pmtilesRegistrationCount, resetPmtilesProtocolForTests } from "@/lib/map/pmtiles-protocol";
import { ensureGlyphProtocol, glyphStats, LOCAL_GLYPHS_URL, parseGlyphUrl, resetGlyphProtocolForTests } from "@/lib/map/glyph-protocol";
import { COUNTRY_RECORDS } from "@/lib/countries/registry";
import type { StyleSpecification } from "maplibre-gl";

// Self-controlled basemap: provider resolution and fallback order, the Protomaps/PMTiles style, the bundled
// key-less geography, protocol registration (once), local-first glyphs, failure handling, and the map itself
// (no MapTiler key, style switching, country map). Base geography only: no intelligence data in any basemap.

const style = (r: ReturnType<typeof resolveBasemap>) => r.provider.style as StyleSpecification;
const PM = "https://tiles.example.org/vigil-basemap-2026-09.pmtiles";

test.describe("provider resolution and fallback order (pure)", () => {
  test("no configuration: Intel resolves to the bundled geography, with the reason recorded", () => {
    const r = resolveBasemap("intel", {});
    expect(r.provider.id).toBe("vigil-bundled");
    expect(r.provider.requiresKey).toBe(false);
    expect(r.fallback).toBe(true);
    expect(r.reason).toContain("NEXT_PUBLIC_BASEMAP_PMTILES_URL");
    expect(r.chain.map((c) => c.id)).toEqual(["vigil-intel", "external-maptiler", "vigil-bundled", "minimal"]);
    expect(resolveBasemap("street", {}).provider.id).toBe("vigil-bundled");
  });

  test("a configured archive wins for Intel and Street, even when a MapTiler key exists", () => {
    const cfg: BasemapConfig = { pmtilesUrl: PM, maptilerKey: "k" };
    expect(resolveBasemap("intel", cfg)).toMatchObject({ provider: { id: "vigil-intel", kind: "pmtiles" }, fallback: false, reason: null });
    expect(resolveBasemap("street", cfg).provider.id).toBe("vigil-street");
    expect(resolveBasemap("intel", cfg).provider.diagnostics.pmtilesHost).toBe("tiles.example.org");
  });

  test("a MapTiler key alone keeps the existing behaviour (external provider); imagery always needs it", () => {
    expect(resolveBasemap("intel", { maptilerKey: "k" }).provider).toMatchObject({ id: "external-maptiler", kind: "external", requiresKey: true });
    expect(resolveBasemap("satellite", { maptilerKey: "k" }).provider.id).toBe("external-satellite");
    const sat = resolveBasemap("satellite", {});
    expect(sat.provider.id).toBe("vigil-bundled"); // imagery cannot be self-hosted here: never blank, never an error
    expect(sat.reason).toContain("NEXT_PUBLIC_MAPTILER_KEY");
  });

  test("runtime failures fall back once per provider and always end in a usable style", () => {
    const cfg: BasemapConfig = { pmtilesUrl: PM, maptilerKey: "k" };
    const a = resolveBasemap("intel", cfg, { "vigil-intel": "HTTP 404" });
    expect(a.provider.id).toBe("external-maptiler");
    expect(a.reason).toContain("HTTP 404");
    const b = resolveBasemap("intel", cfg, { "vigil-intel": "HTTP 404", "external-maptiler": "style parse error" });
    expect(b.provider.id).toBe("vigil-bundled");
    const c = resolveBasemap("intel", cfg, { "vigil-intel": "x", "external-maptiler": "y", "vigil-bundled": "z" });
    expect(c.provider.id).toBe("minimal");
    expect((c.provider.style as StyleSpecification).layers.length).toBeGreaterThan(0);
    expect(resolveBasemap("intel", cfg, { "vigil-intel": "x" }).chain.find((x) => x.id === "vigil-intel")).toMatchObject({ usable: false });
  });

  test("configuration parsing: empty strings are unset, values are trimmed, secrets are masked in reasons", () => {
    expect(readBasemapConfig({ NEXT_PUBLIC_BASEMAP_PMTILES_URL: "  ", NEXT_PUBLIC_MAPTILER_KEY: "", NEXT_PUBLIC_GLYPHS_URL: undefined })).toEqual({ pmtilesUrl: undefined, maptilerKey: undefined, glyphsUrl: undefined });
    expect(readBasemapConfig({ NEXT_PUBLIC_BASEMAP_PMTILES_URL: " /basemaps/a.pmtiles " }).pmtilesUrl).toBe("/basemaps/a.pmtiles");
    expect(safeReason("Failed https://api.maptiler.com/x/style.json?key=SECRET123&a=1")).not.toContain("SECRET123");
    // A custom glyph template is used only when valid.
    expect(resolveBasemap("intel", { glyphsUrl: "https://g.example/{fontstack}/{range}.pbf" }).provider.style).toMatchObject({ glyphs: "https://g.example/{fontstack}/{range}.pbf" });
    expect(resolveBasemap("intel", { glyphsUrl: "https://g.example/nope" }).provider.style).toMatchObject({ glyphs: LOCAL_GLYPHS_URL });
  });
});

test.describe("styles (pure)", () => {
  test("the Vigil Intel PMTiles style has the layers, glyphs and attribution it needs and holds base geography only", () => {
    const s = buildPmtilesStyle("intel", PM, LOCAL_GLYPHS_URL);
    const ids = s.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate layer ids
    for (const need of ["earth", "water", "boundaries_country", "places_country", "places_locality"]) expect(ids).toContain(`${BASEMAP_LAYER_PREFIX}${need}`);
    expect(s.glyphs).toBe(LOCAL_GLYPHS_URL);
    expect(Object.keys(s.sources)).toEqual(["protomaps"]); // the archive is the only source: no events/heat/territory/hazards
    const src = s.sources.protomaps as { url: string; attribution: string };
    expect(src.url).toBe(`pmtiles://${PM}`);
    expect(src.attribution).toContain("OpenStreetMap");
    expect(src.attribution).toContain("Protomaps");
    // Quiet by design: no POIs/buildings/addresses, roads only when zoomed in.
    expect(ids.some((i) => /pois|buildings|address_label/.test(i))).toBe(false);
    const roads = s.layers.filter((l) => l.id.startsWith(`${BASEMAP_LAYER_PREFIX}roads_`) && l.type === "line");
    expect(roads.length).toBeGreaterThan(5);
    for (const r of roads) expect(r.minzoom ?? 0).toBeGreaterThanOrEqual(6);
    // Exactly one country-border definition, tagged so map code can hide it in heat mode.
    const borders = s.layers.filter((l) => (l.metadata as Record<string, unknown> | undefined)?.["vigil:role"] === "basemap-border");
    expect(borders.map((b) => b.id).sort()).toEqual([`${BASEMAP_LAYER_PREFIX}boundaries`, `${BASEMAP_LAYER_PREFIX}boundaries_country`].sort());
    // Label hierarchy: countries from the start, cities from a regional zoom, small places only close in.
    const byId = Object.fromEntries(s.layers.map((l) => [l.id, l]));
    expect(byId[`${BASEMAP_LAYER_PREFIX}places_country`]!.minzoom ?? 0).toBeLessThanOrEqual(2);
    expect(byId[`${BASEMAP_LAYER_PREFIX}places_locality`]!.minzoom).toBeGreaterThanOrEqual(3);
    expect(byId[`${BASEMAP_LAYER_PREFIX}places_subplace`]!.minzoom).toBeGreaterThanOrEqual(10);
    // Every text layer uses a font Vigil ships glyphs for.
    for (const l of s.layers) if (l.type === "symbol") expect(JSON.stringify(l.layout?.["text-font"])).toMatch(/Noto Sans (Regular|Medium|Italic)/);
    // The Street variant keeps roads and POI-free schema but is a separate style.
    expect(buildPmtilesStyle("street", PM, LOCAL_GLYPHS_URL).name).toBe("Vigil Street");
  });

  test("the bundled geography has land, coast, ONE border definition and country labels for every country, from one topology", () => {
    const s = buildBundledStyle(LOCAL_GLYPHS_URL);
    expect(s.glyphs).toBe(LOCAL_GLYPHS_URL);
    expect(s.layers.map((l) => l.id)).toEqual(["ocean", "land", "coast", "boundaries_country", "places_country"].map((i) => `${BASEMAP_LAYER_PREFIX}${i}`));
    expect(s.layers.filter((l) => (l.metadata as Record<string, unknown>)["vigil:role"] === "basemap-border")).toHaveLength(1);
    const labels = (s.sources["vigil-country-labels"] as { data: GeoJSON.FeatureCollection }).data;
    expect(labels.features).toHaveLength(COUNTRY_RECORDS.length);
    const borders = (s.sources["vigil-borders"] as { data: GeoJSON.FeatureCollection }).data;
    expect(borders.features.map((f) => f.properties?.kind).sort()).toEqual(["border", "coast"]); // shared borders traced once, coast separately
    const land = (s.sources["vigil-land"] as { data: GeoJSON.FeatureCollection }).data;
    expect(land.features.length).toBeGreaterThan(0);
    for (const src of Object.values(s.sources)) expect(src.type).toBe("geojson"); // no network needed for geometry
    // Base geography only: nothing here is an event, hazard, territory or heat source.
    expect(JSON.stringify(Object.keys(s.sources))).not.toMatch(/event|hazard|territor|heat|conflict/);
  });
});

test.describe("protocols and archive probe (pure)", () => {
  test("pmtiles:// registers exactly once however many maps ask", () => {
    resetPmtilesProtocolForTests();
    const registered: string[] = [];
    const add = (name: string) => void registered.push(name);
    expect(ensurePmtilesProtocol(add)).toBe(true);
    expect(ensurePmtilesProtocol(add)).toBe(false);
    expect(ensurePmtilesProtocol(add)).toBe(false);
    expect(registered).toEqual(["pmtiles"]);
    expect(pmtilesRegistrationCount()).toBe(1);
  });

  test("vigil-glyphs:// serves shipped ranges locally, other ranges from the remote host, and counts a real failure", async () => {
    resetGlyphProtocolForTests();
    const handlers = new Map<string, (p: { url: string }, a: AbortController) => Promise<unknown>>();
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.startsWith("/fonts/Noto%20Sans%20Regular/0-255")) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/octet-stream" } });
      if (url.includes("remote.example") && url.includes("1024-1279")) return new Response(new Uint8Array([9]), { status: 200 });
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    expect(ensureGlyphProtocol((n, h) => void handlers.set(n, h as never), "https://remote.example/{fontstack}/{range}.pbf", fake)).toBe(true);
    expect(ensureGlyphProtocol((n, h) => void handlers.set(n, h as never), "x", fake)).toBe(false); // once
    const h = handlers.get("vigil-glyphs")!;
    const ctl = new AbortController();
    expect(new Uint8Array((await h({ url: "vigil-glyphs://Noto%20Sans%20Regular/0-255" }, ctl) as { data: ArrayBuffer }).data)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array((await h({ url: "vigil-glyphs://Noto%20Sans%20Regular/1024-1279" }, ctl) as { data: ArrayBuffer }).data)).toEqual(new Uint8Array([9]));
    await expect(h({ url: "vigil-glyphs://Noto%20Sans%20Regular/9216-9471" }, ctl)).rejects.toThrow(/Glyphs unavailable/);
    expect(glyphStats()).toMatchObject({ local: 1, remote: 1, failed: 1, lastFailure: "Noto Sans Regular 9216-9471" });
    expect(parseGlyphUrl("vigil-glyphs://Noto%20Sans%20Regular/0-255")).toEqual({ fontstack: "Noto Sans Regular", range: "0-255" });
    expect(parseGlyphUrl("https://x/0-255")).toBeNull();
  });

  test("the archive probe classifies a missing file, a non-archive, a server without Range, and a valid archive", async () => {
    const header = (magic: string, version = 3) => new Uint8Array([...new TextEncoder().encode(magic.padEnd(7, "_")), version, ...new Array(119).fill(0)]);
    const fake = (kind: string) => (async () => {
      if (kind === "404") return new Response("nf", { status: 404 });
      if (kind === "html") return new Response("<html>", { status: 206, headers: { "content-range": "bytes 0-6/7" } });
      if (kind === "norange") return new Response(header("PMTiles"), { status: 200 });
      if (kind === "ok") return new Response(header("PMTiles"), { status: 206, headers: { "content-range": "bytes 0-126/1000" } });
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await probeArchive("/x", fake("404"))).toMatchObject({ ok: false, status: 404, reason: "HTTP 404" });
    expect(await probeArchive("/x", fake("html"))).toMatchObject({ ok: false, magicOk: false });
    expect((await probeArchive("/x", fake("norange"))).reason).toContain("Range");
    expect(await probeArchive("/x", fake("ok"))).toMatchObject({ ok: true, version: 3, rangeSupported: true });
    expect((await probeArchive("/x", fake("down"))).reason).toContain("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------------------------
type VigilWindow = { __vigilMap: { getStyle: () => StyleSpecification; getLayer: (id: string) => unknown; getCenter: () => { lat: number; lng: number }; isStyleLoaded: () => boolean }; __vigilBasemap?: { provider: string; fallback: boolean; reason: string | null; failed: Record<string, string> } };

async function mapReady(page: Page, layer = "clusters") {
  await page.waitForFunction((l) => {
    const m = (window as unknown as VigilWindow).__vigilMap;
    return !!m && m.isStyleLoaded() && !!m.getLayer(l);
  }, layer, { timeout: 120_000 });
}
const basemapState = (page: Page) => page.evaluate(() => (window as unknown as VigilWindow).__vigilBasemap ?? null);

test.describe("the map without any key", () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ isMobile: false });
  test.beforeEach(({}, info) => test.skip(info.project.name === "Mobile", "Desktop map check"));

  test("Intel shows world geography, borders and labels from the bundled basemap with no MapTiler request; report counts and glyphs work", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      if (/maptiler\.com/.test(r.url())) external.push(r.url());
    });
    const fontResponses: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/fonts/Noto%20Sans%20Regular/0-255.pbf") && r.ok()) fontResponses.push(r.url());
    });
    await page.goto("/world");
    await mapReady(page, "bm-land");
    const layers = await page.evaluate(() => (window as unknown as VigilWindow).__vigilMap.getStyle().layers.map((l) => l.id));
    for (const id of ["bm-ocean", "bm-land", "bm-coast", "bm-boundaries_country", "bm-places_country"]) expect(layers).toContain(id);
    // Vigil's overlays sit above the basemap; the report-count layer exists and uses a shipped font.
    expect(layers.indexOf("bm-boundaries_country")).toBeLessThan(layers.indexOf("clusters"));
    expect(layers).toContain("unclustered-report-count");
    const state = await basemapState(page);
    expect(state).toMatchObject({ provider: "vigil-bundled", fallback: true });
    expect(state!.reason).toContain("NEXT_PUBLIC_BASEMAP_PMTILES_URL");
    await expect.poll(() => fontResponses.length, { timeout: 60_000 }).toBeGreaterThan(0); // labels/counts got glyphs from /fonts
    expect(external).toEqual([]);
    const glyphs = await page.evaluate(() => (window as unknown as VigilWindow).__vigilMap.getStyle().glyphs);
    expect(glyphs).toBe("vigil-glyphs://{fontstack}/{range}");
  });

  test("switching Intel / Street / Satellite repeatedly keeps every dynamic overlay and does not stack listeners", async ({ page }) => {
    await page.goto("/world");
    await mapReady(page, "bm-land");
    const listeners = () => page.evaluate(() => (window as unknown as { __vigilMap: { _listeners: Record<string, unknown[]> } }).__vigilMap._listeners.click?.length ?? 0);
    const before = await listeners();
    await openWorldControls(page, "map");
    const group = page.getByRole("radiogroup", { name: "Basemap" });
    for (const name of ["Street", "Satellite", "Intel", "Satellite", "Intel"]) {
      await group.getByRole("radio", { name: name }).click();
      await page.waitForFunction(() => (window as unknown as VigilWindow).__vigilMap.isStyleLoaded() && !!(window as unknown as VigilWindow).__vigilMap.getLayer("bm-land"), undefined, { timeout: 60_000 });
      const present = await page.evaluate(() => {
        const st = (window as unknown as VigilWindow).__vigilMap.getStyle();
        const layerIds = new Set(st.layers.map((l) => l.id));
        return {
          layers: ["heat-surface", "territory-fill", "clusters", "unclustered-point", "unclustered-report-count", "hz-quake-circle", "hz-airspace-fill", "hz-energy-icon", "hz-internet-icon"].filter((id) => !layerIds.has(id)),
          sources: ["events", "territory", "hz-ops", "hz-quakes", "heat-surface"].filter((id) => !(id in st.sources)),
        };
      });
      expect(present, `overlays missing after switching to ${name}`).toEqual({ layers: [], sources: [] });
    }
    expect(await listeners()).toBe(before);
    // Satellite has no key here: the notice explains it, and the timeline is untouched.
    await group.getByRole("radio", { name: "Satellite" }).click();
    await expect(page.getByTestId("basemap-notice")).toContainText("Satellite imagery");
    await expect(page.getByTestId("historical-indicator")).toHaveCount(0);
  });

  test("a broken PMTiles archive (404 / not an archive) falls back once, records why, and never blanks the map", async ({ page }) => {
    for (const bad of ["/basemaps/does-not-exist.pmtiles", "/icon.svg"]) {
      await page.addInitScript((url) => localStorage.setItem("vigil.basemap.config", JSON.stringify({ pmtilesUrl: url })), bad);
      await page.goto("/world");
      await mapReady(page, "bm-land");
      await expect.poll(async () => (await basemapState(page))?.failed?.["vigil-intel"] ?? "", { timeout: 60_000 }).not.toBe("");
      const state = (await basemapState(page))!;
      expect(state.provider).toBe("vigil-bundled"); // fell back exactly once: to the bundled geography
      expect(state.fallback).toBe(true);
      expect(state.failed["vigil-intel"]).toMatch(/404|PMTiles|Range/);
      await mapReady(page, "bm-boundaries_country");
      await expect(page.getByTestId("basemap-notice")).toContainText("Basemap fallback");
      await page.evaluate(() => localStorage.removeItem("vigil.basemap.config"));
    }
  });

  test("the country page map uses the same basemap abstraction: focus, layers, Open in World Map", async ({ page }) => {
    for (const code of ["FI", "UA", "JP", "US", "BR"]) {
      await page.goto(`/country/${code}`);
      await page.getByTestId("show-country-map").click();
      await mapReady(page, "bm-land");
      const { lat, lng } = COUNTRY_RECORDS.find((c) => c.code === code)!;
      const centre = await page.evaluate(() => (window as unknown as VigilWindow).__vigilMap.getCenter());
      expect(Math.abs(centre.lat - lat), `${code} lat`).toBeLessThan(0.5);
      expect(Math.abs(centre.lng - lng), `${code} lng`).toBeLessThan(0.5);
      expect(await basemapState(page)).toMatchObject({ provider: "vigil-bundled" });
      await expect(page.getByTestId("open-in-world")).toHaveAttribute("href", /^\/world\?focus=/);
    }
  });

  test("the admin diagnostics page shows the configuration, the fallback chain and what the map did", async ({ page, request }) => {
    const api = (await request.get("/api/admin/basemap").then((r) => r.json())) as { config: { pmtilesConfigured: boolean }; resolutions: { mode: string; active: { id: string } }[]; sprites: string; glyphs: { shippedFonts: string[] } };
    expect(api.config.pmtilesConfigured).toBe(false);
    expect(api.resolutions.find((r) => r.mode === "intel")!.active.id).toBe("vigil-bundled");
    expect(JSON.stringify(api)).not.toMatch(/key=/i);
    expect(api.glyphs.shippedFonts).toContain("Noto Sans Regular");
    await page.goto("/world");
    await mapReady(page, "bm-land");
    await page.goto("/admin/basemap");
    await expect(page.getByTestId("active-intel")).toHaveText("vigil-bundled", { timeout: 60_000 });
    await expect(page.getByTestId("cfg-pmtiles")).toContainText("not configured");
    await expect(page.getByTestId("basemap-client-state")).toContainText("Provider: vigil-bundled");
  });
});
