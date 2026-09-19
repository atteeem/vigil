import type {
  Conflict,
  Country,
  ExposureDimension,
  ImpactComponent,
  ImpactDriver,
  ImpactScore,
} from "@/lib/types";
import { distanceKm } from "@/lib/utils/geo";
import { seededRandom } from "@/lib/utils/seed";
import { clamp } from "@/lib/utils/format";
import { computeSeverityScore } from "@/lib/scoring/severity";
import { computeImpactScore } from "@/lib/scoring/impact";
import { MOCK_CONFLICTS, getConflictById } from "./mock-conflicts";

const DIMENSION_WEIGHTS: Record<ExposureDimension, number> = {
  security: 0.23,
  energy: 0.18,
  trade: 0.18,
  finance: 0.13,
  food_supply: 0.13,
};
const DISTANCE_WEIGHT = 0.15;

type DriverTemplate = { label: string; description: string };

const DRIVER_TEMPLATES: Record<ExposureDimension, DriverTemplate[]> = {
  security: [
    { label: "Shared regional security environment", description: "The conflict sits within your country's own region." },
    { label: "Alliance & defense-pact implications", description: "Collective-defense commitments connect this conflict to your country's security posture." },
    { label: "Military posture & mobilization", description: "Visible mobilization or force posture changes near the conflict zone." },
    { label: "Border or maritime proximity", description: "Physical proximity to active front lines or contested waters." },
    { label: "Displacement & spillover risk", description: "Refugee flows or cross-border incidents linked to the conflict." },
  ],
  energy: [
    { label: "Shared energy supplier exposure", description: "Your country's energy mix includes supply routed through this region." },
    { label: "Chokepoint / shipping-lane risk", description: "The conflict sits near a strait or corridor energy shipments pass through." },
    { label: "Benchmark price volatility", description: "The conflict is a recognized driver of recent benchmark energy price swings." },
    { label: "Regional grid interconnection", description: "Shared or adjacent power infrastructure with the conflict region." },
  ],
  trade: [
    { label: "Regional trade disruption", description: "Trade corridors serving your country run through or near the conflict zone." },
    { label: "Shipping-route rerouting", description: "Vessels are being rerouted around the conflict area, adding time and cost." },
    { label: "Key trading-partner exposure", description: "One or more of your country's major trading partners are directly involved." },
    { label: "Supply-chain concentration", description: "Manufacturing or component supply chains pass through the affected region." },
  ],
  finance: [
    { label: "Market spillover", description: "Broad market risk sentiment has moved in response to this conflict." },
    { label: "Currency & rate sensitivity", description: "Regional currency or bond markets have shown measurable sensitivity." },
    { label: "Sanctions & capital-flow effects", description: "Sanctions regimes tied to this conflict affect capital flows your country is exposed to." },
    { label: "Investor risk repricing", description: "Institutional exposure to the region has prompted portfolio repositioning." },
  ],
  food_supply: [
    { label: "Grain & staple export exposure", description: "The conflict region is a significant exporter of grain or staple crops your country imports." },
    { label: "Fertilizer & input supply", description: "Agricultural input supply chains pass through the affected region." },
    { label: "Regional food-price pressure", description: "Local food price indices in your region have moved in tandem with the conflict." },
    { label: "Logistics & storage disruption", description: "Port or logistics disruption is affecting food shipment timelines." },
  ],
};

function pickDrivers(
  dimension: ExposureDimension,
  value: number,
  rand: () => number,
): ImpactDriver[] {
  const pool = [...DRIVER_TEMPLATES[dimension]];
  // deterministic shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const chosen = pool.slice(0, 3);
  const shares = [0.46, 0.3, 0.24];
  let assigned = 0;
  const drivers: ImpactDriver[] = chosen.map((t, i) => {
    const contribution = Math.max(1, Math.round(value * shares[i]! * 0.82));
    assigned += contribution;
    return { label: t.label, description: t.description, contribution };
  });
  const other = Math.max(0, value - assigned);
  drivers.push({
    label: "Other factors",
    description: "Smaller, distributed contributing signals.",
    contribution: other,
  });
  return drivers;
}

