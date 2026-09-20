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
  /** ISO date; null when the registry has no start date. */
  startedAt: string | null;
  /** Representative point. When the conflict has no stored point this falls back to
   * the centroid of a fighting country, and `locationKnown` is false only if even that is missing. */
  lat: number;
  lng: number;
  locationKnown: boolean;
  primaryEffects: string[]; // e.g. ["Security", "Trade", "Energy"]
  summary: string;
  /** Real count of published events attributed to this conflict. */
  eventCount: number;
  /** Time of the conflict's most recent published event (ISO), or null when it has none. */
  lastEventAt: string | null;
  /** When the conflict record itself was last changed (ISO). */
  updatedAt: string;
  /** Registry fact: active full-scale war (state armies engaged at scale). */
  fullScaleWar: boolean;
  /** established | uncertain | disputed — how sure we are this is an active armed conflict. */
  classificationConfidence: string;
  familySlug: string | null;
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
