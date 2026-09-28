// World Command Center: one aggregated payload for /world (status bar, ticker, Pulse, right rail, map markers).
// Everything here is DERIVED from existing canonical state (conflict registry, briefs / state transitions,
// global events, freshness). Nothing is invented and no article count drives any number.

export type PulseCategory = "conflict" | "territory" | "hazard" | "infrastructure";
export type PulseBadge = "VERIFIED" | "PARTY CLAIM" | "OFFICIAL" | "UPDATED" | "TERRITORY" | "HAZARD";
export type LiveState = "live" | "delayed" | "stale" | "no-data";

export interface StatusBar {
  activeConflicts: number;
  /** Active conflicts whose severity score is >= HIGH_TENSION_MIN_SCORE. */
  highTension: number;
  /** Significant, de-duplicated developments in the last 24 h (brief system), party claims excluded. */
  newDevelopments: number;
  live: { state: LiveState; lastIngestionAt: string | null; lastEventAt: string | null; label: string };
}

export interface WorldItem {
  id: string;
  category: PulseCategory;
  developmentType: string;
  headline: string;
  summary: string;
  occurredAt: string;
  place: string | null;
  countryCode: string | null;
  source: string | null;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  significance: number;
  badges: PulseBadge[];
  isPartyClaim: boolean;
  conflictSlug: string | null;
  conflictName: string | null;
  lat: number | null;
  lng: number | null;
  zoom: number | null;
  layers: string[];
  eventId: string | null;
  hazardId: string | null;
  territory: boolean;
  deepLink: string;
}

export interface TopEntity {
  kind: "conflict" | "country";
  key: string;
  label: string;
  /** Distinct meaningful developments (each counted once however many outlets syndicated it). */
  developments: number;
  score: number;
  lead: string;
}

export type EntityWindow = "1h" | "6h" | "24h";

export interface GlobalSignal {
  key: "hazards" | "aviation" | "maritime" | "energy" | "internet";
  label: string;
  count: number;
  items: WorldItem[];
}

export interface MarkerConflict {
  id: string;
  slug: string;
  name: string;
  severity: string;
  severityScore: number;
  lat: number;
  lng: number;
  recent: boolean;
  latestTitle: string | null;
  /** Unique published reports associated with the conflict in the currently displayed state (set by the map page). */
  reportCount?: number;
  /** The subset of `reportCount` attached to a geolocated event (has a map point) — `reportCount -
   * mappedReportCount` is country-level/unknown-scope with no point at all. Lets the map keep representing
   * that portion once zoomed in far enough that the aggregate marker itself steps aside for individual
   * event markers (Final Intelligence Consistency & Map Correctness v1 §9), instead of it silently
   * disappearing. */
  mappedReportCount?: number;
}

export interface CommandCenter {
  generatedAt: string;
  status: StatusBar;
  ticker: WorldItem[];
  pulse: WorldItem[];
  whatChanged: WorldItem[];
  topEntities: Record<EntityWindow, TopEntity[]>;
  globalSignals: GlobalSignal[];
  conflicts: MarkerConflict[];
  meta: {
    revision: string;
    computeMs: number;
    includePartyClaims: boolean;
    partyClaimsHidden: number;
    thresholds: { highTensionMinScore: number; liveMaxMinutes: number };
    /** Set when this payload was computed for a historical `asOf` rather than live "now" (Pre-Launch
     * Critical Correctness & Security v1 §6). Pulse/whatChanged/topEntities/globalSignals ARE reconstructed
     * as of this timestamp (via the brief engine's own asOf support). `status` (activeConflicts/highTension/
     * live indicator) and `conflicts` (map marker positions/severity) are NOT — they read the conflict
     * registry's CURRENT state, which has no version history to reconstruct from — so callers must treat
     * those two fields as Live-only and label them accordingly whenever `asOf` is set, never presenting them
     * as though they describe the historical moment. */
    asOf: string | null;
  };
}
