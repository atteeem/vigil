import { findDuplicateCandidates, type DuplicateQuery } from "@/lib/ingestion/duplicates";
import type { EventType } from "@/lib/types";

// Event Clustering, Corroboration & Final READY Publication v1 — root cause: publishRawItem always
// created a brand-new Event, never checking whether a strongly-matching one already existed (confirmed
// by auditing the 1,090 published events: 100% singleton). This is the SAFE auto-attach decision, used
// at publish time by lib/ingestion/publish-item.ts — deliberately much stricter than
// lib/ingestion/duplicates.ts's own MIN_SCORE=35 (that threshold is for a human reviewer's "possible
// duplicate" warning; auto-merging a report into an existing event without a person looking is a much
// higher-stakes, harder-to-undo action, so this requires real, specific, textual evidence, not just
// geographic/temporal/categorical coincidence).
//
// Real finding from the retroactive audit: two completely unrelated Kherson Oblast reports (an injury
// report and a prisoner-repatriation story) scored 86/100 on time+place+type+conflict alone, zero title
// overlap — proving those weak/medium signals are NOT sufficient by themselves for an unattended merge.
// So on top of a high combined score, this also requires the exact same event type (not just a
// compatible group) and a real, non-trivial title/fact overlap — the "same distinctive casualty/property
// description" style of evidence the milestone's own STRONG signal list asks for.

/** Per-event-type ceiling on how far apart two reports may be and still auto-merge — a tight window for
 * kinetic/instantaneous event types (a real finding from the audit: an ammunition depot can have several
 * genuinely SEPARATE explosions hours apart, which a generic 12-hour decay alone doesn't rule out), wider
 * for slower-moving situations. Event types with no entry here (including "other" — the audit's own
 * false-positive cluster, generic wire-service items with no real distinguishing signal) never auto-merge
 * at all; a human decides via the existing manual Merge action instead. */
export const AUTO_MERGE_WINDOW_MINUTES: Partial<Record<EventType, number>> = {
  // 90 min, not the original 180: the retroactive dry-run's own sample audit found a real edge case at
  // 3h — a Syrian ammunition depot fire genuinely has separate secondary explosions hours apart, and a
  // 3rd report at the site 3h after the first ("Massive explosions... weapons depot", new specific
  // language) read as plausibly a distinct follow-on explosion, not the same one re-described. 90 min
  // keeps the two reports that were unambiguously the same blast (1h apart, consistent casualty count)
  // while excluding that one.
  missile: 90, drone: 90, airstrike: 90, artillery: 90, explosion: 90,
  naval: 90, ground_clash: 90, terrorism: 90, air_defense: 90, border: 90,
  protest: 720, civil_unrest: 720,
  earthquake: 360, flood: 360, storm: 360, fire: 360,
  health: 1440, humanitarian: 1440,
};

export const AUTO_MERGE_MIN_SCORE = 80;
export const AUTO_MERGE_MIN_TITLE_SIMILARITY = 0.2;

export interface CanonicalEventMatch {
  eventId: string;
  score: number;
  reasons: string[];
}

/** Decides whether `query` (a report about to publish) should attach to an ALREADY-PUBLISHED event
 * instead of creating a new one. Reuses the existing scorer verbatim — no second heuristic — and only
 * adds the extra safety gates above. Returns null (create a new event) far more often than it returns a
 * match, by design: a missed merge just stays a singleton event; a false merge conflates two different
 * real-world incidents, which is the worse outcome. */
export async function findCanonicalEventMatch(query: DuplicateQuery): Promise<CanonicalEventMatch | null> {
  const windowMinutes = AUTO_MERGE_WINDOW_MINUTES[query.eventType as EventType];
  if (!windowMinutes) return null;
  const candidates = await findDuplicateCandidates(query);
  const best = candidates[0];
  if (!best) return null;
  if (best.score < AUTO_MERGE_MIN_SCORE) return null;
  if (!best.sameEventType) return null;
  if (best.minutesApart === null || best.minutesApart > windowMinutes) return null;
  if (best.titleSimilarity < AUTO_MERGE_MIN_TITLE_SIMILARITY) return null;
  return { eventId: best.eventId, score: best.score, reasons: best.reasons };
}
