import { SEVERITY_LEVELS } from "@/lib/types/severity";
import type { Severity, VerificationStatus } from "@/lib/types";

export { SEVERITY_LEVELS };

export const SEVERITY_LABEL: Record<Severity, string> = {
  stable: "Stable",
  guarded: "Guarded",
  elevated: "Elevated",
  high: "High",
  severe: "Severe",
  extreme: "Extreme",
};

/**
 * Single source of truth for severity color. Every other severity color
 * representation in the app (Tailwind CSS variables in globals.css, the
 * MapLibre paint expressions in world-map.tsx, the globe hotspot styling in
 * conflict-globe.tsx) is required to resolve back to these exact hex
 * values — see DESIGN_SYSTEM.md. If you change a value here, update the
 * matching `--color-*` token in app/globals.css to match.
 *
 * Extreme (90–100) intentionally departs from the smooth green→red ramp:
 * instead of a brighter/neon red, it drops to a deep, desaturated
 * blood/wine red so it reads as "beyond severe" rather than just "more of
 * the same," without tipping into a neon/game-like alarm color.
 */
export const SEVERITY_HEX: Record<Severity, string> = {
  stable: "#3DDC84",
  guarded: "#8FC93A",
  elevated: "#E4C441",
  high: "#F0923B",
  severe: "#EF4B4B",
  extreme: "#80152A",
};

/** Deeper base tone used for extreme-severity fills/backgrounds (globe hotspot core, map fill). */
export const SEVERITY_EXTREME_BASE = "#5A0B18";
/** Brighter accent/halo tone used for extreme-severity glows, rings, and pulse animation. */
export const SEVERITY_EXTREME_ACCENT = "#80152A";

export const SEVERITY_COLOR_VAR: Record<Severity, string> = {
  stable: "var(--color-stable)",
  guarded: "var(--color-guarded)",
  elevated: "var(--color-elevated)",
  high: "var(--color-high)",
  severe: "var(--color-severe)",
  extreme: "var(--color-extreme)",
};

export const SEVERITY_TEXT_CLASS: Record<Severity, string> = {
  stable: "text-stable",
  guarded: "text-guarded",
  elevated: "text-elevated",
  high: "text-high",
  severe: "text-severe",
  extreme: "text-extreme",
};

export const SEVERITY_BG_DIM_CLASS: Record<Severity, string> = {
  stable: "bg-stable-dim",
  guarded: "bg-guarded-dim",
  elevated: "bg-elevated-dim",
  high: "bg-high-dim",
  severe: "bg-severe-dim",
  extreme: "bg-extreme-dim",
};

/**
 * Centralized severity thresholds. Every severity value shown anywhere in
 * the app — conflict severity, event severity, country/impact exposure
 * severity, global status severity — is derived from a 0–100 score through
 * this single function so a given number always maps to the same label and
 * color everywhere (see PROJECT.md's "no contradictory numbers" rule).
 */
export function severityFromScore(score: number): Severity {
  if (score >= 90) return "extreme";
  if (score >= 80) return "severe";
  if (score >= 70) return "high";
  if (score >= 50) return "elevated";
  if (score >= 30) return "guarded";
  return "stable";
}

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  unverified: "Unverified",
  reported: "Reported",
  multiple_sources: "Multiple Sources",
  confirmed: "Confirmed",
  official_claim: "Official Claim",
};
