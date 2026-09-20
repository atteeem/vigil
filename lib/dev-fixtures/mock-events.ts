import type { ConflictEvent, EventType, Severity, SourceRef, VerificationStatus } from "@/lib/types";
import { MOCK_CONFLICTS } from "./mock-conflicts";
import { OUTLET_POOL } from "./mock-sources";
import { seededRandom } from "./seed";
import { MOCK_NOW } from "./constants";
import { SEVERITY_LEVELS } from "@/lib/utils/severity";

interface LocationProfile {
  name: string;
  countryCode: string;
}

interface ConflictProfile {
  locations: LocationProfile[];
  eventTypes: EventType[];
}

const PROFILES: Record<string, ConflictProfile> = {
  "russia-ukraine": {
    locations: [
      { name: "Kharkiv Oblast", countryCode: "UA" },
      { name: "Donetsk Oblast", countryCode: "UA" },
      { name: "Zaporizhzhia", countryCode: "UA" },
      { name: "Kherson Oblast", countryCode: "UA" },
      { name: "Belgorod Oblast", countryCode: "RU" },
      { name: "Kyiv", countryCode: "UA" },
    ],
    eventTypes: ["drone", "ground", "airstrike", "diplomacy", "cyber"],
  },
  "israel-palestine": {
    locations: [
      { name: "Gaza City", countryCode: "PS" },
      { name: "Khan Younis", countryCode: "PS" },
      { name: "Rafah", countryCode: "PS" },
      { name: "West Bank", countryCode: "PS" },
      { name: "Tel Aviv", countryCode: "IL" },
    ],
    eventTypes: ["airstrike", "ground", "civil_unrest", "diplomacy", "terrorism"],
  },
  "israel-lebanon": {
    locations: [
      { name: "Southern Lebanon", countryCode: "LB" },
      { name: "Tyre District", countryCode: "LB" },
      { name: "Northern Israel", countryCode: "IL" },
    ],
    eventTypes: ["airstrike", "ground", "diplomacy"],
  },
  syria: {
    locations: [
      { name: "Damascus", countryCode: "SY" },
      { name: "Aleppo", countryCode: "SY" },
      { name: "Deir ez-Zor", countryCode: "SY" },
    ],
    eventTypes: ["ground", "airstrike", "civil_unrest", "diplomacy"],
  },
  "persian-gulf": {
    locations: [
      { name: "Strait of Hormuz", countryCode: "IR" },
      { name: "Persian Gulf shipping lane", countryCode: "IR" },
      { name: "Eastern Saudi coast", countryCode: "SA" },
    ],
    eventTypes: ["naval", "diplomacy", "sanctions", "cyber"],
  },
  "red-sea": {
    locations: [
      { name: "Bab-el-Mandeb Strait", countryCode: "YE" },
      { name: "Southern Red Sea", countryCode: "YE" },
      { name: "Gulf of Aden", countryCode: "YE" },
    ],
    eventTypes: ["naval", "drone", "sanctions"],
  },
  sudan: {
    locations: [
      { name: "Khartoum", countryCode: "SD" },
      { name: "Darfur region", countryCode: "SD" },
      { name: "Omdurman", countryCode: "SD" },
    ],
    eventTypes: ["ground", "civil_unrest", "diplomacy"],
  },
  "eastern-congo": {
    locations: [
      { name: "North Kivu", countryCode: "CD" },
      { name: "Goma", countryCode: "CD" },
      { name: "South Kivu", countryCode: "CD" },
    ],
    eventTypes: ["ground", "civil_unrest"],
  },
  somalia: {
    locations: [
      { name: "Mogadishu", countryCode: "SO" },
      { name: "Central Somalia", countryCode: "SO" },
    ],
    eventTypes: ["terrorism", "ground"],
  },
  sahel: {
    locations: [
      { name: "Northern Mali", countryCode: "ML" },
      { name: "Tri-border area", countryCode: "ML" },
    ],
    eventTypes: ["terrorism", "ground", "civil_unrest"],
  },
  myanmar: {
    locations: [
      { name: "Shan State", countryCode: "MM" },
      { name: "Rakhine State", countryCode: "MM" },
      { name: "Sagaing Region", countryCode: "MM" },
    ],
    eventTypes: ["ground", "civil_unrest", "airstrike"],
  },
  "india-pakistan": {
    locations: [
      { name: "Line of Control, Kashmir", countryCode: "IN" },
      { name: "Poonch sector", countryCode: "PK" },
    ],
    eventTypes: ["ground", "diplomacy"],
  },
  "korean-peninsula": {
    locations: [
      { name: "Demilitarized Zone", countryCode: "KP" },
      { name: "Sea of Japan / East Sea", countryCode: "KR" },
    ],
    eventTypes: ["diplomacy", "naval", "cyber"],
  },
  "taiwan-strait": {
    locations: [
      { name: "Taiwan Strait median line", countryCode: "TW" },
      { name: "Southwest ADIZ approach", countryCode: "TW" },
    ],
    eventTypes: ["naval", "diplomacy", "cyber"],
  },
};

