import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// The globe's ocean, land fill and heat are ONE equirectangular texture on the base sphere (lib/globe/surface-texture.ts).
// It replaced raised land polygons plus a second heat sphere 0.02 units above them: the two shells depth-fought
// (grid-aligned grey blocks through the heat) and both stood proud of the silhouette (jagged slivers past the limb).
// These tests read the actual texture and scene on the running globe (window.__vigilGlobe) instead of trusting the
// renderer, and pin the geometry rules that keep the limb clean.

interface SceneObj {
  name: string;
  type: string;
  visible: boolean;
  children: SceneObj[];
  __globeObjType?: string;
  geometry?: { type: string; parameters?: { radius?: number } };
}
interface GlobeHandle {
  scene(): SceneObj;
}
interface SurfaceHandle {
  surface: HTMLCanvasElement;
  heat: HTMLCanvasElement | null;
}

async function surfaceProbe(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    const w = window as unknown as { __vigilGlobe?: GlobeHandle; __vigilGlobeSurface?: SurfaceHandle };
    return !!w.__vigilGlobe && !!w.__vigilGlobeSurface?.surface && !!w.__vigilGlobeSurface.heat;
  }, undefined, { timeout: 60_000 });
  return page.evaluate(() => {
    const g = (window as unknown as { __vigilGlobe: GlobeHandle }).__vigilGlobe;
    const handle = (window as unknown as { __vigilGlobeSurface: SurfaceHandle }).__vigilGlobeSurface;
    const px = (cv: HTMLCanvasElement, lng: number, lat: number) => {
      const d = cv.getContext("2d")!.getImageData(Math.min(cv.width - 1, Math.floor(((lng + 180) / 360) * cv.width)), Math.min(cv.height - 1, Math.floor(((90 - lat) / 180) * cv.height)), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!, d[3]!] as [number, number, number, number];
    };
    const surface = handle.surface;
    const heat = handle.heat!;
    const rowCount = (cv: HTMLCanvasElement, lat: number, test: (d: Uint8ClampedArray, i: number) => boolean) => {
      const d = cv.getContext("2d")!.getImageData(0, Math.min(cv.height - 1, Math.floor(((90 - lat) / 180) * cv.height)), cv.width, 1).data;
      let n = 0;
      for (let x = 0; x < cv.width; x++) if (test(d, x * 4)) n++;
      return n;
    };
    const heatCounts: Record<number, number> = {};
    const landCounts: Record<number, number> = {};
    const isLand = (d: Uint8ClampedArray, i: number) => d[i]! + d[i + 1]! + d[i + 2]! > 60;
    for (let lat = -88; lat <= 88; lat += 1) {
      heatCounts[lat] = rowCount(heat, lat, (d, i) => d[i + 3]! > 20);
      landCounts[lat] = rowCount(surface, lat, isLand);
    }
    // Everything drawn in the scene: what could stand above the sphere.
    const meshes: { name: string; type: string; globeType: string | undefined; radius: number | undefined }[] = [];
    const walk = (o: SceneObj, t: string | undefined) => {
      const type = o.__globeObjType ?? t;
      if (o.geometry) meshes.push({ name: o.name, type: o.type, globeType: type, radius: o.geometry.parameters?.radius });
      o.children.forEach((c) => walk(c, type));
    };
    walk(g.scene(), undefined);
    return {
      w: heat.width,
      sw: surface.width,
      heatCounts,
      landCounts,
      heatOcean: [px(heat, 0, 71)[3], px(heat, -30, 60)[3], px(heat, 0, 75)[3], px(heat, -170, 30)[3]],
      surfaceOcean: [px(surface, -30, 40), px(surface, -170, 30), px(surface, 80, -20)],
      seam: [px(surface, -179.8, 66.5), px(surface, 179.8, 66.5)],
      heatSeam: [px(heat, -179.8, 66.5)[3], px(heat, 179.8, 66.5)[3]],
      southPole: landCounts[-88],
      meshes,
    };
  });
}

test.describe("3D globe surface", () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, "the texture is the same on every viewport; the desktop probe is enough");
  });

  test("open ocean is transparent in the heat layer and black on the surface: no strip across the Arctic", async ({ page }) => {
    const p = await surfaceProbe(page);
    expect(p.heatOcean).toEqual([0, 0, 0, 0]);
    for (const [r, g, b] of p.surfaceOcean) expect(r + g + b).toBeLessThan(20);
  });

  test("no single row is a full-width line: land and heat coverage change smoothly with latitude (no band around the poles)", async ({ page }) => {
    const p = await surfaceProbe(page);
    for (let lat = -80; lat <= 84; lat += 1) {
      const heatAround = ((p.heatCounts[lat - 3] ?? 0) + (p.heatCounts[lat + 3] ?? 0)) / 2;
      expect(Math.abs(p.heatCounts[lat]! - heatAround), `heat lat ${lat}`).toBeLessThan(0.3 * p.w);
      const landAround = ((p.landCounts[lat - 3] ?? 0) + (p.landCounts[lat + 3] ?? 0)) / 2;
      expect(Math.abs(p.landCounts[lat]! - landAround), `land lat ${lat}`).toBeLessThan(0.3 * p.sw);
    }
  });

  test("a landmass cut at the antimeridian is continuous (Chukotka on both texture edges) and Antarctica covers the pole", async ({ page }) => {
    const p = await surfaceProbe(page);
    for (const [r, g, b] of p.seam) expect(r + g + b).toBeGreaterThan(60);
    expect(p.heatSeam[0]).toBeGreaterThan(20);
    expect(p.heatSeam[1]).toBeGreaterThan(20);
    // The polar cap is filled, not left as a hole around the pole.
    expect(p.southPole).toBe(p.sw);
  });

  test("nothing area-filled stands above the sphere: no raised land polygons and no second heat shell", async ({ page }) => {
    const p = await surfaceProbe(page);
    expect(p.meshes.filter((m) => m.globeType === "polygon")).toEqual([]);
    expect(p.meshes.filter((m) => m.name === "heat-surface")).toEqual([]);
    // Spheres: the globe itself (100), three-globe's atmosphere/background — never a shell a hair above the surface.
    const shells = p.meshes.filter((m) => m.radius !== undefined && m.radius > 100 && m.radius < 110);
    expect(shells).toEqual([]);
  });
});

test.describe("3D globe limb rules (source)", () => {
  const src = readFileSync("components/globe/conflict-globe.tsx", "utf8");
  test("borders, labels and markers sit just above the surface, so the far hemisphere cannot show past the limb", () => {
    const alt = (re: RegExp) => [...src.matchAll(re)].flatMap((m) => [...m[1]!.matchAll(/0\.\d+/g)].map((x) => Number(x[0])));
    const borders = alt(/pathPointAlt=\{([^\n]*)\}/g);
    const labels = alt(/labelAltitude=\{([^\n]*)\}/g);
    const html = alt(/htmlAltitude=\{([^\n]*)\}/g);
    expect(borders.length).toBeGreaterThan(0);
    expect(labels.length).toBeGreaterThan(0);
    expect(html.length).toBeGreaterThan(0);
    for (const a of [...borders, ...labels, ...html]) expect(a).toBeLessThanOrEqual(0.003);
    expect(src).not.toMatch(/polygonsData=/);
    expect(src).toMatch(/globeMaterial=\{/);
  });
});
