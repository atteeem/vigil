import type { ExposureDimension, Severity } from "./severity";

export interface ImpactDriver {
  label: string;
  contribution: number; // signed points contributed to the total
  description: string;
}

export interface ImpactComponent {
  dimension: ExposureDimension;
  value: number; // 0-100
  drivers: ImpactDriver[];
  /** "computed": derived from geography/severity/hard rules. "estimated":
   * a rule-of-thumb from the conflict's tagged effects and intensity — no
   * sourced energy/trade/finance/food data feeds it yet, and the UI says so. */
  basis: "computed" | "estimated" | "insufficient";
}

export interface ImpactScore {
  countryCode: string;
  conflictId: string | null; // null = overall country exposure
  score: number; // 0-100
  change24h: number;
  components: ImpactComponent[];
  /** Decomposition of the overall score itself (distinct from each dimension's own 0-100 value). */
  overallDrivers: ImpactDriver[];
}

export interface CountryRiskScore {
  countryCode: string;
  globalStatus: number; // 0-100
  label: Severity;
  change24h: number;
}
