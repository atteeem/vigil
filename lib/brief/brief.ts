import { prisma } from "@/lib/db/client";
import { scoreConflict } from "@/lib/db/repositories/scoring";
import { resolveCountry } from "@/lib/countries/registry";
import { buildUniverse, type Universe } from "./collect";
import { dataRevision } from "./revision";
import { DEFAULT_WINDOW, MAX_CUSTOM_WINDOW_MS, WINDOW_LABEL, WINDOW_MS, type Brief, type BriefCounts, type BriefDevelopment, type BriefRange, type BriefScope, type BriefWindow, type EscalationAssessment, type HotspotAssessment, BRIEF_WINDOWS } from "./types";

// Brief assembly: parse the range, get the (cached) world-wide universe of developments, then scope it
// (global / country / conflict / watchlist) and lay it out. The same function serves the public brief,
// the country and conflict briefs, the watchlist brief, "What changed" and the manual 24h brief.

export interface BriefQuery {
  window?: string | null;
  from?: string | null;
  to?: string | null;
  /** Historical end time ("as of"); default now. */
  asOf?: string | null;
  country?: string | null;
  conflict?: string | null;
  watcherId?: string | null;
  /** Union of country + watchlist ("For you"). */
  includeWatchlistWithCountry?: boolean;
  includePartyClaims?: boolean;
}

export const COUNTRY_IMPACT_MIN = 40;

export class BriefInputError extends Error {}

export function parseRange(q: BriefQuery, now: Date = new Date()): BriefRange {
  const w = ((q.window ?? DEFAULT_WINDOW) as string).toLowerCase() as BriefWindow;
  if (!(BRIEF_WINDOWS as readonly string[]).includes(w)) throw new BriefInputError(`Unknown window "${q.window}". Use one of ${BRIEF_WINDOWS.join(", ")}.`);
  const date = (s: string, name: string) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) throw new BriefInputError(`Invalid ${name} time`);
    return d;
  };
  if (w === "custom") {
    if (!q.from || !q.to) throw new BriefInputError("A custom window needs both from and to (ISO times)");
    const from = date(q.from, "from");
    const to = date(q.to, "to");
    if (to <= from) throw new BriefInputError("The custom window must end after it starts");
    if (to.getTime() - from.getTime() > MAX_CUSTOM_WINDOW_MS) throw new BriefInputError("The custom window is limited to 30 days");
    if (to > now) return { window: w, from, to: now, live: true };
    return { window: w, from, to, live: false };
  }
  const to = q.asOf ? date(q.asOf, "asOf") : now;
  const end = to > now ? now : to;
  return { window: w, from: new Date(end.getTime() - WINDOW_MS[w]), to: end, live: !q.asOf || end.getTime() >= now.getTime() - 1000 };
}

// ---------------------------------------------------------------------------------------------
// Cache of the world-wide universe: keyed by window, revision and (for historical briefs) exact range.
// Live entries are also time-limited so the window edge advances; a repeated request in between costs
// nothing, and a data revision that did not change (e.g. a duplicate article) keeps the entry valid.
// ---------------------------------------------------------------------------------------------
interface CacheEntry {
  universe: Universe;
  revision: string;
  at: number;
  computeMs: number;
}
const g = globalThis as unknown as { __vigilBriefCache?: Map<string, CacheEntry>; __vigilBriefStats?: { computes: number; hits: number } };
const cache = (g.__vigilBriefCache ??= new Map());
export const briefStats = (g.__vigilBriefStats ??= { computes: 0, hits: 0 });
const LIVE_TTL_MS = 120_000;
const MAX_ENTRIES = 40;

export async function getUniverse(range: BriefRange, opts: { fresh?: boolean } = {}): Promise<{ universe: Universe; revision: string; cached: boolean; computeMs: number }> {
  const revision = await dataRevision();
  const key = range.live ? `live|${range.window}|${range.window === "custom" ? range.from.toISOString() : ""}` : `hist|${range.from.toISOString()}|${range.to.toISOString()}`;
  const hit = cache.get(key);
  if (!opts.fresh && hit && hit.revision === revision && (!range.live || Date.now() - hit.at < LIVE_TTL_MS)) {
    briefStats.hits++;
    return { universe: hit.universe, revision, cached: true, computeMs: hit.computeMs };
  }
  const t0 = Date.now();
  const universe = await buildUniverse(range);
  const computeMs = Date.now() - t0;
  briefStats.computes++;
  cache.set(key, { universe, revision, at: Date.now(), computeMs });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return { universe, revision, cached: false, computeMs };
}

