import type { Conflict, ConflictEvent, Country } from "@/lib/types";
import { computeSeverityScore, effectiveSeverityLabel } from "@/lib/scoring/severity";
import { computeImpact, type ConflictImpactDetail } from "@/lib/data/impact";
import { summarizeEvidence } from "@/lib/sources/trust";
import { sourceTrust } from "@/lib/sources/trust";

// What deserves attention first. Deterministic, explainable, and deliberately NOT a
// popularity ranking: report / article count never appears here (it only moves the
// small confidence factor through independent-outlet groups). Severity, significance,
// recency and confidence decide; for a selected country, the centralized impact score
// (with its hard floors) decides first.

const HOUR = 3_600_000;

/** How much an event matters: its severity and importance, faded by age, nudged (±15%) by
 * how well it is evidenced. 0-100. */
export function eventSignificance(event: ConflictEvent, now: number): number {
  const severity = computeSeverityScore({ severityLabel: event.severity, importance: event.importance }).severityScore;
  const base = 0.6 * severity + 0.4 * Math.max(0, Math.min(100, event.importance));
  const ageHours = Math.max(0, (now - new Date(event.occurredAt).getTime()) / HOUR);
  const recency = Math.pow(0.5, ageHours / 72);
  return base * recency * (0.85 + 0.15 * eventConfidence(event));
}

/** 0-1: independent outlets behind the event (three or more = 1). Report volume from one outlet does nothing. */
export function eventConfidence(event: ConflictEvent): number {
  const summary = summarizeEvidence(event.sources.map((s) => ({ sourceId: s.id, url: s.url, trust: s.trust ?? sourceTrust({ sourceRole: s.sourceRole }), relay: s.relationship === "relay" })));
  return Math.min(1, summary.independentSources / 3);
}

/** 0-1 freshness of a timestamp: half-life of 7 days; no timestamp = 0 (never "fresh by default"). */
export function freshness(iso: string | null | undefined, now: number): number {
  if (!iso) return 0;
  return Math.pow(0.5, Math.max(0, now - new Date(iso).getTime()) / (7 * 24 * HOUR));
}

export function conflictSeverityScore(c: Conflict): number {
  return computeSeverityScore({
    severityLabel: effectiveSeverityLabel(c.severity, c.fullScaleWar, c.status),
    status: c.status,
    intensity: c.intensity,
    eventCount: c.eventCount,
    escalationTrend: c.intensityChange24h,
  }).severityScore;
}

const isLive = (c: Conflict) => c.status === "active" || c.status === "reduced";

function recentSignificance(events: readonly ConflictEvent[], conflictId: string, now: number): number {
  let best = 0;
  for (const e of events) if (e.conflictId === conflictId) best = Math.max(best, eventSignificance(e, now));
  return best;
}

export interface RankedConflict {
  conflict: Conflict;
  priority: number;
  severityScore: number;
  recentSignificance: number;
}

/** Major active conflicts: severity first, then the most significant recent event and recency of
 * the latest one. Live (active / reduced) conflicts only. */
export function rankMajorConflicts(conflicts: readonly Conflict[], events: readonly ConflictEvent[], now: number, limit = 5): RankedConflict[] {
  return conflicts
    .filter(isLive)
    .map((conflict) => {
      const severityScore = conflictSeverityScore(conflict);
      const recentSig = recentSignificance(events, conflict.id, now);
      return { conflict, severityScore, recentSignificance: recentSig, priority: 0.7 * severityScore + 0.2 * recentSig + 0.1 * 100 * freshness(conflict.lastEventAt, now) };
    })
    .sort((a, b) => b.priority - a.priority || (a.conflict.id < b.conflict.id ? -1 : 1))
    .slice(0, limit);
}

/** The events that matter most right now (by significance, not by how many outlets wrote about them). */
export function rankSignificantEvents(events: readonly ConflictEvent[], now: number, limit = 5): { event: ConflictEvent; significance: number }[] {
  return events
    .map((event) => ({ event, significance: eventSignificance(event, now) }))
    .filter((r) => r.significance > 0)
    .sort((a, b) => b.significance - a.significance || (a.event.id < b.event.id ? -1 : 1))
    .slice(0, limit);
}

export interface CountryRelevance {
  conflict: Conflict;
  impact: ConflictImpactDetail;
  relevance: number;
  recentSignificance: number;
  /** Short, factual reasons this conflict ranks where it does. */
  reasons: string[];
}

const FLOOR_RANK: Record<string, number> = { own_country_war: 2, bordering_war: 1 };

/** Conflicts ranked for ONE explicitly selected country. Impact (with its hard floors) leads:
 * an own-country or bordering active full-scale war always outranks anything else; below that,
 * relevance blends impact, severity, recent significant events, evidence confidence and freshness.
 * No randomness, no inference about the user. */
export function rankConflictsForCountry(country: Country, conflicts: readonly Conflict[], events: readonly ConflictEvent[], now: number, limit = 5): CountryRelevance[] {
  return conflicts
    .filter((c) => c.status !== "ended" && c.status !== "resolved")
    .map((conflict) => {
      const impact = computeImpact(country, conflict);
      const sev = conflictSeverityScore(conflict);
      const sig = recentSignificance(events, conflict.id, now);
      const own = events.filter((e) => e.conflictId === conflict.id);
      const conf = own.length ? own.reduce((a, e) => a + eventConfidence(e), 0) / own.length : 0.5;
      const relevance = 0.65 * impact.score + 0.15 * sev + 0.1 * sig + 0.05 * 100 * conf + 0.05 * 100 * freshness(conflict.lastEventAt, now);
      const reasons: string[] = [];
      if (impact.hardFloor === "own_country_war") reasons.push("Active war inside your country");
      else if (impact.hardFloor === "bordering_war") reasons.push("Active war in a bordering country");
      reasons.push(...impact.overallDrivers.map((d) => d.description).filter(Boolean).slice(0, 2));
      if (sig >= 40) reasons.push("Significant recent event");
      return { conflict, impact, relevance, recentSignificance: sig, reasons };
    })
    .sort((a, b) => (FLOOR_RANK[b.impact.hardFloor ?? ""] ?? 0) - (FLOOR_RANK[a.impact.hardFloor ?? ""] ?? 0) || b.relevance - a.relevance || (a.conflict.id < b.conflict.id ? -1 : 1))
    .slice(0, limit);
}
