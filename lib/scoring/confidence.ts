import { clamp } from "@/lib/utils/format";
import type { ConfidenceScoreResult } from "./types";

// Central Conflict Scoring Engine v1 §4 — confidenceScore measures
// EVIDENCE QUALITY, never severity. Built from the same descriptive
// signals lib/data/corroboration.ts already derives (independent source
// count, source categories, freshness) WITHOUT changing that module —
// corroboration.ts stays a pure, non-scored description; this is the one
// place that new "collapse it to a number" happens, additive rather than
// duplicative. Multiple sources raise confidence here, and ONLY here —
// severity.ts never reads source/report count at all.
export interface ConfidenceScoreInput {
  independentSourceCount: number;
  /** e.g. EventCorroborationDTO.sourceCategories — distinct source types/roles. */
  sourceCategories: string[];
  /** ISO timestamp of the most recent corroborating report, if any. */
  latestCorroborationAt?: string | null;
  /** Reference "now" — injectable so freshness scoring is deterministic in tests, never Date.now() implicitly. */
  now?: string;
  /** Average extraction confidence (0-1) across this item's extracted facts, if available. */
  extractionConfidence?: number | null;
  /** True when independently extracted facts disagree on the same field (e.g. two different casualty counts) — see ExtractedFact's "multiple simultaneous values" model. */
  conflictingReports?: boolean;
}

const OFFICIAL_CATEGORY_MATCH = /official/i;

export function computeConfidenceScore(input: ConfidenceScoreInput): ConfidenceScoreResult {
  const reasons: string[] = [];
  let score = 30; // baseline: a single unconfirmed report

  if (input.independentSourceCount >= 2) {
    const bonus = clamp((input.independentSourceCount - 1) * 10, 0, 30);
    score += bonus;
    reasons.push(input.independentSourceCount >= 3 ? "Multiple independent sources" : "A second independent source");
  }

  const hasOfficial = input.sourceCategories.some((c) => OFFICIAL_CATEGORY_MATCH.test(c));
  if (hasOfficial) {
    score += 15;
    reasons.push("Official-source confirmation");
  }

  const distinctCategories = new Set(input.sourceCategories).size;
  if (distinctCategories >= 2) {
    score += clamp((distinctCategories - 1) * 5, 0, 15);
    reasons.push("Source diversity across categories");
  }

  if (input.latestCorroborationAt) {
    const now = input.now ? new Date(input.now).getTime() : Date.now();
    const ageHours = Math.max(0, (now - new Date(input.latestCorroborationAt).getTime()) / 3_600_000);
    if (ageHours <= 24) {
      score += 10;
      reasons.push("Recent corroboration");
    } else if (ageHours > 24 * 14) {
      score -= 10;
      reasons.push("Corroboration is stale");
    }
  }

  if (input.extractionConfidence != null) {
    score += clamp((input.extractionConfidence - 0.5) * 20, -10, 10);
  }

  if (input.conflictingReports) {
    score -= 20;
    reasons.push("Conflicting reports on key facts");
  }

  if (reasons.length === 0) {
    reasons.push("Single unconfirmed report");
  }

  return { confidenceScore: Math.round(clamp(score, 0, 100)), reasons };
}
