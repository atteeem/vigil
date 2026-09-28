import { prisma } from "@/lib/db/client";
import { findDuplicateCandidates, type DuplicateQuery } from "@/lib/ingestion/duplicates";
import { AUTO_MERGE_WINDOW_MINUTES, AUTO_MERGE_MIN_SCORE, AUTO_MERGE_MIN_TITLE_SIMILARITY } from "@/lib/ingestion/event-match";
import { linkEventSource } from "@/lib/db/repositories/event-sources";
import { setProcessingStatus } from "@/lib/db/repositories/raw-ingestion-items";
import { proposeEventUpdatesFromReport } from "@/lib/db/repositories/event-updates";
import { propagateEntityLinksToEvent } from "@/lib/military/link-entities";
import { alertsForEvent } from "@/lib/alerts/hooks";
import { isAggregatorRole } from "@/lib/registry/source-tiers";
import type { EventType } from "@/lib/types";

// Event Clustering, Corroboration & Final READY Publication v1 — offline analysis over ALREADY-published
// events, reusing the exact same scoring model publish-time matching uses (lib/ingestion/duplicates.ts),
// never a second heuristic. Read-only: never mutates anything. Used both for the initial singleton audit
// and, after the canonical-matcher fix, as the retroactive-clustering dry run (spec §9).

export interface ClusterCandidatePair {
  eventAId: string;
  eventBId: string;
  score: number;
  reasons: string[];
}

/** For every published event, scores it against every OTHER published event using the real duplicate
 * scorer and keeps pairs at or above `minScore`. Each unordered pair appears once (deduped by score). */
