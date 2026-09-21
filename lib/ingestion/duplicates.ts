import { prisma } from "@/lib/db/client";
import type { DuplicateCandidateDTO } from "@/lib/types/db";
import type { EventType } from "@/lib/types";

/** Great-circle distance in km (haversine). */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Generic newswire/headline filler that would otherwise inflate title
// similarity between two genuinely unrelated reports (spec "generic
// headline false-positive protection" — e.g. two different "Breaking
// news: ..." headlines about unrelated events must not score highly on
// title overlap alone just because they share wire-service boilerplate).
const STOPWORDS = new Set([
  "the", "a", "an", "in", "on", "at", "of", "to", "for", "and", "or", "near", "over", "reported",
  "report", "reports", "amid", "after", "as", "with", "by", "is", "are", "was", "were",
  "breaking", "news", "update", "updates", "latest", "live", "watch", "video", "says", "say",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity (0-1) between two titles' significant words — a
 * lightweight, dependency-free stand-in for real text similarity, good
 * enough to catch "Drone strike hits Kharkiv" vs "Drone attack reported
 * near Kharkiv" scoring meaningfully higher than an unrelated headline. */
export function titleSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// Event-type compatibility groups (spec "event-type compatibility",
// Stage 3 "incompatible event types should reduce or eliminate a
// match") — a coarser signal than exact equality. Two DIFFERENT exact
// types in the same group (e.g. "airstrike" and "explosion" — an
// airstrike very plausibly produces an explosion someone else reports
// independently) get partial credit; two types in DIFFERENT groups
// (e.g. "earthquake" and "explosion") are treated as actively
// incompatible and penalized, not just left at zero, so a same-place/
// same-time pairing of clearly unrelated event kinds doesn't still
// clear the threshold on distance+time alone.
const EVENT_TYPE_GROUPS: Record<string, EventType[]> = {
  kinetic: [
    "airstrike", "drone", "missile", "explosion", "artillery", "ground",
    "ground_clash", "naval", "air_defense", "terrorism", "border",
  ],
  civil: ["protest", "civil_unrest"],
  natural_disaster: ["earthquake", "flood", "storm", "fire"],
  health_humanitarian: ["health", "humanitarian"],
  policy_other: ["cyber", "diplomacy", "sanctions", "infrastructure", "conflict", "security", "other"],
};

function groupOf(eventType: string): string | null {
  for (const [group, types] of Object.entries(EVENT_TYPE_GROUPS)) {
    if ((types as string[]).includes(eventType)) return group;
  }
  return null;
}

export interface DuplicateQuery {
  title: string;
  eventType: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string | null;
  region: string | null;
  conflictId: string | null;
  occurredAt: Date;
  /** Exclude this event id (e.g. when re-scoring for an item already merged into one). */
  excludeEventId?: string;
}

const WEIGHTS = { distance: 30, time: 20, eventType: 15, region: 10, conflict: 10, title: 15 };
// A same-group-but-different-type pairing gets half the full eventType
// weight; a cross-group pairing loses a comparable amount instead of
// just scoring zero for that component.
const SAME_GROUP_CREDIT = WEIGHTS.eventType / 2;
const INCOMPATIBLE_GROUP_PENALTY = WEIGHTS.eventType + WEIGHTS.distance / 3; // 25
const CANDIDATE_WINDOW_DAYS = 14;
const MIN_SCORE = 35;
const MAX_CANDIDATES = 5;

/** Scores every recently-published event against a candidate report and
 * returns the top matches (score >= MIN_SCORE) ranked descending. Never
 * merges anything itself — spec §2 "Do NOT automatically merge." */
export async function findDuplicateCandidates(query: DuplicateQuery): Promise<DuplicateCandidateDTO[]> {
  const windowStart = new Date(query.occurredAt.getTime() - CANDIDATE_WINDOW_DAYS * 86_400_000);
  const windowEnd = new Date(query.occurredAt.getTime() + CANDIDATE_WINDOW_DAYS * 86_400_000);

  const events = await prisma.event.findMany({
    where: {
      published: true,
      occurredAt: { gte: windowStart, lte: windowEnd },
      ...(query.excludeEventId ? { id: { not: query.excludeEventId } } : {}),
    },
  });

  const candidates: DuplicateCandidateDTO[] = [];

  for (const event of events) {
    const dKm =
      query.latitude !== null && query.longitude !== null && event.latitude !== null && event.longitude !== null
        ? distanceKm(query.latitude, query.longitude, event.latitude, event.longitude)
        : null;
    const minutesApart = Math.abs(query.occurredAt.getTime() - event.occurredAt.getTime()) / 60_000;
    const sameEventType = query.eventType === event.eventType;
    const queryGroup = groupOf(query.eventType);
    const eventGroup = groupOf(event.eventType);
    const sameGroup = queryGroup !== null && queryGroup === eventGroup;
    const eventTypeCompatible = sameEventType || sameGroup;
    const sameConflict = Boolean(query.conflictId) && query.conflictId === event.conflictId;
    const sameRegionOrCountry =
      (Boolean(query.countryCode) && query.countryCode === event.countryCode) ||
      (Boolean(query.region) && query.region === event.region);
    const simTitle = titleSimilarity(query.title, event.title);

    // Distance/time components decay smoothly to 0 rather than gating
    // hard, so e.g. a very close report 20 minutes apart at a somewhat
    // different type still surfaces as a lower-ranked possible duplicate
    // instead of vanishing entirely.
    const distanceScore = dKm === null ? 0 : Math.max(0, 1 - dKm / 25) * WEIGHTS.distance;
    const timeScore = Math.max(0, 1 - minutesApart / (12 * 60)) * WEIGHTS.time;
    const typeScore = sameEventType ? WEIGHTS.eventType : sameGroup ? SAME_GROUP_CREDIT : -INCOMPATIBLE_GROUP_PENALTY;
    const regionScore = sameRegionOrCountry ? WEIGHTS.region : 0;
    const conflictScore = sameConflict ? WEIGHTS.conflict : 0;
    const titleScore = simTitle * WEIGHTS.title;

    // Geographic proximity is spec's first-listed signal, and it has to
    // actually gate the result, not just be one more additive component —
    // otherwise an identical/near-identical headline (e.g. two outlets'
    // wire copy) with a matching event type and similar time-of-day can
    // clear MIN_SCORE from title+type+time alone even on opposite sides
    // of the planet, with zero geographic corroboration at all. If
    // nothing here places the two reports anywhere near each other —
    // not close distance, not the same region/country, not the same
    // conflict — apply a real penalty rather than leaving distance at a
    // mere 0 contribution.
    const hasGeographicSignal = (dKm !== null && dKm <= 500) || sameRegionOrCountry || sameConflict;
    const noGeographicSignalPenalty = hasGeographicSignal ? 0 : WEIGHTS.distance;

    const score = Math.round(
      distanceScore + timeScore + typeScore + regionScore + conflictScore + titleScore - noGeographicSignalPenalty,
    );
    const clampedScore = Math.max(0, Math.min(100, score));
    if (clampedScore < MIN_SCORE) continue;

    const reasons: string[] = [];
    if (dKm !== null) reasons.push(dKm < 1 ? `${Math.round(dKm * 1000)} m away` : `${Math.round(dKm * 10) / 10} km away`);
    reasons.push(minutesApart < 60 ? `${Math.round(minutesApart)} min apart` : `${Math.round(minutesApart / 60)} h apart`);
    if (sameEventType) reasons.push("same event type");
    else if (sameGroup) reasons.push("related event type");
    else if (queryGroup !== null && eventGroup !== null) reasons.push("incompatible event type");
    if (sameConflict) reasons.push("same conflict");
    if (sameRegionOrCountry) reasons.push("same region/country");
    if (simTitle > 0.2) reasons.push(`${Math.round(simTitle * 100)}% title overlap`);

    candidates.push({
      eventId: event.id,
      slug: event.slug,
      title: event.title,
      eventType: event.eventType,
      region: event.region,
      countryCode: event.countryCode,
      occurredAt: event.occurredAt.toISOString(),
      score: clampedScore,
      distanceKm: dKm === null ? null : Math.round(dKm * 10) / 10,
      minutesApart: Math.round(minutesApart),
      sameEventType,
      eventTypeCompatible,
      sameConflict,
      sameRegionOrCountry,
      titleSimilarity: Math.round(simTitle * 100) / 100,
      reasons,
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}
