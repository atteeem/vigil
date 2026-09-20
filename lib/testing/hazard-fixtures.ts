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

  // ---- v2: transport and infrastructure -----------------------------------------------------
  if (key === "faa") {
    const d = new Date(now);
    const fmt = (t: number) => {
      const x = new Date(t);
      return `${x.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${x.getUTCDate()} at ${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")} UTC.`;
    };
    const upd = `${d.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:00 ${d.getUTCFullYear()} GMT`;
    const closures = [
      // A whole-airport closure (ORD) — present in v1, reopened (absent) in v2 — and a general-aviation-only closure (LAX).
      ...(v2 ? [] : [`<Airport><ARPT>ORD</ARPT><Reason>!ORD 09/001 ORD AD AP CLSD ${now}-${now + 6 * HOUR}</Reason><Start>${fmt(now - 2 * HOUR)}</Start><Reopen>${fmt(now + 6 * HOUR)}</Reopen></Airport>`]),
      `<Airport><ARPT>LAX</ARPT><Reason>!LAX 05/277 LAX AD AP CLSD TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR</Reason><Start>${fmt(now - 20 * HOUR)}</Start><Reopen>${fmt(now + 10 * HOUR)}</Reopen></Airport>`,
    ].join("");
    const xml = `<AIRPORT_STATUS_INFORMATION><Update_Time>${upd}</Update_Time><Delay_type><Name>Ground Delay Programs</Name><Ground_Delay_List><Ground_Delay><ARPT>SFO</ARPT><Reason>low ceilings</Reason><Avg>52 minutes</Avg><Max>1 hour and 58 minutes</Max></Ground_Delay></Ground_Delay_List></Delay_type><Delay_type><Name>General Arrival/Departure Delay Info</Name><Arrival_Departure_Delay_List><Delay><ARPT>EWR</ARPT><Reason>EQ:FAA</Reason><Arrival_Departure Type="Departure"><Min>31 minutes</Min><Max>45 minutes</Max><Trend>Increasing</Trend></Arrival_Departure></Delay></Arrival_Departure_Delay_List></Delay_type><Delay_type><Name>Airport Closures</Name><Airport_Closure_List>${closures}</Airport_Closure_List></Delay_type></AIRPORT_STATUS_INFORMATION>`;
    return { body: xml, contentType: "application/xml" };
  }

  if (key === "notam") {
    const notam = (id: string, icao: string, text: string, startMin: number, endMin: number | null) => ({
      properties: { coreNOTAMData: { notam: { id, number: id.toUpperCase(), icaoLocation: icao, text, effectiveStart: iso(now + startMin * MIN), effectiveEnd: endMin === null ? "PERM" : iso(now + endMin * MIN), lastUpdated: iso(now - 5 * MIN) } } },
      geometry: null,
    });
    return json({
      items: [
        notam("fx-notam-1", "OLBA", "OLBA AD AP CLSD DUE TO SECURITY SITUATION", -180, 240),
        notam("fx-notam-2", "KZLA", "Q) KZLA/QRTCA/IV/BO/W/000/180/3345N11800W050 TEMPORARY FLIGHT RESTRICTION WI 50NM OF 3345N11800W", -60, 300),
        notam("fx-notam-3", "KSFO", "TWY A CLSD FOR MAINT", -30, 60), // routine: ignored
      ],
    });
  }

  const pw = /^portwatch\/(\w+)\/FeatureServer\/0\/query$/.exec(key);
  if (pw) {
    if (pw[1] === "PortWatch_chokepoints_database") {
      return json({ features: [{ attributes: { portid: "chokepoint6", portname: "Strait of Hormuz", lat: 26.29, lon: 56.86 } }, { attributes: { portid: "chokepoint4", portname: "Bab el-Mandeb Strait", lat: 12.79, lon: 43.35 } }, { attributes: { portid: "chokepoint1", portname: "Suez Canal", lat: 30.59, lon: 32.44 } }] });
    }
    if (pw[1] === "Daily_Chokepoints_Data") {
      const rows: unknown[] = [];
      const last = new Date(Math.floor((now - 8 * 24 * HOUR) / 86_400_000) * 86_400_000);
      for (let i = 0; i < 110; i++) {
        const date = new Date(last.getTime() - i * 86_400_000).toISOString().slice(0, 10);
        const recent = i < 7;
        rows.push({ attributes: { date, portid: "chokepoint6", n_total: recent ? (v2 ? 96 : 30) : 100 + (i % 5) } });
        rows.push({ attributes: { date, portid: "chokepoint4", n_total: recent ? 38 : 40 + (i % 3) } });
        rows.push({ attributes: { date, portid: "chokepoint1", n_total: 5 } }); // baseline too small to assess
      }
      return json({ features: rows });
    }
    if (pw[1] === "portwatch_disruptions_database") {
      return json({ features: [{ attributes: { eventid: 9100, eventtype: "TC", eventname: "Cyclone FIXTURE-26", alertlevel: "Red", country: "Fixtureland", fromdate: now - 20 * HOUR, todate: now + 30 * HOUR, severitytext: "Category 4", lat: 18.4, long: 122.3, affectedports: "Port Alpha; Port Beta", n_affectedports: 2, editdate: now - HOUR } }, { attributes: { eventid: 9101, eventtype: "FL", eventname: "Flood Greenland", alertlevel: "Green", country: "X", fromdate: now - HOUR, todate: now + HOUR, lat: 1, long: 1, affectedports: "", n_affectedports: 0 } }] });
    }
  }

  if (key === "nga") {
    const stamp = (agoH: number) => {
      const x = new Date(now - agoH * HOUR);
      const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][x.getUTCMonth()];
      return `${String(x.getUTCDate()).padStart(2, "0")}${String(x.getUTCHours()).padStart(2, "0")}${String(x.getUTCMinutes()).padStart(2, "0")}Z ${mon} ${x.getUTCFullYear()}`;
    };
    const w = (n: number, area: string, text: string, ago: number) => ({ msgYear: 2026, msgNumber: n, navArea: "A", subregion: "11", text: `${area}.\n${text}\n`, status: "A", issueDate: stamp(ago), authority: "NGA FIXTURE" });
    return json({
      "broadcast-warn": [
        w(1, "GULF OF GUINEA", "PIRATES BOARDED A TANKER AT 04-10.50N 005-20.30E. ARMED MEN REPORTED. VESSELS EXERCISE CAUTION.", 20),
        w(2, "BLACK SEA", "MINES REPORTED WITHIN FIVE MILES OF 45-07.10N 030-09.70E.", 48),
        w(3, "ATLANTIC", "NAVAL GUNNERY EXERCISES IN AREA 30-00.00N 040-00.00W. LIVE FIRING.", 10),
        w(4, "NORTH SEA", "PIRACY REPORTED IN AREA. NO POSITION GIVEN.", 5),
      ],
    });
  }

  if (key === "elexon") {
    const rem = (mrid: string, rev: number, over: Record<string, unknown>) => ({ dataset: "REMIT", mrid, revisionNumber: rev, publishTime: iso(now - 30 * MIN), messageHeading: "REMIT Information", eventType: "Production unavailability", unavailabilityType: "Unplanned", assetId: "T_FIXA-1", affectedUnit: "FIXA-1", biddingZone: "10YGB----------A", fuelType: "Gas", assetType: "Production", normalCapacity: 660, availableCapacity: 0, unavailableCapacity: 660, eventStatus: "Active", eventStartTime: iso(now - 3 * HOUR), eventEndTime: iso(now + 5 * HOUR), cause: "Boiler / Fuel supply", relatedInformation: "Automated Message:", ...over });
    return json({
      data: [
        rem("FX-A", 1, { publishTime: iso(now - 3 * HOUR) }),
        v2 ? rem("FX-A", 3, { eventStatus: "Dismissed", publishTime: iso(now - 5 * MIN) }) : rem("FX-A", 2, {}),
        rem("FX-B", 1, { unavailabilityType: "Planned" }),
        rem("FX-C", 1, { assetId: "T_FIXC-1", affectedUnit: "FIXC-1", normalCapacity: 60, unavailableCapacity: 50, availableCapacity: 10 }),
        rem("FX-D", 1, { assetId: "T_FIXD-1", affectedUnit: "FIXD-1", fuelType: "Nuclear", normalCapacity: 1200, unavailableCapacity: 900, availableCapacity: 300, cause: "Reactor cooling", eventEndTime: iso(now + 20 * HOUR) }),
      ],
    });
  }

  if (key === "entsog") {
    const umm = (id: string, over: Record<string, unknown>) => ({ id, messageId: `${id}_001`, threadId: id, marketParticipantKey: "DE-TSO-0009", marketParticipantName: "Fixture Gas Grid", publicationDateTime: iso(now - 2 * HOUR), versionNumber: "001", eventStatus: "Active", eventType: "Transmission system unavailability", eventStart: iso(now - 2 * HOUR), eventStop: iso(now + 30 * HOUR), unavailabilityType: "Unplanned", unitMeasure: "kWh/h", affectedAssetName: "Fixture Compressor Entry", unavailableCapacity: "800000.00", technicalCapacity: "1200000.00", unavailabilityReason: "Technical fault", isLatestVersion: "Yes", ...over });
    return json({ urgentMarketMessages: [umm("FX-G1", {}), umm("FX-G2", { unavailabilityType: "Planned" }), umm("FX-G3", { unavailableCapacity: "1000.00", affectedAssetName: "Fee notice" }), umm("FX-G4", { eventType: "Other", unavailabilityType: null })] });
  }

  if (key === "ioda") {
    const s = (ago: number) => Math.floor((now - ago * HOUR) / 1000);
    const row = (cc: string, name: string, ds: string, startAgoH: number, durH: number, score: number) => ({ location: `country/${cc}`, location_name: name, start: s(startAgoH), duration: Math.round(durH * 3600), datasource: ds, score, method: "median", overlaps_window: true, status: 0 });
    // v1: Lebanon anomaly ongoing on two signals; Paraguay ended, one weak signal; NZ isolated weak signal.
    // v2: the Lebanon anomaly has ended two hours ago.
    const lb = v2 ? [row("LB", "Lebanon", "bgp", 6, 4, 8000), row("LB", "Lebanon", "ping-slash24", 5.5, 3.5, 3000)] : [row("LB", "Lebanon", "bgp", 6, 7, 8000), row("LB", "Lebanon", "ping-slash24", 5.5, 6.5, 3000)];
    return json({ data: [...lb, row("PY", "Paraguay", "bgp", 30, 3, 200), row("NZ", "New Zealand", "merit-nt", 4, 1, 90)] });
  }

  return null;
}
