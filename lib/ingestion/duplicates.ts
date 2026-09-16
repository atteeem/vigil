import { prisma } from "@/lib/db/client";
import type { DuplicateCandidateDTO } from "@/lib/types/db";

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

const STOPWORDS = new Set([
  "the", "a", "an", "in", "on", "at", "of", "to", "for", "and", "or", "near", "over", "reported",
  "report", "reports", "amid", "after", "as", "with", "by", "is", "are", "was", "were",
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
      query.latitude !== null && query.longitude !== null
        ? distanceKm(query.latitude, query.longitude, event.latitude, event.longitude)
        : null;
    const minutesApart = Math.abs(query.occurredAt.getTime() - event.occurredAt.getTime()) / 60_000;
    const sameEventType = query.eventType === event.eventType;
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
    const typeScore = sameEventType ? WEIGHTS.eventType : 0;
    const regionScore = sameRegionOrCountry ? WEIGHTS.region : 0;
    const conflictScore = sameConflict ? WEIGHTS.conflict : 0;
    const titleScore = simTitle * WEIGHTS.title;

    const score = Math.round(distanceScore + timeScore + typeScore + regionScore + conflictScore + titleScore);
    if (score < MIN_SCORE) continue;

    candidates.push({
      eventId: event.id,
      slug: event.slug,
      title: event.title,
      score: Math.min(100, score),
      distanceKm: dKm === null ? null : Math.round(dKm * 10) / 10,
      minutesApart: Math.round(minutesApart),
      sameEventType,
      sameConflict,
      sameRegionOrCountry,
      titleSimilarity: Math.round(simTitle * 100) / 100,
    });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}
