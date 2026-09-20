import { prisma } from "@/lib/db/client";
import type { HazardProvider, NormalizedGlobalEvent, ProviderContext, ProviderResult } from "../types";
import { VOLCANO_ALERT_VALUE, volcanoProminence } from "../significance";

// USGS Volcano Hazards Program HANS (Hazards Notification System) public API: the volcanoes whose
// alert level is ABOVE normal right now (ADVISORY / WATCH / WARNING) as set by the US volcano
// observatories. Public domain, keyless. A volcano that drops off the list has returned to normal,
// so this is a complete snapshot: absence closes the record. Coverage is US-monitored volcanoes only.
// https://volcanoes.usgs.gov/hans-public/
export const HANS_ELEVATED_URL = "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes";
const HANS_VOLCANO_URL = "https://volcanoes.usgs.gov/hans-public/api/volcano/getVolcano/";

interface HansNotice {
  obs_fullname: string;
  obs_abbr: string;
  volcano_name: string;
  vnum: string;
  notice_type_cd?: string;
  notice_identifier?: string;
  sent_unixtime: number;
  color_code: string;
  alert_level: string;
  notice_url?: string;
}
interface HansVolcano {
  latitude: number;
  longitude: number;
  elevation_meters?: number;
  region?: string;
  volcano_cd?: string;
}

export function parseHansNotices(json: unknown, locate: (vnum: string) => HansVolcano | null): { events: NormalizedGlobalEvent[]; unlocated: string[] } {
  const notices = (Array.isArray(json) ? json : []) as HansNotice[];
  const events: NormalizedGlobalEvent[] = [];
  const unlocated: string[] = [];
  for (const n of notices) {
    const v = locate(n.vnum);
    if (!v) {
      unlocated.push(n.vnum);
      continue;
    }
    const level = (n.alert_level ?? "").toUpperCase();
    const sent = new Date(n.sent_unixtime * 1000);
    events.push({
      origin: "official_alert",
      category: "volcano",
      layer: "volcanoes",
      subtype: "alert_status",
      provider: "usgs_volcanoes",
      providerEventId: `hans-${n.vnum}`,
      title: `${n.volcano_name} — alert level ${level}`,
      description: `${n.obs_fullname} aviation color code ${n.color_code}, alert level ${level}.`,
      severityDomain: "volcano_alert_level",
      severityValue: VOLCANO_ALERT_VALUE[level] ?? null,
      severityLabel: level,
      prominence: volcanoProminence(level),
      confidenceLabel: null,
      lat: v.latitude,
      lng: v.longitude,
      locationPrecision: "exact",
      observedAt: sent,
      providerUpdatedAt: sent,
      sourceUrl: n.notice_url ?? `https://volcanoes.usgs.gov/volcanoes/${v.volcano_cd ?? ""}`,
      metadata: {
        volcano: n.volcano_name,
        vnum: n.vnum,
        observatory: n.obs_fullname,
        colorCode: n.color_code,
        alertLevel: level,
        noticeType: n.notice_type_cd ?? null,
        noticeId: n.notice_identifier ?? null,
        elevationM: v.elevation_meters ?? null,
        region: v.region ?? null,
      },
    });
  }
  return { events, unlocated };
}

/** The per-volcano endpoint sits beside the elevated list (also when the list URL is overridden). */
function volcanoUrl(listUrl: string, vnum: string): string {
  try {
    const u = new URL(listUrl);
    if (u.pathname.endsWith("getElevatedVolcanoes")) {
      u.pathname = u.pathname.replace(/getElevatedVolcanoes$/, `getVolcano/${vnum}`);
      return u.toString();
    }
  } catch {
    /* fall through to the default */
  }
  return `${HANS_VOLCANO_URL}${vnum}`;
}

async function loadVolcano(vnum: string, ctx: ProviderContext, budget: { left: number }): Promise<HansVolcano | null> {
  const id = `hans-volcano:${vnum}`;
  const cached = await prisma.hazardZone.findUnique({ where: { id } });
  if (cached) return JSON.parse(cached.geometry) as HansVolcano;
  if (budget.left <= 0) return null;
  budget.left -= 1;
  try {
    const v = JSON.parse(await ctx.fetchText(volcanoUrl(ctx.url, vnum))) as HansVolcano;
    if (typeof v.latitude !== "number" || typeof v.longitude !== "number") return null;
    const slim: HansVolcano = { latitude: v.latitude, longitude: v.longitude, elevation_meters: v.elevation_meters, region: v.region, volcano_cd: v.volcano_cd };
    await prisma.hazardZone.upsert({ where: { id }, update: { geometry: JSON.stringify(slim) }, create: { id, geometry: JSON.stringify(slim) } });
    return slim;
  } catch {
    return null;
  }
}

export const usgsVolcanoes: HazardProvider = {
  key: "usgs_volcanoes",
  label: "USGS Volcano Hazards Program (HANS)",
  defaultUrl: HANS_ELEVATED_URL,
  pollIntervalMinutes: 60,
  layer: "volcanoes",
  async fetch(ctx): Promise<ProviderResult> {
    const json = JSON.parse(await ctx.fetchText(ctx.url));
    const notices = (Array.isArray(json) ? json : []) as HansNotice[];
    const budget = { left: 25 };
    const known = new Map<string, HansVolcano | null>();
    for (const n of notices) known.set(n.vnum, await loadVolcano(n.vnum, ctx, budget));
    const { events, unlocated } = parseHansNotices(json, (vnum) => known.get(vnum) ?? null);
    return {
      events,
      snapshot: true,
      seenProviderIds: notices.map((n) => `hans-${n.vnum}`),
      note: unlocated.length ? `${unlocated.length} volcano location(s) unresolved` : undefined,
    };
  },
};
