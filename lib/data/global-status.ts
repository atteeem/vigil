import type { Conflict } from "@/lib/types";

/** Global Status: a single, non-personalized read of overall world tension. */
export function getGlobalStatus(allConflicts: readonly Conflict[]): { score: number; change24h: number } | null {
  const conflicts = allConflicts.filter((c) => c.status === "active" || c.status === "reduced");
  // Nothing tracked yet: there is no honest score to show.
  if (conflicts.length === 0) return null;
  const weightSum = conflicts.reduce((a, c) => a + weightFor(c.severity), 0);
  const score = Math.round(
    conflicts.reduce((a, c) => a + c.intensity * weightFor(c.severity), 0) / weightSum,
  );
  const change24h =
    Math.round(
      (conflicts.reduce((a, c) => a + c.intensityChange24h * weightFor(c.severity), 0) /
        weightSum) *
        10,
    ) / 10;
  return { score, change24h };
}

function weightFor(severity: string): number {
  switch (severity) {
    case "extreme":
      return 2.4;
    case "severe":
      return 1.7;
    case "high":
      return 1.3;
    case "elevated":
      return 1;
    case "guarded":
      return 0.8;
    default:
      return 0.6;
  }
}
