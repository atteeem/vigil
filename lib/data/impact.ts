import type {
  Conflict,
  Country,
  ExposureDimension,
  ImpactComponent,
  ImpactDriver,
  ImpactScore,
} from "@/lib/types";
import { distanceKm } from "@/lib/utils/geo";
import { clamp } from "@/lib/utils/format";
import { computeSeverityScore, effectiveSeverityLabel } from "@/lib/scoring/severity";
import { computeImpactScore } from "@/lib/scoring/impact";
import { aggregateExposure, combineDamped } from "@/lib/scoring/exposure";
import type { ImpactScoreResult } from "@/lib/scoring/types";

// Country impact/exposure. Everything here is a deterministic function of the
// country, the conflict's own fields and the Central Conflict Scoring Engine —
// no random jitter, no shuffled boilerplate "drivers". Where a dimension has
// no sourced data behind it yet (energy, trade, finance, food), the value is a
// rule-of-thumb estimate from the conflict's tagged effects and intensity and
// is labelled `basis: "estimated"` so the UI never presents it as measured.


const DIMENSIONS: ExposureDimension[] = ["security", "energy", "trade", "finance", "food_supply"];

const DIMENSION_LABEL: Record<ExposureDimension, string> = {
  security: "Security",
  energy: "Energy",
  trade: "Trade",
  finance: "Finance",
  food_supply: "Food & Supply",
};

export { DIMENSION_LABEL };

/** Only security is built from geography/severity/hard rules; the rest are
 * tag-and-intensity estimates until real supply-chain/market data feeds them. */
/** The conflict-effect tag that gives a non-security dimension any evidence at all. Without it the
 * dimension has no input and reads "insufficient data" rather than a filler number. */
const DIMENSION_TAG: Partial<Record<ExposureDimension, string>> = { energy: "Energy", trade: "Trade", finance: "Finance", food_supply: "Food & Supply" };

const DIMENSION_BASIS: Record<ExposureDimension, ImpactComponent["basis"]> = {
  security: "computed",
  energy: "estimated",
  trade: "estimated",
  finance: "estimated",
  food_supply: "estimated",
};

interface Term {
  label: string;
  description: string;
  points: number;
}

/** Turns a dimension's own formula terms into drivers that sum to the value —
 * the explanation is the calculation, not narrative filler. */
function driversFromTerms(terms: Term[], value: number): ImpactDriver[] {
  const active = terms.filter((t) => t.points > 0);
  const total = active.reduce((a, t) => a + t.points, 0);
  const drivers = active
    .sort((a, b) => b.points - a.points)
    .map((t) => ({
      label: t.label,
      description: t.description,
      contribution: total > 0 ? Math.round((t.points / total) * value) : 0,
    }));
  const assigned = drivers.reduce((a, d) => a + d.contribution, 0);
  if (assigned !== value && drivers.length > 0) drivers[0]!.contribution += value - assigned;
  return drivers;
}

export interface ConflictImpactDetail extends ImpactScore {
  hardFloor: ImpactScoreResult["hardFloor"];
}

const isScored = (c: Conflict) => c.status !== "ended" && c.status !== "resolved";

