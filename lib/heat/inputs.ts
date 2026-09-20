import type { Conflict, ConflictEvent } from "@/lib/types";
import { computeSeverityScore, effectiveSeverityLabel } from "@/lib/scoring/severity";
import { computeConfidenceScore } from "@/lib/scoring/confidence";
import { distanceKm } from "@/lib/utils/geo";
import { maxSeverity } from "@/lib/utils/severity";
import { HEAT_MODEL, type HeatConflict, type HeatIncident, type HeatInput } from "./field";

// Turns the app's existing centralized data into heat-field inputs. This is
// the ONE place both the flat map and the globe go through, so they cannot
// disagree about what is hot. Severity comes from the Central Conflict Scoring
// Engine (active full-scale war = 100); report/article counts are never read
// for severity — only for the confidence value, which is visual-only.

export interface HeatInputArgs {
  /** Curated conflict records (sustained base). Omit in historical mode: only
   * conflicts reconstructable from the timeline's own events are shown. */
  conflicts?: readonly Conflict[];
  /** Events valid at `nowIso` (already filtered by the caller's timeline/filters). */
  events: readonly ConflictEvent[];
  /** Reference time: the timeline's asOf, or the app's live reference "now". */
  nowIso: string;
  /** Live view: the reference "now" is a fixed mock time while live events carry real
   * timestamps, so an event dated after it counts as brand new instead of being dropped.
   * Historical views leave this false: an event after asOf is not part of that state. */
  live?: boolean;
}

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["active", "reduced"]);

function eventConfidence(e: ConflictEvent, nowIso: string): number {
  return (
    computeConfidenceScore({
      independentSourceCount: e.sourceCount,
      sourceCategories: Array.from(new Set(e.sources.map((s) => s.sourceType))),
      latestCorroborationAt: e.sources.length > 0 ? new Date(Math.max(...e.sources.map((s) => new Date(s.publishedAt).getTime()))).toISOString() : null,
      now: nowIso,
    }).confidenceScore / 100
  );
}

export function buildHeatInput({ conflicts = [], events: allEvents, nowIso, live = false }: HeatInputArgs): HeatInput {
  const now = new Date(nowIso).getTime();
  // Only what is known at the reference time: in a historical view an event
  // dated after asOf is not part of that state — as an incident or as evidence
  // for a conflict's extent.
  const events = live ? allEvents : allEvents.filter((e) => new Date(e.occurredAt).getTime() <= now);
  const incidents: HeatIncident[] = [];
  const confidenceOf = new Map<string, number>();

  for (const e of events) {
    const occurred = new Date(e.occurredAt).getTime();
    if (!Number.isFinite(occurred)) continue;
    let ageHours = (now - occurred) / 3_600_000;
    if (live && ageHours < 0) ageHours = 0;
    const confidence = eventConfidence(e, nowIso);
    confidenceOf.set(e.id, confidence);
    // An event that has not happened yet at `nowIso` is not part of that state.
    if (ageHours < 0 || ageHours > HEAT_MODEL.incidentMaxAgeHours) continue;
    const severity = computeSeverityScore({ severityLabel: e.severity, importance: e.importance });
    incidents.push({ id: e.id, lat: e.lat, lng: e.lng, severityScore: severity.severityScore, confidence, ageHours: Math.round(ageHours), importance: e.importance, precision: e.locationPrecision ?? null });
  }

  const byConflict = new Map<string, ConflictEvent[]>();
  for (const e of events) {
    if (!e.conflictId) continue;
    const list = byConflict.get(e.conflictId);
    if (list) list.push(e);
    else byConflict.set(e.conflictId, [e]);
  }

  const heatConflicts: HeatConflict[] = [];
  const known = new Set<string>();

  for (const c of conflicts) {
    known.add(c.id);
    if (!ACTIVE_STATUSES.has(c.status)) continue;
    const own = byConflict.get(c.id) ?? [];
    const anchors = [{ lat: c.lat, lng: c.lng }, ...own.map((e) => ({ lat: e.lat, lng: e.lng }))];
    const spreadKm = anchors.reduce((max, a) => Math.max(max, distanceKm(anchors[0]!, a)), 0);
    const severity = computeSeverityScore({
      severityLabel: effectiveSeverityLabel(c.severity, c.fullScaleWar, c.status),
      status: c.status,
      intensity: c.intensity,
      spreadKm,
      eventCount: c.eventCount,
      escalationTrend: c.intensityChange24h,
    });
    heatConflicts.push({
      id: c.id,
      severityScore: severity.severityScore,
      confidence: own.length > 0 ? Math.max(...own.map((e) => confidenceOf.get(e.id) ?? 0.6)) : 0.6,
      anchors,
      countryCodes: c.fightingCountryCodes,
      spreadKm,
    });
  }

  // Conflicts known only through their events (e.g. historical mode, or a
  // database conflict the curated list doesn't carry) get a base derived from
  // those events: worst severity, geographic spread, the countries they
  // occurred in — never how many reports exist.
  for (const [conflictId, group] of byConflict) {
    if (known.has(conflictId)) continue;
    const seen = new Set<string>();
    const anchors: { lat: number; lng: number }[] = [];
    for (const e of group) {
      const key = `${Math.round(e.lat * 4)},${Math.round(e.lng * 4)}`;
      if (!seen.has(key)) {
        seen.add(key);
        anchors.push({ lat: e.lat, lng: e.lng });
      }
    }
    const spreadKm = anchors.reduce((max, a) => Math.max(max, distanceKm(anchors[0]!, a)), 0);
    const worst = group.reduce((w: string, e) => maxSeverity(w, e.severity), group[0]!.severity) as ConflictEvent["severity"];
    const severity = computeSeverityScore({ severityLabel: worst, spreadKm, eventCount: group.length });
    heatConflicts.push({
      id: conflictId,
      severityScore: severity.severityScore,
      confidence: Math.max(...group.map((e) => confidenceOf.get(e.id) ?? 0.6)),
      anchors,
      countryCodes: [...new Set(group.map((e) => e.countryCode).filter(Boolean))],
      spreadKm,
    });
  }

  return { conflicts: heatConflicts, incidents };
}
