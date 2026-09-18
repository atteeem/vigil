// Territorial Control Mode — a small diagonal-hatch tile used as the
// "contested" fill-pattern (spec §3 "patterned/striped or clearly distinct
// overlay... do not rely on color alone for meaning"), registered once via
// map.addImage and referenced by world-map.tsx's territory-contested-hatch
// layer's `fill-pattern`. Deliberately NOT an SDF image (unlike the event
// icons in lib/map/event-icons.ts) — the hatch needs to keep its own
// baked-in white/alpha stripes rather than being tinted by a paint
// property, since it's meant to read as a neutral "contested" texture
// independent of which actor(s) are involved.
const TILE_SIZE = 16;

export function createContestedPatternImageData(): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 3;
  // Two diagonal strokes (offset by half the tile) so the pattern tiles
  // seamlessly with no visible seam between repeats.
  ctx.beginPath();
  ctx.moveTo(-2, TILE_SIZE + 2);
  ctx.lineTo(TILE_SIZE + 2, -2);
  ctx.moveTo(-2 + TILE_SIZE / 2, TILE_SIZE + 2);
  ctx.lineTo(TILE_SIZE + 2 + TILE_SIZE / 2, -2);
  ctx.moveTo(-2 - TILE_SIZE / 2, TILE_SIZE + 2);
  ctx.lineTo(TILE_SIZE + 2 - TILE_SIZE / 2, -2);
  ctx.stroke();
  return ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
}
