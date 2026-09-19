import { prisma } from "@/lib/db/client";
import type { Conflict, Event } from "@prisma/client";
import { computeSeverityScore } from "@/lib/scoring/severity";
import { computeConfidenceScore } from "@/lib/scoring/confidence";
import { computeImpactScore } from "@/lib/scoring/impact";
import type { SeverityScoreResult, ImpactScoreResult, ConfidenceScoreResult } from "@/lib/scoring/types";
import { getCountryByCode } from "@/lib/data/mock-countries";
import { distanceKm } from "@/lib/utils/geo";

// Central Conflict Scoring Engine v1 §6/§8 — the ONE place real,
// DB-backed Conflict/Event rows are turned into scoring-engine input.
// Deliberately separate from lib/scoring/*.ts (which stay pure/DB-free,
// same convention as lib/data/corroboration.ts) — this module is the
// Prisma-aware adapter layer admin routes/pages call.

export interface EntityScores {
  severity: SeverityScoreResult;
  confidence: ConfidenceScoreResult;
  impact: ImpactScoreResult | null; // null when no countryCode was requested
}

function jsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function conflictConfidence(events: Event[]): ConfidenceScoreResult {
  // Conflict-level confidence: how well-evidenced is the conflict's own
  // body of events, not any single one — total independent sourcing across
  // its events, since a sustained conflict corroborated by many separate
  // incidents is better-evidenced than one thin report.
  const independentSourceCount = events.length; // one real report minimum per event; a fuller per-source rollup happens at the event level (scoreEvent)
  return computeConfidenceScore({
    independentSourceCount,
    sourceCategories: ["News"],
  });
}

function computeConflictSeverityInput(conflict: Conflict, events: Event[]) {
  let spreadKm = 0;
  if (events.length > 1 && conflict.lat != null && conflict.lng != null) {
    spreadKm = events.reduce(
      (max, e) => Math.max(max, distanceKm({ lat: conflict.lat!, lng: conflict.lng! }, { lat: e.latitude, lng: e.longitude })),
      0,
    );
  }
  const casualtiesKilled = events.reduce((sum, e) => sum + (e.casualtiesKilled ?? 0), 0);
  const casualtiesInjured = events.reduce((sum, e) => sum + (e.casualtiesInjured ?? 0), 0);
  const infrastructureDamage = events.some((e) => e.eventType === "infrastructure" || jsonArray(e.infrastructureDamage).length > 0);
  const displacement = events.some((e) => e.eventType === "humanitarian");
  return {
    severityLabel: conflict.severity as import("@/lib/types/severity").Severity,
    status: conflict.status as import("@/lib/scoring/types").ConflictStatusLike,
    intensity: conflict.intensity,
    spreadKm,
    eventCount: events.length,
    casualtiesKilled,
    casualtiesInjured,
    infrastructureDamage,
    displacement,
    escalationTrend: conflict.intensityChange24h,
  };
}

/** Scores a real Conflict row. `userCountryCode` is optional — omit for
 * severity/confidence only (spec "conflict itself, independent of the
 * user"), pass it for the admin "impact preview for a selected country"
 * feature. */
export async function scoreConflict(conflictId: string, userCountryCode?: string | null): Promise<EntityScores | null> {
  const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!conflict) return null;
  const events = await prisma.event.findMany({ where: { conflictId } });

  const severity = computeSeverityScore(computeConflictSeverityInput(conflict, events));
  const confidence = conflictConfidence(events);

  let impact: ImpactScoreResult | null = null;
  if (userCountryCode) {
    const userCountry = getCountryByCode(userCountryCode);
    if (userCountry && conflict.lat != null && conflict.lng != null) {
      impact = computeImpactScore({
        severityScore: severity.severityScore,
        conflictStatus: conflict.status as import("@/lib/scoring/types").ConflictStatusLike,
        userCountryCode,
        conflictCountryCodes: jsonArray(conflict.countries),
        userCountryPoint: userCountry,
        conflictPoint: { lat: conflict.lat, lng: conflict.lng },
        sameRegion: userCountry.region === conflict.region,
        primaryEffects: jsonArray(conflict.primaryEffects),
      });
    }
  }

  return { severity, confidence, impact };
}

/** Scores a single real Event row. */
export async function scoreEvent(eventId: string, userCountryCode?: string | null): Promise<EntityScores | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { sources: { include: { rawIngestionItem: { include: { source: true } } } } },
  });
  if (!event) return null;

  const severity = computeSeverityScore({
    severityLabel: event.severity as import("@/lib/types/severity").Severity,
    importance: event.importance,
    casualtiesKilled: event.casualtiesKilled,
    casualtiesInjured: event.casualtiesInjured,
    infrastructureDamage: jsonArray(event.infrastructureDamage).length > 0,
  });

  const sourceCategories = Array.from(new Set(event.sources.map((s) => s.rawIngestionItem.source.sourceCategory ?? s.rawIngestionItem.source.type)));
  const timestamps = event.sources.map((s) => s.rawIngestionItem.publishedAt?.getTime() ?? s.rawIngestionItem.receivedAt.getTime());
  const latestCorroborationAt = timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
  const confidence = computeConfidenceScore({
    independentSourceCount: event.sources.length,
    sourceCategories,
    latestCorroborationAt,
  });

  let impact: ImpactScoreResult | null = null;
  if (userCountryCode) {
    const userCountry = getCountryByCode(userCountryCode);
    if (userCountry) {
      impact = computeImpactScore({
        severityScore: severity.severityScore,
        userCountryCode,
        conflictCountryCodes: event.countryCode ? [event.countryCode] : [],
        userCountryPoint: userCountry,
        conflictPoint: { lat: event.latitude, lng: event.longitude },
        sameRegion: event.region ? userCountry.region === event.region : false,
      });
    }
  }

  return { severity, confidence, impact };
}
