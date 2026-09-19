import type { HardFloor } from "./types";

// Country-level exposure aggregation — how per-conflict impact scores roll up
// into ONE headline number for a country ("Global Exposure").
//
// The bug this replaces: the headline used to be a weighted AVERAGE of five
// dimension blends, so a country with an active full-scale war inside its own
// borders (Ukraine, impact 100) showed 65 because energy/trade/finance/food
// dragged the mean down. An existential local war must never be diluted by
// unrelated dimensions or unrelated conflicts.
//
// Model (explainable, deterministic, monotone):
//   1. Hard floors win outright: an active war inside the country -> 100;
//      an active war in a directly bordering country -> at least 75.
//      (Both are already reflected in that conflict's own impactScore by
//      computeImpactScore; here they are enforced again on the aggregate so
//      no later combination step can pull them down.)
//   2. Otherwise the LEADING conflict sets the base: the highest single
//      impactScore.
//   3. Every other conflict can only ADD, with geometrically decaying weight
//      (0.5, 0.25, ...) and only into the headroom left above the base, so
//      several moderate conflicts read worse than one, the total never
//      exceeds 99 without an own-country war, and adding a conflict can
//      never lower the score. Report/event counts play no part at all.

export const BORDER_WAR_EXPOSURE_FLOOR = 75;
const SECONDARY_HEADROOM_SHARE = 0.5;
const SECONDARY_DECAY = 0.5;

export interface ExposureConflictInput {
  conflictId: string;
  conflictName: string;
  impactScore: number;
  hardFloor?: HardFloor;
}

export interface ExposureContribution {
  conflictId: string;
  conflictName: string;
  impactScore: number;
  /** Points this conflict contributes to the headline (the lead's is its own score). */
  contribution: number;
}

export interface ExposureResult {
  score: number;
  floor: HardFloor;
  leadConflictId: string | null;
  contributions: ExposureContribution[];
  reasons: string[];
}

/** Damped combination of a list of 0-100 values: max first, then decaying
 * additions into the remaining headroom. Used for the headline (over
 * conflict impacts) and for each dimension card (over conflict-level
 * dimension values). Monotone: adding a value never lowers the result. */
export function combineDamped(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  const base = sorted[0]!;
  if (base >= 100) return 100;
  let weighted = 0;
  let weight = SECONDARY_DECAY;
  for (let i = 1; i < sorted.length; i++) {
    weighted += weight * (sorted[i]! / 100);
    weight *= SECONDARY_DECAY;
  }
  return Math.min(99, Math.round(base + (100 - base) * SECONDARY_HEADROOM_SHARE * weighted));
}

export function aggregateExposure(inputs: readonly ExposureConflictInput[]): ExposureResult {
  if (inputs.length === 0) return { score: 0, floor: null, leadConflictId: null, contributions: [], reasons: ["No monitored conflicts"] };

  const sorted = [...inputs].sort((a, b) => b.impactScore - a.impactScore || a.conflictName.localeCompare(b.conflictName));
  const lead = sorted[0]!;
  const reasons: string[] = [];

  const own = sorted.find((c) => c.hardFloor === "own_country_war");
  const bordering = sorted.filter((c) => c.hardFloor === "bordering_war");
  let floor: HardFloor = null;
  let floorValue = 0;
  if (own) {
    floor = "own_country_war";
    floorValue = 100;
    reasons.push(`Active war inside your country (${own.conflictName}) sets exposure to 100`);
  } else if (bordering.length > 0) {
    floor = "bordering_war";
    floorValue = BORDER_WAR_EXPOSURE_FLOOR;
    reasons.push(`Active war in a directly bordering country (${bordering[0]!.conflictName}) sets a minimum exposure of ${BORDER_WAR_EXPOSURE_FLOOR}`);
  }

  const combined = combineDamped(sorted.map((c) => c.impactScore));
  const score = Math.max(combined, floorValue);
  reasons.push(`Leading conflict: ${lead.conflictName} (impact ${lead.impactScore})`);
  if (sorted.length > 1) reasons.push("Other conflicts add a small, decaying amount — they can never lower the score");

  // Contribution breakdown: lead gets its own score, the rest share whatever the aggregate added.
  const added = Math.max(0, score - lead.impactScore);
  const others = sorted.slice(1);
  const otherWeightTotal = others.reduce((sum, c, i) => sum + SECONDARY_DECAY ** (i + 1) * (c.impactScore / 100), 0);
  const contributions: ExposureContribution[] = [
    { conflictId: lead.conflictId, conflictName: lead.conflictName, impactScore: lead.impactScore, contribution: Math.min(score, lead.impactScore) },
    ...others.map((c, i) => ({
      conflictId: c.conflictId,
      conflictName: c.conflictName,
      impactScore: c.impactScore,
      contribution: otherWeightTotal > 0 ? Math.round((added * (SECONDARY_DECAY ** (i + 1) * (c.impactScore / 100))) / otherWeightTotal) : 0,
    })),
  ];

  return { score, floor, leadConflictId: lead.conflictId, contributions, reasons };
}
