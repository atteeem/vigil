import type { HazardDetail } from "./public-types";

/** What a structured event IS, in plain words: a headline that never overclaims. */
export function hazardHeadline(d: Pick<HazardDetail, "category" | "title" | "severity">): string {
  switch (d.category) {
    case "earthquake":
      return `${d.severity.label ?? "Earthquake"} Earthquake`;
    case "thermal_detection":
      return "Thermal anomaly";
    default:
      return d.title;
  }
}
