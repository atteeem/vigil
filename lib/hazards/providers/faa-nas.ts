import type { HazardProvider, NormalizedGlobalEvent, ProviderResult } from "../types";
import { airportProminence } from "../significance";
import { findAirport } from "../reference";

// FAA National Airspace System Status (nasstatus.faa.gov): the FAA public airport status XML —
// ground stops, ground delay programs, general delays and airport closures. US Government work; keyless;
// refreshed every few minutes. Coverage: US airports (plus a few Canadian/Caribbean ones the FAA manages
// flow for). It is NOT a global feed. The XML has no coordinates: airports are located through the
// OurAirports reference. An airport absent from the feed is simply not reported disrupted by the FAA; a
// drop in flights is never read as a closure.
export const FAA_NAS_URL = "https://nasstatus.faa.gov/api/airport-status-information";
export const FAA_NAS_PAGE = "https://nasstatus.faa.gov/";

const tag = (block: string, name: string) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1]?.trim() ?? null;
const blocks = (xml: string, name: string) => xml.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`, "gi")) ?? [];

/** "Sep 19 at 00:15 UTC." relative to the report year. */
function parseFaaTime(text: string | null, ref: Date): Date | null {
  const m = /([A-Z][a-z]{2})\s+(\d{1,2})\s+at\s+(\d{2}):(\d{2})/.exec(text ?? "");
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]} ${ref.getUTCFullYear()} ${m[3]}:${m[4]}:00 UTC`);
  if (Number.isNaN(d.getTime())) return null;
  // A "Jan" reopening reported in December belongs to next year.
  if (d.getTime() - ref.getTime() < -200 * 86_400_000) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

const RANK: Record<string, number> = { unknown: 0, normal: 1, disrupted: 2, partially_closed: 3, closed: 4 };

interface Acc {
  status: string;
  reasons: string[];
  kinds: Set<string>;
  start: Date | null;
  reopen: Date | null;
  detail: Record<string, unknown>;
}

export function parseFaaNas(xml: string): { events: NormalizedGlobalEvent[]; updated: Date } {
  const updated = new Date((tag(xml, "Update_Time") ?? "").replace(" GMT", " UTC"));
  const ref = Number.isNaN(updated.getTime()) ? new Date() : updated;
  const byAirport = new Map<string, Acc>();
  const note = (arpt: string, status: string, kind: string, reason: string | null, extra: { start?: Date | null; reopen?: Date | null } = {}, detail: Record<string, unknown> = {}) => {
    const cur: Acc = byAirport.get(arpt) ?? { status: "normal", reasons: [], kinds: new Set(), start: null, reopen: null, detail: {} };
    if (RANK[status]! > RANK[cur.status]!) cur.status = status;
    if (reason) cur.reasons.push(reason);
    cur.kinds.add(kind);
    cur.start = extra.start ?? cur.start;
    cur.reopen = extra.reopen ?? cur.reopen;
    Object.assign(cur.detail, detail);
    byAirport.set(arpt, cur);
  };

  for (const b of blocks(xml, "Delay_type")) {
    const name = tag(b, "Name") ?? "";
    if (/closure/i.test(name)) {
      for (const a of blocks(b, "Airport")) {
        const reason = tag(a, "Reason") ?? "";
        // "AP CLSD EXC HEL" or "AP CLSD TO NON SKED ... GA" is a partial closure, not the whole airport.
        const partial = /\b(EXC|EXCEPT|RWY|TWY|PARTIAL|TO NON SKED)\b/i.test(reason) && !/\bAP\s+CLSD\s+\d/i.test(reason);
        note(tag(a, "ARPT") ?? "", partial ? "partially_closed" : "closed", "closure", reason, { start: parseFaaTime(tag(a, "Start"), ref), reopen: parseFaaTime(tag(a, "Reopen"), ref) }, { closureNotam: reason });
      }
    } else if (/ground stop/i.test(name)) {
      for (const g of blocks(b, "Program")) note(tag(g, "ARPT") ?? "", "disrupted", "ground_stop", tag(g, "Reason"), {}, { groundStopEnds: tag(g, "End_Time") });
    } else if (/ground delay/i.test(name)) {
      for (const g of blocks(b, "Ground_Delay")) note(tag(g, "ARPT") ?? "", "disrupted", "ground_delay", tag(g, "Reason"), {}, { averageDelay: tag(g, "Avg"), maxDelay: tag(g, "Max") });
    } else if (/arrival|departure/i.test(name)) {
      for (const d of blocks(b, "Delay")) note(tag(d, "ARPT") ?? "", "disrupted", "delay", tag(d, "Reason"), {}, { delayMin: tag(d, "Min"), delayMax: tag(d, "Max") });
    }
  }

  const events: NormalizedGlobalEvent[] = [];
  for (const [code, v] of byAirport) {
    const ap = findAirport(code);
    if (!ap || v.status === "normal") continue; // an airport we cannot place is not invented onto the map
    const ground = v.kinds.has("ground_stop") || v.kinds.has("closure");
    events.push({
      origin: "official_alert",
      category: "airport_status",
      layer: "aviation",
      subtype: [...v.kinds].join("+"),
      status: v.status,
      entityKey: ap.icao || ap.iata,
      countryCode: ap.country,
      provider: "faa_nas_status",
      providerEventId: `faa-${ap.icao || ap.iata}`,
      title: ap.name,
      description: v.reasons[0] ?? null,
      severityDomain: "airport_status",
      severityValue: RANK[v.status]!,
      severityLabel: v.status.replace("_", " "),
      prominence: airportProminence(v.status, ap.size, ground),
      confidenceLabel: null,
      lat: ap.lat,
      lng: ap.lng,
      locationPrecision: "exact",
      observedAt: v.start ?? ref,
      providerUpdatedAt: ref,
      effectiveAt: v.start,
      expiresAt: v.reopen,
      sourceUrl: FAA_NAS_PAGE,
      metadata: { icao: ap.icao, iata: ap.iata, authority: "US Federal Aviation Administration", programs: [...v.kinds], reasons: v.reasons.slice(0, 4), reopens: v.reopen?.toISOString() ?? null, ...v.detail },
    });
  }
  return { events, updated: ref };
}

export const faaNasStatus: HazardProvider = {
  key: "faa_nas_status",
  label: "FAA National Airspace System Status",
  defaultUrl: FAA_NAS_URL,
  pollIntervalMinutes: 5,
  layer: "aviation",
  async fetch(ctx): Promise<ProviderResult> {
    return { events: parseFaaNas(await ctx.fetchText(ctx.url)).events, snapshot: true };
  },
};