export function clearBriefCache() {
  cache.clear();
}

// ---------------------------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------------------------
const impactCache = new Map<string, Promise<number>>();
function impactFor(conflictId: string, country: string): Promise<number> {
  const k = `${conflictId}:${country}`;
  if (!impactCache.has(k)) {
    impactCache.set(
      k,
      scoreConflict(conflictId, country).then((s) => s?.impact?.impactScore ?? 0).catch(() => 0),
    );
    if (impactCache.size > 500) impactCache.delete(impactCache.keys().next().value as string);
  }
  return impactCache.get(k)!;
}
// Impact depends on conflict state: forget it whenever the data revision moves (see getBrief).
let impactRevision = "";

export function normalizeCountry(input: string): { code: string; name: string } | null {
  const c = resolveCountry(input);
  return c ? { code: c.code, name: c.name } : null;
}

const rankKey = (d: BriefDevelopment) => (d.impact != null ? 0.6 * d.significance + 0.4 * d.impact : d.significance);

function emptyCounts(): BriefCounts {
  return { developments: 0, escalationSignals: 0, territorialChanges: 0, infrastructureDisruptions: 0, hazards: 0, hotspots: 0, partyClaimsHidden: 0 };
}

function makeHeadline(counts: BriefCounts, label: string): string {
  if (counts.developments === 0 && counts.hotspots === 0) return `No material developments recorded — ${label.toLowerCase()}.`;
  const parts = [`${counts.developments} significant development${counts.developments === 1 ? "" : "s"}`, counts.escalationSignals > 0 ? `${counts.escalationSignals} escalation signal${counts.escalationSignals === 1 ? "" : "s"}` : null, counts.territorialChanges > 0 ? `${counts.territorialChanges} territorial change${counts.territorialChanges === 1 ? "" : "s"}` : null, counts.infrastructureDisruptions > 0 ? `${counts.infrastructureDisruptions} major infrastructure disruption${counts.infrastructureDisruptions === 1 ? "" : "s"}` : null, counts.hazards > 0 ? `${counts.hazards} natural hazard${counts.hazards === 1 ? "" : "s"}` : null].filter(Boolean);
  return `${label}: ${parts.join(" · ")}`;
}

function assessmentText(a: EscalationAssessment): string {
  switch (a.trend) {
    case "escalating":
      return "Escalation indicators increased";
    case "de-escalating":
      return "De-escalation indicators increased";
    case "stable":
      return "No material change in escalation indicators";
    default:
      return "Not enough recorded activity to assess a trend";
  }
}

