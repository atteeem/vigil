import type { HazardProvider, NormalizedGlobalEvent, ProviderResult } from "../types";
import { internetProminence } from "../significance";
import { countryCentroid } from "../reference";

// A network measurement is an OBSERVED ANOMALY in connectivity. Nothing in these adapters concludes that
// a shutdown was intentional or that a government or any party did anything: the cause is stored only
// when the provider itself reports one, and is then labelled as the provider's classification.

// ---------------------------------------------------------------------------------------------
// IODA — Internet Outage Detection and Analysis (Georgia Tech, CAIDA/Internet Intelligence Lab).
// Public JSON API at api.ioda.inetintel.cc.gatech.edu (keyless). Country outage events derived from
// three independent signals (BGP visibility, active probing, network telescope). Data are
// "Copyright Georgia Tech Research Corporation. All Rights Reserved": the public API is used for
// display with attribution and a link back; redistribution beyond that is not assumed. The previous
// hostname (api.ioda.inetintelligence.cc) no longer resolves.
// ---------------------------------------------------------------------------------------------
export const IODA_EVENTS_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events";
export const IODA_PAGE = "https://ioda.inetintel.cc.gatech.edu/";

interface IodaRow {
  location: string;
  start: number;
  duration: number;
  datasource: string;
  score: number;
  location_name?: string;
  method?: string;
}

const SOURCE_LABEL: Record<string, string> = { bgp: "BGP routing visibility", "ping-slash24": "active probing", "merit-nt": "network telescope", "ucsd-nt": "network telescope" };

/** Merge one country's per-signal rows into outage episodes (rows whose intervals overlap or touch). */
export function parseIodaEvents(json: unknown, until: Date): NormalizedGlobalEvent[] {
  const rows = ((json as { data?: IodaRow[] })?.data ?? []).filter((r) => r.location?.startsWith("country/"));
  const byCountry = new Map<string, IodaRow[]>();
  for (const r of rows) (byCountry.get(r.location.slice(8)) ?? byCountry.set(r.location.slice(8), []).get(r.location.slice(8))!).push(r);
  const out: NormalizedGlobalEvent[] = [];
  for (const [cc, list] of byCountry) {
    const place = countryCentroid(cc);
    if (!place) continue;
    const sorted = [...list].sort((a, b) => a.start - b.start);
    const episodes: { start: number; end: number; rows: IodaRow[] }[] = [];
    for (const r of sorted) {
      const end = r.start + r.duration;
      const last = episodes[episodes.length - 1];
      if (last && r.start <= last.end + 3600) {
        last.end = Math.max(last.end, end);
        last.rows.push(r);
      } else episodes.push({ start: r.start, end, rows: [r] });
    }
    for (const ep of episodes) {
      const signals = [...new Set(ep.rows.map((r) => r.datasource))];
      const score = Math.max(...ep.rows.map((r) => r.score));
      if (score < 500 && signals.length < 2) continue; // an isolated weak signal is not a national disruption
      const ongoing = ep.end >= until.getTime() / 1000 - 3600;
      out.push({
        origin: "sensor",
        category: "internet_disruption",
        layer: "internet",
        subtype: "connectivity_anomaly",
        status: ongoing ? "outage" : "restored",
        entityKey: cc,
        countryCode: cc,
        provider: "ioda",
        providerEventId: `ioda-${cc}-${ep.start}`,
        title: `${place.name} — internet connectivity disruption`,
        description: "Observed network anomaly. The measurement shows a fall in connectivity; it does not establish the cause (power failure, cable damage, technical fault or deliberate shutdown).",
        severityDomain: "internet_anomaly_score",
        severityValue: Math.round(score),
        severityLabel: `${signals.length} independent signal${signals.length === 1 ? "" : "s"}`,
        prominence: internetProminence(score, signals.length, "national"),
        confidenceLabel: `${signals.length} of 3 measurement signals`,
        lat: place.lat,
        lng: place.lng,
        locationPrecision: "area_level",
        observedAt: new Date(ep.start * 1000),
        providerUpdatedAt: until, // the moment of this measurement; an ended episode carries its end in endedAt
        endedAt: ongoing ? null : new Date(ep.end * 1000),
        sourceUrl: `${IODA_PAGE}country/${cc}`,
        metadata: { scope: "national", signals: signals.map((s) => SOURCE_LABEL[s] ?? s), maxScore: Math.round(score), anomalyType: "observed_network_anomaly", intentionalShutdownConfirmed: false, causeEstablished: false, methodology: "IODA country outage detection over BGP, active probing and network-telescope signals", provider: "IODA (Georgia Tech)", ongoing },
      });
    }
  }
  return out;
}

