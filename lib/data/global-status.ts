import { MOCK_CONFLICTS } from "./mock-conflicts";

/** Global Status: a single, non-personalized read of overall world tension. */
export function getGlobalStatus(): { score: number; change24h: number } {
  const weightSum = MOCK_CONFLICTS.reduce((a, c) => a + weightFor(c.severity), 0);
  const score = Math.round(
    MOCK_CONFLICTS.reduce((a, c) => a + c.intensity * weightFor(c.severity), 0) / weightSum,
  );
  const change24h =
    Math.round(
      (MOCK_CONFLICTS.reduce((a, c) => a + c.intensityChange24h * weightFor(c.severity), 0) /
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
