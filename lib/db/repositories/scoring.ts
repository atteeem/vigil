import { prisma } from "@/lib/db/client";
import type { Conflict, Event } from "@prisma/client";
import { computeSeverityScore, effectiveSeverityLabel } from "@/lib/scoring/severity";
import { computeConfidenceScore } from "@/lib/scoring/confidence";
import { computeImpactScore } from "@/lib/scoring/impact";
import type { SeverityScoreResult, ImpactScoreResult, ConfidenceScoreResult } from "@/lib/scoring/types";
import { getCountryByCode } from "@/lib/reference/countries";
import { conflictGeographyOf } from "@/lib/registry/geography";
import { distanceKm } from "@/lib/utils/geo";
import { sourceTrust, summarizeEvidence } from "@/lib/sources/trust";

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

export const CONFIDENCE_WINDOW_DAYS = 90;

type EvidenceEvent = { occurredAt: Date; sources: { relationship: string; rawIngestionItem: { originalUrl: string | null; publishedAt: Date | null; receivedAt: Date; source: { id: string; sourceRole: string | null; independenceClass: string | null; claimPolicy: string | null; perspective: string | null; sourceCategory: string | null; type: string } } }[] };

/** Conflict-level confidence: the evidence behind the conflict's recent published incidents, on the canonical
 * corroboration model (lib/sources/trust.ts summarizeEvidence: an outlet is one independence group, the same article
 * counts once, relays / discovery leads / party claims never count). The TYPICAL incident's independence groups (the
 * median) feed the central formula, so many single-source reports never read as "multiple independent sources".
 * Report volume only enters as the stated rollup, never as corroboration. */
export function conflictConfidence(events: readonly EvidenceEvent[]): ConfidenceScoreResult {
  const per = events.map((e) => ({
    e,
    s: summarizeEvidence(e.sources.map((x) => ({ sourceId: x.rawIngestionItem.source.id, url: x.rawIngestionItem.originalUrl, trust: sourceTrust(x.rawIngestionItem.source), relay: x.relationship === "relay" }))),
  }));
  const factual = per.filter((p) => p.s.independentSources > 0);
  const partyOnly = per.length - factual.length;
  if (factual.length === 0) {
    const base = computeConfidenceScore({ independentSourceCount: 0, sourceCategories: [] });
    return { ...base, reasons: [per.length ? `No independent source behind the ${per.length} recent incident${per.length === 1 ? "" : "s"} (party claims / leads only)` : `No published incident in the last ${CONFIDENCE_WINDOW_DAYS} days`] };
  }
  const groups = factual.map((p) => p.s.independentSources).sort((a, b) => a - b);
  const median = groups[Math.floor((groups.length - 1) / 2)]!;
  const corroborated = factual.filter((p) => p.s.independentSources >= 2).length;
  const categories = [...new Set(factual.flatMap((p) => p.e.sources.map((x) => x.rawIngestionItem.source.sourceCategory ?? x.rawIngestionItem.source.type)))];
  const latest = Math.max(...factual.flatMap((p) => p.e.sources.map((x) => (x.rawIngestionItem.publishedAt ?? x.rawIngestionItem.receivedAt).getTime())));
  const result = computeConfidenceScore({ independentSourceCount: median, sourceCategories: categories, latestCorroborationAt: Number.isFinite(latest) ? new Date(latest).toISOString() : null });
  return {
    ...result,
    reasons: [
      `${corroborated} of ${factual.length} incident${factual.length === 1 ? "" : "s"} in ${CONFIDENCE_WINDOW_DAYS} days corroborated by 2+ independent source groups`,
      `Typical incident: ${median} independent source group${median === 1 ? "" : "s"}`,
      ...(partyOnly ? [`${partyOnly} party-claim-only incident${partyOnly === 1 ? "" : "s"} not counted`] : []),
      ...result.reasons.filter((r) => !/independent source/i.test(r)),
    ],
  };
}

function computeConflictSeverityInput(conflict: Conflict, events: Event[]) {
  let spreadKm = 0;
  if (events.length > 1 && conflict.lat != null && conflict.lng != null) {
    spreadKm = events.reduce(
      (max, e) => (e.latitude == null || e.longitude == null ? max : Math.max(max, distanceKm({ lat: conflict.lat!, lng: conflict.lng! }, { lat: e.latitude, lng: e.longitude }))),
      0,
    );
  }
  const casualtiesKilled = events.reduce((sum, e) => sum + (e.casualtiesKilled ?? 0), 0);
  const casualtiesInjured = events.reduce((sum, e) => sum + (e.casualtiesInjured ?? 0), 0);
  const infrastructureDamage = events.some((e) => e.eventType === "infrastructure" || jsonArray(e.infrastructureDamage).length > 0);
  const displacement = events.some((e) => e.eventType === "humanitarian");
  return {
    severityLabel: effectiveSeverityLabel(conflict.severity as import("@/lib/types/severity").Severity, conflict.fullScaleWar, conflict.status),
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
  // Published-only: an admin draft/unpublished event must never move the PUBLIC Severity number — it isn't
  // real corroborated intelligence yet, and this is the one score every public surface (conflict page,
  // homepage, globe, /world) ultimately reads (Pre-Launch Critical Correctness & Security v1).
  const events = await prisma.event.findMany({ where: { conflictId, published: true } });
  const evidenceEvents = await prisma.event.findMany({
    where: { conflictId, published: true, occurredAt: { gte: new Date(Date.now() - CONFIDENCE_WINDOW_DAYS * 86_400_000) } },
    select: { occurredAt: true, sources: { select: { relationship: true, rawIngestionItem: { select: { originalUrl: true, publishedAt: true, receivedAt: true, source: { select: { id: true, sourceRole: true, independenceClass: true, claimPolicy: true, perspective: true, sourceCategory: true, type: true } } } } } } },
    orderBy: { occurredAt: "desc" },
    take: 500,
  });

  const severity = computeSeverityScore(computeConflictSeverityInput(conflict, events));
  const confidence = conflictConfidence(evidenceEvents);

  let impact: ImpactScoreResult | null = null;
  if (userCountryCode) {
    const userCountry = getCountryByCode(userCountryCode);
    if (userCountry && conflict.lat != null && conflict.lng != null) {
      impact = computeImpactScore({
        severityScore: severity.severityScore,
        conflictStatus: conflict.status as import("@/lib/scoring/types").ConflictStatusLike,
        userCountryCode,
        // Fighting geography only: participants and supporters never trigger
        // the same-country / bordering-country floors.
        conflictCountryCodes: conflictGeographyOf(conflict).fighting,
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
        // A country-level / unknown-location event has no point: fall back to the user country (distance 0 is not implied).
        conflictPoint: event.latitude != null && event.longitude != null ? { lat: event.latitude, lng: event.longitude } : (event.countryCode ? getCountryByCode(event.countryCode) : undefined) ?? userCountry,
        sameRegion: event.region ? userCountry.region === event.region : false,
      });
    }
  }

  return { severity, confidence, impact };
}
