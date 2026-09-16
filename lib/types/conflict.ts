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
  countryCodesInvolved: string[];
}
