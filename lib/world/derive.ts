import type { BriefDevelopment } from "@/lib/brief/types";
import type { EntityWindow, GlobalSignal, LiveState, PulseBadge, PulseCategory, TopEntity, WorldItem } from "./types";

// Pure derivations for the World Command Center (no database) so the rules are unit-testable and documented once.

/** A conflict counts as HIGH TENSION at severity score >= 70: the "high" band of severityFromScore (lib/utils/severity.ts). */
export const HIGH_TENSION_MIN_SCORE = 70;
/** LIVE while the newest successful ingestion is at most this old; DELAYED up to STALE_AFTER_HOURS; then STALE. */
export const LIVE_MAX_MINUTES = 120;
export const STALE_AFTER_HOURS = 48;
/** Ticker and Live View only carry developments at least this significant (the brief itself floors at 50). */
export const TICKER_MIN_SIGNIFICANCE = 60;
export const TICKER_MAX = 12;
export const ENTITY_LIMIT = 6;
const WINDOW_MS: Record<EntityWindow, number> = { "1h": 3_600_000, "6h": 21_600_000, "24h": 86_400_000 };

export function liveState(lastIngestionAt: string | null, now: Date): { state: LiveState; label: string } {
  if (!lastIngestionAt) return { state: "no-data", label: "NO DATA" };
  const ageMin = (now.getTime() - new Date(lastIngestionAt).getTime()) / 60_000;
  if (ageMin <= LIVE_MAX_MINUTES) return { state: "live", label: "LIVE" };
  if (ageMin <= STALE_AFTER_HOURS * 60) return { state: "delayed", label: "DELAYED" };
  return { state: "stale", label: "STALE" };
}

const categoryOf = (d: BriefDevelopment): PulseCategory => (d.domain === "territory" ? "territory" : d.domain === "hazard" ? "hazard" : d.domain === "infrastructure" ? "infrastructure" : "conflict");

export function toWorldItem(d: BriefDevelopment): WorldItem {
  const badges: PulseBadge[] = [];
  if (d.isPartyClaim) badges.push("PARTY CLAIM");
  else if (d.evidence.official) badges.push("OFFICIAL");
  else if (d.evidence.independentSources >= 2 && d.confidenceLabel !== "low") badges.push("VERIFIED");
  if (d.developmentType === "event_update") badges.push("UPDATED");
  if (d.domain === "territory") badges.push("TERRITORY");
  if (d.domain === "hazard") badges.push("HAZARD");
  const t = d.mapTarget;
  const first = d.sources[0];
  return {
    id: d.id,
    category: categoryOf(d),
    developmentType: d.developmentType,
    headline: d.title,
    summary: d.summary,
    occurredAt: d.occurredAt,
    place: d.geography.place,
    countryCode: d.geography.countryCode ?? d.countryCode,
    source: first ? first.name : null,
    confidence: d.confidence,
    confidenceLabel: d.confidenceLabel,
    significance: d.significance,
    badges,
    isPartyClaim: d.isPartyClaim,
    conflictSlug: d.conflictSlug,
    conflictName: d.conflictName,
    lat: t?.lat ?? d.geography.lat,
    lng: t?.lng ?? d.geography.lng,
    zoom: t?.zoom ?? null,
    layers: t?.layers ?? [],
    eventId: t?.eventId ?? null,
    hazardId: t?.hazardId ?? null,
    territory: !!t?.territory,
    deepLink: d.deepLink,
  };
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Drops repeats of the same development (same id, or same type and normalised headline): several feeds and
 * per-asset records can state one thing many times, and a list should say it once. Keeps the first of each. */
export function dedupeItems(items: WorldItem[]): WorldItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = `${i.developmentType}|${normTitle(i.headline)}|${i.countryCode ?? ""}`;
    if (seen.has(i.id) || seen.has(key)) return false;
    seen.add(i.id);
    seen.add(key);
    return true;
  });
}

/**
 * Breaking-intelligence ticker and Live View queue: significant, non-party-claim developments, de-duplicated
 * (same id, same type + normalised headline, or same conflict + type + place), newest first. Minor RSS and
 * routine thermal detections never appear because the brief system does not emit them as developments; the
 * significance floor keeps low-importance ones out too.
 */
