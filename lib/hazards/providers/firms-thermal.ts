import type { HazardProvider, NormalizedGlobalEvent, ProviderResult } from "../types";
import { thermalProminence } from "../significance";

// NASA FIRMS (Fire Information for Resource Management System) active-fire detections. NASA data
// are open (FIRMS asks users to acknowledge it); the Global_24h CSV files are keyless downloads that
// refresh with each satellite-pass batch (VIIRS NRT roughly every 3 h), so polling is 3-hourly. The
// per-area API needs a MAP_KEY; this adapter deliberately uses the keyless global file.
//
// A detection is a satellite thermal ANOMALY: it may be a wildfire, but also gas flaring,
// industrial heat or agricultural burning. It is never labelled "wildfire" here.
export const FIRMS_VIIRS_URL = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv";

/** Bound per-poll volume: strongest detections first (the global file holds tens of thousands). */
export const MAX_DETECTIONS_PER_POLL = 12_000;

const SATELLITE_NAME: Record<string, string> = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21", "1": "NOAA-20" };
const CONFIDENCE_LABEL: Record<string, string> = { l: "low", n: "nominal", h: "high", low: "low", nominal: "nominal", high: "high" };

export function parseFirmsCsv(csv: string, maxDetections = MAX_DETECTIONS_PER_POLL): NormalizedGlobalEvent[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const head = (lines.shift() ?? "").split(",").map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const iLat = col("latitude"), iLng = col("longitude"), iDate = col("acq_date"), iTime = col("acq_time");
  const iSat = col("satellite"), iConf = col("confidence"), iFrp = col("frp"), iDn = col("daynight");
  const iBright = head.includes("bright_ti4") ? col("bright_ti4") : col("brightness");
  const iScan = col("scan"), iTrack = col("track");
  if ([iLat, iLng, iDate, iTime].some((i) => i < 0)) return [];

  const rows: NormalizedGlobalEvent[] = [];
  for (const line of lines) {
    const c = line.split(",");
    const lat = Number(c[iLat]);
    const lng = Number(c[iLng]);
    const date = c[iDate];
    const time = (c[iTime] ?? "").padStart(4, "0");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !date || time.length < 4) continue;
    const confidence = CONFIDENCE_LABEL[(c[iConf] ?? "").toLowerCase()] ?? (c[iConf] || null);
    // Low-confidence detections are dropped at ingestion (sun glint, small artefacts); the label of
    // everything kept is stored exactly as the provider gave it.
    if (confidence === "low") continue;
    const observedAt = new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
    if (Number.isNaN(observedAt.getTime())) continue;
    const frp = Number(c[iFrp]);
    const sat = c[iSat] ?? "";
    rows.push({
      origin: "sensor",
      category: "thermal_detection",
      layer: "fires",
      subtype: "viirs_375m",
      provider: "nasa_firms",
      providerEventId: `viirs-${sat}-${date}-${time}-${lat.toFixed(4)}-${lng.toFixed(4)}`,
      title: "Thermal anomaly",
      description: "Satellite thermal detection — not necessarily a confirmed wildfire.",
      severityDomain: "fire_radiative_power_mw",
      severityValue: Number.isFinite(frp) ? frp : null,
      severityLabel: Number.isFinite(frp) ? `${frp} MW` : null,
      prominence: thermalProminence(Number.isFinite(frp) ? frp : null),
      confidenceLabel: confidence,
      lat,
      lng,
      locationPrecision: "exact",
      observedAt,
      providerUpdatedAt: observedAt,
      sourceUrl: `https://firms.modaps.eosdis.nasa.gov/map/#d:24hrs;@${lng.toFixed(3)},${lat.toFixed(3)},10z`,
      metadata: {
        satellite: SATELLITE_NAME[sat] ?? sat,
        instrument: "VIIRS",
        dayNight: c[iDn] === "D" ? "day" : c[iDn] === "N" ? "night" : null,
        brightnessK: Number(c[iBright]) || null,
        pixelScanKm: Number(c[iScan]) || null,
        pixelTrackKm: Number(c[iTrack]) || null,
      },
    });
  }
  if (rows.length <= maxDetections) return rows;
  return rows.sort((a, b) => (b.severityValue ?? 0) - (a.severityValue ?? 0)).slice(0, maxDetections);
}

export const nasaFirms: HazardProvider = {
  key: "nasa_firms",
  label: "NASA FIRMS (VIIRS active fire)",
  defaultUrl: FIRMS_VIIRS_URL,
  pollIntervalMinutes: 180,
  layer: "fires",
  async fetch(ctx): Promise<ProviderResult> {
    const text = await ctx.fetchText(ctx.url);
    return { events: parseFirmsCsv(text), snapshot: false };
  },
};