export function computeImpact(country: Country, conflict: Conflict): ImpactScore {
  const rand = seededRandom(`${country.code}:${conflict.id}`);
  const jitter = (spread: number) => (rand() * 2 - 1) * spread;

  const dist = distanceKm(country, conflict);
  const proximity = clamp(100 - dist / 120, 0, 100);
  const sameRegion = country.region === conflict.region;
  const involved = conflict.countryCodesInvolved.includes(country.code);
  const effects = new Set(conflict.primaryEffects);

  const security = clamp(
    0.5 * proximity +
      (sameRegion ? 16 : 0) +
      (involved ? 22 : 0) +
      conflict.intensity * 0.14 +
      jitter(6),
    0,
    100,
  );
  const energy = clamp(
    (effects.has("Energy") ? 38 : 8) +
      proximity * 0.22 +
      conflict.intensity * 0.24 +
      jitter(7),
    0,
    100,
  );
  const trade = clamp(
    (effects.has("Trade") ? 34 : 8) +
      proximity * 0.28 +
      (sameRegion ? 10 : 0) +
      conflict.intensity * 0.14 +
      jitter(7),
    0,
    100,
  );
  const finance = clamp(
    14 + conflict.intensity * 0.34 + (effects.has("Finance") ? 14 : 0) + jitter(9),
    0,
    100,
  );
  const foodSupply = clamp(
    (effects.has("Food & Supply") ? 34 : 7) +
      proximity * 0.14 +
      (sameRegion ? 9 : 0) +
      conflict.intensity * 0.09 +
      jitter(6),
    0,
    100,
  );

  const values: Record<ExposureDimension, number> = {
    security: Math.round(security),
    energy: Math.round(energy),
    trade: Math.round(trade),
    finance: Math.round(finance),
    food_supply: Math.round(foodSupply),
  };

  const components: ImpactComponent[] = (
    Object.keys(values) as ExposureDimension[]
  ).map((dimension) => ({
    dimension,
    value: values[dimension],
    drivers: pickDrivers(dimension, values[dimension], seededRandom(`${country.code}:${conflict.id}:${dimension}`)),
  }));

  // Headline score: the Central Conflict Scoring Engine, not this file's
  // own weighted-jitter formula — this is what makes the hard rules
  // (same-country war = 100, bordering war >= 75, regardless of
  // attacker/defender) actually hold for the homepage's "Most Relevant To
  // You" card and the /country, /for-you pages that share this function.
  // The dimension-level values above remain this file's own decorative
  // sub-breakdown (used for the driver cards' flavor text), unaffected.
  const severity = computeSeverityScore({
    severityLabel: conflict.severity,
    status: conflict.status,
    intensity: conflict.intensity,
    escalationTrend: conflict.intensityChange24h,
  });
  const centralized = computeImpactScore({
    severityScore: severity.severityScore,
    conflictStatus: conflict.status,
    userCountryCode: country.code,
    conflictCountryCodes: conflict.countryCodesInvolved,
    userCountryPoint: country,
    conflictPoint: conflict,
    sameRegion,
    primaryEffects: conflict.primaryEffects,
  });
  const score = centralized.impactScore;

  const overallDrivers: ImpactDriver[] = (
    Object.keys(values) as ExposureDimension[]
  ).map((dim) => ({
    label: DIMENSION_LABEL[dim],
    description: `Contribution from ${DIMENSION_LABEL[dim].toLowerCase()} exposure.`,
    contribution: Math.round(values[dim] * DIMENSION_WEIGHTS[dim]),
  }));
  overallDrivers.push({
    label: "Distance",
    description: "Geographic proximity to the conflict.",
    contribution: Math.round(proximity * DISTANCE_WEIGHT),
  });
  const assignedTotal = overallDrivers.reduce((a, d) => a + d.contribution, 0);
  overallDrivers.push({
    label: "Other",
    description: "Smaller, distributed contributing signals.",
    contribution: Math.max(0, score - assignedTotal),
  });
  if (centralized.reasons.length > 0) {
    overallDrivers.unshift({
      label: "Centralized scoring engine",
      description: centralized.reasons.join("; "),
      contribution: 0,
    });
  }

  const change24h =
    Math.round((conflict.intensityChange24h * 0.55 + jitter(1.4)) * 10) / 10;

  return {
    countryCode: country.code,
    conflictId: conflict.id,
    score,
    change24h,
    components,
    overallDrivers,
  };
}

