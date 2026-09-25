import type { CountryRecord } from "./registry";

// Which structured providers can say anything about a given country, per country-page domain. This is a
// statement about PROVIDER SCOPE (FAA publishes US airport status, Elexon covers Great Britain...), not
// about current conditions: a country outside every provider's scope gets "Insufficient current data",
// never an implied "all clear". Whether a covering provider actually delivered data recently is checked
// separately against its last successful ingestion.

export type CoverageDomain = "transport" | "energy" | "internet" | "hazards";

interface ProviderScope {
  platform: string;
  label: string;
  covers: (c: CountryRecord) => boolean;
}

const everywhere = () => true;
const coastal = (c: CountryRecord) => !c.landlocked;

export const DOMAIN_PROVIDERS: Record<CoverageDomain, ProviderScope[]> = {
  transport: [
    { platform: "faa_nas_status", label: "FAA airport status (United States)", covers: (c) => c.code === "US" },
    { platform: "faa_notam", label: "FAA NOTAM closures (United States)", covers: (c) => c.code === "US" },
    { platform: "portwatch_disruptions", label: "IMF PortWatch port disruptions", covers: coastal },
    { platform: "nga_warnings", label: "NGA navigational warnings", covers: coastal },
  ],
  energy: [
    { platform: "elexon_remit", label: "Elexon REMIT (Great Britain)", covers: (c) => c.code === "GB" },
    { platform: "entsog_umm", label: "ENTSOG gas transmission messages (European operators)", covers: (c) => c.region === "Europe" },
  ],
  internet: [
    { platform: "ioda", label: "IODA (Georgia Tech)", covers: everywhere },
    { platform: "cloudflare_radar", label: "Cloudflare Radar", covers: everywhere },
  ],
  hazards: [
    { platform: "usgs_earthquakes", label: "USGS earthquakes", covers: everywhere },
    { platform: "gdacs", label: "GDACS alerts", covers: everywhere },
    { platform: "eonet_wildfires", label: "NASA EONET wildfires", covers: everywhere },
    { platform: "eonet_volcanoes", label: "NASA EONET volcanoes", covers: everywhere },
    { platform: "nasa_firms", label: "NASA FIRMS thermal detections", covers: everywhere },
    { platform: "usgs_volcanoes", label: "USGS volcanoes", covers: (c) => c.code === "US" },
    { platform: "nws_alerts", label: "NWS weather alerts (United States)", covers: (c) => c.code === "US" },
  ],
};

export const ALL_DOMAIN_PLATFORMS = [...new Set(Object.values(DOMAIN_PROVIDERS).flatMap((l) => l.map((p) => p.platform)))];

export interface DomainCoverage {
  /** covered: at least one provider in scope delivered data within `freshHours`. */
  state: "covered" | "stale" | "insufficient";
  providers: { label: string; lastSuccessAt: string | null }[];
  note: string;
}

/** Pure: which providers cover the country and whether any of them is delivering. */
export function domainCoverage(domain: CoverageDomain, country: CountryRecord, feeds: { platform: string | null; lastSuccessfulIngestion: Date | null }[], now: Date, freshHours = 48): DomainCoverage {
  const inScope = DOMAIN_PROVIDERS[domain].filter((p) => p.covers(country));
  const providers = inScope.map((p) => {
    const t = feeds.filter((f) => f.platform === p.platform && f.lastSuccessfulIngestion).map((f) => f.lastSuccessfulIngestion!.getTime());
    return { label: p.label, lastSuccessAt: t.length ? new Date(Math.max(...t)).toISOString() : null };
  });
  if (providers.length === 0) return { state: "insufficient", providers, note: `Insufficient current data: no connected provider covers ${country.name} for this domain.` };
  const fresh = providers.some((p) => p.lastSuccessAt && now.getTime() - new Date(p.lastSuccessAt).getTime() <= freshHours * 3_600_000);
  if (fresh) return { state: "covered", providers, note: `Monitored by ${providers.map((p) => p.label).join(", ")}.` };
  const ever = providers.some((p) => p.lastSuccessAt);
  return ever
    ? { state: "stale", providers, note: `Provider data for ${country.name} is stale (no successful update in ${freshHours} h); absence of events is not evidence of normal conditions.` }
    : { state: "insufficient", providers, note: `Insufficient current data: the providers covering ${country.name} have not delivered data yet.` };
}
