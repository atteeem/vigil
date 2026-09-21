import type { EvidenceSummary } from "@/lib/sources/trust";

// Centralised briefing significance and confidence. Pure and deterministic. Neither uses article or
// report counts: confidence uses INDEPENDENCE GROUPS (an outlet counts once, relays and repeats never),
// significance uses what changed, how big it is, how widely it matters and how well it is supported.

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

export interface SignificanceInput {
  /** 0-100: how large the thing is on its own scale (severity, magnitude, closure level). */
  magnitude: number;
  /** 0-100: 100 = a real status transition, ~60 = a new development, ~40 = an update, 0 = routine. */
  stateChange: number;
  /** 0-100: geographic reach (local ... national/multi-country). */
  scope: number;
  /** 0-100: how much this kind of thing matters (territory, chokepoint, national outage...). */
  kindWeight: number;
  /** 0-1 from deriveConfidence / the source provider. */
  confidence: number;
  /** Hours since it occurred, relative to the end of the window. */
  ageHours: number;
  /** Window length in hours (recency is judged inside the window). */
  windowHours: number;
  /** true when it is new in this window (not just an update to something older). */
  novel: boolean;
}

export interface SignificanceResult {
  score: number;
  reasons: string[];
}

export function briefSignificance(i: SignificanceInput): SignificanceResult {
  const recency = clamp(100 - (i.ageHours / Math.max(1, i.windowHours)) * 40);
  const novelty = i.novel ? 100 : 40;
  const base = 0.4 * i.magnitude + 0.2 * i.stateChange + 0.2 * i.kindWeight + 0.1 * i.scope + 0.05 * novelty + 0.05 * recency;
  // Confidence scales, it never adds: a weakly supported item cannot be lifted by anything else.
  const factor = 0.6 + 0.4 * clamp(i.confidence * 100) / 100;
  const score = Math.round(clamp(base * factor));
  const reasons: string[] = [];
  reasons.push(`magnitude ${Math.round(i.magnitude)}`);
  reasons.push(i.stateChange >= 90 ? "status transition" : i.stateChange >= 55 ? "new development" : "update to an existing item");
  if (i.kindWeight >= 75) reasons.push("high-importance kind");
  if (i.scope >= 60) reasons.push("wide geographic scope");
  reasons.push(`confidence ${Math.round(i.confidence * 100)}%`);
  return { score, reasons };
}

export interface ConfidenceResult {
  score: number;
  label: "high" | "medium" | "low";
  reasons: string[];
}
export const confidenceLabel = (c: number): "high" | "medium" | "low" => (c >= 0.7 ? "high" : c >= 0.45 ? "medium" : "low");

export interface ConfidenceInput {
  evidence: EvidenceSummary;
  verificationStatus?: string | null;
  disputed?: boolean;
  conflictingClaims?: boolean;
  /** Provider-issued official measurement / operator data. */
  official?: boolean;
  /** Hours since the newest supporting report (freshness). */
  freshnessHours?: number | null;
}

export function deriveConfidence(i: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];
  const n = i.evidence.independentSources;
  let score = n === 0 ? 0.15 : n === 1 ? 0.45 : n === 2 ? 0.7 : 0.85;
  if (n === 0) reasons.push(i.evidence.partyClaims > 0 ? "no independent source; only party claims" : "no independent source");
  else reasons.push(`${n} independent source${n === 1 ? "" : "s"}`);
  if (i.evidence.strongVerification > 0) {
    score += 0.08;
    reasons.push(`${i.evidence.strongVerification} strongly verified`);
  }
  if (i.official) {
    score = Math.max(score, 0.85);
    reasons.push("official / measurement provider");
  }
  if (i.evidence.dependentRepeats > 0) reasons.push(`${i.evidence.dependentRepeats} repeat/relay report${i.evidence.dependentRepeats === 1 ? "" : "s"} not counted`);
  if (i.evidence.partyClaims > 0 && n > 0) reasons.push(`${i.evidence.partyClaims} party claim${i.evidence.partyClaims === 1 ? "" : "s"} shown separately, not counted as confirmation`);
  if (i.verificationStatus === "confirmed") score += 0.05;
  if (i.disputed || i.verificationStatus === "disputed") {
    score -= 0.2;
    reasons.push("disputed");
  }
  if (i.conflictingClaims) {
    score -= 0.15;
    reasons.push("conflicting claims");
  }
  if (i.freshnessHours != null && i.freshnessHours > 72) {
    score -= 0.05;
    reasons.push("newest report is more than 3 days old");
  }
  score = Math.max(0.05, Math.min(0.95, score));
  return { score: Math.round(score * 100) / 100, label: confidenceLabel(score), reasons };
}
