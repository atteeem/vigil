import type { HazardProvider, NormalizedGlobalEvent, ProviderContext, ProviderResult } from "../types";
import { chokepointProminence, portProminence } from "../significance";

// IMF PortWatch (with the University of Oxford): aggregate, AIS-derived daily transit counts for the
// world's maritime chokepoints, and a database of natural-hazard events that may affect ports. Served as
// public ArcGIS REST feature services on services9.arcgis.com (keyless, no authentication; the data
// are published under an open licence with attribution to IMF PortWatch / Oxford). Data lag the present
// by about a week (the latest daily value seen while building this was 7 days old).
//
// This is AGGREGATE traffic only — daily vessel-call counts per chokepoint — never individual ships,
// never military vessels. A chokepoint's status here is a MEASUREMENT of transit volume against its own
// 90-day baseline ("transit 45% below baseline"); it is never read as a closure. The top status,
// closed_restricted, is reserved for an explicit official statement and is never derived.
export const PORTWATCH_BASE = "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services";
export const PORTWATCH_PAGE = "https://portwatch.imf.org/";

const BASELINE_DAYS = 90;
const RECENT_DAYS = 7;
/** Below this many daily transits the baseline is too noisy to call a deviation: status stays undetermined. */
const MIN_BASELINE = 10;

