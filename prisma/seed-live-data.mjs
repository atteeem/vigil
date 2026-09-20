// Live Global Data Layers: registers the structured providers as Sources (type "structured",
// provider key in `platform`), so they share the source registry's health, backoff, verification and
// provenance fields with every news source. Idempotent. All seven are keyless public endpoints that
// were fetched and inspected while building the adapters (see TASKS.md, "Live Global Data Layers").
//
// independenceClass marks them as authoritative for THEIR OWN measurements/alerts only.

const PROVIDERS = [
  { key: "usgs_earthquakes", name: "USGS Earthquake Hazards Program", site: "https://earthquake.usgs.gov/", feed: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", cls: "scientific_official", minutes: 5, perspective: "US Geological Survey — seismic network solutions", notes: "Public domain (US Government). Keyless GeoJSON summary feed, regenerated about every minute; stable event ids, `updated` moves on revision." },
  { key: "nasa_firms", name: "NASA FIRMS active fire (VIIRS)", site: "https://firms.modaps.eosdis.nasa.gov/", feed: "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv", cls: "sensor_provider", minutes: 180, perspective: "NASA satellite thermal anomaly detections", notes: "NASA open data; keyless Global_24h CSV, refreshed with each VIIRS NRT batch (~3 h). Detections are anomalies, not confirmed wildfires. FIRMS asks for acknowledgement." },
  { key: "eonet_wildfires", name: "NASA EONET wildfire incidents", site: "https://eonet.gsfc.nasa.gov/", feed: "https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&limit=300", cls: "scientific_official", minutes: 60, perspective: "NASA EONET — incident reports from agency systems (IRWIN)", notes: "NASA open data, keyless v3 API. Each event cites its own upstream incident source." },
  { key: "eonet_volcanoes", name: "NASA EONET volcano activity reports", site: "https://eonet.gsfc.nasa.gov/", feed: "https://eonet.gsfc.nasa.gov/api/v3/events?category=volcanoes&status=open&limit=300", cls: "scientific_official", minutes: 360, perspective: "NASA EONET — Smithsonian GVP / USGS weekly volcano reports", notes: "NASA open data, keyless v3 API. Records can be weeks old: shown as stale, never as current activity." },
  { key: "usgs_volcanoes", name: "USGS Volcano Hazards Program (HANS)", site: "https://volcanoes.usgs.gov/", feed: "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes", cls: "scientific_official", minutes: 60, perspective: "US volcano observatories — alert levels", notes: "Public domain (US Government), keyless. Lists US volcanoes above normal alert level; absence means back to normal. US-monitored volcanoes only." },
  { key: "nws_alerts", name: "US National Weather Service alerts", site: "https://www.weather.gov/", feed: "https://api.weather.gov/alerts/active?status=actual&message_type=alert", cls: "government_alert", minutes: 10, perspective: "US National Weather Service — CAP alerts", notes: "Public domain (US Government), keyless; requires an identifying User-Agent. CAP severity/certainty/urgency preserved. United States only." },
  { key: "gdacs", name: "GDACS cyclone and flood alerts", site: "https://www.gdacs.org/", feed: "https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP", cls: "humanitarian_monitor", minutes: 60, perspective: "EC JRC / UN OCHA disaster alert system", notes: "Public, keyless. Global tropical cyclone and flood alert levels (Green/Orange/Red); attribution to GDACS requested." },
  // ---- v2: transport and infrastructure -------------------------------------------------------
  { key: "faa_nas_status", name: "FAA National Airspace System Status", site: "https://nasstatus.faa.gov/", feed: "https://nasstatus.faa.gov/api/airport-status-information", cls: "government_alert", minutes: 5, perspective: "US Federal Aviation Administration — airport status", notes: "US Government work, keyless XML, refreshed every few minutes. US airports (plus a few Canadian/Caribbean) only; airports absent from the feed are not reported disrupted." },
  { key: "faa_notam", name: "FAA NOTAM API (airspace and airport notices)", site: "https://api.faa.gov/", feed: "https://external-api.faa.gov/notamapi/v1/notams?pageSize=200&sortBy=effectiveStartDate&sortOrder=Desc", cls: "government_alert", minutes: 15, perspective: "US FAA — NOTAMs (civil airspace and airports)", notes: "REQUIRES credentials (free FAA API portal client id + secret: FAA_NOTAM_CLIENT_ID / FAA_NOTAM_CLIENT_SECRET). Not verified live in this build; fixture-tested. Disabled until configured. No aircraft tracking of any kind.", enabled: false },
  { key: "portwatch_chokepoints", name: "IMF PortWatch chokepoint transit volumes", site: "https://portwatch.imf.org/", feed: "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services?dataset=chokepoints", cls: "sensor_provider", minutes: 720, perspective: "IMF PortWatch / Oxford — aggregate AIS-derived daily transit counts", notes: "Public ArcGIS REST services, keyless, open licence with attribution. ~1 week data lag. AGGREGATE counts per chokepoint only (no vessels); status = deviation from a 90-day baseline, never a closure claim." },
  { key: "portwatch_disruptions", name: "IMF PortWatch port-affecting hazard events", site: "https://portwatch.imf.org/", feed: "https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services?dataset=port-disruptions", cls: "sensor_provider", minutes: 360, perspective: "IMF PortWatch — hazard events with potential port impact", notes: "Public ArcGIS REST service, keyless. Hazard-derived POTENTIAL impact (GDACS-based), not confirmed port operating status." },
  { key: "nga_warnings", name: "NGA broadcast navigation warnings", site: "https://msi.nga.mil/", feed: "https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active", cls: "government_alert", minutes: 180, perspective: "US NGA — maritime navigation warnings (NAVAREA IV, XII, HYDROLANT/PAC/ARC)", notes: "US Government work, keyless JSON. Only US-coordinated areas (not the Red Sea, Gulf of Aden or Hormuz). Only maritime SECURITY notices with a position are kept; military exercise/firing notices are excluded. UKMTO has no public API (site behind an anti-bot challenge) and was not scraped." },
  { key: "elexon_remit", name: "Elexon REMIT (UK generation and grid unavailability)", site: "https://bmrs.elexon.co.uk/remit", feed: "https://data.elexon.co.uk/bmrs/api/v1/datasets/REMIT", cls: "infrastructure_operator", minutes: 30, perspective: "GB market participants — REMIT unavailability notices", notes: "Official operator-published data, keyless (Elexon Insights). One-day query window; stable mrid + revisions. No asset coordinates: shown at the country marker. Unplanned unavailability >= 100 MW only." },
  { key: "entsog_umm", name: "ENTSOG Transparency (European gas capacity unavailability)", site: "https://transparency.entsog.eu/", feed: "https://transparency.entsog.eu/api/v1/urgentMarketMessages", cls: "infrastructure_operator", minutes: 60, perspective: "European gas TSOs — urgent market messages", notes: "Official operator-published data, keyless. No coordinates: shown at the operator country marker. Unplanned unavailability >= 50 MW-equivalent in force now only." },
  { key: "ioda", name: "IODA internet outage detection (Georgia Tech)", site: "https://ioda.inetintel.cc.gatech.edu/", feed: "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events", cls: "sensor_provider", minutes: 30, perspective: "Georgia Tech IODA — BGP, active probing and telescope signals", notes: "Public JSON API, keyless. Data (c) Georgia Tech Research Corporation: shown with attribution and a link back. Observed network anomalies only; cause is never inferred." },
  { key: "cloudflare_radar", name: "Cloudflare Radar outage annotations", site: "https://radar.cloudflare.com/outage-center", feed: "https://api.cloudflare.com/client/v4/radar/annotations/outages?dateRange=7d&limit=100", cls: "sensor_provider", minutes: 30, perspective: "Cloudflare Radar — traffic and routing outage annotations", notes: "REQUIRES a free Cloudflare API token (CLOUDFLARE_RADAR_TOKEN). Endpoint confirmed to demand auth; response shape from documentation, fixture-tested, not verified live. Disabled until configured.", enabled: false },
];

export async function seedLiveData(prisma) {
  let created = 0;
  for (const p of PROVIDERS) {
    const existing = await prisma.source.findFirst({ where: { type: "structured", platform: p.key } });
    const data = {
      name: p.name,
      type: "structured",
      url: p.feed,
      feedUrl: p.feed,
      canonicalSourceUrl: p.site,
      platform: p.key,
      sourceCategory: "Structured data",
      sourceRole: "official",
      reliabilityTier: "A",
      independenceClass: p.cls,
      perspective: p.perspective,
      verificationStatus: "verified",
      verifiedAt: new Date(),
      verificationNotes: p.notes,
      permissionStatus: "authorized",
      enabled: p.enabled !== false,
      autoIngest: p.enabled !== false,
      autoProcessing: false,
      pollIntervalMinutes: p.minutes,
    };
    if (existing) await prisma.source.update({ where: { id: existing.id }, data: { ...data, enabled: existing.enabled, autoIngest: existing.autoIngest, pollIntervalMinutes: existing.pollIntervalMinutes } });
    else {
      await prisma.source.create({ data });
      created += 1;
    }
  }
  console.log(`Seeded live global data providers: ${PROVIDERS.length} (${created} new).`);
}