// Partial: only covers the legacy event types PROFILES[*].eventTypes above
// actually draws from. The map-upgrade spec's fuller EventType union (see
// lib/types/severity.ts) adds categories for the icon system and future
// ingestion, but mock-data generation doesn't emit them (yet), so no
// templates are needed for them here.
const TITLE_TEMPLATES: Partial<Record<EventType, string[]>> = {
  airstrike: [
    "Airstrike reported near {loc}",
    "Series of airstrikes reported over {loc}",
  ],
  drone: [
    "Multiple drones reported near {loc}",
    "Drone activity reported over {loc}",
  ],
  ground: [
    "Ground clashes reported near {loc}",
    "Renewed fighting reported in {loc}",
  ],
  naval: [
    "Naval incident reported near {loc}",
    "Vessel activity reported near {loc}",
  ],
  terrorism: [
    "Attack reported in {loc}",
    "Security incident reported in {loc}",
  ],
  civil_unrest: [
    "Unrest reported in {loc}",
    "Clashes between armed groups reported in {loc}",
  ],
  cyber: [
    "Cyber incident reported targeting infrastructure linked to {loc}",
    "Network disruption reported affecting systems near {loc}",
  ],
  diplomacy: [
    "Diplomatic statement issued regarding {loc}",
    "Officials comment on situation in {loc}",
  ],
  sanctions: [
    "New sanctions measures announced concerning {loc}",
    "Sanctions enforcement action reported near {loc}",
  ],
  conflict: [
    "Escalation reported in {loc}",
    "Renewed activity reported in {loc}",
  ],
};

const SUMMARY_TEMPLATES: Partial<Record<EventType, string>> = {
  airstrike: "Local and regional sources describe strikes affecting the area; the scale and target of the strikes has not been independently confirmed.",
  drone: "Observers reported drone activity in the area. The origin and intended target have not been independently confirmed.",
  ground: "Sources describe an exchange of fire or renewed movement along the contact line; territorial control has not been independently confirmed to have changed.",
  naval: "A vessel-related incident was reported in the area; the vessels and parties involved have not been independently confirmed.",
  terrorism: "An attack was reported in the area. Casualty figures and the responsible party have not been independently confirmed.",
  civil_unrest: "Clashes or unrest were reported in the area, consistent with ongoing instability described by monitoring groups.",
  cyber: "A network or infrastructure disruption was reported; attribution has not been independently confirmed.",
  diplomacy: "An official or diplomatic statement was issued relating to the situation; this is reported as a claim by the issuing party.",
  sanctions: "A sanctions-related measure or enforcement action was reported, with implications for trade and financial exposure.",
  conflict: "Monitoring groups reported renewed activity; details remain preliminary.",
};

// Verification status for a single-source event: never "Multiple Sources"
// (that would contradict the source count), and never automatically
// "Confirmed" — a lone source can only be a claim, a first report, or
// genuinely unverified.
const SINGLE_SOURCE_WEIGHTS: { status: VerificationStatus; weight: number }[] = [
  { status: "reported", weight: 0.55 },
  { status: "official_claim", weight: 0.2 },
  { status: "unverified", weight: 0.25 },
];

// Verification status once 2+ independently drawn sources exist. Multiple
// sources is the default read; "Confirmed" is reserved for events with
// several corroborating sources AND is deliberately rare — per spec,
// multiple sources must never be *automatically* treated as confirmed.
const MULTI_SOURCE_WEIGHTS: { status: VerificationStatus; weight: number }[] = [
  { status: "multiple_sources", weight: 0.82 },
  { status: "confirmed", weight: 0.18 },
];

function weightedPick<T>(items: { status: T; weight: number }[], rand: () => number): T {
  const total = items.reduce((a, i) => a + i.weight, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.status;
  }
  return items[0]!.status;
}

function severityForConflict(base: Severity, rand: () => number): Severity {
  const order = SEVERITY_LEVELS;
  const idx = order.indexOf(base);
  const delta = Math.round((rand() - 0.5) * 2); // -1, 0, 1
  return order[Math.max(0, Math.min(order.length - 1, idx + delta))]!;
}

// Weighted so a lone source is the most common case, tapering off — this is
// the distribution `verificationStatus` gets derived FROM (see below), not
// the other way around, so the two can never contradict each other.
const SOURCE_COUNT_WEIGHTS = [
  { status: 1, weight: 0.45 },
  { status: 2, weight: 0.26 },
  { status: 3, weight: 0.15 },
  { status: 4, weight: 0.09 },
  { status: 5, weight: 0.05 },
];