export const ioda: HazardProvider = {
  key: "ioda",
  label: "IODA (Georgia Tech internet outage detection)",
  defaultUrl: IODA_EVENTS_URL,
  pollIntervalMinutes: 30,
  layer: "internet",
  async fetch(ctx): Promise<ProviderResult> {
    const until = Math.floor(ctx.now.getTime() / 1000);
    const from = until - 3 * 86_400;
    const sep = ctx.url.includes("?") ? "&" : "?";
    const json = JSON.parse(await ctx.fetchText(`${ctx.url}${sep}from=${from}&until=${until}&entityType=country&limit=500`));
    // Episodes that fell out of the 3-day window are already ended; still-open ones missing now were withdrawn.
    return { events: parseIodaEvents(json, ctx.now), snapshot: true };
  },
};

// ---------------------------------------------------------------------------------------------
// Cloudflare Radar outage annotations. ACCESS: needs a free Cloudflare API token (Radar read) sent as a
// Bearer token — verified only as far as "the endpoint answers 400 without credentials"; NOT verified
// live with a token, so the adapter follows the documented response shape and is fixture-tested. The
// source is seeded DISABLED and idle ("credentials not configured") until CLOUDFLARE_RADAR_TOKEN is
// set. Radar is authoritative for its own measurements; the `outageCause` field is Cloudflare's
// classification of a cause, carried through labelled as such, never as established fact.
// ---------------------------------------------------------------------------------------------
export const CLOUDFLARE_RADAR_URL = "https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=7d&limit=100";
export const CLOUDFLARE_RADAR_PAGE = "https://radar.cloudflare.com/outage-center";

interface RadarAnnotation {
  id: string;
  dataSource?: string;
  description?: string;
  startDate: string;
  endDate?: string | null;
  eventType?: string;
  scope?: string;
  locations?: string[];
  locationsDetails?: { code: string; name: string }[];
  outage?: { outageCause?: string; outageType?: string };
  asnsDetails?: { asn: string; name: string }[];
  linkedUrl?: string;
}

export function parseRadarOutages(json: unknown): NormalizedGlobalEvent[] {
  const list = ((json as { result?: { annotations?: RadarAnnotation[] } })?.result?.annotations ?? []) as RadarAnnotation[];
  const out: NormalizedGlobalEvent[] = [];
  for (const a of list) {
    const cc = a.locations?.[0];
    const place = countryCentroid(cc);
    if (!a.id || !cc || !place) continue;
    const nationwide = /nation/i.test(a.outage?.outageType ?? "");
    const start = new Date(a.startDate);
    const end = a.endDate ? new Date(a.endDate) : null;
    out.push({
      origin: "sensor",
      category: "internet_disruption",
      layer: "internet",
      subtype: nationwide ? "national_outage" : "regional_outage",
      status: end ? "restored" : "outage",
      entityKey: cc,
      countryCode: cc,
      provider: "cloudflare_radar",
      providerEventId: `radar-${a.id}`,
      title: `${a.locationsDetails?.[0]?.name ?? place.name} — ${nationwide ? "internet outage" : "regional connectivity disruption"}`,
      description: a.description ?? "Observed network anomaly reported by Cloudflare Radar.",
      severityDomain: "internet_anomaly_score",
      severityValue: null,
      severityLabel: nationwide ? "nationwide" : "regional",
      prominence: internetProminence(null, 1, nationwide ? "national" : "regional") + (nationwide ? 15 : 0),
      confidenceLabel: "Cloudflare Radar annotation",
      lat: place.lat,
      lng: place.lng,
      locationPrecision: "area_level",
      observedAt: start,
      providerUpdatedAt: end ?? start,
      endedAt: end,
      sourceUrl: a.linkedUrl ?? CLOUDFLARE_RADAR_PAGE,
      metadata: { scope: nationwide ? "national" : "regional", anomalyType: "observed_network_anomaly", providerReportedCause: a.outage?.outageCause ?? null, causeIsProviderClassification: true, intentionalShutdownConfirmed: false, networks: (a.asnsDetails ?? []).slice(0, 8).map((n) => `AS${n.asn} ${n.name}`), dataSource: a.dataSource ?? null, methodology: "Cloudflare Radar outage annotation (traffic and routing signals)" },
    });
  }
  return out;
}

export const cloudflareRadar: HazardProvider = {
  key: "cloudflare_radar",
  label: "Cloudflare Radar (outage annotations)",
  defaultUrl: CLOUDFLARE_RADAR_URL,
  pollIntervalMinutes: 30,
  layer: "internet",
  credentials: { env: ["CLOUDFLARE_RADAR_TOKEN"], signup: "https://dash.cloudflare.com/profile/api-tokens" },
  async fetch(ctx): Promise<ProviderResult> {
    const env = ctx.env ?? process.env;
    const text = await ctx.fetchText(ctx.url, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_RADAR_TOKEN ?? ""}` } });
    return { events: parseRadarOutages(JSON.parse(text)), snapshot: false };
  },
};
