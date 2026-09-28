import type { Severity } from "@/lib/types/severity";
import { severityFromScore } from "@/lib/utils/severity";
import { clamp } from "@/lib/utils/format";
import type { ConflictStatusLike, SeverityScoreResult } from "./types";
import type { Conflict } from "@/lib/types";

// Midpoint of each label's own band in severityFromScore's thresholds
// (stable <30, guarded <50, elevated <70, high <80, severe <90, extreme
// <100) — see computeSeverityScore's own comment for why this, not a
// linear rank scale, is required for round-tripping correctly.
const SEVERITY_ANCHOR: Record<Severity, number> = {
  stable: 15,
  guarded: 35,
  elevated: 55,
  high: 72,
  severe: 82,
  extreme: 92,
};

// Central Conflict Scoring Engine v1 §1 — severityScore measures the
// conflict/event ITSELF, independent of any user/country (spec). Every
// field below is OPTIONAL except `severityLabel` (the one signal every
// Conflict and Event row already always has) so this single function
// scores both a whole Conflict (status/intensity/spreadKm/eventCount all
// present) and a single Event (only severityLabel/importance present) —
// one engine, not two.
//
// Deliberately excludes report/article/source count entirely (spec "report
// count must NOT directly raise severity") — `eventCount` below is the
// number of distinct INCIDENTS feeding a conflict (a real "sustained
// fighting" signal), never the number of articles/sources reporting the
// same incident (that's corroboration, confidence.ts's concern only).
export interface SeverityScoreInput {
  /** The existing admin/extraction-assigned severity enum — always present, the anchor signal. */
  severityLabel: Severity;
  /** Conflict.status. Omit for a standalone Event (no status field) — the full-scale-war hard rule still applies to an event whose own severityLabel is "extreme", since a single event tagged extreme is by definition describing something happening now. */
  status?: ConflictStatusLike;
  /** Conflict.intensity, 0-100 (existing admin field), if available. */
  intensity?: number | null;
  /** Event.importance, 0-100, if available. */
  importance?: number | null;
  /** Geographic spread (km) of the conflict's own contributing events — "geographic spread" input. */
  spreadKm?: number | null;
  /** Count of distinct incidents/events (NOT reports) — "sustained fighting" input. */
  eventCount?: number | null;
  casualtiesKilled?: number | null;
  casualtiesInjured?: number | null;
  /** Presence of infrastructure-damage signal (e.g. an "infrastructure" eventType, or a non-empty infrastructureDamage list). */
  infrastructureDamage?: boolean;
  /** Presence of displacement signal (e.g. a "humanitarian" eventType or explicit displacement report). */
  displacement?: boolean;
  /** Signed escalation trend — e.g. Conflict.intensityChange24h. */
  escalationTrend?: number | null;
}

/** The severity label a conflict is SCORED with. A registry-flagged active
 * full-scale war is scored as "extreme" (=> severityScore 100, the deepest heat
 * band) whatever label its intensity happened to map to. */
export function effectiveSeverityLabel(label: Severity, fullScaleWar: boolean | null | undefined, status: string | null | undefined): Severity {
  return fullScaleWar && status === "active" ? "extreme" : label;
}

/** Active full-scale war is the ONLY way to reach 100 — a hard ceiling
 * everywhere else in this function, per spec's own banding table treating
 * 100 as its own distinct band, separate from "80-99 severe". This keeps
 * "100 = deepest red on the heatmap" meaningful: it can never be hit by
 * accumulating enough lesser signals, only by this one explicit trigger. */
function isActiveFullScaleWar(input: SeverityScoreInput): boolean {
  const statusEligible = input.status === "active" || input.status === null || input.status === undefined;
  return statusEligible && input.severityLabel === "extreme";
}

