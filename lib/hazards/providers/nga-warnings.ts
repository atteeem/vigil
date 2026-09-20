import type { HazardProvider, NormalizedGlobalEvent, ProviderResult } from "../types";
import { maritimeIncidentProminence } from "../significance";

// NGA Maritime Safety Information (msi.nga.mil): US National Geospatial-Intelligence Agency broadcast
// navigation warnings (NAVAREAs IV, XII and the HYDROLANT / HYDROPAC / HYDROARC areas). US Government
// work; keyless JSON API. Coverage is those areas only — NOT the Red Sea, Gulf of Aden or Hormuz (other
// NAVAREA coordinators) — so this is one partial civil source for maritime security notices, not a
// global one. UKMTO, IMB and IMO GISIS were checked and NOT integrated: UKMTO publishes no API and its
// site sits behind an anti-bot challenge; the others need accounts.
//
// Only warnings that report maritime SECURITY events (piracy/armed robbery, hijack/seizure, attacks,
// mines) with a parseable position are kept. Naval exercises, firing/gunnery areas and other military
// activity notices are excluded on purpose, and no vessel positions are ever produced.
export const NGA_WARNINGS_URL = "https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active";
export const NGA_PAGE = "https://msi.nga.mil/";

interface NgaWarning {
  msgYear: number;
  msgNumber: number;
  navArea: string;
  subregion?: string;
  text: string;
  status: string;
  issueDate: string;
  authority?: string;
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
/** "092138Z MAY 2024" */
export function parseNgaDate(s: string): Date | null {
  const m = /(\d{2})(\d{2})(\d{2})Z\s+([A-Z]{3})\s+(\d{4})/.exec(s);
  if (!m || MONTHS[m[4]!] === undefined) return null;
  return new Date(Date.UTC(Number(m[5]), MONTHS[m[4]!]!, Number(m[1]), Number(m[2]), Number(m[3])));
}

/** First "45-07.10N 030-09.70E" position in the text (degrees-decimal minutes). */
export function parseNgaPosition(text: string): { lat: number; lng: number } | null {
  const m = /(\d{1,2})-(\d{2}(?:\.\d+)?)([NS])\s+(\d{1,3})-(\d{2}(?:\.\d+)?)([EW])/.exec(text);
  if (!m) return null;
  return { lat: (Number(m[1]) + Number(m[2]) / 60) * (m[3] === "S" ? -1 : 1), lng: (Number(m[4]) + Number(m[5]) / 60) * (m[6] === "W" ? -1 : 1) };
}

// "EXERCISE CAUTION" is ordinary warning language; only actual exercises / weapons activity is excluded.
const EXCLUDE = /(?:NAVAL|MILITARY|MULTINATIONAL|LIVE) EXERCISES?|EXERCISES? (?:AREA|BEING CONDUCTED|WILL BE)|FIRING|GUNNERY|LIVE FIRE|SHOOTING|ROCKET LAUNCH|MISSILE TEST|TORPEDO|NAVAL OPERATIONS|WARSHIP/;
const KINDS: { re: RegExp; type: "piracy" | "seizure" | "attack" | "navigation_warning"; label: string }[] = [
  { re: /PIRAT|PIRAC|ARMED ROBBERY|ARMED (?:PERSONS|MEN)/, type: "piracy", label: "Piracy / armed robbery reported" },
  { re: /HIJACK|SEIZ(?:ED|URE)|BOARDED BY/, type: "seizure", label: "Vessel seizure / hijacking reported" },
  { re: /ATTACK|HOSTILE|EXPLOSION|STRUCK BY/, type: "attack", label: "Attack / hostile act reported" },
  { re: /\bMINES?\b/, type: "navigation_warning", label: "Mines reported" },
];

export function parseNgaWarnings(json: unknown): NormalizedGlobalEvent[] {
  const list = ((json as { "broadcast-warn"?: NgaWarning[] })?.["broadcast-warn"] ?? []) as NgaWarning[];
  const out: NormalizedGlobalEvent[] = [];
  for (const w of list) {
    if (w.status !== "A" || !w.text) continue;
    const text = w.text.toUpperCase();
    if (EXCLUDE.test(text)) continue;
    const kind = KINDS.find((k) => k.re.test(text));
    const pos = parseNgaPosition(w.text);
    const issued = parseNgaDate(w.issueDate);
    if (!kind || !pos || !issued) continue;
    const area = w.text.split("\n")[0]?.replace(/\.$/, "").trim() || `NAVAREA ${w.navArea}`;
    out.push({
      origin: "official_alert",
      category: "maritime_incident",
      layer: "maritime",
      subtype: kind.type,
      status: kind.type === "navigation_warning" ? "navigation_warning" : "security_incident",
      entityKey: `nga-${w.navArea}-${w.msgNumber}-${w.msgYear}`,
      provider: "nga_warnings",
      providerEventId: `nga-${w.navArea}-${w.msgNumber}-${w.msgYear}`,
      title: `${kind.label} — ${area}`,
      description: w.text.replace(/\n/g, " ").slice(0, 500),
      severityDomain: "maritime_incident_type",
      severityValue: null,
      severityLabel: kind.type.replace("_", " "),
      prominence: maritimeIncidentProminence(kind.type),
      confidenceLabel: "Official navigation warning",
      lat: pos.lat,
      lng: pos.lng,
      locationPrecision: "approximate",
      observedAt: issued,
      providerUpdatedAt: issued,
      sourceUrl: NGA_PAGE,
      metadata: { navArea: w.navArea, subregion: w.subregion ?? null, messageNumber: w.msgNumber, messageYear: w.msgYear, authority: w.authority ?? "NGA", incidentType: kind.type, fullText: w.text.slice(0, 1200) },
    });
  }
  return out;
}

export const ngaWarnings: HazardProvider = {
  key: "nga_warnings",
  label: "NGA broadcast navigation warnings",
  defaultUrl: NGA_WARNINGS_URL,
  pollIntervalMinutes: 180,
  layer: "maritime",
  async fetch(ctx): Promise<ProviderResult> {
    return { events: parseNgaWarnings(JSON.parse(await ctx.fetchText(ctx.url))), snapshot: true };
  },
};
