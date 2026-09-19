import type { Severity } from "@/lib/types/severity";

// Central Conflict Scoring Engine v1 — one authoritative, deterministic,
// explainable scoring system (severity/impact/confidence). Every result
// carries its own `reasons`: no unexplained number is ever returned, per
// spec §5 "Explainability". All three engines (severity.ts, impact.ts,
// confidence.ts) are pure functions of their input — no randomness, no
// DB access, no Date.now() unless explicitly passed as `now` — so the
// same input always produces the same output/reasons (spec's "explanations
// deterministic" test requirement) and the engine can run identically for
// mock data, real Prisma-backed data, or a hand-built test fixture.

export interface SeverityScoreResult {
  severityScore: number; // 0-100 integer. 100 is reserved exclusively for the active-full-scale-war hard rule.
  severityLabel: Severity; // severityScore run back through lib/utils/severity.ts's existing severityFromScore — one enum-mapping function, not a second one.
  reasons: string[];
}

export interface ImpactScoreResult {
  impactScore: number; // 0-100 integer, always relative to one country
  reasons: string[];
}

export interface ConfidenceScoreResult {
  confidenceScore: number; // 0-100 integer
  reasons: string[];
}

export type ConflictStatusLike = "active" | "dormant" | "resolved" | "archived" | null | undefined;