export function buildTicker(items: WorldItem[], max = TICKER_MAX): WorldItem[] {
  const seenId = new Set<string>();
  const seenTitle = new Set<string>();
  const seenSituation = new Set<string>();
  const out: WorldItem[] = [];
  const candidates = items.filter((i) => !i.isPartyClaim && i.significance >= TICKER_MIN_SIGNIFICANCE).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.significance - a.significance || a.id.localeCompare(b.id));
  for (const i of candidates) {
    const titleKey = `${i.developmentType}|${normTitle(i.headline)}`;
    const situationKey = i.conflictSlug && i.place ? `${i.conflictSlug}|${i.developmentType}|${normTitle(i.place)}` : null;
    if (seenId.has(i.id) || seenTitle.has(titleKey) || (situationKey && seenSituation.has(situationKey))) continue;
    seenId.add(i.id);
    seenTitle.add(titleKey);
    if (situationKey) seenSituation.add(situationKey);
    out.push(i);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Top entities per window, ranked by MEANINGFUL DEVELOPMENTS, never raw article frequency: every development
 * (already de-duplicated by the brief system, one row however many outlets syndicated it) contributes its
 * significance once, so one syndicated story cannot outrank a conflict with several distinct developments.
 * Entities are conflicts and the countries where developments are located.
 */
export function rankEntities(items: WorldItem[], now: Date, countryName: (code: string) => string | null): Record<EntityWindow, TopEntity[]> {
  const result = {} as Record<EntityWindow, TopEntity[]>;
  for (const w of Object.keys(WINDOW_MS) as EntityWindow[]) {
    const from = now.getTime() - WINDOW_MS[w];
    const acc = new Map<string, TopEntity & { best: number }>();
    const bump = (kind: TopEntity["kind"], key: string, label: string, i: WorldItem) => {
      const id = `${kind}:${key}`;
      const cur = acc.get(id) ?? { kind, key, label, developments: 0, score: 0, lead: i.headline, best: -1 };
      cur.developments += 1;
      cur.score += i.significance;
      if (i.significance > cur.best) {
        cur.best = i.significance;
        cur.lead = i.headline;
      }
      acc.set(id, cur);
    };
    for (const i of items) {
      if (i.isPartyClaim || new Date(i.occurredAt).getTime() < from) continue;
      if (i.conflictSlug) bump("conflict", i.conflictSlug, i.conflictName ?? i.conflictSlug, i);
      const name = i.countryCode ? countryName(i.countryCode) : null;
      if (i.countryCode && name) bump("country", i.countryCode, name, i);
    }
    result[w] = [...acc.values()]
      .sort((a, b) => b.score - a.score || b.developments - a.developments || a.label.localeCompare(b.label))
      .slice(0, ENTITY_LIMIT)
      .map((e) => ({ kind: e.kind, key: e.key, label: e.label, developments: e.developments, score: e.score, lead: e.lead }));
  }
  return result;
}

const SIGNALS: { key: GlobalSignal["key"]; label: string; match: (i: WorldItem) => boolean }[] = [
  { key: "hazards", label: "Hazards", match: (i) => i.category === "hazard" },
  { key: "aviation", label: "Airports & airspace", match: (i) => i.developmentType === "airport" || i.developmentType === "airspace" },
  { key: "maritime", label: "Maritime", match: (i) => ["maritime", "port", "chokepoint"].includes(i.developmentType) },
  { key: "energy", label: "Energy", match: (i) => i.developmentType === "energy" },
  { key: "internet", label: "Internet", match: (i) => i.developmentType === "internet" },
];

export function buildSignals(items: WorldItem[]): GlobalSignal[] {
  return SIGNALS.map((s) => {
    const hits = items.filter((i) => !i.isPartyClaim && s.match(i)).sort((a, b) => b.significance - a.significance || b.occurredAt.localeCompare(a.occurredAt));
    return { key: s.key, label: s.label, count: hits.length, items: hits.slice(0, 2) };
  });
}
