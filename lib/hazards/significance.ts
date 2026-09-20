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
  // v2: a status feed that has not been refreshed is no longer a statement about NOW.
  airport_status: 1,
  airspace_event: 14,
  chokepoint_status: 14,
  port_disruption: 7,
  maritime_incident: 120,
  energy_disruption: 14,
  internet_disruption: 2,
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

// ---------------------------------------------------------------------------------------------
// v2 layers (transport and infrastructure). Same rule as above: prominence ranks within a domain
// (a major international airport closure > a routine delay; a Hormuz closure > a small-port advisory;
// a multi-GW outage > a local one) and is never derived from conflict severity or article counts.
// ---------------------------------------------------------------------------------------------
export const AIRPORT_STATUSES = ["normal", "disrupted", "partially_closed", "closed", "unknown"] as const;
export type AirportStatus = (typeof AIRPORT_STATUSES)[number];
export const AIRSPACE_EVENT_TYPES = ["restriction", "closure", "rerouting", "warning", "reopening"] as const;
export const PORT_STATUSES = ["normal", "disrupted", "partially_closed", "closed"] as const;
export const CHOKEPOINT_STATUSES = ["normal", "elevated_disruption", "major_disruption", "closed_restricted"] as const;
export const MARITIME_INCIDENT_TYPES = ["attack", "piracy", "seizure", "collision", "navigation_warning", "security_advisory", "other"] as const;
export const ENERGY_EVENT_TYPES = ["outage", "reduced_capacity", "shutdown", "damage", "restart", "supply_interruption", "emergency_measure"] as const;
export const ENERGY_KINDS = ["electricity", "oil", "gas", "lng", "refinery", "pipeline", "generation", "terminal", "other"] as const;

export function airportProminence(status: string, size: "L" | "M" | null, ground: boolean): number {
  const base = status === "closed" ? 88 : status === "partially_closed" ? 62 : status === "disrupted" ? (ground ? 50 : 26) : 5;
  return Math.round(base * (size === "L" ? 1 : size === "M" ? 0.8 : 0.7));
}

export function airspaceProminence(eventType: string): number {
  return ({ closure: 85, restriction: 62, rerouting: 45, warning: 40, reopening: 20 } as Record<string, number>)[eventType] ?? 30;
}

/** The chokepoints whose disruption matters globally (the rest are regional). */
export const MAJOR_CHOKEPOINTS = new Set(["chokepoint1", "chokepoint2", "chokepoint3", "chokepoint4", "chokepoint5", "chokepoint6", "chokepoint8", "chokepoint28"]);
export function chokepointProminence(status: string, chokepointId: string): number {
  const base = ({ closed_restricted: 95, major_disruption: 88, elevated_disruption: 58, normal: 10 } as Record<string, number>)[status] ?? 0;
  return Math.round(base * (MAJOR_CHOKEPOINTS.has(chokepointId) ? 1 : 0.7));
}

export function portProminence(alertLevel: string): number {
  return alertLevel === "Red" ? 80 : alertLevel === "Orange" ? 60 : 25;
}

export function maritimeIncidentProminence(type: string): number {
  return ({ attack: 75, seizure: 70, piracy: 68, security_advisory: 50, collision: 40, navigation_warning: 35, other: 25 } as Record<string, number>)[type] ?? 25;
}

/** Capacity affected -> prominence. Missing capacity is NOT guessed: the record gets a modest default. */
export function energyProminence(megawatts: number | null, eventType: string): number {
  const bump = eventType === "shutdown" || eventType === "damage" || eventType === "supply_interruption" || eventType === "emergency_measure" ? 10 : 0;
  if (megawatts == null || megawatts <= 0) return 30 + bump;
  return Math.round(clamp(25 + 30 * Math.log10(Math.max(megawatts, 10) / 100) + bump));
}

export function internetProminence(score: number | null, signals: number, scope: "national" | "regional"): number {
  const base = scope === "national" ? 40 : 28;
  return Math.round(clamp(base + 6 * Math.log10(Math.max(score ?? 1, 1)) + 8 * (Math.max(signals, 1) - 1)));
}
