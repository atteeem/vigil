import { test, expect } from "@playwright/test";

// The globe's heat surface is a land-clipped texture. The world topology cuts landmasses at the antimeridian, so a
// ring can step from lng 180 to -180: drawn naively that is a line across the whole texture whose fill leaves
// horizontal strips, which wrap the sphere as grey rings around the poles. These tests read the actual texture on the
// running globe (window.__vigilGlobe) instead of trusting the renderer.

interface HeatMesh {
  name: string;
  material: { map: { image: HTMLCanvasElement } };
}
interface GlobeHandle {
  scene(): { children: HeatMesh[] };
}

async function heatTextureProbe(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    const g = (window as unknown as { __vigilGlobe?: GlobeHandle }).__vigilGlobe;
    return !!g?.scene().children.some((c) => c.name === "heat-surface");
  }, undefined, { timeout: 60_000 });
  return page.evaluate(() => {
    const g = (window as unknown as { __vigilGlobe: GlobeHandle }).__vigilGlobe;
    const cv = g.scene().children.find((c) => c.name === "heat-surface")!.material.map.image;
    const ctx = cv.getContext("2d")!;
    const w = cv.width;
    const h = cv.height;
    const row = (lat: number) => ctx.getImageData(0, Math.min(h - 1, Math.floor(((90 - lat) / 180) * h)), w, 1).data;
    const count = (lat: number) => {
      const d = row(lat);
      let n = 0;
      for (let x = 0; x < w; x++) if (d[x * 4 + 3]! > 20) n++;
      return n;
    };
    const alphaAt = (lng: number, lat: number) => ctx.getImageData(Math.floor(((lng + 180) / 360) * w), Math.floor(((90 - lat) / 180) * h), 1, 1).data[3]!;
    const counts: Record<number, number> = {};
    for (let lat = -88; lat <= 88; lat += 1) counts[lat] = count(lat);
    return { w, counts, ocean: [alphaAt(0, 71), alphaAt(-30, 71), alphaAt(0, 75), alphaAt(-170, 30)], seam: [alphaAt(-179.8, 66.5), alphaAt(179.8, 66.5)] };
  });
}

test.describe("3D globe heat surface", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, "the texture is the same on every viewport; the desktop probe is enough");
  });

  test("open ocean is transparent: no strip is left across the Arctic where there is no land", async ({ page }) => {
    const p = await heatTextureProbe(page);
    expect(p.ocean).toEqual([0, 0, 0, 0]);
  });

  test("no single row is a full-width line: land coverage changes smoothly with latitude (no grey band around the poles)", async ({ page }) => {
    const { w, counts } = await heatTextureProbe(page);
    for (let lat = -80; lat <= 84; lat += 1) {
      const around = ((counts[lat - 3] ?? 0) + (counts[lat + 3] ?? 0)) / 2;
      // A seam line adds nearly a whole row of texels to one row; real coastlines never do.
      expect(Math.abs(counts[lat]! - around), `lat ${lat}`).toBeLessThan(0.3 * w);
    }
  });

  test("a landmass that crosses the antimeridian is continuous: land exists on both edges of the texture", async ({ page }) => {
    const p = await heatTextureProbe(page);
    expect(p.seam[0]).toBeGreaterThan(20);
    expect(p.seam[1]).toBeGreaterThan(20);
  });
});
