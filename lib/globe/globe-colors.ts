/**
 * Globe readability fix: named, shared color constants for the Intel
 * globe's landmass fill and its border-path overlay (components/globe/
 * conflict-globe.tsx), pulled out of inline JSX literals specifically so
 * `colorDistance()` below can assert they're actually visually distinct.
 *
 * The bug this exists to prevent: borders were previously enabled by
 * default but rendered in the exact same color as the landmass fill
 * sitting on top of them, so they were invisible everywhere a border
 * crossed land instead of coastline — "enabled in config" but not
 * actually visible in a real browser. A plain `!==` check would have let
 * a future edit reintroduce two merely-different-looking-in-source but
 * perceptually-identical colors; comparing parsed channel values catches
 * that too.
 */

// Same value as conflict-globe.tsx's polygonCapColor for the Intel
// globe's continental landmass fill.
export const LAND_FILL_COLOR = "rgba(141, 150, 165, 0.4)";

// A light, cool neutral — visible against both the dark ocean and the
// gray-blue landmass fill above.
export const BORDER_COLOR = "rgba(210, 218, 230, 0.65)";

// Distinct amber tint for disputed/indeterminate boundaries (Natural
// Earth's own TYPE field — see lib/globe/country-borders.ts), rendered
// dashed as well as differently colored.
export const DISPUTED_BORDER_COLOR = "rgba(228, 196, 65, 0.85)";

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgba(color: string): RGBA {
  const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(color);
  if (!match) throw new Error(`Not an rgb()/rgba() color: ${color}`);
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

/**
 * A simple perceptual-enough distance between two rgba() strings —
 * channel deltas plus an alpha delta scaled to the same 0-255 range (two
 * lines of an identical hue but very different opacity read as different
 * too, e.g. against a dark background), not a colorimetric formula. Good
 * enough to catch "these are the same color" or "these are near-
 * indistinguishable," which is all this module needs to guard against.
 */
export function colorDistance(a: string, b: string): number {
  const ca = parseRgba(a);
  const cb = parseRgba(b);
  return Math.sqrt((ca.r - cb.r) ** 2 + (ca.g - cb.g) ** 2 + (ca.b - cb.b) ** 2 + ((ca.a - cb.a) * 255) ** 2);
}