export async function findClusterCandidatePairs(minScore = 50): Promise<ClusterCandidatePair[]> {
  const events = await prisma.event.findMany({
    where: { published: true },
    select: { id: true, title: true, eventType: true, latitude: true, longitude: true, countryCode: true, region: true, conflictId: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });

  const seen = new Set<string>();
  const pairs: ClusterCandidatePair[] = [];
  for (const e of events) {
    const query: DuplicateQuery = {
      title: e.title,
      eventType: e.eventType,
      latitude: e.latitude,
      longitude: e.longitude,
      countryCode: e.countryCode,
      region: e.region,
      conflictId: e.conflictId,
      occurredAt: e.occurredAt,
      excludeEventId: e.id,
    };
    const candidates = await findDuplicateCandidates(query);
    for (const c of candidates) {
      if (c.score < minScore) continue;
      const key = [e.id, c.eventId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ eventAId: e.id, eventBId: c.eventId, score: c.score, reasons: c.reasons });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

export interface RetroactiveMergeGroup {
  /** The oldest event in the group (occurredAt-earliest) — kept as canonical; the others would merge into it. */
  canonicalEventId: string;
  memberEventIds: string[];
  pairs: ClusterCandidatePair[];
}

/** The same pairwise scoring as findClusterCandidatePairs, but filtered to exactly the criteria
 * lib/ingestion/event-match.ts uses for a live auto-merge (spec §9 "retroactive cluster dry run" — this
 * makes the dry run test the REAL rule, not a looser stand-in). Transitively-connected pairs (A merges
 * with B, B merges with C) are grouped together, canonical = earliest occurredAt in the group. */
export async function findRetroactiveMergeGroups(): Promise<RetroactiveMergeGroup[]> {
  const events = await prisma.event.findMany({
    where: { published: true },
    select: { id: true, title: true, eventType: true, latitude: true, longitude: true, countryCode: true, region: true, conflictId: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });
  const byId = new Map(events.map((e) => [e.id, e]));

  const qualifyingPairs: ClusterCandidatePair[] = [];
  for (const e of events) {
    const windowMinutes = AUTO_MERGE_WINDOW_MINUTES[e.eventType as EventType];
    if (!windowMinutes) continue;
    const query: DuplicateQuery = {
      title: e.title,
      eventType: e.eventType,
      latitude: e.latitude,
      longitude: e.longitude,
      countryCode: e.countryCode,
      region: e.region,
      conflictId: e.conflictId,
      occurredAt: e.occurredAt,
      excludeEventId: e.id,
    };
    const candidates = await findDuplicateCandidates(query);
    for (const c of candidates) {
      if (c.score < AUTO_MERGE_MIN_SCORE) continue;
      if (!c.sameEventType) continue;
      if (c.minutesApart === null || c.minutesApart > windowMinutes) continue;
      if (c.titleSimilarity < AUTO_MERGE_MIN_TITLE_SIMILARITY) continue;
      qualifyingPairs.push({ eventAId: e.id, eventBId: c.eventId, score: c.score, reasons: c.reasons });
    }
  }

  // Union-find over qualifying pairs only.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of qualifyingPairs) union(p.eventAId, p.eventBId);

  const groups = new Map<string, Set<string>>();
  for (const p of qualifyingPairs) {
    const root = find(p.eventAId);
    if (!groups.has(root)) groups.set(root, new Set());
    groups.get(root)!.add(p.eventAId);
    groups.get(root)!.add(p.eventBId);
  }

  const result: RetroactiveMergeGroup[] = [];
  for (const memberIds of groups.values()) {
    const members = [...memberIds].sort((a, b) => byId.get(a)!.occurredAt.getTime() - byId.get(b)!.occurredAt.getTime());
    const canonical = members[0]!;
    const pairsInGroup = qualifyingPairs.filter((p) => memberIds.has(p.eventAId) && memberIds.has(p.eventBId));
    result.push({ canonicalEventId: canonical, memberEventIds: members.slice(1), pairs: pairsInGroup });
  }
  return result;
}

export interface RetroactiveMergeApplyResult {
  canonicalEventId: string;
  attachedEventIds: string[];
  attachedReportCount: number;
  proposalsCreated: number;
}

/** Applies ONE already-reviewed group from findRetroactiveMergeGroups (spec §11 "apply only high-
 * confidence retroactive clustering"): every member event's own report attaches to the canonical event
 * (same mechanism as a live auto-merge or the manual Merge action — never a special case), and the member
 * event itself is unpublished (published: false, publishedAt kept) rather than deleted — its own
 * provenance, original URL and history all stay intact, it simply stops being shown as a separate public
 * incident. Never called automatically; the caller (an admin script/route) decides which groups to apply
 * after manually reviewing the sample (spec §10). */
export async function applyRetroactiveMergeGroup(group: RetroactiveMergeGroup): Promise<RetroactiveMergeApplyResult> {
  let attachedReportCount = 0;
  let proposalsCreated = 0;
  for (const memberEventId of group.memberEventIds) {
    const sources = await prisma.eventSource.findMany({ where: { eventId: memberEventId }, include: { rawIngestionItem: { include: { source: { select: { sourceRole: true } } } } } });
    for (const s of sources) {
      const relationship = isAggregatorRole(s.rawIngestionItem.source.sourceRole) ? "relay" : "corroborating";
      await linkEventSource(group.canonicalEventId, s.rawIngestionItemId, relationship, relationship !== "relay");
      if (s.rawIngestionItem.processingStatus === "published") await setProcessingStatus(s.rawIngestionItemId, "merged");
      const proposals = await proposeEventUpdatesFromReport(group.canonicalEventId, s.rawIngestionItemId);
      proposalsCreated += proposals.length;
      await propagateEntityLinksToEvent(s.rawIngestionItemId, group.canonicalEventId);
      attachedReportCount++;
    }
    await prisma.event.update({ where: { id: memberEventId }, data: { published: false } });
  }
  await alertsForEvent(group.canonicalEventId);
  return { canonicalEventId: group.canonicalEventId, attachedEventIds: group.memberEventIds, attachedReportCount, proposalsCreated };
}
