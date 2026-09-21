import { getBrief } from "@/lib/brief/brief";
import { listPublicConflicts } from "@/lib/public/conflicts";
import { getPublicFreshness } from "@/lib/public/overview";
import { computeSeverityScore, effectiveSeverityLabel } from "@/lib/scoring/severity";
import type { ConflictStatusLike } from "@/lib/scoring/types";
import { getCountryRecord } from "@/lib/countries/registry";
import type { Conflict } from "@/lib/types";
import { HIGH_TENSION_MIN_SCORE, LIVE_MAX_MINUTES, buildSignals, dedupeItems, buildTicker, liveState, rankEntities, toWorldItem } from "./derive";
import type { CommandCenter, MarkerConflict } from "./types";

// One aggregation for /world: status counters, ticker, Pulse, What Changed, Top Entities, Global Signals and the
// active-conflict marker set. It reuses the canonical services (conflict registry, the cached brief universe that
// already folds in state transitions and global events, and the public freshness stamps) and adds no new store.

const PULSE_MAX = 60;
const WHAT_CHANGED_MAX = 5;
const RECENT_MS = 24 * 3_600_000;

export function conflictSeverityScore(c: Conflict): number {
  return computeSeverityScore({
    severityLabel: effectiveSeverityLabel(c.severity, c.fullScaleWar, c.status),
    status: c.status as ConflictStatusLike,
    intensity: c.intensity,
    eventCount: c.eventCount,
    escalationTrend: c.intensityChange24h,
  }).severityScore;
}

export async function getCommandCenter(opts: { includePartyClaims?: boolean } = {}, now: Date = new Date()): Promise<CommandCenter> {
  const started = Date.now();
  const includePartyClaims = opts.includePartyClaims === true;
  const [conflicts, brief24, brief6, freshness] = await Promise.all([listPublicConflicts(), getBrief({ window: "24h", includePartyClaims }, now), getBrief({ window: "6h" }, now), getPublicFreshness(now)]);

  const active = conflicts.filter((c) => c.status === "active");
  const scored = active.map((c) => ({ c, score: conflictSeverityScore(c) }));

  const items = dedupeItems(brief24.developments.map(toWorldItem)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.significance - a.significance || a.id.localeCompare(b.id));
  const claimFree = items.filter((i) => !i.isPartyClaim);
  const latestBySlug = new Map<string, string>();
  const recentBySlug = new Set<string>();
  for (const i of claimFree) {
    if (!i.conflictSlug) continue;
    if (!latestBySlug.has(i.conflictSlug)) latestBySlug.set(i.conflictSlug, i.headline);
    if (now.getTime() - new Date(i.occurredAt).getTime() <= RECENT_MS) recentBySlug.add(i.conflictSlug);
  }
  const markers: MarkerConflict[] = scored
    .filter(({ c }) => c.locationKnown && Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map(({ c, score }) => ({ slug: c.slug, name: c.shortName || c.name, severity: c.severity, severityScore: score, lat: c.lat, lng: c.lng, recent: recentBySlug.has(c.slug), latestTitle: latestBySlug.get(c.slug) ?? null }));

  const live = liveState(freshness.lastIngestionAt, now);
  return {
    generatedAt: now.toISOString(),
    status: {
      activeConflicts: active.length,
      highTension: scored.filter((s) => s.score >= HIGH_TENSION_MIN_SCORE).length,
      newDevelopments: brief24.counts.developments,
      live: { ...live, lastIngestionAt: freshness.lastIngestionAt, lastEventAt: freshness.lastEventAt },
    },
    ticker: buildTicker(claimFree),
    pulse: items.slice(0, PULSE_MAX),
    whatChanged: dedupeItems(brief6.developments.filter((d) => !d.isPartyClaim).map(toWorldItem)).slice(0, WHAT_CHANGED_MAX),
    topEntities: rankEntities(claimFree, now, (code) => getCountryRecord(code)?.name ?? null),
    globalSignals: buildSignals(claimFree),
    conflicts: markers,
    meta: { revision: brief24.revision, computeMs: Date.now() - started, includePartyClaims, partyClaimsHidden: brief24.counts.partyClaimsHidden, thresholds: { highTensionMinScore: HIGH_TENSION_MIN_SCORE, liveMaxMinutes: LIVE_MAX_MINUTES } },
  };
}