export async function getBrief(q: BriefQuery, now: Date = new Date(), opts: { fresh?: boolean } = {}): Promise<Brief> {
  const started = Date.now();
  const range = parseRange(q, now);
  const { universe, revision, cached, computeMs } = await getUniverse(range, opts);
  if (impactRevision !== revision) {
    impactCache.clear();
    impactRevision = revision;
  }
  const includeParty = q.includePartyClaims === true;

  let scope: BriefScope = { kind: "global" };
  let country: { code: string; name: string } | null = null;
  let conflictSlug: string | null = null;
  if (q.conflict) {
    scope = { kind: "conflict", conflict: q.conflict };
    conflictSlug = q.conflict;
  } else if (q.country) {
    const c = normalizeCountry(q.country);
    if (!c) throw new BriefInputError(`Unknown country "${q.country}"`);
    country = c;
    scope = { kind: "country", country: c.code };
  }
  if (q.watcherId && !q.conflict && !q.country) scope = { kind: "watchlist", watcherId: q.watcherId };
  const scopeKey = scope.kind === "global" ? "global" : scope.kind === "country" ? `country:${scope.country}` : scope.kind === "conflict" ? `conflict:${scope.conflict}` : `watchlist:${q.watcherId}${country ? `+country:${country.code}` : ""}`;

  let devs: BriefDevelopment[] = universe.developments.map((d) => ({ ...d, reasons: [...d.reasons] }));
  let hotspots: HotspotAssessment[] = universe.hotspots;
  let escalation: EscalationAssessment[] = universe.escalation;
  const conflictByslug = new Map(universe.conflicts.map((c) => [c.slug, c]));

  if (q.conflict) {
    const c = conflictByslug.get(q.conflict);
    if (!c) throw new BriefInputError(`Unknown conflict "${q.conflict}"`);
    devs = devs.filter((d) => d.conflictSlug === q.conflict || d.watchKeys.some((k) => k.type === "conflict" && k.key === q.conflict));
    hotspots = hotspots.filter((h) => h.conflictSlug === q.conflict);
    escalation = escalation.filter((e) => e.conflictSlug === q.conflict);
  } else {
    const wantCountry = country;
    const watches = q.watcherId ? await prisma.watch.findMany({ where: { watcherId: q.watcherId, muted: false } }) : [];
    const watched = new Set(watches.map((w) => `${w.entityType}:${w.entityKey}`));
    const watchMode = new Map(watches.map((w) => [`${w.entityType}:${w.entityKey}`, w.mode]));
    const useCountry = !!wantCountry;
    const useWatch = !!q.watcherId && !q.conflict;
    if (useCountry || useWatch) {
      const kept: BriefDevelopment[] = [];
      for (const d of devs) {
        const why: string[] = [];
        let relevance: number | null = null;
        if (wantCountry) {
          const keyed = d.watchKeys.some((k) => k.type === "country" && k.key === wantCountry.code) || d.countryCode === wantCountry.code;
          const conflict = d.conflictSlug ? conflictByslug.get(d.conflictSlug) : null;
          const isConflictNews = d.domain === "conflict" || d.domain === "territory" || d.domain === "actor";
          if (keyed && (!isConflictNews || conflict?.fighting.includes(wantCountry.code) || d.countryCode === wantCountry.code)) {
            relevance = 100;
            why.push(`occurs in ${wantCountry.name}`);
          } else if (conflict && (isConflictNews || d.domain === "infrastructure" || d.domain === "hazard")) {
            const impact = await impactFor(conflict.id, wantCountry.code);
            if (impact >= COUNTRY_IMPACT_MIN) {
              relevance = impact;
              why.push(`${conflict.name} affects ${wantCountry.name}: impact score ${impact} (central impact model)`);
            }
          } else if (keyed) {
            relevance = 100;
            why.push(`located in ${wantCountry.name}`);
          }
        }
        if (useWatch) {
          const hit = d.watchKeys.filter((k) => watched.has(`${k.type}:${k.key}`));
          if (hit.length > 0) {
            // A "major only" watch does not pull in mid-significance items.
            const strict = hit.every((k) => watchMode.get(`${k.type}:${k.key}`) === "major");
            if (!strict || d.significance >= 55 || d.isResolution || d.developmentType === "territory_changed") {
              relevance = Math.max(relevance ?? 0, 80);
              why.push(`you follow ${[...new Set(hit.map((k) => k.key))].slice(0, 3).join(", ")}`);
            }
          }
        }
        if (relevance != null) kept.push({ ...d, impact: relevance, reasons: [...why, ...d.reasons] });
      }
      devs = kept;
      const slugs = new Set(devs.map((d) => d.conflictSlug).filter(Boolean));
      hotspots = hotspots.filter((h) => (h.conflictSlug && slugs.has(h.conflictSlug)) || (wantCountry && h.countryCode === wantCountry.code));
      escalation = escalation.filter((e) => slugs.has(e.conflictSlug));
    }
  }

  const hiddenClaims = devs.filter((d) => d.isPartyClaim).length;
  if (!includeParty) devs = devs.filter((d) => !d.isPartyClaim);
  devs.sort((a, b) => rankKey(b) - rankKey(a) || b.significance - a.significance || b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));

  const counts: BriefCounts = emptyCounts();
  counts.developments = devs.filter((d) => !d.isPartyClaim).length;
  counts.escalationSignals = escalation.filter((e) => e.trend === "escalating").length;
  counts.territorialChanges = devs.filter((d) => d.developmentType === "territory_changed").length;
  counts.infrastructureDisruptions = devs.filter((d) => d.domain === "infrastructure" && !d.isResolution).length;
  counts.hazards = devs.filter((d) => d.domain === "hazard" && !d.isResolution).length;
  counts.hotspots = hotspots.length;
  counts.partyClaimsHidden = includeParty ? 0 : hiddenClaims;

  const top = devs.filter((d) => !d.isPartyClaim && d.developmentType !== "de_escalation").slice(0, 5).map((d) => d.id);
  const label = range.window === "custom" ? `${range.from.toISOString().slice(0, 16).replace("T", " ")} – ${range.to.toISOString().slice(0, 16).replace("T", " ")} UTC` : WINDOW_LABEL[range.window];
  const focusEsc = conflictSlug ? (escalation.find((e) => e.conflictSlug === conflictSlug) ?? null) : null;

  return {
    scopeKey,
    scope,
    window: range.window,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    live: range.live,
    generatedAt: now.toISOString(),
    revision,
    headline: makeHeadline(counts, label),
    counts,
    top,
    developments: devs,
    escalation: escalation.filter((e) => e.trend !== "uncertain" || conflictSlug != null),
    hotspots,
    assessment: focusEsc ? { conflictSlug: focusEsc.conflictSlug, trend: focusEsc.trend, text: assessmentText(focusEsc), reasons: focusEsc.reasons } : null,
    includePartyClaims: includeParty,
    country,
    meta: { cached, computeMs: cached ? 0 : computeMs, excluded: universe.excluded.length + (Date.now() - started > 1e9 ? 1 : 0) },
  };
}

