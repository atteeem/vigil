import type { Conflict } from "@/lib/types";
import { severityFromScore } from "@/lib/utils/severity";
import { registryEntryByMockSlug } from "@/lib/registry/conflict-registry";

/**
 * Fictionalized development data. Intensity/counts are illustrative mock
 * values for Phase 1 UI — not a live feed. See PROJECT.md.
 *
 * `severity` is NOT authored per-conflict below: it is derived from
 * `intensity` through the single centralized threshold function
 * (`severityFromScore`), so a conflict's severity label can never
 * contradict its intensity number — see TASKS.md decision log ("severity
 * vs intensity consistency").
 */
type ConflictInput = Omit<Conflict, "severity" | "fightingCountryCodes" | "participantCountryCodes" | "supporterCountryCodes">;

const MOCK_CONFLICTS_INPUT: ConflictInput[] = [
  {
    id: "c-ru-ua",
    slug: "russia-ukraine",
    name: "Russia–Ukraine War",
    shortName: "Russia–Ukraine",
    region: "Europe",
    status: "active",
    intensity: 88,
    intensityChange24h: 4,
    startedAt: "2022-02-24",
    lat: 48.5,
    lng: 37.0,
    primaryEffects: ["Security", "Trade", "Energy"],
    summary:
      "Large-scale conventional war along a shifting front line in eastern and southern Ukraine, with sustained long-range strikes on infrastructure on both sides.",
    eventCount: 63,
    lastUpdateMinutesAgo: 12,
    countryCodesInvolved: ["UA", "RU"],
  },
  {
    id: "c-il-ps",
    slug: "israel-palestine",
    name: "Israel–Palestine Conflict",
    shortName: "Israel–Palestine",
    region: "Middle East",
    status: "active",
    intensity: 81,
    intensityChange24h: -2,
    startedAt: "2023-10-07",
    lat: 31.5,
    lng: 34.47,
    primaryEffects: ["Security", "Diplomacy", "Trade"],
    summary:
      "Ongoing military operations in and around Gaza alongside intermittent escalation in the West Bank, with periodic diplomatic ceasefire efforts.",
    eventCount: 58,
    lastUpdateMinutesAgo: 24,
    countryCodesInvolved: ["IL", "PS"],
  },
  {
    id: "c-lb",
    slug: "israel-lebanon",
    name: "Israel–Lebanon Border Conflict",
    shortName: "Israel–Lebanon",
    region: "Middle East",
    status: "active",
    intensity: 72,
    intensityChange24h: 3,
    startedAt: "2023-10-08",
    lat: 33.25,
    lng: 35.5,
    primaryEffects: ["Security", "Diplomacy"],
    summary:
      "Cross-border exchanges of fire between Israeli forces and armed groups in southern Lebanon, with periodic airstrikes further north.",
    eventCount: 34,
    lastUpdateMinutesAgo: 41,
    countryCodesInvolved: ["LB", "IL"],
  },
  {
    id: "c-sy",
    slug: "syria",
    name: "Syrian Civil Conflict",
    shortName: "Syria",
    region: "Middle East",
    status: "active",
    intensity: 39,
    intensityChange24h: 1,
    startedAt: "2011-03-15",
    lat: 35.0,
    lng: 38.5,
    primaryEffects: ["Security", "Diplomacy"],
    summary:
      "Fragmented post-transition security environment with localized clashes between armed factions and sporadic external strikes.",
    eventCount: 21,
    lastUpdateMinutesAgo: 96,
    countryCodesInvolved: ["SY", "IL", "TR"],
  },
  {
    id: "c-ir-gulf",
    slug: "persian-gulf",
    name: "Iran–Persian Gulf Tensions",
    shortName: "Persian Gulf",
    region: "Middle East",
    status: "active",
    intensity: 64,
    intensityChange24h: 6,
    startedAt: "2019-05-01",
    lat: 26.5,
    lng: 52.5,
    primaryEffects: ["Energy", "Security", "Finance"],
    summary:
      "Elevated naval posturing and intermittent tanker incidents around the Strait of Hormuz amid wider regional tension involving Iran.",
    eventCount: 27,
    lastUpdateMinutesAgo: 33,
    countryCodesInvolved: ["IR", "SA", "US"],
  },
  {
    id: "c-ye-red-sea",
    slug: "red-sea",
    name: "Yemen / Red Sea Shipping Crisis",
    shortName: "Red Sea",
    region: "Middle East",
    status: "active",
    intensity: 61,
    intensityChange24h: -3,
    startedAt: "2023-11-19",
    lat: 14.5,
    lng: 42.5,
    primaryEffects: ["Trade", "Security", "Energy"],
    summary:
      "Repeated attacks on commercial shipping in the Bab-el-Mandeb corridor have pushed significant container and tanker traffic away from the Suez route.",
    eventCount: 30,
    lastUpdateMinutesAgo: 55,
    countryCodesInvolved: ["YE"],
  },
  {
    id: "c-sd",
    slug: "sudan",
    name: "Sudan Civil War",
    shortName: "Sudan",
    region: "Africa",
    status: "active",
    intensity: 91,
    intensityChange24h: 2,
    startedAt: "2023-04-15",
    lat: 15.5,
    lng: 32.5,
    primaryEffects: ["Security", "Food & Supply"],
    summary:
      "Sustained fighting between rival military factions has produced one of the world's largest displacement and food-insecurity crises.",
    eventCount: 22,
    lastUpdateMinutesAgo: 70,
    countryCodesInvolved: ["SD"],
  },
  {
    id: "c-cd",
    slug: "eastern-congo",
    name: "Eastern DR Congo Conflict",
    shortName: "DR Congo",
    region: "Africa",
    status: "active",
    intensity: 55,
    intensityChange24h: 5,
    startedAt: "2021-11-01",
    lat: -1.6,
    lng: 29.2,
    primaryEffects: ["Security", "Food & Supply"],
    summary:
      "Armed group activity in North and South Kivu continues to drive mass displacement and periodic clashes near provincial capitals.",
    eventCount: 18,
    lastUpdateMinutesAgo: 140,
    countryCodesInvolved: ["CD"],
  },
  {
    id: "c-so",
    slug: "somalia",
    name: "Somalia Insurgency",
    shortName: "Somalia",
    region: "Africa",
    status: "active",
    intensity: 43,
    intensityChange24h: 0,
    startedAt: "2006-12-01",
    lat: 4.5,
    lng: 45.5,
    primaryEffects: ["Security"],
    summary:
      "Ongoing counter-insurgency operations against al-Shabaab, with periodic attacks in Mogadishu and central regions.",
    eventCount: 14,
    lastUpdateMinutesAgo: 210,
    countryCodesInvolved: ["SO"],
  },
  {
    id: "c-sahel",
    slug: "sahel",
    name: "Sahel Insurgency",
    shortName: "Sahel",
    region: "Africa",
    status: "active",
    intensity: 52,
    intensityChange24h: 1,
    startedAt: "2012-01-16",
    lat: 16.0,
    lng: -1.0,
    primaryEffects: ["Security", "Food & Supply"],
    summary:
      "Jihadist and militia violence across Mali, Burkina Faso, and Niger continues to strain regional militaries and displace civilians.",
    eventCount: 16,
    lastUpdateMinutesAgo: 180,
    countryCodesInvolved: ["ML"],
  },
  {
    id: "c-mm",
    slug: "myanmar",
    name: "Myanmar Civil War",
    shortName: "Myanmar",
    region: "Asia",
    status: "active",
    intensity: 57,
    intensityChange24h: -1,
    startedAt: "2021-02-01",
    lat: 21.9,
    lng: 96.0,
    primaryEffects: ["Security", "Trade"],
    summary:
      "Fighting between the military government and allied resistance forces continues across multiple states and regions.",
    eventCount: 19,
    lastUpdateMinutesAgo: 160,
    countryCodesInvolved: ["MM"],
  },
  {
    id: "c-in-pk",
    slug: "india-pakistan",
    name: "India–Pakistan Border Tension",
    shortName: "India–Pakistan",
    region: "Asia",
    status: "active",
    intensity: 34,
    intensityChange24h: 2,
    startedAt: "1947-08-15",
    lat: 34.0,
    lng: 74.3,
    primaryEffects: ["Security", "Diplomacy"],
    summary:
      "Periodic exchanges along the Line of Control in Kashmir alongside cyclical diplomatic and rhetorical escalation.",
    eventCount: 9,
    lastUpdateMinutesAgo: 260,
    countryCodesInvolved: ["IN", "PK"],
  },
  {
    id: "c-korea",
    slug: "korean-peninsula",
    name: "Korean Peninsula Tension",
    shortName: "Korean Peninsula",
    region: "Asia",
    status: "active",
    intensity: 31,
    intensityChange24h: -1,
    startedAt: "1953-07-27",
    lat: 38.3,
    lng: 127.5,
    primaryEffects: ["Security", "Diplomacy"],
    summary:
      "Continued missile tests and military posturing around the demilitarized zone, alongside allied exercises in the region.",
    eventCount: 11,
    lastUpdateMinutesAgo: 300,
    countryCodesInvolved: ["KP", "KR"],
  },
  {
    id: "c-taiwan",
    slug: "taiwan-strait",
    name: "Taiwan Strait Tension",
    shortName: "Taiwan Strait",
    region: "Asia",
    status: "active",
    intensity: 48,
    intensityChange24h: 3,
    startedAt: "2022-08-02",
    lat: 24.5,
    lng: 119.5,
    primaryEffects: ["Security", "Trade", "Finance"],
    summary:
      "Increased military activity and patrols around Taiwan continue alongside close monitoring of semiconductor-linked trade routes.",
    eventCount: 15,
    lastUpdateMinutesAgo: 190,
    countryCodesInvolved: ["TW", "CN"],
  },
];

// Geography and (audited) status come from the Global Conflict Registry so the
// mock UI data, the scoring engine, admin and the database read one set of
// facts: `countryCodesInvolved` is the participant set, and only
// `fightingCountryCodes` feeds the scoring hard rules.
export const MOCK_CONFLICTS: Conflict[] = MOCK_CONFLICTS_INPUT.map((c) => {
  const registry = registryEntryByMockSlug(c.slug);
  const participants = registry?.participantCountries ?? c.countryCodesInvolved;
  return {
    ...c,
    severity: severityFromScore(c.intensity),
    status: registry?.statusAudit && registry.status ? registry.status : c.status,
    countryCodesInvolved: participants,
    participantCountryCodes: participants,
    fightingCountryCodes: registry?.fightingCountries ?? c.countryCodesInvolved,
    supporterCountryCodes: registry?.supporterCountries ?? [],
  };
});

export function getConflictBySlug(slug: string): Conflict | undefined {
  return MOCK_CONFLICTS.find((c) => c.slug === slug);
}

export function getConflictById(id: string): Conflict | undefined {
  return MOCK_CONFLICTS.find((c) => c.id === id);
}
