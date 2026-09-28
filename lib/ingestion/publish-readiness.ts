import type { DraftSuggestionDTO, DuplicateLikelihood } from "@/lib/types/db";
import { evidenceRoleOf, isNonIndependentRole } from "@/lib/registry/source-tiers";

// Backlog Triage & Safe Publication v1: turns a computed draft suggestion into an explicit, explainable
// triage verdict — never a decorative 0-100 score (spec §9). Two independent axes:
//   classification — WHAT the report is (conflict incident, country-level news, global/live event,
//     probable duplicate, insufficient to publish, a party/aligned claim, or none of the above);
//   publishReadiness — whether it can stand alone right now without a human decision.
// Both are deterministic functions of the existing draft suggestion + source + live duplicate signal —
// no new heuristic invented beyond what lib/ingestion/conflict-match.ts and duplicates.ts already compute.

export const CLASSIFICATIONS = ["CONFLICT_EVENT", "COUNTRY_DEVELOPMENT", "GLOBAL_LIVE_EVENT", "DUPLICATE", "INSUFFICIENT", "PARTY_CLAIM", "OTHER"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const READINESS_STATUSES = ["READY", "NEEDS_REVIEW", "BLOCKED"] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

/** Confidence below this is treated as an ambiguous/weak conflict match — real evidence exists (it's not
 * null) but not enough to auto-ready a report on it; see lib/ingestion/conflict-match.ts's own band
 * comments for what each level means. */
export const AMBIGUOUS_MATCH_CEILING = 0.6;

export interface ReadinessInput {
  draft: DraftSuggestionDTO | null;
  hasOriginalText: boolean;
  sourceMissing: boolean;
  sourceUrl: string | null;
  sourceAutoProcessing: boolean;
  source: { sourceRole?: string | null; claimPolicy?: string | null } | null;
}

export interface ReadinessResult {
  classification: Classification;
  readiness: ReadinessStatus;
  reasons: string[];
}

function isMalformedUrl(url: string | null): boolean {
  if (!url) return false; // absent is fine (manual entries); malformed is the concern
  try {
    new URL(url);
    return false;
  } catch {
    return true;
  }
}

/** Everything EXCEPT the live duplicate signal — safe to snapshot at ingestion time and persist for
 * DB-level admin-queue filtering, the same reasoning lib/ingestion/incoming-queue.ts already documents
 * for every other suggestion column. Duplicate likelihood is deliberately excluded here for the same
 * reason it's excluded from that snapshot: an event published after this item arrived can make it newly
 * duplicate something, so a stale "not a duplicate" snapshot would be actively unsafe. Combine this with
 * a freshly-computed duplicateLikelihood via applyDuplicateSignal at read/publish time. */
export function deriveReadinessSnapshot(input: ReadinessInput): ReadinessResult {
  if (input.sourceMissing || !input.sourceAutoProcessing || !input.draft) {
    return { classification: "INSUFFICIENT", readiness: "BLOCKED", reasons: ["automated processing is unavailable for this item (source missing or not configured for it)"] };
  }
  const d = input.draft;

  if (d.titleSource === "none") {
    return { classification: "INSUFFICIENT", readiness: "BLOCKED", reasons: ["no usable headline"] };
  }
  if (d.summarySource === "title_only" && !input.hasOriginalText) {
    return { classification: "INSUFFICIENT", readiness: "BLOCKED", reasons: ["no source text to summarise"] };
  }
  if (isMalformedUrl(input.sourceUrl)) {
    return { classification: "INSUFFICIENT", readiness: "BLOCKED", reasons: ["the source URL does not parse"] };
  }

  const isPartyClaim = evidenceRoleOf(input.source ?? {}) === "party_claim";
  const isNonIndependent = isNonIndependentRole(evidenceRoleOf(input.source ?? {}));

  let classification: Classification;
  if (d.conflictId) classification = "CONFLICT_EVENT";
  else if (d.countryCode) classification = "COUNTRY_DEVELOPMENT";
  else if (d.locationScope === "global") classification = "GLOBAL_LIVE_EVENT";
  else classification = "OTHER";
  if (isPartyClaim) classification = "PARTY_CLAIM"; // orthogonal to geography — a party's own claim about itself, whatever it's about

  const reasons: string[] = [];
  if (d.conflictId && d.conflictMatchConfidence < AMBIGUOUS_MATCH_CEILING) {
    reasons.push(`ambiguous conflict association (${Math.round(d.conflictMatchConfidence * 100)}% confidence: ${d.conflictMatchReasons.join("; ")})`);
    return { classification, readiness: "NEEDS_REVIEW", reasons };
  }

  if (isPartyClaim) {
    reasons.push("a party/aligned claim — needs a human decision on whether to publish as PARTY CLAIM");
    return { classification, readiness: "NEEDS_REVIEW", reasons };
  }

  if (classification === "OTHER") {
    reasons.push("no country, conflict, or global scope resolved — not enough to classify automatically");
    return { classification, readiness: "NEEDS_REVIEW", reasons };
  }

  if (isNonIndependent) reasons.push("aggregator/relay source — usable, but not independent corroboration");
  if (d.conflictId) reasons.push(`conflict match: ${Math.round(d.conflictMatchConfidence * 100)}% confidence`);
  reasons.push(`geography resolved to ${d.locationScope} scope`);
  return { classification, readiness: "READY", reasons };
}

/** Downgrades a snapshot verdict using a freshly-computed duplicate likelihood — never upgrades one, and
 * never itself queries anything (the caller already has duplicateLikelihood from lib/ingestion/duplicates.ts).
 * `hasCanonicalMatch` (Final Intelligence Consistency & Map Correctness v1): a "high" raw duplicate score
 * that ALSO clears the much stricter canonical-merge bar (lib/ingestion/event-match.ts) is safe to leave
 * READY — it will attach to the matching event automatically at publish time (lib/ingestion/publish-item.ts),
 * never create a fragmented duplicate. A "high" score that does NOT clear that bar stays exactly as
 * conservative as before: BLOCKED for a person to look at individually. */
export function applyDuplicateSignal(snapshot: ReadinessResult, duplicateLikelihood: DuplicateLikelihood, hasCanonicalMatch = false): ReadinessResult {
  if (duplicateLikelihood === "high") {
    if (hasCanonicalMatch) return snapshot;
    return { classification: "DUPLICATE", readiness: "BLOCKED", reasons: ["scores as a likely duplicate of an already-published event"] };
  }
  if (duplicateLikelihood === "medium" && snapshot.readiness === "READY") {
    return { ...snapshot, readiness: "NEEDS_REVIEW", reasons: [...snapshot.reasons, "moderate duplicate risk against an already-published event — worth a human look before publishing"] };
  }
  return snapshot;
}
