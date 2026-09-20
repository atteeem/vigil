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
      enabled: true,
      autoIngest: true,
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
