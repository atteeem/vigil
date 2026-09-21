import { test, expect } from "@playwright/test";
import { DEFAULT_GLYPHS_URL, FALLBACK_STYLE, getGlyphsUrl } from "@/lib/map/style";
import { eventListSignature } from "@/lib/map/list-signature";
import type { ConflictEvent } from "@/lib/types";

// Map architecture fixes from the open-source audit (docs/OPEN_SOURCE_AUDIT.md, Phase 3):
//  - layer interactions are registered ONCE (not on every style.load, which fires on every basemap switch);
//  - the key-less fallback style has a glyph source, so text layers can draw;
//  - the live-events poll ignores unchanged payloads.

test.describe("fallback style glyphs and live-event signature (pure)", () => {
  test("the key-less fallback style declares a glyph source; it can be self-hosted through NEXT_PUBLIC_GLYPHS_URL", () => {
    expect(FALLBACK_STYLE.glyphs).toBe(DEFAULT_GLYPHS_URL);
    expect(DEFAULT_GLYPHS_URL).toContain("{fontstack}");
    expect(DEFAULT_GLYPHS_URL).toContain("{range}");
    const saved = process.env.NEXT_PUBLIC_GLYPHS_URL;
    try {
      process.env.NEXT_PUBLIC_GLYPHS_URL = "https://tiles.example.org/fonts/{fontstack}/{range}.pbf";
      expect(getGlyphsUrl()).toBe("https://tiles.example.org/fonts/{fontstack}/{range}.pbf");
      process.env.NEXT_PUBLIC_GLYPHS_URL = "https://tiles.example.org/no-placeholders";
      expect(getGlyphsUrl()).toBe(DEFAULT_GLYPHS_URL); // an unusable override never breaks text rendering
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_GLYPHS_URL;
      else process.env.NEXT_PUBLIC_GLYPHS_URL = saved;
    }
  });

  test("the event-list signature changes exactly when something visible changes", () => {
    const e = (over: Partial<ConflictEvent> = {}) => ({ id: "a", updatedAt: "2026-09-21T00:00:00Z", sourceCount: 1, severity: "high", verificationStatus: "reported", disputed: false, ...over }) as ConflictEvent;
    const base = eventListSignature([e(), e({ id: "b" })]);
    expect(eventListSignature([e(), e({ id: "b" })])).toBe(base); // identical payload: same signature, no state change
    expect(eventListSignature([e(), e({ id: "b", sourceCount: 2 })])).not.toBe(base);
    expect(eventListSignature([e({ severity: "severe" }), e({ id: "b" })])).not.toBe(base);
    expect(eventListSignature([e(), e({ id: "b", updatedAt: "2026-09-21T01:00:00Z" })])).not.toBe(base);
    expect(eventListSignature([e()])).not.toBe(base);
    expect(eventListSignature([])).toBe("");
  });
});

test.describe("world map lifecycle", () => {
  test.describe.configure({ timeout: 180_000 });
  test.use({ isMobile: false });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "Mobile", "Desktop map lifecycle check");
  });

  test("basemap switches (style.load) do not stack listeners, the interactive layers come back, and text layers have glyphs", async ({ page }) => {
    await page.goto("/world");
    await page.waitForFunction(() => {
      const m = (window as unknown as { __vigilMap?: { getLayer: (id: string) => unknown; isStyleLoaded: () => boolean } }).__vigilMap;
      return !!m && m.isStyleLoaded() && !!m.getLayer("clusters");
    }, undefined, { timeout: 120_000 });

    const counts = () =>
      page.evaluate(() => {
        const m = (window as unknown as { __vigilMap: { _listeners: Record<string, unknown[]> } }).__vigilMap;
        return { click: m._listeners.click?.length ?? 0, mouseenter: m._listeners.mouseenter?.length ?? 0, mouseleave: m._listeners.mouseleave?.length ?? 0, styleLoad: m._listeners["style.load"]?.length ?? 0 };
      });
    const before = await counts();
    expect(before.click).toBeGreaterThan(10); // the layer click handlers exist

    for (let i = 0; i < 3; i++) {
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const m = (window as unknown as { __vigilMap: { once: (e: string, f: () => void) => void; setStyle: (s: object, o: object) => void; getStyle: () => { glyphs?: string } } }).__vigilMap;
            m.once("style.load", () => resolve());
            m.setStyle({ version: 8, glyphs: m.getStyle().glyphs, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0E1116" } }] }, { diff: false });
          }),
      );
      await page.waitForFunction(() => !!(window as unknown as { __vigilMap: { getLayer: (id: string) => unknown } }).__vigilMap.getLayer("hz-quake-circle"));
    }
    const after = await counts();
    expect(after).toEqual(before); // three basemap switches added nothing
    // The layers the listeners point at exist again after the switches.
    const layers = await page.evaluate(() => {
      const m = (window as unknown as { __vigilMap: { getLayer: (id: string) => unknown } }).__vigilMap;
      return ["clusters", "unclustered-point", "territory-fill", "hz-quake-circle", "hz-thermal-cluster"].map((l) => !!m.getLayer(l));
    });
    expect(layers.every(Boolean)).toBe(true);
    // Text layers can draw: the style carries a glyph source.
    const glyphs = await page.evaluate(() => (window as unknown as { __vigilMap: { getStyle: () => { glyphs?: string } } }).__vigilMap.getStyle().glyphs);
    expect(glyphs).toContain("{fontstack}");
  });
});
