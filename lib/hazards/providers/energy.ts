import type { HazardProvider, NormalizedGlobalEvent, ProviderResult } from "../types";
import { energyProminence } from "../significance";
import { countryCentroid } from "../reference";

// ---------------------------------------------------------------------------------------------
// Elexon Insights (UK): REMIT urgent market messages — operators must publish unavailability of
// generation units, demand and transmission assets (capacity, cause, start, expected end, status).
// OFFICIAL OPERATOR DATA. Keyless public API (data.elexon.co.uk, BMRS); a request window is capped at
// one day; each message has a stable `mrid` and increasing `revisionNumber` (status Active / Dismissed).
// No coordinates are published for assets: events sit at the country marker (area_level) and say so.
// Planned maintenance is routine and is skipped; only UNPLANNED unavailability >= 100 MW is kept.
// ---------------------------------------------------------------------------------------------
export const ELEXON_REMIT_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets/REMIT";
export const ELEXON_PAGE = "https://bmrs.elexon.co.uk/remit";
const MIN_ELECTRICITY_MW = 100;

interface Remit {
  mrid: string;
  revisionNumber: number;
  publishTime: string;
  messageHeading?: string;
  eventType?: string;
  unavailabilityType?: string;
  participantId?: string;
  assetId?: string;
  affectedUnit?: string;
  biddingZone?: string;
  fuelType?: string;
  assetType?: string;
  normalCapacity?: number;
  availableCapacity?: number;
  unavailableCapacity?: number;
  eventStatus?: string;
  eventStartTime?: string;
  eventEndTime?: string;
  cause?: string;
  relatedInformation?: string;
}

export function parseElexonRemit(json: unknown, now: Date = new Date()): NormalizedGlobalEvent[] {
  const rows = (((json as { data?: Remit[] })?.data ?? []) as Remit[]).filter((r) => r.mrid);
  // Latest revision per message.
  const latest = new Map<string, Remit>();
  for (const r of rows) if (!latest.has(r.mrid) || r.revisionNumber > latest.get(r.mrid)!.revisionNumber) latest.set(r.mrid, r);
  const place = countryCentroid("GB")!;
  const out: NormalizedGlobalEvent[] = [];
  for (const r of latest.values()) {
    if (r.unavailabilityType !== "Unplanned") continue;
    const mw = r.unavailableCapacity ?? null;
    if (mw == null || mw < MIN_ELECTRICITY_MW) continue;
    const start = r.eventStartTime ? new Date(r.eventStartTime) : new Date(r.publishTime);
    const end = r.eventEndTime ? new Date(r.eventEndTime) : null;
    const dismissed = r.eventStatus === "Dismissed";
    const full = r.normalCapacity != null && mw >= r.normalCapacity;
    const kind = /transmission/i.test(r.eventType ?? "") ? "electricity" : "generation";
    const eventType = full ? "outage" : "reduced_capacity";
    const pct = r.normalCapacity ? Math.round((mw / r.normalCapacity) * 100) : null;
    out.push({
      origin: "official_alert",
      category: "energy_disruption",
      layer: "energy",
      subtype: eventType,
      status: dismissed ? "restored" : eventType,
      entityKey: `GB:${r.assetId ?? r.affectedUnit ?? r.mrid}`,
      countryCode: "GB",
      provider: "elexon_remit",
      providerEventId: r.mrid,
      title: `${r.affectedUnit ?? r.assetId ?? "Unit"} — ${r.fuelType ?? "electricity"} ${eventType === "outage" ? "outage" : "reduced capacity"}`,
      description: [r.cause, r.relatedInformation && !/^Automated Message:?$/i.test(r.relatedInformation.trim()) ? r.relatedInformation : null].filter(Boolean).join(" — ") || null,
      severityDomain: "electricity_capacity_mw",
      severityValue: mw,
      severityLabel: `${mw} MW${pct != null ? ` (${pct}%)` : ""}`,
      prominence: energyProminence(mw, eventType),
      confidenceLabel: "Operator-published (REMIT)",
      lat: place.lat,
      lng: place.lng,
      locationPrecision: "area_level",
      observedAt: start,
      providerUpdatedAt: new Date(r.publishTime),
      expiresAt: end,
      endedAt: dismissed ? new Date(r.publishTime) : null,
      sourceUrl: ELEXON_PAGE,
      metadata: { infrastructureName: r.affectedUnit ?? r.assetId ?? null, operator: r.participantId ?? null, energyKind: kind, fuel: r.fuelType ?? null, capacityAffectedMw: mw, normalCapacityMw: r.normalCapacity ?? null, availableCapacityMw: r.availableCapacity ?? null, percentAffected: pct, expectedRestoration: end?.toISOString() ?? null, cause: r.cause ?? null, biddingZone: r.biddingZone ?? null, remitRevision: r.revisionNumber, messageHeading: r.messageHeading ?? null, unplanned: true },
    });
  }
  void now;
  return out;
}

export const elexonRemit: HazardProvider = {
  key: "elexon_remit",
  label: "Elexon REMIT (UK generation and grid unavailability)",
  defaultUrl: ELEXON_REMIT_URL,
  pollIntervalMinutes: 30,
  layer: "energy",
  async fetch(ctx): Promise<ProviderResult> {
    const from = new Date(ctx.now.getTime() - 23 * 3_600_000).toISOString().slice(0, 16) + "Z";
    const to = ctx.now.toISOString().slice(0, 16) + "Z";
    const sep = ctx.url.includes("?") ? "&" : "?";
    const json = JSON.parse(await ctx.fetchText(`${ctx.url}${sep}publishDateTimeFrom=${from}&publishDateTimeTo=${to}&format=json`));
    // A rolling one-day window of new revisions, not the complete active set: expiry and Dismissed end events.
    return { events: parseElexonRemit(json, ctx.now), snapshot: false };
  },
};

