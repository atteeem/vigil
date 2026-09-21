// Global Intelligence Briefings: shared vocabulary. A brief summarises DEVELOPMENTS (meaningful state
// changes between T0 and T1) read from Vigil's canonical state; it never summarises articles.

export const BRIEF_WINDOWS = ["1h", "6h", "12h", "24h", "3d", "7d", "custom"] as const;
export type BriefWindow = (typeof BRIEF_WINDOWS)[number];
export const DEFAULT_WINDOW: BriefWindow = "6h";
export const WINDOW_MS: Record<Exclude<BriefWindow, "custom">, number> = { "1h": 3_600_000, "6h": 21_600_000, "12h": 43_200_000, "24h": 86_400_000, "3d": 259_200_000, "7d": 604_800_000 };
export const WINDOW_LABEL: Record<BriefWindow, string> = { "1h": "Last hour", "6h": "Last 6 hours", "12h": "Last 12 hours", "24h": "Last 24 hours", "3d": "Last 3 days", "7d": "Last 7 days", custom: "Custom range" };
export const MAX_CUSTOM_WINDOW_MS = 30 * 86_400_000;

export interface BriefRange {
  window: BriefWindow;
  from: Date;
  to: Date;
  /** true when `to` is "now" (a live brief) rather than a fixed historical moment. */
  live: boolean;
}

export const DEVELOPMENT_TYPES = [
  "conflict_event",
  "event_update",
  "conflict_status",
  "actor_involvement",
  "escalation",
  "de_escalation",
  "territory_changed",
  "territory_under_review",
  "territory_conflicting",
  "party_claim",
  "airport",
  "airspace",
  "chokepoint",
  "port",
  "maritime",
  "energy",
  "internet",
  "earthquake",
  "weather",
  "volcano",
  "wildfire",
] as const;
export type DevelopmentType = (typeof DEVELOPMENT_TYPES)[number];

export type DevelopmentDomain = "conflict" | "territory" | "actor" | "infrastructure" | "hazard";

export const DOMAIN_OF: Record<DevelopmentType, DevelopmentDomain> = {
  conflict_event: "conflict",
  event_update: "conflict",
  conflict_status: "conflict",
  actor_involvement: "actor",
  escalation: "conflict",
  de_escalation: "conflict",
  territory_changed: "territory",
  territory_under_review: "territory",
  territory_conflicting: "territory",
  party_claim: "conflict",
  airport: "infrastructure",
  airspace: "infrastructure",
  chokepoint: "infrastructure",
  port: "infrastructure",
  maritime: "infrastructure",
  energy: "infrastructure",
  internet: "infrastructure",
  earthquake: "hazard",
  weather: "hazard",
  volcano: "hazard",
  wildfire: "hazard",
};

export const BRIEF_SECTIONS = ["escalation", "resolution", "territory", "infrastructure", "hazards", "claims", "conflict"] as const;
export type BriefSection = (typeof BRIEF_SECTIONS)[number];
export const SECTION_TITLE: Record<BriefSection, string> = {
  conflict: "Conflict developments",
  escalation: "Escalation",
  resolution: "De-escalation / resolution",
  territory: "Territorial changes",
  infrastructure: "Infrastructure / transport",
  hazards: "Natural hazards",
  claims: "Party claims",
};

export interface BriefSourceRef {
  name: string;
  url: string | null;
  /** How the source counts: independent report, party claim, official/measurement provider, discovery lead. */
  role: "independent" | "party_claim" | "provider" | "discovery" | "repeat";
  trustLabel: string | null;
}

export interface BriefEvidence {
  independentSources: number;
  partyClaims: number;
  discoveryLeads: number;
  dependentRepeats: number;
  /** Provider-issued measurement/alert (USGS, operator...) — official, not counted as news corroboration. */
  official: boolean;
  text: string;
}

export interface BriefMapTarget {
  layers: string[];
  hazardId?: string;
  eventId?: string;
  eventSlug?: string;
  territory?: boolean;
  lat?: number;
  lng?: number;
  zoom?: number;
  /** ISO time to move the timeline to (historical view of the moment). */
  at?: string;
}