interface ArcGisResponse<T> {
  features?: { attributes: T }[];
  exceededTransferLimit?: boolean;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

export interface ChokepointAssessment {
  status: "normal" | "elevated_disruption" | "major_disruption";
  recentAvg: number;
  baselineMedian: number;
  deviationPct: number;
  through: string;
}

/** Compare the last week of daily transits with the median of the 90 days before it. */
export function assessChokepoint(series: { date: string; n: number }[]): ChokepointAssessment | null {
  const s = [...series].sort((a, b) => a.date.localeCompare(b.date));
  if (s.length < RECENT_DAYS + 30) return null;
  const recent = s.slice(-RECENT_DAYS);
  const baseline = s.slice(-(RECENT_DAYS + BASELINE_DAYS), -RECENT_DAYS).map((d) => d.n);
  const base = median(baseline);
  if (base < MIN_BASELINE) return null;
  const recentAvg = recent.reduce((a, d) => a + d.n, 0) / recent.length;
  const ratio = recentAvg / base;
  return { status: ratio < 0.5 ? "major_disruption" : ratio < 0.75 ? "elevated_disruption" : "normal", recentAvg: Math.round(recentAvg * 10) / 10, baselineMedian: base, deviationPct: Math.round((ratio - 1) * 100), through: s[s.length - 1]!.date };
}

async function query<T>(ctx: ProviderContext, service: string, params: Record<string, string>): Promise<ArcGisResponse<T>> {
  // The configured URL is the service directory; any query it carries (test pinning) is preserved.
  const u = new URL(ctx.url);
  u.pathname = `${u.pathname.replace(/\/$/, "")}/${service}/FeatureServer/0/query`;
  for (const [k, v] of Object.entries({ f: "json", ...params })) u.searchParams.set(k, v);
  return JSON.parse(await ctx.fetchText(u.toString())) as ArcGisResponse<T>;
}

export const portwatchChokepoints: HazardProvider = {
  key: "portwatch_chokepoints",
  label: "IMF PortWatch (chokepoint transit volumes)",
  defaultUrl: PORTWATCH_BASE,
  pollIntervalMinutes: 720,
  layer: "maritime",
  async fetch(ctx): Promise<ProviderResult> {
    const list = await query<{ portid: string; portname: string; lat: number; lon: number }>(ctx, "PortWatch_chokepoints_database", { where: "1=1", outFields: "portid,portname,lat,lon", returnGeometry: "false" });
    const since = new Date(ctx.now.getTime() - (BASELINE_DAYS + RECENT_DAYS + 25) * 86_400_000).toISOString().slice(0, 10);
    const series = new Map<string, { date: string; n: number }[]>();
    for (let offset = 0, page = 0; page < 4; page++) {
      const r = await query<{ date: string | number; portid: string; n_total: number }>(ctx, "Daily_Chokepoints_Data", { where: `date >= DATE '${since}'`, outFields: "date,portid,n_total", orderByFields: "date DESC", returnGeometry: "false", resultOffset: String(offset), resultRecordCount: "2000" });
      for (const f of r.features ?? []) {
        const d = typeof f.attributes.date === "number" ? new Date(f.attributes.date).toISOString().slice(0, 10) : String(f.attributes.date);
        (series.get(f.attributes.portid) ?? series.set(f.attributes.portid, []).get(f.attributes.portid)!).push({ date: d, n: f.attributes.n_total });
      }
      if (!r.exceededTransferLimit) break;
      offset += 2000;
    }
    const events: NormalizedGlobalEvent[] = [];
    for (const { attributes: cp } of list.features ?? []) {
      const a = assessChokepoint(series.get(cp.portid) ?? []);
      if (!a) continue; // not enough data to say anything: no record rather than a guess
      const through = new Date(`${a.through}T00:00:00Z`);
      events.push({
        origin: "sensor",
        category: "chokepoint_status",
        layer: "maritime",
        subtype: "transit_volume",
        status: a.status,
        entityKey: cp.portid,
        provider: "portwatch_chokepoints",
        providerEventId: `portwatch-${cp.portid}`,
        title: cp.portname,
        description: a.status === "normal" ? "Transit volume within its normal range." : `Aggregate daily transits ${Math.abs(a.deviationPct)}% ${a.deviationPct < 0 ? "below" : "above"} the 90-day baseline. This measures traffic volume; it does not by itself mean the passage is closed.`,
        severityDomain: "chokepoint_transit_deviation_pct",
        severityValue: a.deviationPct,
        severityLabel: `${a.deviationPct > 0 ? "+" : ""}${a.deviationPct}% vs baseline`,
        prominence: chokepointProminence(a.status, cp.portid),
        confidenceLabel: "Aggregate AIS-derived measurement",
        lat: cp.lat,
        lng: cp.lon,
        locationPrecision: "area_level",
        observedAt: through,
        providerUpdatedAt: through,
        sourceUrl: PORTWATCH_PAGE,
        metadata: { chokepointId: cp.portid, recentAvgDailyTransits: a.recentAvg, baselineMedianDailyTransits: a.baselineMedian, deviationPct: a.deviationPct, dataThrough: a.through, baselineDays: BASELINE_DAYS, recentDays: RECENT_DAYS, methodology: "Daily vessel-call counts aggregated from AIS by IMF PortWatch; last 7 days vs median of the prior 90 days.", statusIsDerived: true },
      });
    }
    return { events, snapshot: true, note: `${events.length}/${list.features?.length ?? 0} chokepoints assessed` };
  },
};

interface DisruptionAttrs {
  eventid: number;
  eventtype: string;
  eventname: string;
  alertlevel: string;
  country: string | null;
  fromdate: number | string | null;
  todate: number | string | null;
  severitytext: string | null;
  lat: number;
  long: number;
  affectedports: string | null;
  n_affectedports: number | null;
  editdate?: number | string | null;
}
const toDate = (v: number | string | null | undefined) => (v == null ? null : new Date(typeof v === "number" ? v : v));

export function parsePortDisruptions(features: { attributes: DisruptionAttrs }[]): NormalizedGlobalEvent[] {
  const out: NormalizedGlobalEvent[] = [];
  for (const { attributes: a } of features) {
    if (!["Orange", "Red"].includes(a.alertlevel) || typeof a.lat !== "number" || typeof a.long !== "number") continue;
    const from = toDate(a.fromdate) ?? new Date();
    const to = toDate(a.todate);
    const n = a.n_affectedports ?? 0;
    out.push({
      origin: "humanitarian",
      category: "port_disruption",
      layer: "maritime",
      subtype: a.eventtype,
      // A hazard-derived potential impact, not a confirmed port closure: the status never says "closed".
      status: "disrupted",
      entityKey: `portwatch-event-${a.eventid}`,
      countryCode: null,
      provider: "portwatch_disruptions",
      providerEventId: `portwatch-disruption-${a.eventid}`,
      title: `${a.eventname}${n ? ` — ${n} port${n === 1 ? "" : "s"} potentially affected` : ""}`,
      description: a.severitytext ?? null,
      severityDomain: "port_alert_level",
      severityValue: a.alertlevel === "Red" ? 3 : 2,
      severityLabel: `${a.alertlevel} alert`,
      prominence: portProminence(a.alertlevel),
      confidenceLabel: "Hazard-derived potential impact",
      lat: a.lat,
      lng: a.long,
      locationPrecision: "area_level",
      observedAt: from,
      providerUpdatedAt: toDate(a.editdate) ?? from,
      expiresAt: to,
      sourceUrl: PORTWATCH_PAGE,
      metadata: { eventType: a.eventtype, country: a.country, affectedPorts: a.affectedports, affectedPortCount: n, potentialImpactOnly: true },
    });
  }
  return out;
}

export const portwatchDisruptions: HazardProvider = {
  key: "portwatch_disruptions",
  label: "IMF PortWatch (port-affecting hazard events)",
  defaultUrl: PORTWATCH_BASE,
  pollIntervalMinutes: 360,
  layer: "maritime",
  async fetch(ctx): Promise<ProviderResult> {
    const since = new Date(ctx.now.getTime() - 5 * 86_400_000).toISOString().slice(0, 10);
    const r = await query<DisruptionAttrs>(ctx, "portwatch_disruptions_database", { where: `todate >= DATE '${since}'`, outFields: "eventid,eventtype,eventname,alertlevel,country,fromdate,todate,severitytext,lat,long,affectedports,n_affectedports,editdate", returnGeometry: "false", resultRecordCount: "500" });
    return { events: parsePortDisruptions(r.features ?? []), snapshot: true };
  },
};
