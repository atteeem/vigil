// The ONE heat-color scale. The flat map and the globe both paint the same
// conflict-intensity field (lib/heat/field.ts) through this function, so a
// value of 72 is the same orange everywhere.
//
// Intensity is "observed conflict intensity / conflict pressure", 0-100. It is
// not a probability of future war, not personal danger and not a political
// or legal statement. The low end is a deliberately subdued cool blue-grey —
// the bottom of the scale, never labelled "safe".
//
// Approximate bands (interpolated smoothly between stops, never stepped):
//   0-15  deep cool blue      16-30 blue        31-45 blue-grey / neutral
//   46-60 yellow              61-75 orange      76-89 red
//   90-99 deep red            100   strongest deep red (active full-scale war)

export interface HeatStop {
  at: number;
  rgb: readonly [number, number, number];
}

export const HEAT_STOPS: readonly HeatStop[] = [
  { at: 0, rgb: [14, 30, 68] },
  { at: 15, rgb: [22, 50, 108] },
  { at: 30, rgb: [38, 82, 142] },
  { at: 42, rgb: [92, 114, 142] },
  { at: 55, rgb: [222, 190, 68] },
  { at: 68, rgb: [238, 138, 42] },
  { at: 80, rgb: [218, 60, 40] },
  { at: 92, rgb: [152, 20, 30] },
  { at: 100, rgb: [104, 8, 22] },
];

export interface HeatColor {
  r: number;
  g: number;
  b: number;
  /** 0-1 */
  a: number;
}

/** Baseline land value: the bottom of the scale, not an event. */
export const HEAT_BASELINE = 8;

/** Layer opacity at the low end (subtle) and at the top (strong). */
const ALPHA_LOW = 0.6;
const ALPHA_HIGH = 0.88;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Pure RGB for an intensity, no confidence adjustment. */
export function heatRgb(intensity: number): [number, number, number] {
  const v = Math.max(0, Math.min(100, intensity));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const hi = HEAT_STOPS[i]!;
    if (v <= hi.at) {
      const lo = HEAT_STOPS[i - 1]!;
      const t = (v - lo.at) / (hi.at - lo.at);
      return [lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * t, lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * t, lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * t];
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1]!;
  return [last.rgb[0], last.rgb[1], last.rgb[2]];
}

/** Color for an intensity (0-100) and an evidence confidence (0-1).
 *
 * Severity/intensity alone picks the hue and value. Confidence is a subtle
 * second channel — at most ~18% desaturation and ~14% opacity — so a
 * low-confidence claim of a severe conflict still reads as red, never as a
 * low-intensity color. */
export function heatColor(intensity: number, confidence = 1): HeatColor {
  const [r, g, b] = heatRgb(intensity);
  const c = clamp01(confidence);
  const desat = (1 - c) * 0.18;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const v = clamp01(intensity / 100);
  const alpha = (ALPHA_LOW + (ALPHA_HIGH - ALPHA_LOW) * v) * (0.86 + 0.14 * c);
  return { r: r + (luma - r) * desat, g: g + (luma - g) * desat, b: b + (luma - b) * desat, a: alpha };
}

/** CSS gradient for the legend, generated from the same stops. */
export function heatLegendGradient(): string {
  const stops = HEAT_STOPS.map((s) => `rgb(${s.rgb[0]} ${s.rgb[1]} ${s.rgb[2]}) ${s.at}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export const HEAT_LEGEND = {
  low: "Low observed intensity",
  high: "Extreme",
  info: "Color shows observed conflict intensity: severity, recency and geographic reach of conflicts and incidents. It is not a prediction of future conflict, and blue does not mean guaranteed safety. Report counts do not set the color.",
} as const;
