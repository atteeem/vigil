import type { Severity, Region } from "./severity";

export interface Conflict {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  region: Region;
  status: "active" | "reduced" | "dormant" | "ended" | "resolved";
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
  /** ISO codes of the belligerent / party countries. Being a participant does
   * NOT make a country a place where the war is fought — see fightingCountryCodes. */
  countryCodesInvolved: string[];
  /** ISO codes where fighting actually occurs (from the Global Conflict
   * Registry). The ONLY set the scoring hard rules use: same-country war = 100,
   * bordering war >= 75. */
  fightingCountryCodes: string[];
  /** Belligerent / party countries (same as countryCodesInvolved). */
  participantCountryCodes: string[];
  /** External supporters / interveners — never trigger a scoring floor. */
  supporterCountryCodes: string[];
}