// ---------------------------------------------------------------------------------------------
// Snapshots: a generated brief kept as it was
// ---------------------------------------------------------------------------------------------
export interface StoredBrief {
  id: string;
  scopeKey: string;
  window: string;
  from: string;
  to: string;
  generatedAt: string;
  revision: string;
  developmentIds: string[];
  headline: string;
  counts: BriefCounts;
  items: { id: string; type: string; section: string; title: string; summary: string; significance: number; confidence: number; deepLink: string; occurredAt: string; isPartyClaim: boolean; sources: { name: string; url: string | null; role: string }[] }[];
  hotspots: { label: string; label2: string; score: number; reasons: string[] }[];
  escalation: { conflict: string; trend: string; score: number; reasons: string[] }[];
}

export async function saveBriefSnapshot(brief: Brief, watcherId: string | null): Promise<StoredBrief> {
  const stored: Omit<StoredBrief, "id" | "generatedAt"> = {
    scopeKey: brief.scopeKey,
    window: brief.window,
    from: brief.from,
    to: brief.to,
    revision: brief.revision,
    developmentIds: brief.developments.map((d) => d.id),
    headline: brief.headline,
    counts: brief.counts,
    items: brief.developments.slice(0, 40).map((d) => ({ id: d.id, type: d.developmentType, section: d.section, title: d.title, summary: d.summary, significance: d.significance, confidence: d.confidence, deepLink: d.deepLink, occurredAt: d.occurredAt, isPartyClaim: d.isPartyClaim, sources: d.sources.slice(0, 6).map((s) => ({ name: s.name, url: s.url, role: s.role })) })),
    hotspots: brief.hotspots.slice(0, 8).map((h) => ({ label: h.label, label2: h.label2, score: h.score, reasons: h.reasons })),
    escalation: brief.escalation.filter((e) => e.trend !== "stable" && e.trend !== "uncertain").map((e) => ({ conflict: e.conflictName, trend: e.trend, score: e.score, reasons: e.reasons.slice(0, 4) })),
  };
  const row = await prisma.briefSnapshot.create({ data: { scopeKey: brief.scopeKey, windowKey: brief.window, fromAt: new Date(brief.from), toAt: new Date(brief.to), revision: brief.revision, watcherId, developmentIds: JSON.stringify(stored.developmentIds), summary: JSON.stringify(stored) } });
  return { ...stored, id: row.id, generatedAt: row.generatedAt.toISOString() };
}

export async function getBriefSnapshot(id: string, watcherId: string | null): Promise<StoredBrief | null> {
  const row = await prisma.briefSnapshot.findUnique({ where: { id } });
  if (!row) return null;
  if (row.watcherId && row.watcherId !== watcherId) return null; // personal briefs are private to their owner
  return { ...(JSON.parse(row.summary) as StoredBrief), id: row.id, generatedAt: row.generatedAt.toISOString() };
}

export async function listBriefSnapshots(scopeKey: string, watcherId: string | null, limit = 10) {
  const rows = await prisma.briefSnapshot.findMany({ where: { scopeKey, OR: [{ watcherId: null }, ...(watcherId ? [{ watcherId }] : [])] }, orderBy: { generatedAt: "desc" }, take: Math.min(limit, 50) });
  return rows.map((r) => ({ id: r.id, scopeKey: r.scopeKey, window: r.windowKey, from: r.fromAt.toISOString(), to: r.toAt.toISOString(), generatedAt: r.generatedAt.toISOString(), headline: (JSON.parse(r.summary) as StoredBrief).headline }));
}