export interface BriefDevelopment {
  id: string;
  developmentType: DevelopmentType;
  domain: DevelopmentDomain;
  section: BriefSection;
  /** When the thing occurred / changed. */
  occurredAt: string;
  /** When Vigil first knew (published / first seen / reviewed). */
  firstKnownAt: string;
  lastUpdatedAt: string;
  title: string;
  /** Concise, template-generated, grounded in stored facts. */
  summary: string;
  previousState: string | null;
  currentState: string | null;
  isResolution: boolean;
  significance: number;
  significanceReasons: string[];
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  confidenceReasons: string[];
  /** Selected-country impact (0-100) when a country scope was requested. */
  impact: number | null;
  countryCode: string | null;
  geography: { lat: number | null; lng: number | null; place: string | null; countryCode: string | null };
  conflictSlug: string | null;
  conflictName: string | null;
  actors: string[];
  independentSourceCount: number;
  partyClaimCount: number;
  conflictingClaims: { actor: string; text: string }[] | null;
  sources: BriefSourceRef[];
  evidence: BriefEvidence;
  /** Why it is in the brief. */
  reasons: string[];
  deepLink: string;
  mapTarget: BriefMapTarget | null;
  /** (type, key) pairs a watch could match: the same vocabulary as the alert service. */
  watchKeys: { type: string; key: string }[];
  isPartyClaim: boolean;
}

export interface BriefExclusion {
  id: string;
  developmentType: DevelopmentType | "unreviewed_territorial_lead";
  title: string;
  reason: string;
  significance: number | null;
}

export type Trend = "escalating" | "stable" | "de-escalating" | "uncertain";
export interface EscalationSignal {
  name: string;
  /** Signed contribution to the score (positive = escalation). */
  delta: number;
  detail: string;
}
export interface EscalationAssessment {
  conflictSlug: string;
  conflictName: string;
  trend: Trend;
  /** Signed, -100..100. */
  score: number;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  signals: EscalationSignal[];
  reasons: string[];
  metrics: { windowEvents: number; baselineEvents: number; windowSevere: number; baselineSevereRate: number; newCells: number; windowHours: number };
}

export interface HotspotAssessment {
  key: string;
  label: string;
  conflictSlug: string | null;
  countryCode: string | null;
  /** 0-100 change magnitude relative to the area's own baseline. */
  score: number;
  /** "Emerging activity" | "Increased conflict activity" | "Rapid escalation" — never "emerging war". */
  label2: "Emerging activity" | "Increased conflict activity" | "Rapid escalation";
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
  reasons: string[];
  metrics: { windowEvents: number; expectedEvents: number; baselineEvents: number; windowMeanSeverity: number | null; baselineMeanSeverity: number | null; newCells: number; territorialClaims: number; infrastructureEvents: number; newActors: number };
  deepLink: string;
  lat: number | null;
  lng: number | null;
}

export interface BriefCounts {
  developments: number;
  escalationSignals: number;
  territorialChanges: number;
  infrastructureDisruptions: number;
  hazards: number;
  hotspots: number;
  partyClaimsHidden: number;
}

export type BriefScope = { kind: "global" } | { kind: "country"; country: string } | { kind: "conflict"; conflict: string } | { kind: "watchlist"; watcherId: string };

export interface Brief {
  scopeKey: string;
  scope: BriefScope;
  window: BriefWindow;
  from: string;
  to: string;
  live: boolean;
  generatedAt: string;
  revision: string;
  headline: string;
  counts: BriefCounts;
  /** Compact ranked highlights (ids into `developments`). */
  top: string[];
  developments: BriefDevelopment[];
  escalation: EscalationAssessment[];
  hotspots: HotspotAssessment[];
  /** Conflict brief: overall assessment line. */
  assessment: { conflictSlug: string; trend: Trend; text: string; reasons: string[] } | null;
  includePartyClaims: boolean;
  country: { code: string; name: string } | null;
  meta: { cached: boolean; computeMs: number; excluded: number };
}

export const MIN_SIGNIFICANCE = 50;
