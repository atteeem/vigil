import { landPath } from "@/lib/heat/render";
import { LAND_FILL_COLOR, OCEAN_COLOR } from "@/lib/globe/globe-colors";

// The globe's ONE surface: an equirectangular texture painted onto the base sphere itself (radius 100, the same mesh
// three-globe draws), holding the ocean, the land fill and the conflict-intensity heat in a single image.
//
// Why a texture and not polygons: the land used to be three-globe polygon caps lifted 0.6 units above the sphere and
// the heat a second, separately tessellated sphere 0.62 units up. Two shells 0.02 apart, each a set of flat facets
// that sag between their vertices by more than that gap, depth-fought: the land cap poked through the heat shell in
// grid-aligned grey blocks and streaks. Both shells also stood proud of the sphere, so at the silhouette their coarse
// facets (and double-sided land on the far hemisphere) showed as jagged slivers and wedges past the round edge. On the
// sphere's own surface there is nothing to fight and nothing to protrude, and no polygon triangulation (poles,
// antimeridian, concave coasts) is involved at all: the land path is rasterized with the same antimeridian-safe
// unwrapping the heat clip already uses (lib/heat/render.ts), so land and heat line up exactly.

/** Texture width for a device class. 4096 px = 0.09 degrees per texel, finer than the 110m land data itself. */
export const surfaceTextureWidth = (isMobile: boolean) => (isMobile ? 2048 : 4096);

export interface SurfaceLayers {
  /** Photographic base (Satellite mode); omitted = the stylized Intel ocean + land fill. */
  satellite?: CanvasImageSource | null;
  /** An equirectangular, land-clipped heat canvas (any width with a 2:1 aspect), drawn over the base. */
  heat?: HTMLCanvasElement | null;
}

/** Paints the surface into `canvas` (resized to width x width/2). Pure canvas work, no three.js. */
export function paintGlobeSurface(canvas: HTMLCanvasElement, width: number, layers: SurfaceLayers): HTMLCanvasElement {
  const height = width / 2;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.globalCompositeOperation = "source-over";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (layers.satellite) {
    ctx.drawImage(layers.satellite, 0, 0, width, height);
  } else {
    ctx.fillStyle = OCEAN_COLOR;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = LAND_FILL_COLOR;
    ctx.fill(landPath("equirect", width, height), "evenodd");
  }
  if (layers.heat) ctx.drawImage(layers.heat, 0, 0, width, height);
  return canvas;
}
