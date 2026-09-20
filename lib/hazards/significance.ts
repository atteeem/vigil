import type { HazardCategory } from "./types";

// Domain-specific prominence (0-100). It ranks a hazard against OTHER hazards of its own kind for
// marker size and the homepage cut-off. It is NOT a severity and never feeds the conflict severity
// or heat surface: a magnitude 7 earthquake is not "severe conflict".

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export function earthquakeProminence(magnitude: number, significance: number | null | undefined): number {
  const byMag = clamp(((magnitude - 2.5) / 5.5) * 100);
  const bySig = clamp(((significance ?? 0) / 1000) * 100);
  return Math.round(clamp(byMag * 0.7 + bySig * 0.3));
}

export function thermalProminence(frpMw: number | null | undefined): number {
  return Math.round(clamp(frpMw ?? 0));
}

export const CAP_SEVERITY_VALUE: Record<string, number> = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };
const CAP_CERTAINTY_FACTOR: Record<string, number> = { Observed: 1, Likely: 0.95, Possible: 0.8, Unlikely: 0.65, Unknown: 0.75 };

export function capProminence(severity: string, certainty: string | null | undefined): number {
  const base = [5, 18, 40, 70, 92][CAP_SEVERITY_VALUE[severity] ?? 0]!;
  return Math.round(base * (CAP_CERTAINTY_FACTOR[certainty ?? "Unknown"] ?? 0.75));
}

export const VOLCANO_ALERT_VALUE: Record<string, number> = { UNASSIGNED: 0, NORMAL: 0, ADVISORY: 1, WATCH: 2, WARNING: 3 };
export function volcanoProminence(alertLevel: string | null): number {
  switch ((alertLevel ?? "").toUpperCase()) {
    case "WARNING":
      return 95;
    case "WATCH":
      return 80;
    case "ADVISORY":
      return 55;
    case "NORMAL":
      return 20;
    default:
      return 45; // a reported activity record with no alert level
  }
}

export const GDACS_LEVEL_VALUE: Record<string, number> = { Green: 1, Orange: 2, Red: 3 };
export function gdacsProminence(level: string): number {
  return level === "Red" ? 90 : level === "Orange" ? 65 : 25;
}

/** Events at or above this are worth a homepage mention (never routine minor observations). */
export const HOMEPAGE_PROMINENCE = 65;

const STALE_AFTER_DAYS: Partial<Record<HazardCategory, number>> = {
  volcano: 60,
  confirmed_wildfire: 14,
  cyclone: 3,
  flood: 7,
};

/** A record the provider has not touched for long enough that presenting it as current would be wrong. */
export function isStaleHazard(category: HazardCategory | string, lastTouched: Date | null | undefined, now: number = Date.now()): boolean {
  const days = STALE_AFTER_DAYS[category as HazardCategory];
  if (!days || !lastTouched) return false;
  return now - lastTouched.getTime() > days * 86_400_000;
}

/** How far back (relative to the viewed moment) each observation kind is shown as "recent". */
export const DISPLAY_WINDOW_HOURS: Partial<Record<HazardCategory, number>> = {
  earthquake: 72,
  thermal_detection: 24,
};

/** Marker radius (px) for an earthquake from its magnitude: stepped by size, not linear noise. */
export function quakeRadius(magnitude: number): number {
  return Math.round(clamp(3 + Math.pow(Math.max(magnitude, 1) - 1, 1.6) * 1.1, 4, 34));
}
