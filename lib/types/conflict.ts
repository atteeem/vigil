import type { Severity, Region } from "./severity";

export interface Conflict {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  region: Region;
  status: "active" | "dormant" | "resolved";
  severity: Severity;
  intensity: number; // 0-100
  intensityChange24h: number; // signed
  startedAt: string; // ISO date
  lat: number;
  lng: number;
  primaryEffects: string[]; // e.g. ["Security", "Trade", "Energy"]
  summary: string;
  eventCount: number;
  lastUpdateMinutesAgo: number;
  /** ISO codes of the countries whose territory or armed forces are PARTY to
   * the fighting (belligerents and the country it is fought in). Not
   * suppliers, mediators or alliance members: the scoring engine's hard rules
   * treat every code here as "the war is in that country", so listing a
   * bystander would wrongly floor its impact at 100. */
  countryCodesInvolved: string[];
}
