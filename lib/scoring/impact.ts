import { clamp } from "@/lib/utils/format";
import { isSameCountry, isDirectlyBordering, countryDistanceKm, type AdjacencyMap, type GeoPoint } from "./geography";
import type { ConflictStatusLike, ImpactScoreResult } from "./types";

// Central Conflict Scoring Engine v1 §2 — impactScore measures relevance
// to ONE user/country, always computed against an already-known
// severityScore (from severity.ts) rather than re-deriving "how bad is
// this conflict" a second time — impact depends on severity, it doesn't
// duplicate it.
//
// Hard rules (spec, evaluated as FLOORS before any blended calculation —
// "minimum 75" is explicitly a floor, not a ceiling other factors can't
// exceed):
//   - active war inside the user's own country -> 100
//   - active war in a directly bordering country -> floor of 75
//   - the border floor applies regardless of attacker/defender — geography
//     adjacency is symmetric by construction (buildAdjacency stores both
//     directions), so this function never even sees "who attacked whom".
// "War" here is read as severityScore reaching the severe/extreme band
// (>=80) — the same banding table severity.ts itself uses — so a minor,
// low-severity border skirmish does not auto-max a neighbor's score.
const WAR_THRESHOLD = 80;
const BORDER_FLOOR = 75;

export interface ImpactScoreInput {
  severityScore: number; // 0-100, from computeSeverityScore — required, not recomputed here
  conflictStatus?: ConflictStatusLike;
  userCountryCode: string;
  /** ISO codes of every country the conflict is happening in/involves. */
  conflictCountryCodes: readonly string[];
  userCountryPoint: GeoPoint;
  conflictPoint: GeoPoint;
  sameRegion?: boolean;
  /** e.g. Conflict.primaryEffects — ["Security","Energy","Trade","Finance","Food & Supply"]. */
  primaryEffects?: readonly string[];
  /** Injectable for tests (spec "generic ... fixture, not Finland-specific production logic") — defaults to the real world dataset. */
  adjacency?: AdjacencyMap;
}

function isWarLike(status: ConflictStatusLike, severityScore: number): boolean {
  const statusEligible = status === "active" || status === null || status === undefined;
  return statusEligible && severityScore >= WAR_THRESHOLD;
}

export function computeImpactScore(input: ImpactScoreInput): ImpactScoreResult {
  const reasons: string[] = [];

  const sameCountry = input.conflictCountryCodes.some((c) => isSameCountry(c, input.userCountryCode));
  const bordering = input.conflictCountryCodes.some((c) => isDirectlyBordering(c, input.userCountryCode, input.adjacency));
  const warLike = isWarLike(input.conflictStatus, input.severityScore);

  let floor = 0;
  if (sameCountry && warLike) {
    floor = 100;
    reasons.push("Active war is happening inside your country");
  } else if (bordering && warLike) {
    floor = BORDER_FLOOR;
    reasons.push("Conflict directly borders your country");
  }

  const distanceKmValue = countryDistanceKm(input.userCountryPoint, input.conflictPoint);
  const proximity = clamp(100 - distanceKmValue / 150, 0, 100);

  let blended = input.severityScore * 0.5 + proximity * 0.3;
  if (proximity >= 40) reasons.push("Geographic proximity to the conflict");

  if (input.sameRegion) {
    blended += 15;
    reasons.push("Shared regional security environment");
  }

  const effects = new Set((input.primaryEffects ?? []).map((e) => e.toLowerCase()));
  let exposureBonus = 0;
  if (effects.has("energy")) {
    exposureBonus += 8;
    reasons.push("Energy supply exposure");
  }
  if (effects.has("trade")) {
    exposureBonus += 8;
    reasons.push("Trade/shipping exposure");
  }
  if (effects.has("security")) {
    exposureBonus += 6;
    reasons.push("Regional security relevance");
  }
  if (effects.has("food & supply") || effects.has("food")) {
    exposureBonus += 5;
    reasons.push("Food/supply chain exposure");
  }
  if (effects.has("finance")) {
    exposureBonus += 5;
    reasons.push("Sanctions/economic exposure");
  }
  blended += exposureBonus;

  if (sameCountry && !warLike) reasons.push("Conflict is inside your country");
  else if (bordering && !warLike) reasons.push("Conflict is in a bordering country");

  // Never 100 outside the explicit same-country-war hard rule, mirroring
  // severity.ts's "100 is reserved" design — kept below floor's own value
  // too so the floor is genuinely a floor, not silently overridden by clamp order.
  const blendedScore = Math.round(clamp(blended, 0, 99));
  const finalScore = Math.max(blendedScore, floor);

  if (reasons.length === 0) reasons.push("Limited geographic or economic exposure");

  return { impactScore: finalScore, reasons };
}
