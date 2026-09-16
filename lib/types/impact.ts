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