export function computeImpact(country: Country, conflict: Conflict): ConflictImpactDetail {
  // A conflict with no known location contributes no proximity (never a distance to 0,0).
  const dist = conflict.locationKnown === false ? Number.POSITIVE_INFINITY : distanceKm(country, conflict);
  const proximity = clamp(100 - dist / 120, 0, 100);
  const sameRegion = country.region === conflict.region;
  const involved = conflict.participantCountryCodes.includes(country.code);
  const effects = new Set(conflict.primaryEffects);

  const severity = computeSeverityScore({
    severityLabel: effectiveSeverityLabel(conflict.severity, conflict.fullScaleWar, conflict.status),
    status: conflict.status,
    intensity: conflict.intensity,
    escalationTrend: conflict.intensityChange24h,
  });
  const centralized = computeImpactScore({
    severityScore: severity.severityScore,
    conflictStatus: conflict.status,
    userCountryCode: country.code,
    // Where the fighting actually is — participants and supporters never floor the score.
    conflictCountryCodes: conflict.fightingCountryCodes,
    userCountryPoint: country,
    conflictPoint: conflict,
    sameRegion,
    primaryEffects: conflict.primaryEffects,
  });
  const score = centralized.impactScore;

  const securityTerms: Term[] = [
    { label: "Proximity", description: "Geographic distance to the conflict.", points: 0.5 * proximity },
    { label: "Shared region", description: "The conflict is in your country's own region.", points: sameRegion ? 16 : 0 },
    { label: "Country involved", description: "Your country is named as involved in the conflict.", points: involved ? 22 : 0 },
    { label: "Conflict intensity", description: "Current intensity of the conflict.", points: conflict.intensity * 0.14 },
  ];
  let security = securityTerms.reduce((a, t) => a + t.points, 0);
  // Hard rules apply to the security dimension too: an own-country war is a
  // 100 security exposure, a bordering war at least 75 (attacker/defender
  // direction is irrelevant).
  const securityFloor = centralized.hardFloor === "own_country_war" ? 100 : centralized.hardFloor === "bordering_war" ? 75 : 0;
  if (securityFloor > security) {
    securityTerms.push({
      label: centralized.hardFloor === "own_country_war" ? "Active war inside your country" : "Active war in a bordering country",
      description: centralized.reasons.join("; "),
      points: securityFloor - security,
    });
    security = securityFloor;
  }

  const energyTerms: Term[] = [
    { label: "Energy supply exposure", description: "The conflict is tagged as affecting energy supply.", points: effects.has("Energy") ? 38 : 0 },
    { label: "Proximity", description: "Geographic distance to the conflict.", points: proximity * 0.22 },
    { label: "Conflict intensity", description: "Current intensity of the conflict.", points: conflict.intensity * 0.24 },
  ];
  const tradeTerms: Term[] = [
    { label: "Trade/shipping exposure", description: "The conflict is tagged as affecting trade.", points: effects.has("Trade") ? 34 : 0 },
    { label: "Proximity", description: "Geographic distance to the conflict.", points: proximity * 0.28 },
    { label: "Shared region", description: "The conflict is in your country's own region.", points: sameRegion ? 10 : 0 },
    { label: "Conflict intensity", description: "Current intensity of the conflict.", points: conflict.intensity * 0.14 },
  ];
  const financeTerms: Term[] = [
    { label: "Conflict intensity", description: "Current intensity of the conflict.", points: conflict.intensity * 0.34 },
    { label: "Sanctions/economic exposure", description: "The conflict is tagged as affecting finance.", points: effects.has("Finance") ? 14 : 0 },
  ];
  const foodTerms: Term[] = [
    { label: "Food/supply chain exposure", description: "The conflict is tagged as affecting food and supply.", points: effects.has("Food & Supply") ? 34 : 0 },
    { label: "Proximity", description: "Geographic distance to the conflict.", points: proximity * 0.14 },
    { label: "Shared region", description: "The conflict is in your country's own region.", points: sameRegion ? 9 : 0 },
    { label: "Conflict intensity", description: "Current intensity of the conflict.", points: conflict.intensity * 0.09 },
  ];

  const sum = (terms: Term[]) => clamp(terms.reduce((a, t) => a + t.points, 0), 0, 100);
  const raw: Record<ExposureDimension, { value: number; terms: Term[] }> = {
    security: { value: clamp(security, 0, 100), terms: securityTerms },
    energy: { value: sum(energyTerms), terms: energyTerms },
    trade: { value: sum(tradeTerms), terms: tradeTerms },
    finance: { value: sum(financeTerms), terms: financeTerms },
    food_supply: { value: sum(foodTerms), terms: foodTerms },
  };

  const components: ImpactComponent[] = DIMENSIONS.map((dimension) => {
    const tag = DIMENSION_TAG[dimension];
    // No tagged effect on this dimension: no evidence, so no number (never a proximity-only filler).
    if (tag && !effects.has(tag)) return { dimension, value: 0, basis: "insufficient" as const, drivers: [] };
    const value = Math.round(raw[dimension].value);
    return { dimension, value, basis: DIMENSION_BASIS[dimension], drivers: driversFromTerms(raw[dimension].terms, value) };
  });

  const overallDrivers: ImpactDriver[] = [];
  if (centralized.reasons.length > 0) {
    overallDrivers.push({ label: "Centralized scoring engine", description: centralized.reasons.join("; "), contribution: score });
  }

  return {
    countryCode: country.code,
    conflictId: conflict.id,
    score,
    // The conflict's own reported 24h intensity change, scaled — never random.
    change24h: Math.round(conflict.intensityChange24h * 0.55 * 10) / 10,
    components,
    overallDrivers,
    hardFloor: centralized.hardFloor,
  };
}