export function computeSeverityScore(input: SeverityScoreInput): SeverityScoreResult {
  if (isActiveFullScaleWar(input)) {
    const reasons = ["Full-scale active war"];
    if ((input.eventCount ?? 0) >= 5 && (input.spreadKm ?? 0) >= 50) {
      reasons.push("Sustained multi-region fighting");
    } else if ((input.eventCount ?? 0) >= 5) {
      reasons.push("Sustained fighting across many incidents");
    }
    if ((input.casualtiesKilled ?? 0) > 0 || (input.casualtiesInjured ?? 0) > 0) {
      reasons.push("Confirmed casualties");
    }
    return { severityScore: 100, severityLabel: "extreme", reasons };
  }

  const reasons: string[] = [];

  // Anchor: the existing severity enum, mapped to the MIDPOINT of its own
  // band in severityFromScore's thresholds (lib/utils/severity.ts) — not a
  // naive rank/5*100 linear scale, which would put "guarded" (rank 1) at
  // 20, BELOW severityFromScore's own >=30 threshold for "guarded" and
  // round-trip to the wrong label with zero other signals present. Using
  // each band's own midpoint means a label with no additional structured
  // signals always maps back to itself; bonuses below can still push the
  // score into a higher band when real signals justify it.
  let score = SEVERITY_ANCHOR[input.severityLabel];
  reasons.push(`Assessed severity: ${input.severityLabel}`);

  if (input.eventCount != null && input.eventCount >= 3) {
    const bonus = clamp((input.eventCount - 2) * 2, 0, 12);
    score += bonus;
    reasons.push("Sustained fighting across multiple incidents");
  }

  if (input.spreadKm != null && input.spreadKm >= 50) {
    const bonus = clamp(input.spreadKm / 40, 0, 10);
    score += bonus;
    reasons.push("Geographic spread across multiple locations");
  }

  const killed = input.casualtiesKilled ?? 0;
  const injured = input.casualtiesInjured ?? 0;
  if (killed > 0 || injured > 0) {
    const bonus = clamp(killed * 1.5 + injured * 0.5, 0, 15);
    score += bonus;
    reasons.push("Reported casualties");
  }

  if (input.infrastructureDamage) {
    score += 6;
    reasons.push("Infrastructure damage reported");
  }

  if (input.displacement) {
    score += 6;
    reasons.push("Displacement reported");
  }

  if (input.escalationTrend != null && input.escalationTrend > 0) {
    const bonus = clamp(input.escalationTrend * 0.4, 0, 8);
    score += bonus;
    reasons.push("Escalating trend");
  } else if (input.escalationTrend != null && input.escalationTrend < 0) {
    score += clamp(input.escalationTrend * 0.4, -8, 0);
    reasons.push("De-escalating trend");
  }

  if (input.importance != null && input.importance >= 70) {
    score += clamp((input.importance - 70) * 0.2, 0, 6);
    reasons.push("High-importance event signal");
  }

  // Duration/status: a dormant or resolved conflict's historical peak
  // shouldn't still render as "currently this bad" — the one place status
  // reduces rather than adds (spec input "duration/status").
  if (input.status === "dormant") {
    score *= 0.7;
    reasons.push("Conflict is currently dormant");
  } else if (input.status === "reduced") {
    score *= 0.85;
    reasons.push("Conflict is at reduced intensity");
  } else if (input.status === "resolved" || input.status === "archived" || input.status === "ended") {
    score *= 0.4;
    reasons.push("Conflict has been resolved");
  }

  // Never 100 here — 100 is reserved exclusively for the hard rule above.
  const finalScore = Math.round(clamp(score, 0, 99));
  return { severityScore: finalScore, severityLabel: severityFromScore(finalScore), reasons };
}

/** The canonical Severity SCORE for a public `Conflict` object — the same number every public surface's
 * Severity display must agree with (Final Intelligence Consistency & Map Correctness v1 §8: a page must
 * never show this number's canonical label next to the legacy raw `intensity` field as though they were
 * two competing 0-100 conflict-danger scores). Pure and dependency-free (no DB access), so it is safe to
 * call from a client component that already has a `Conflict` object in hand, not just from server code —
 * moved here (out of lib/world/command-center.ts, which pulls in server-only DB modules) for exactly that
 * reason; command-center.ts re-exports it unchanged for its own existing callers. */
export function conflictSeverityScore(c: Conflict): number {
  return computeSeverityScore({
    severityLabel: effectiveSeverityLabel(c.severity, c.fullScaleWar, c.status),
    status: c.status as ConflictStatusLike,
    intensity: c.intensity,
    eventCount: c.eventCount,
    escalationTrend: c.intensityChange24h,
  }).severityScore;
}