function buildSources(count: number, rand: () => number, occurredAt: Date): SourceRef[] {
  const pool = [...OUTLET_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count).map((outlet, i) => {
    const slug = outlet.name.replace(/\s+/g, "-").toLowerCase();
    return {
      id: `src-${slug}-${i}`,
      name: outlet.name,
      sourceType: outlet.sourceType,
      // Phase 1 ships mock/development data only — there is no real article
      // behind this event. example.com is IANA-reserved for documentation
      // and demos, so this link is safe to render without pointing anyone
      // at a real (or real-looking) outlet page. The `note` makes the same
      // thing explicit in the UI wherever sources are listed.
      url: `https://example.com/vigil-dev-source/${slug}/${encodeURIComponent(occurredAt.toISOString())}`,
      publishedAt: new Date(occurredAt.getTime() + i * 5 * 60000).toISOString(),
      note: "Development data — placeholder link, not a live source.",
    };
  });
}

function generateEventsForConflict(conflictId: string, count: number): ConflictEvent[] {
  const conflict = MOCK_CONFLICTS.find((c) => c.id === conflictId)!;
  const profile = PROFILES[conflict.slug];
  if (!profile) return [];
  const rand = seededRandom(`events:${conflict.slug}`);
  const now = new Date(MOCK_NOW).getTime();
  const events: ConflictEvent[] = [];

  for (let i = 0; i < count; i++) {
    const loc = profile.locations[i % profile.locations.length]!;
    const type = profile.eventTypes[Math.floor(rand() * profile.eventTypes.length)]!;
    const templates = TITLE_TEMPLATES[type]!;
    const title = templates[i % templates.length]!.replace("{loc}", loc.name);

    // more events cluster in the recent past, tail out to 30 days
    const ageMinutes = Math.round(Math.pow(rand(), 2.1) * 30 * 24 * 60) + i;
    const occurredAt = new Date(now - ageMinutes * 60000);

    const jitterLat = (rand() - 0.5) * 2.4;
    const jitterLng = (rand() - 0.5) * 2.4;

    // Source count is the ground truth; verification status is derived FROM
    // it (never the reverse), so "Multiple Sources" and "1 source" can
    // never both appear on the same event — see TASKS.md decision log.
    const sourceCount = weightedPick(SOURCE_COUNT_WEIGHTS, rand);
    const verificationStatus =
      sourceCount === 1
        ? weightedPick(SINGLE_SOURCE_WEIGHTS, rand)
        : weightedPick(MULTI_SOURCE_WEIGHTS, rand);
    const disputed = rand() < 0.08;
    const severity = severityForConflict(conflict.severity, rand);
    const sources = buildSources(sourceCount, rand, occurredAt);

    events.push({
      id: `evt-${conflict.slug}-${i}`,
      slug: `${conflict.slug}-${i}`,
      title,
      summary: SUMMARY_TEMPLATES[type]!,
      eventType: type,
      lat: conflict.lat + jitterLat,
      lng: conflict.lng + jitterLng,
      countryCode: loc.countryCode,
      region: conflict.region,
      conflictId: conflict.id,
      occurredAt: occurredAt.toISOString(),
      severity,
      importance: Math.round(40 + rand() * 60),
      verificationStatus,
      disputed,
      sourceCount,
      sources,
      timeline: [
        {
          label: "First report",
          time: occurredAt.toISOString(),
          description: `Initial ${verificationStatus === "unverified" ? "unverified report" : "report"} of the incident near ${loc.name}.`,
        },
        ...(sources.length > 1
          ? [
              {
                label: "Independent corroboration",
                time: new Date(occurredAt.getTime() + 5 * 60000).toISOString(),
                description: "A second, independent source published a related account.",
              },
            ]
          : []),
        ...(verificationStatus === "official_claim" || verificationStatus === "confirmed"
          ? [
              {
                label: "Official statement",
                time: new Date(occurredAt.getTime() + 11 * 60000).toISOString(),
                description: "An official or regional authority issued a statement on the incident.",
              },
            ]
          : []),
      ],
    });
  }

  return events.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

export const MOCK_EVENTS: ConflictEvent[] = MOCK_CONFLICTS.flatMap((c) =>
  generateEventsForConflict(c.id, Math.max(8, Math.min(12, Math.round(c.eventCount / 5)))),
).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

export function getEventBySlug(slug: string): ConflictEvent | undefined {
  return MOCK_EVENTS.find((e) => e.slug === slug);
}

export function getEventsForConflict(conflictId: string): ConflictEvent[] {
  return MOCK_EVENTS.filter((e) => e.conflictId === conflictId);
}

export function getRecentEvents(limit = 20): ConflictEvent[] {
  return MOCK_EVENTS.slice(0, limit);
}