/** Country exposure over the given (real, DB-backed) conflicts. Ended conflicts add nothing. */
export function computeCountryExposure(country: Country, conflicts: readonly Conflict[]): ImpactScore {
  const perConflict = conflicts.filter(isScored).map((c) => ({ conflict: c, impact: computeImpact(country, c) }));

  // Headline: the explainable aggregate (lib/scoring/exposure.ts) over the
  // per-conflict centralized impact scores — never an average of dimensions.
  const aggregate = aggregateExposure(
    perConflict.map(({ conflict, impact }) => ({
      conflictId: conflict.id,
      conflictName: conflict.shortName,
      impactScore: impact.score,
      hardFloor: impact.hardFloor,
    })),
  );

  // Each dimension card combines the conflicts' own dimension values with the
  // same damped rule (top conflict leads), so a 100-security own-country war
  // shows Security 100 rather than being averaged away.
  const components: ImpactComponent[] = DIMENSIONS.map((dimension) => {
    const rows = perConflict
      .map(({ conflict, impact }) => ({ conflict, value: impact.components.find((c) => c.dimension === dimension)?.value ?? 0, basis: impact.components.find((c) => c.dimension === dimension)?.basis }))
      .sort((a, b) => b.value - a.value);
    const value = combineDamped(rows.map((r) => r.value));
    const lead = rows[0]?.conflict;
    // A dimension with no evidence from any scored conflict is "insufficient", not a low number.
    if (DIMENSION_TAG[dimension] && !rows.some((r) => r.basis !== "insufficient")) return { dimension, value: 0, basis: "insufficient" as const, drivers: [] };
    return {
      dimension,
      value,
      basis: DIMENSION_BASIS[dimension],
      drivers: [
        {
          label: lead ? lead.shortName : "Leading conflict",
          description: `Largest single contributor to your ${DIMENSION_LABEL[dimension].toLowerCase()} exposure.`,
          contribution: Math.min(value, rows[0]?.value ?? 0),
        },
        {
          label: "Other active conflicts",
          description: "Combined smaller contributions from other monitored conflicts.",
          contribution: Math.max(0, value - (rows[0]?.value ?? 0)),
        },
      ],
    };
  });

  const overallDrivers: ImpactDriver[] = [
    ...aggregate.reasons.map((r) => ({ label: "Aggregation", description: r, contribution: 0 })),
    ...aggregate.contributions.slice(0, 5).map((c) => ({
      label: c.conflictName,
      description: `Impact ${c.impactScore} for your country.`,
      contribution: c.contribution,
    })),
  ];

  const lead = perConflict.find((p) => p.conflict.id === aggregate.leadConflictId);
  return {
    countryCode: country.code,
    conflictId: null,
    score: aggregate.score,
    // The leading conflict's own change — an average across conflicts would
    // itself dilute the direction of the one that matters.
    change24h: lead?.impact.change24h ?? 0,
    components,
    overallDrivers,
  };
}

export function getTopConflictsForCountry(country: Country, conflicts: readonly Conflict[], limit = 5) {
  return conflicts.filter(isScored).map((conflict) => ({
    conflict,
    impact: computeImpact(country, conflict),
  }))
    .sort((a, b) => b.impact.score - a.impact.score)
    .slice(0, limit);
}