// ---------------------------------------------------------------------------------------------
// ENTSOG Transparency Platform (European gas TSOs): urgent market messages — unavailability of
// transmission, compressor and interconnection capacity. OFFICIAL OPERATOR DATA; keyless public API;
// stable message ids + version numbers. No coordinates: located at the operator country marker.
// Only UNPLANNED capacity unavailability >= 50 MW-equivalent that is in force now is kept; the platform
// also carries unrelated notices (fees, auctions) which are ignored.
// ---------------------------------------------------------------------------------------------
export const ENTSOG_UMM_URL = "https://transparency.entsog.eu/api/v1/urgentMarketMessages";
export const ENTSOG_PAGE = "https://transparency.entsog.eu/";
const MIN_GAS_MW = 50;

interface Umm {
  id: string;
  messageId: string;
  marketParticipantKey?: string;
  marketParticipantName?: string;
  publicationDateTime: string;
  threadId: string;
  versionNumber?: string;
  eventStatus?: string;
  eventType?: string | null;
  eventStart?: string;
  eventStop?: string;
  unavailabilityType?: string | null;
  unavailabilityReason?: string | null;
  unitMeasure?: string | null;
  affectedAssetName?: string | null;
  unavailableCapacity?: string | number | null;
  technicalCapacity?: string | number | null;
  remarks?: string | null;
  lastUpdateDateTime?: string | null;
  isLatestVersion?: string;
}

const toMw = (value: string | number | null | undefined, unit: string | null | undefined): number | null => {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (unit === "kWh/h") return v / 1000;
  if (unit === "kWh/d") return v / 24 / 1000;
  if (unit === "MWh/h") return v;
  if (unit === "MWh/d") return v / 24;
  if (unit === "GWh/d") return (v * 1000) / 24;
  return null; // unknown unit: capacity is never guessed
};

export function parseEntsogUmm(json: unknown, now: Date = new Date()): NormalizedGlobalEvent[] {
  const rows = ((json as { urgentMarketMessages?: Umm[] })?.urgentMarketMessages ?? []) as Umm[];
  const out: NormalizedGlobalEvent[] = [];
  for (const m of rows) {
    if (m.isLatestVersion !== "Yes" || m.unavailabilityType !== "Unplanned" || !/unavailability/i.test(m.eventType ?? "")) continue;
    const mw = toMw(m.unavailableCapacity, m.unitMeasure);
    if (mw == null || mw < MIN_GAS_MW) continue;
    const start = m.eventStart ? new Date(m.eventStart) : null;
    const stop = m.eventStop ? new Date(m.eventStop) : null;
    if (!start || start.getTime() > now.getTime() || (stop && stop.getTime() < now.getTime())) continue;
    const country = (m.marketParticipantKey ?? "").slice(0, 2).toUpperCase();
    const place = countryCentroid(country);
    if (!place) continue;
    const cancelled = m.eventStatus && m.eventStatus !== "Active";
    const compressor = /compressor/i.test(m.eventType ?? "");
    out.push({
      origin: "official_alert",
      category: "energy_disruption",
      layer: "energy",
      subtype: "reduced_capacity",
      status: cancelled ? "restored" : "reduced_capacity",
      entityKey: `${country}:${m.affectedAssetName ?? m.threadId}`,
      countryCode: country,
      provider: "entsog_umm",
      providerEventId: m.threadId,
      title: `${m.affectedAssetName ?? "Gas transmission asset"} — capacity unavailable`,
      description: m.unavailabilityReason ?? m.remarks?.slice(0, 400) ?? null,
      severityDomain: "gas_capacity_mw_equivalent",
      severityValue: Math.round(mw),
      severityLabel: `~${Math.round(mw)} MW-equivalent`,
      prominence: energyProminence(mw, "reduced_capacity"),
      confidenceLabel: "Operator-published (ENTSOG UMM)",
      lat: place.lat,
      lng: place.lng,
      locationPrecision: "area_level",
      observedAt: start,
      providerUpdatedAt: new Date(m.lastUpdateDateTime ?? m.publicationDateTime),
      expiresAt: stop,
      endedAt: cancelled ? new Date(m.lastUpdateDateTime ?? m.publicationDateTime) : null,
      sourceUrl: ENTSOG_PAGE,
      metadata: { infrastructureName: m.affectedAssetName ?? null, operator: m.marketParticipantName ?? null, energyKind: compressor ? "pipeline" : "gas", capacityAffectedOriginal: Number(m.unavailableCapacity), capacityUnit: m.unitMeasure ?? null, capacityAffectedMwEquivalent: Math.round(mw), technicalCapacity: m.technicalCapacity ?? null, expectedRestoration: stop?.toISOString() ?? null, umMessageId: m.messageId, version: m.versionNumber ?? null, unplanned: true },
    });
  }
  return out;
}

export const entsogUmm: HazardProvider = {
  key: "entsog_umm",
  label: "ENTSOG Transparency (European gas capacity unavailability)",
  defaultUrl: ENTSOG_UMM_URL,
  pollIntervalMinutes: 60,
  layer: "energy",
  async fetch(ctx): Promise<ProviderResult> {
    const from = new Date(ctx.now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(ctx.now.getTime() + 86_400_000).toISOString().slice(0, 10);
    const sep = ctx.url.includes("?") ? "&" : "?";
    const json = JSON.parse(await ctx.fetchText(`${ctx.url}${sep}limit=1000&periodFrom=${from}&periodTo=${to}&timezone=UTC`));
    return { events: parseEntsogUmm(json, ctx.now), snapshot: false };
  },
};
