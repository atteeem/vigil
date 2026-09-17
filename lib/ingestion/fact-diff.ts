import type { ExtractedFactDTO, ExtractedFactField } from "@/lib/types/db";

// Shared by the pre-merge candidate-match preview (app/api/admin/incoming/
// [id]/facts/route.ts) and the post-merge update-proposal generator
// (lib/db/repositories/event-updates.ts) — both need to pick one
// representative value out of a field's possibly-multiple ExtractedFact
// rows, and both need to decide whether two values are "actually
// different" with the same tolerances. One shared module keeps both
// comparisons consistent instead of drifting apart.

// ~50m — ignores float-formatting noise between two independently
// computed coordinates, not a real distance tolerance.
export const LATLNG_EPSILON_DEGREES = 0.0005;

// 5 minutes — ignores clock-precision/formatting noise between two
// reports' timestamps for what is genuinely the same occurrence, without
// swallowing a real correction (e.g. "actually happened yesterday, not
// this morning").
export const OCCURRED_AT_TOLERANCE_MS = 5 * 60_000;

/** The single fact a field should contribute when it can have multiple
 * simultaneous rows: an admin's own decision (accepted/edited) wins over
 * a raw suggestion, and among undecided suggestions the highest-
 * confidence one wins. Never picks a rejected fact. Returns the whole
 * fact (not just its value) so callers can also read confidence/source/
 * observedAt for provenance. */
export function pickEffectiveFact(facts: ExtractedFactDTO[], field: ExtractedFactField): ExtractedFactDTO | null {
  const candidates = facts.filter((f) => f.field === field && f.status !== "rejected");
  if (candidates.length === 0) return null;
  const decided = candidates.find((f) => f.status === "accepted" || f.status === "edited");
  if (decided) return decided;
  return candidates.reduce((best, f) => (f.confidence > best.confidence ? f : best), candidates[0]!);
}

/** Whether `proposed` counts as a real difference from `current` for this
 * field — null `current` always counts as a difference (nothing to match
 * against yet). Lat/lng and occurredAt get tolerance bands instead of
 * exact equality; everything else is a plain string compare. */
export function valuesDiffer(field: ExtractedFactField, current: string | null, proposed: string): boolean {
  if (current === null) return true;
  if (field === "latitude" || field === "longitude") {
    return Math.abs(Number(proposed) - Number(current)) > LATLNG_EPSILON_DEGREES;
  }
  if (field === "occurredAt") {
    return Math.abs(new Date(proposed).getTime() - new Date(current).getTime()) > OCCURRED_AT_TOLERANCE_MS;
  }
  return proposed !== current;
}
