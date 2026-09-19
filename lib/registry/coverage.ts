import { isLiveStatus, normalizeConflictStatus, type RegistryStatus } from "@/lib/registry/status";
import { geographyIssues, type ConflictGeography } from "@/lib/registry/geography";

// Coverage / freshness for one conflict — pure functions of their input (with
// an injectable `now`) so the health rules are deterministic and testable.
//
// Design rules:
//  - Diversity is counted in SOURCES, never articles: a feed that publishes a
//    hundred items a day is still one source, and every aggregator/relay
//    together counts as at most ONE independent source.
//  - "Healthy" needs recent successful ingestion AND recent events AND real
//    diversity; a single fresh aggregator is "weak", not healthy.
//  - This is an admin coverage tool, not a public ranking.

export const COVERAGE_THRESHOLDS = {
  /** A source counts as updating when its last successful ingestion is this recent. */
  sourceFreshHours: { active: 48, reduced: 24 * 7 },
  /** A conflict has recent events when its latest event is this recent. */
  eventFreshHours: { active: 72, reduced: 24 * 14 },
  /** Independent sources needed before coverage can be "healthy". */
  minIndependentSources: 2,
} as const;

export type CoverageHealth = "healthy" | "weak" | "stale" | "no_source" | "inactive";
export type SourceKind = "dedicated" | "specialist_local" | "general" | "aggregator";
export type SourceLinkScope = "dedicated" | "general" | "derived";

export interface CoverageSource {
  id: string;
  name: string;
  enabled: boolean;
  sourceRole: string | null;
  /** How the source is related: an explicit link, a country match, or having contributed events. */
  link: SourceLinkScope;
  lastSuccessfulIngestion: Date | null;
}

const LOCAL_ROLES = new Set(["local_media", "eyewitness_community"]);
const AGGREGATOR_ROLES = new Set(["aggregator", "relay"]);

/** Dedicated (explicitly linked as conflict-specific) > specialist/local >
 * aggregator/relay > general. */
export function classifySource(source: Pick<CoverageSource, "link" | "sourceRole">): SourceKind {
  if (source.link === "dedicated") return "dedicated";
  if (source.sourceRole && AGGREGATOR_ROLES.has(source.sourceRole)) return "aggregator";
  if (source.sourceRole && LOCAL_ROLES.has(source.sourceRole)) return "specialist_local";
  return "general";
}

export interface CoverageInput {
  status: string;
  fullScaleWar?: boolean;
  sources: CoverageSource[];
  latestEventAt: Date | null;
  territorialAreas: number;
  actorCount: number;
  geography: ConflictGeography;
}

export interface ConflictCoverage {
  status: RegistryStatus;
  enabledSources: number;
  dedicatedSources: number;
  specialistSources: number;
  generalSources: number;
  aggregatorSources: number;
  /** Distinct independent sources: aggregators/relays together count as one. */
  independentSources: number;
  latestSourceAt: Date | null;
  latestEventAt: Date | null;
  health: CoverageHealth;
  reasons: string[];
  hasDedicatedSource: boolean;
  hasTerritorialData: boolean;
  flags: {
    missingActors: boolean;
    missingFightingGeography: boolean;
    missingParticipants: boolean;
    unreviewedGeography: boolean;
  };
}

const hoursBetween = (later: Date, earlier: Date) => (later.getTime() - earlier.getTime()) / 3_600_000;

