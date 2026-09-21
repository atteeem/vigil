import type { Watch, Watcher } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { scoreConflict } from "@/lib/db/repositories/scoring";
import { acceptDevelopment, computePriority, fingerprintOf, ledgerPrefix, type Candidate, type Development } from "./decide";
import { ALERT_CATEGORY, CATEGORY_LABEL, ENTITY_TYPE_LABEL, MODE_LABEL, effectiveRules, inQuietHours, parseSettings, priorityRank, type Priority, type WatchEntityType, type WatchMode, type WatchRules } from "./types";

// The ONE alert-evaluation service. Input: developments (already reduced to meaningful state changes).
// It derives candidate watch keys, fetches only the watches on those keys (indexed on entityType+entityKey),
// applies each watch's rules, priority and the watcher's settings, and writes at most one Notification per
// watcher per fingerprint. Every decision is recorded for the inspector; nothing scans all users.

// Process-wide counters (globalThis: the Next dev server may bundle route handlers separately).
const g = globalThis as unknown as { __vigilAlertStats?: { developments: number; watchQueries: number; watchesMatched: number; notifications: number; duplicatesSuppressed: number } };
export const alertStats = (g.__vigilAlertStats ??= { developments: 0, watchQueries: 0, watchesMatched: 0, notifications: 0, duplicatesSuppressed: 0 });

export type Decision = "notified" | "merged_watch" | "suppressed_duplicate" | "below_threshold" | "party_claim_hidden" | "muted" | "paused" | "disabled" | "category_off" | "below_min_priority" | "resolution_off" | "not_material";

export interface MatchResult {
  watchId: string;
  watcherId: string;
  entityType: string;
  entityKey: string;
  label: string;
  mode: string;
  decision: Decision;
  rule: string | null;
  priority: Priority | null;
  priorityScore: number | null;
  factors?: { name: string; value: number; weight: number }[];
  notificationId?: string | null;
  wouldNotify: boolean;
}

export interface ProcessResult {
  fingerprint: string;
  alertType: string;
  title: string;
  candidates: Candidate[];
  matches: MatchResult[];
  created: number;
  suppressed: number;
}

export interface ProcessOptions {
  commit: boolean;
  now?: Date;
}

const uniqCandidates = (list: Candidate[]): Candidate[] => {
  const best = new Map<string, Candidate>();
  for (const c of list) {
    const k = `${c.type}:${c.key}`;
    if (!best.has(k) || best.get(k)!.specificity < c.specificity) best.set(k, c);
  }
  return [...best.values()];
};

/** Conflict impact for a country, cached per batch. */
function impactResolver() {
  const cache = new Map<string, Promise<{ score: number; hardFloor: string | null }>>();
  return (conflictId: string | null | undefined, country: string | null | undefined) => {
    if (!conflictId || !country) return Promise.resolve({ score: 0, hardFloor: null });
    const k = `${conflictId}:${country}`;
    if (!cache.has(k)) cache.set(k, scoreConflict(conflictId, country).then((s) => ({ score: s?.impact?.impactScore ?? 0, hardFloor: s?.impact?.hardFloor ?? null })));
    return cache.get(k)!;
  };
}