const DIMENSION_LABEL: Record<ExposureDimension, string> = {
  security: "Security",
  energy: "Energy",
  trade: "Trade",
  finance: "Finance",
  food_supply: "Food & Supply",
};

export { DIMENSION_LABEL };

export function computeCountryExposure(country: Country): ImpactScore {
  const perConflict = MOCK_CONFLICTS.map((c) => computeImpact(country, c));
  const dims: ExposureDimension[] = ["security", "energy", "trade", "finance", "food_supply"];

  // Overall country exposure = highest-weighted blend of top contributing conflicts per dimension.
  const components: ImpactComponent[] = dims.map((dimension) => {
    const sorted = [...perConflict].sort(
      (a, b) =>
        (b.components.find((c) => c.dimension === dimension)?.value ?? 0) -
        (a.components.find((c) => c.dimension === dimension)?.value ?? 0),
    );
    const top = sorted.slice(0, 4);
    const value = Math.round(
      top.reduce(
        (acc, s, i) =>
          acc +
          (s.components.find((c) => c.dimension === dimension)?.value ?? 0) *
            [0.4, 0.28, 0.19, 0.13][i]!,
        0,
      ),
    );
    const topConflict = getConflictById(sorted[0]!.conflictId!);
    return {
      dimension,
      value: clampInt(value),
      drivers: [
        {
          label: topConflict ? topConflict.shortName : "Leading conflict",
          description: `Largest single contributor to your ${DIMENSION_LABEL[dimension].toLowerCase()} exposure.`,
          contribution: Math.round(value * 0.55),
        },
        {
          label: "Other active conflicts",
          description: "Combined smaller contributions from other monitored conflicts.",
          contribution: Math.max(0, value - Math.round(value * 0.55)),
        },
      ],
    };
  });

  const score = clampInt(
    Math.round(
      components.reduce((acc, c) => acc + c.value * DIMENSION_WEIGHTS[c.dimension], 0) /
        (1 - DISTANCE_WEIGHT),
    ),
  );

  const change24h =
    Math.round(
      (perConflict.reduce((acc, s) => acc + s.change24h, 0) / perConflict.length) * 10,
    ) / 10;

  const overallDrivers: ImpactDriver[] = components.map((c) => ({
    label: DIMENSION_LABEL[c.dimension],
    description: `Contribution from ${DIMENSION_LABEL[c.dimension].toLowerCase()} exposure.`,
    contribution: Math.round(c.value * DIMENSION_WEIGHTS[c.dimension]),
  }));
  const assigned = overallDrivers.reduce((a, d) => a + d.contribution, 0);
  overallDrivers.push({
    label: "Other",
    description: "Smaller, distributed contributing signals across all monitored conflicts.",
    contribution: Math.max(0, score - assigned),
  });

  return {
    countryCode: country.code,
    conflictId: null,
    score,
    change24h,
    components,
    overallDrivers,
  };
}

export function getTopConflictsForCountry(country: Country, limit = 5) {
  return MOCK_CONFLICTS.map((conflict) => ({
    conflict,
    impact: computeImpact(country, conflict),
  }))
    .sort((a, b) => b.impact.score - a.impact.score)
    .slice(0, limit);
}

function clampInt(n: number): number {
  return Math.round(clamp(n, 0, 100));
}