export function computeCoverage(input: CoverageInput, now: Date = new Date()): ConflictCoverage {
  const status = normalizeConflictStatus(input.status);
  const enabled = input.sources.filter((s) => s.enabled);
  const counts = { dedicated: 0, specialist_local: 0, general: 0, aggregator: 0 } satisfies Record<SourceKind, number>;
  for (const s of enabled) counts[classifySource(s)] += 1;

  const independent = counts.dedicated + counts.specialist_local + counts.general + (counts.aggregator > 0 ? 1 : 0);
  const successTimes = enabled.map((s) => s.lastSuccessfulIngestion?.getTime()).filter((t): t is number => typeof t === "number");
  const latestSourceAt = successTimes.length > 0 ? new Date(Math.max(...successTimes)) : null;

  const live = isLiveStatus(status);
  const window = status === "reduced" ? "reduced" : "active";
  const sourceFresh = latestSourceAt !== null && hoursBetween(now, latestSourceAt) <= COVERAGE_THRESHOLDS.sourceFreshHours[window];
  const eventFresh = input.latestEventAt !== null && hoursBetween(now, input.latestEventAt) <= COVERAGE_THRESHOLDS.eventFreshHours[window];

  const reasons: string[] = [];
  let health: CoverageHealth;
  if (!live) {
    health = "inactive";
    reasons.push(`Conflict is ${status}; coverage is not required to be current.`);
  } else if (enabled.length === 0) {
    health = "no_source";
    reasons.push("No enabled source is relevant to this conflict.");
  } else if (!sourceFresh) {
    health = "stale";
    reasons.push(latestSourceAt ? "No relevant source has ingested successfully within the freshness window." : "No relevant source has ever ingested successfully.");
  } else {
    const specialised = counts.dedicated + counts.specialist_local;
    const weakReasons: string[] = [];
    if (independent < COVERAGE_THRESHOLDS.minIndependentSources) weakReasons.push(`Only ${independent} independent source${independent === 1 ? "" : "s"} (aggregators count once).`);
    if (specialised === 0 && independent < 3) weakReasons.push("No dedicated or local/specialist source.");
    if (!eventFresh) weakReasons.push(input.latestEventAt ? "No recent events despite fresh sources." : "No events recorded yet.");
    if (weakReasons.length > 0) {
      health = "weak";
      reasons.push(...weakReasons);
    } else {
      health = "healthy";
      reasons.push("Fresh ingestion, recent events and more than one independent source.");
    }
  }

  const issues = geographyIssues(input.geography, status);
  return {
    status,
    enabledSources: enabled.length,
    dedicatedSources: counts.dedicated,
    specialistSources: counts.specialist_local,
    generalSources: counts.general,
    aggregatorSources: counts.aggregator,
    independentSources: independent,
    latestSourceAt,
    latestEventAt: input.latestEventAt,
    health,
    reasons,
    hasDedicatedSource: counts.dedicated > 0,
    hasTerritorialData: input.territorialAreas > 0,
    flags: {
      missingActors: live && input.actorCount === 0,
      missingFightingGeography: issues.missingFighting,
      missingParticipants: issues.missingParticipants,
      unreviewedGeography: issues.unreviewed,
    },
  };
}

export interface CoverageSummary {
  total: number;
  /** Status "active" — the conflicts this registry tracks as active fighting. */
  activeTracked: number;
  reducedTracked: number;
  withDedicatedSources: number;
  withTerritorialData: number;
  updatedLast6h: number;
  updatedLast24h: number;
  weakCoverage: number;
  staleCoverage: number;
  noSource: number;
  missingActors: number;
  missingGeography: number;
}

export interface CoverageRowLike {
  coverage: ConflictCoverage;
}

/** Roll-up over live (active/reduced) conflicts. "Updated" = a new event OR a
 * successful source ingestion in the window. */
export function summarizeCoverage(rows: CoverageRowLike[], now: Date = new Date()): CoverageSummary {
  const live = rows.filter((r) => isLiveStatus(r.coverage.status));
  const updatedWithin = (hours: number) =>
    live.filter((r) => {
      const latest = [r.coverage.latestEventAt, r.coverage.latestSourceAt].filter((d): d is Date => d !== null).map((d) => d.getTime());
      return latest.length > 0 && hoursBetween(now, new Date(Math.max(...latest))) <= hours;
    }).length;
  return {
    total: rows.length,
    activeTracked: rows.filter((r) => r.coverage.status === "active").length,
    reducedTracked: rows.filter((r) => r.coverage.status === "reduced").length,
    withDedicatedSources: live.filter((r) => r.coverage.hasDedicatedSource).length,
    withTerritorialData: live.filter((r) => r.coverage.hasTerritorialData).length,
    updatedLast6h: updatedWithin(6),
    updatedLast24h: updatedWithin(24),
    weakCoverage: live.filter((r) => r.coverage.health === "weak").length,
    staleCoverage: live.filter((r) => r.coverage.health === "stale").length,
    noSource: live.filter((r) => r.coverage.health === "no_source").length,
    missingActors: live.filter((r) => r.coverage.flags.missingActors).length,
    missingGeography: live.filter((r) => r.coverage.flags.missingFightingGeography || r.coverage.flags.missingParticipants || r.coverage.flags.unreviewedGeography).length,
  };
}