export async function processDevelopment(dev: Development, opts: ProcessOptions, impactOf = impactResolver()): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  alertStats.developments++;
  const fingerprint = fingerprintOf(dev);
  const category = ALERT_CATEGORY[dev.alertType];

  // 1. Candidate keys. For conflict developments every WATCHED country is a candidate (relevance is then
  //    judged by impact scoring): a bounded distinct-key query, never a scan of watchers.
  let candidates = uniqCandidates(dev.candidates);
  if (dev.facts.conflictId) {
    alertStats.watchQueries++;
    const countries = await prisma.watch.findMany({ where: { entityType: "country" }, distinct: ["entityKey"], select: { entityKey: true } });
    candidates = uniqCandidates([...candidates, ...countries.map((c) => ({ type: "country" as const, key: c.entityKey, specificity: 0.6 }))]);
  }
  const result: ProcessResult = { fingerprint, alertType: dev.alertType, title: dev.title, candidates, matches: [], created: 0, suppressed: 0 };
  if (candidates.length === 0) return result;

  // 2. One indexed query for the watches on those keys.
  alertStats.watchQueries++;
  const watches = await prisma.watch.findMany({ where: { OR: candidates.map((c) => ({ entityType: c.type, entityKey: c.key })) }, include: { watcher: true } });
  alertStats.watchesMatched += watches.length;
  const specOf = (w: Watch) => candidates.find((c) => c.type === w.entityType && c.key === w.entityKey)?.specificity ?? 0.4;

  const byWatcher = new Map<string, (Watch & { watcher: Watcher })[]>();
  for (const w of watches) (byWatcher.get(w.watcherId) ?? byWatcher.set(w.watcherId, []).get(w.watcherId)!).push(w);

  for (const [watcherId, list] of byWatcher) {
    const settings = parseSettings(list[0]!.watcher.settings);
    const accepted: { watch: Watch; match: MatchResult; reason: Record<string, unknown> }[] = [];

    for (const watch of list) {
      const base = { watchId: watch.id, watcherId, entityType: watch.entityType, entityKey: watch.entityKey, label: watch.label, mode: watch.mode };
      const rec = (decision: Decision, extra: Partial<MatchResult> = {}): MatchResult => ({ ...base, decision, rule: null, priority: null, priorityScore: null, wouldNotify: false, ...extra });
      if (watch.muted) { result.matches.push(rec("muted")); continue; }
      if (watch.pausedUntil && watch.pausedUntil > now) { result.matches.push(rec("paused")); continue; }
      if (!settings.enabled) { result.matches.push(rec("disabled")); continue; }
      if (!settings.categories[category]) { result.matches.push(rec("category_off")); continue; }
      const custom = JSON.parse(watch.rules || "{}") as WatchRules;
      if (dev.isPartyClaim && !(settings.partyClaims || (watch.mode === "custom" && custom.includePartyClaims === true))) { result.matches.push(rec("party_claim_hidden")); continue; }
      if (dev.isResolution && !settings.resolutionAlerts) { result.matches.push(rec("resolution_off")); continue; }

      const rules = effectiveRules(watch.entityType as WatchEntityType, watch.entityKey, watch.mode as WatchMode, custom);
      const watchCountry = watch.entityType === "country" ? watch.entityKey : settings.baseCountry;
      const impact = dev.facts.conflictId ? await impactOf(dev.facts.conflictId, watchCountry) : { score: 0, hardFloor: null };
      const decision = acceptDevelopment({ entityType: watch.entityType as WatchEntityType }, rules, dev, { impactForWatchCountry: dev.facts.conflictId ? impact.score : null });
      if (!decision.accept) { result.matches.push(rec("below_threshold", { rule: decision.rule })); continue; }

      // A restoration is only news to someone who was told about the problem.
      if (dev.isResolution) {
        const told = await prisma.notification.findFirst({ where: { watcherId, fingerprint: { startsWith: ledgerPrefix(dev) }, isResolution: false }, select: { id: true } });
        if (!told) { result.matches.push(rec("not_material", { rule: "Nothing to resolve: you were not alerted to the original problem" })); continue; }
      }

      // Personal relevance: conflict impact for the user's selected country, or the hazard being in it.
      const userCountry = settings.baseCountry;
      const userImpact = dev.facts.conflictId ? (await impactOf(dev.facts.conflictId, userCountry)).score : userCountry && dev.facts.countryCode === userCountry ? 100 : 0;
      const ownWar = dev.facts.conflictId ? (await impactOf(dev.facts.conflictId, userCountry)).hardFloor === "own_country_war" && (dev.alertType === "conflict_escalation" || dev.alertType === "conflict_event" || dev.alertType === "territorial_change") : false;
      const pr = computePriority({ significance: dev.significance, userImpact, specificity: specOf(watch), confidence: dev.confidence, ownCountryWar: ownWar, isResolution: dev.isResolution, isPartyClaim: dev.isPartyClaim });
      if (priorityRank(pr.priority) < priorityRank(settings.minPriority)) { result.matches.push(rec("below_min_priority", { rule: decision.rule, priority: pr.priority, priorityScore: pr.score })); continue; }

      const match = rec("notified", { rule: decision.rule, priority: pr.priority, priorityScore: pr.score, factors: pr.factors, wouldNotify: true });
      accepted.push({
        watch,
        match,
        reason: { follows: { entityType: watch.entityType, typeLabel: ENTITY_TYPE_LABEL[watch.entityType as WatchEntityType], entityKey: watch.entityKey, label: watch.label }, mode: watch.mode, modeLabel: MODE_LABEL[watch.mode as WatchMode], rule: decision.rule, ruleKey: decision.ruleKey, category: CATEGORY_LABEL[category], priority: pr.priority, priorityScore: pr.score, priorityFactors: pr.factors, priorityNotes: pr.notes, changeNote: dev.changeNote ?? null, userImpact, partyClaim: dev.isPartyClaim, resolution: dev.isResolution },
      });
    }

    if (accepted.length === 0) continue;
    // One development -> one notification per watcher: the strongest matching watch is the reason; the rest are noted.
    accepted.sort((a, b) => (b.match.priorityScore ?? 0) - (a.match.priorityScore ?? 0) || specOf(b.watch) - specOf(a.watch));
    const primary = accepted[0]!;
    const others = accepted.slice(1);
    for (const o of others) o.match.decision = "merged_watch";
    result.matches.push(...accepted.map((a) => a.match));

    const existing = await prisma.notification.findUnique({ where: { watcherId_fingerprint: { watcherId, fingerprint } } });
    if (existing) {
      // Same development, same state, already announced (another source repeating it, a provider re-sending it).
      for (const a of accepted) a.match.decision = "suppressed_duplicate";
      result.suppressed++;
      alertStats.duplicatesSuppressed++;
      if (opts.commit) await prisma.notification.update({ where: { id: existing.id }, data: { suppressedCount: { increment: 1 } } });
      continue;
    }
    result.created++;
    if (!opts.commit) continue;
    const reason = { ...primary.reason, alsoMatched: others.map((o) => `${o.watch.label} (${ENTITY_TYPE_LABEL[o.watch.entityType as WatchEntityType]})`) };
    try {
      const n = await prisma.notification.create({
        data: {
          watcherId,
          watchId: primary.watch.id,
          fingerprint,
          alertType: dev.alertType,
          category: ALERT_CATEGORY[dev.alertType],
          priority: primary.match.priority!,
          priorityScore: primary.match.priorityScore!,
          title: dev.title,
          summary: dev.summary,
          entityType: primary.watch.entityType,
          entityKey: primary.watch.entityKey,
          entityLabel: primary.watch.label,
          eventId: dev.eventId ?? null,
          globalEventId: dev.globalEventId ?? null,
          conflictSlug: dev.conflictSlug ?? null,
          deepLink: dev.deepLink,
          snapshot: JSON.stringify({ ...dev.snapshot, snapshotLink: dev.snapshotLink ?? null, state: dev.state }),
          reason: JSON.stringify(reason),
          isPartyClaim: dev.isPartyClaim,
          isResolution: dev.isResolution,
          quiet: inQuietHours(settings.quietHours, now),
        },
      });
      alertStats.notifications++;
      for (const a of accepted) a.match.notificationId = n.id;
    } catch {
      // A concurrent evaluation created it first: that is a duplicate, not an error.
      result.created--;
      result.suppressed++;
      for (const a of accepted) a.match.decision = "suppressed_duplicate";
    }
  }

  if (opts.commit && result.matches.length > 0) {
    await prisma.alertRecord.createMany({
      data: result.matches.map((m) => ({ signalKind: dev.signalKind, signalRef: dev.signalRef, fingerprint, alertType: dev.alertType, entityType: m.entityType, entityKey: m.entityKey, watchId: m.watchId, watcherId: m.watcherId, decision: m.decision, rule: m.rule, priority: m.priority, reason: m.rule, notificationId: m.notificationId ?? null, detail: JSON.stringify({ title: dev.title, state: dev.state, version: dev.version, factors: m.factors ?? null }) })),
    });
  }
  return result;
}

export async function processDevelopments(devs: Development[], opts: ProcessOptions): Promise<ProcessResult[]> {
  const impactOf = impactResolver();
  const out: ProcessResult[] = [];
  for (const d of devs) out.push(await processDevelopment(d, opts, impactOf));
  return out;
}

const RECORD_RETENTION_DAYS = 30;
export async function pruneAlertRecords(now: Date = new Date()): Promise<number> {
  // Transitions feed briefings (up to 7-day windows plus a 7-day baseline); kept well beyond that.
  await prisma.stateTransition.deleteMany({ where: { at: { lt: new Date(now.getTime() - 120 * 86_400_000) } } });
  return (await prisma.alertRecord.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - RECORD_RETENTION_DAYS * 86_400_000) } } })).count;
}
