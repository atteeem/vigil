// Deterministic provider payloads for the Playwright suite (served by app/api/test-fixtures/hazards).
// Shapes mirror the real USGS / FIRMS / EONET / HANS / NWS / GDACS responses sampled while building
// the adapters. Times are relative to "now" so "24 min ago" style assertions stay valid; `v=2`
// serves the provider's next revision of the same events (idempotency / revision tests).

const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

export interface HazardFixture {
  body: string;
  contentType: string;
}

export function getHazardFixture(path: string[], variant: string, now: number = Date.now()): HazardFixture | null {
  const key = path.join("/");
  const v2 = variant === "2";
  const json = (o: unknown): HazardFixture => ({ body: JSON.stringify(o), contentType: "application/json" });

  if (key === "usgs") {
    const quake = (id: string, mag: number, place: string, lng: number, lat: number, depth: number, agoMin: number, updatedAgoMin: number, extra: Record<string, unknown> = {}) => ({
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [lng, lat, depth] },
      properties: { mag, place, time: now - agoMin * MIN, updated: now - updatedAgoMin * MIN, url: `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`, tsunami: 0, sig: Math.round(mag * 100), alert: null, status: "automatic", magType: "mww", net: "us", type: "earthquake", ...extra },
    });
    return json({
      type: "FeatureCollection",
      metadata: { generated: now, count: 4 },
      features: [
        v2
          ? quake("fx-usgs-big", 6.6, "62 km SW of Testville, Fixtureland", 145.1, -6.2, 21, 24, 2, { status: "reviewed", tsunami: 1, sig: 730 })
          : quake("fx-usgs-big", 6.4, "62 km SW of Testville, Fixtureland", 145.1, -6.2, 18, 24, 8, { tsunami: 0, sig: 630 }),
        quake("fx-usgs-mid", 4.3, "10 km E of Midtown, Fixtureland", 143.0, -5.0, 35, 90, 80),
        quake("fx-usgs-old", 5.1, "40 km S of Oldtown, Fixtureland", 120.0, 12.0, 30, 26 * 60, 26 * 60 - 5),
        quake("fx-usgs-small", 2.8, "3 km N of Smallton, Fixtureland", 141.0, -4.0, 5, 200, 190),
        { ...quake("fx-usgs-blast", 3.1, "quarry", 100, 10, 0, 30, 30), properties: { mag: 3.1, place: "quarry", time: now - 30 * MIN, updated: now - 30 * MIN, type: "quarry blast", url: null } },
      ],
    });
  }

  if (key === "firms") {
    const d = new Date(now - 90 * MIN);
    const date = d.toISOString().slice(0, 10);
    const time = `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const rows = ["latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight"];
    // A dense cluster (a fire complex) plus scattered singles and one low-confidence artefact.
    for (let i = 0; i < 60; i++) rows.push(`${(34.0 + (i % 10) * 0.004).toFixed(5)},${(-118.0 + Math.floor(i / 10) * 0.004).toFixed(5)},330.1,0.4,0.37,${date},${time},N20,${i % 5 === 0 ? "high" : "nominal"},2.0NRT,290.2,${(5 + i * 0.5).toFixed(1)},D`);
    rows.push(`-12.50000,131.00000,340.0,0.4,0.37,${date},${time},N20,high,2.0NRT,291.0,88.5,N`);
    rows.push(`48.10000,10.10000,301.0,0.4,0.37,${date},${time},N20,nominal,2.0NRT,285.0,2.1,D`);
    rows.push(`10.00000,20.00000,299.0,0.4,0.37,${date},${time},N20,low,2.0NRT,280.0,0.5,D`);
    return { body: rows.join("\n"), contentType: "text/csv" };
  }

  if (key === "eonet-wildfires") {
    return json({
      title: "EONET Events",
      events: [
        { id: "FX_FIRE_1", title: "Wildfire Fixture Ridge, Testland", description: "10 Miles NE from Fixtown", link: "https://eonet.gsfc.nasa.gov/api/v3/events/FX_FIRE_1", closed: null, categories: [{ id: "wildfires", title: "Wildfires" }], sources: [{ id: "IRWIN", url: "https://irwin.doi.gov/observer/incidents/fx-1" }], geometry: [{ magnitudeValue: 500, magnitudeUnit: "acres", date: iso(now - 30 * HOUR), type: "Point", coordinates: [-120.0, 39.4] }, { magnitudeValue: v2 ? 900 : 620, magnitudeUnit: "acres", date: iso(now - 2 * HOUR), type: "Point", coordinates: [-120.0, 39.4] }] },
        { id: "FX_FIRE_OLD", title: "Wildfire Old Ridge, Testland", description: null, link: "https://eonet.gsfc.nasa.gov/api/v3/events/FX_FIRE_OLD", closed: null, categories: [{ id: "wildfires", title: "Wildfires" }], sources: [{ id: "IRWIN", url: "https://irwin.doi.gov/observer/incidents/fx-old" }], geometry: [{ magnitudeValue: 100, magnitudeUnit: "acres", date: iso(now - 60 * 24 * HOUR), type: "Point", coordinates: [-110.0, 35.0] }] },
      ],
    });
  }

  if (key === "eonet-volcanoes") {
    return json({
      title: "EONET Events",
      events: [
        { id: "FX_VOLC_FRESH", title: "Fixture Volcano, Testland", description: null, link: "https://eonet.gsfc.nasa.gov/api/v3/events/FX_VOLC_FRESH", closed: null, categories: [{ id: "volcanoes", title: "Volcanoes" }], sources: [{ id: "SIVolcano", url: "https://volcano.si.edu/volcano.cfm?vn=999001" }], geometry: [{ magnitudeValue: null, magnitudeUnit: null, date: iso(now - 3 * 24 * HOUR), type: "Point", coordinates: [-71.4, -36.9] }] },
        { id: "FX_VOLC_STALE", title: "Dormant Fixture Volcano, Testland", description: null, link: "https://eonet.gsfc.nasa.gov/api/v3/events/FX_VOLC_STALE", closed: null, categories: [{ id: "volcanoes", title: "Volcanoes" }], sources: [{ id: "SIVolcano", url: "https://volcano.si.edu/volcano.cfm?vn=999002" }], geometry: [{ magnitudeValue: null, magnitudeUnit: null, date: iso(now - 200 * 24 * HOUR), type: "Point", coordinates: [86.0, 27.0] }] },
      ],
    });
  }

  if (key === "hans/getElevatedVolcanoes") {
    const notice = (name: string, vnum: string, level: string, color: string, agoMin: number) => ({ obs_fullname: "Fixture Volcano Observatory", obs_abbr: "fvo", volcano_name: name, vnum, notice_type_cd: "DU", notice_identifier: `FX-${vnum}-${level}`, sent_unixtime: Math.floor((now - agoMin * MIN) / 1000), color_code: color, alert_level: level, notice_url: `https://volcanoes.usgs.gov/hans-public/notice/FX-${vnum}` });
    return json(v2 ? [notice("Fixture Peak", "900001", "WARNING", "RED", 5)] : [notice("Fixture Peak", "900001", "WATCH", "ORANGE", 120), notice("Fixture Cone", "900002", "ADVISORY", "YELLOW", 300)]);
  }
  const hansVolcano = /^hans\/getVolcano\/(\d+)$/.exec(key);
  if (hansVolcano) return json({ volcano_name: `Fixture ${hansVolcano[1]}`, vnum: hansVolcano[1], latitude: hansVolcano[1] === "900001" ? 52.0 : 60.0, longitude: hansVolcano[1] === "900001" ? -176.0 : -152.0, elevation_meters: 1700, region: "Fixture Arc", volcano_cd: "fx" });

  if (key === "nws/alerts") {
    const cap = (id: string, event: string, severity: string, certainty: string, expiresInMin: number, geometry: unknown, extra: Record<string, unknown> = {}) => ({
      id: `https://api.weather.gov/alerts/${id}`,
      type: "Feature",
      geometry,
      properties: { "@id": `https://api.weather.gov/alerts/${id}`, id, areaDesc: "Fixture County, TX", affectedZones: [], references: [], sent: iso(now - 20 * MIN), effective: iso(now - 20 * MIN), onset: iso(now - 20 * MIN), expires: iso(now + expiresInMin * MIN), ends: iso(now + expiresInMin * MIN), status: "Actual", messageType: "Alert", severity, certainty, urgency: "Expected", event, senderName: "NWS Fixture TX", headline: `${event} issued`, description: `${event} for Fixture County.`, response: "Avoid", ...extra },
    });
    const box = (w: number, s: number, e: number, n: number) => ({ type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] });
    const features = [
      cap("urn:fx:flood-1", "Flood Warning", "Severe", "Likely", v2 ? 30 : 180, box(-98.0, 30.0, -97.0, 31.0)),
      cap("urn:fx:zone-1", "Severe Thunderstorm Warning", "Severe", "Observed", 120, null, { affectedZones: [`${process.env.FIXTURE_ORIGIN ?? "http://localhost:3100"}/api/test-fixtures/hazards/nws/zones/FXC001`] }),
      cap("urn:fx:minor-1", "Frost Advisory", "Minor", "Likely", 240, box(-100.0, 35.0, -99.0, 36.0)),
      cap("urn:fx:tornado-1", "Tornado Warning", "Extreme", "Observed", 45, box(-96.0, 32.0, -95.5, 32.5)),
    ];
    return json({ type: "FeatureCollection", features: v2 ? features.filter((f) => f.properties.id !== "urn:fx:tornado-1") : features });
  }
  const zone = /^nws\/zones\/(\w+)$/.exec(key);
  if (zone) return json({ type: "Feature", id: key, geometry: { type: "Polygon", coordinates: [[[-101.0, 33.0], [-100.4, 33.0], [-100.4, 33.6], [-101.0, 33.6], [-101.0, 33.0]]] }, properties: { id: zone[1] } });

  if (key === "gdacs") {
    const f = (type: string, id: number, name: string, level: string, lng: number, lat: number, extra: Record<string, unknown> = {}) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { eventtype: type, eventid: id, eventname: name, name: `${type === "TC" ? "Tropical Cyclone" : type === "FL" ? "Flood in" : "Earthquake in"} ${name}`, alertlevel: level, iscurrent: "true", fromdate: iso(now - 30 * HOUR).slice(0, 19), todate: iso(now + 5 * HOUR).slice(0, 19), datemodified: iso(now - 1 * HOUR).slice(0, 19), country: "", source: "NOAA", url: { report: `https://www.gdacs.org/report.aspx?eventid=${id}&eventtype=${type}` }, severitydata: { severity: 150, severitytext: "Category 2 (maximum wind speed of 150 km/h)", severityunit: "km/h" }, alertscore: 2, ...extra },
    });
    return json({ type: "FeatureCollection", features: [f("TC", 9000001, "FIXTURE-26", "Orange", 130.0, 15.0), f("FL", 9000002, "Fixtureland", "Green", 20.0, 40.0, { country: "Fixtureland" }), f("EQ", 9000003, "Fixtureland", "Green", 0, 0)] });
  }
  return null;
}
