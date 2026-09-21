import { test, expect } from "@playwright/test";
import { resolveLocationScope } from "@/lib/geocoding/location-scope";
import { normalizeLocation, PublishError } from "@/lib/ingestion/publish-item";
import { locationDraftError, SCOPE_RULES } from "@/lib/geocoding/scope-rules";
import { cleanText, deriveSummary, deriveTitle, setSummaryProvider } from "@/lib/ingestion/text-summary";

// Hierarchical location: how much the source tells us (never what the map needs), the publish rules per scope, and
// the automatic title / summary. Pure: no server.

test.describe("location resolution hierarchy", () => {
  test("a country-level article resolves to the country with no coordinates and no marker", () => {
    const r = resolveLocationScope("Libya's central bank names a new governor", "The appointment follows months of dispute over the bank's leadership.");
    expect(r).toMatchObject({ scope: "country", precision: "country", countryCode: "LY", latitude: null, longitude: null, city: null, adminRegion: null });
    expect(r.evidence).toContain("no map point");
  });

  test("a region-only report gets the region, its centroid as a render point, and precision REGION (never exact)", () => {
    const r = resolveLocationScope("Air raid alert declared across Zhytomyr Oblast", "Regional authorities urged residents to stay in shelters.");
    expect(r).toMatchObject({ scope: "region", precision: "region", countryCode: "UA", adminRegion: "Zhytomyr Oblast" });
    expect(r.latitude).toBeCloseTo(50.6, 0);
    expect(r.precision).not.toBe("exact");
    expect(r.evidence).toContain("centroid");
    expect(r.city).toBeNull();
  });

  test("a bare city-like word without the administrative suffix is not silently turned into the region", () => {
    const r = resolveLocationScope("Officials in Zhytomyr comment on the budget", "The council met on Monday.");
    expect(r.scope).not.toBe("region");
  });

  test("a city-only report gets CITY precision and the canonical city coordinates", () => {
    const r = resolveLocationScope("Drone strike hits Kharkiv overnight", "Local officials said several buildings were damaged.");
    expect(r).toMatchObject({ scope: "city", precision: "city", city: "Kharkiv", countryCode: "UA" });
    expect(r.latitude).toBeCloseTo(49.99, 1);
    expect(r.evidence).toContain("not the incident point");
  });

  test("a place that only appears later in background text does not set the location", () => {
    const r = resolveLocationScope("Government approves next year's budget", "Ministers met on Monday. Last year, strikes near Kyiv delayed the vote.");
    expect(r.scope).toBe("unknown");
    expect(r.latitude).toBeNull();
  });

  test("places in different countries are ambiguous, not a guess", () => {
    const r = resolveLocationScope("Kyiv and Moscow trade accusations", "Both sides denied the claims.");
    expect(r.scope).toBe("unknown");
    expect(r.latitude).toBeNull();
  });

  test("a name shared by several places is never auto-resolved", () => {
    const r = resolveLocationScope("Shelling reported near Novoselivka", "Officials gave no details.");
    expect(r.scope).not.toBe("city");
    expect(r.notes.join(" ")).toContain("several places");
  });

  test("nothing usable stays unknown, with no coordinates", () => {
    const r = resolveLocationScope("Markets close higher on Friday", "Investors welcomed the data.");
    expect(r).toMatchObject({ scope: "unknown", precision: "unknown", latitude: null, longitude: null, countryCode: null });
  });
});

test.describe("publish rules per geographic scope", () => {
  test("country scope needs a country and never keeps coordinates", () => {
    expect(() => normalizeLocation({ locationScope: "country" })).toThrow(PublishError);
    const n = normalizeLocation({ locationScope: "country", countryCode: "ly", latitude: 27, longitude: 17 });
    expect(n).toMatchObject({ scope: "country", precision: "country", countryCode: "LY", latitude: null, longitude: null });
  });

  test("region scope needs region and country; the centroid is used but the precision stays REGION", () => {
    expect(() => normalizeLocation({ locationScope: "region", countryCode: "UA" })).toThrow(/region/i);
    const n = normalizeLocation({ locationScope: "region", countryCode: "UA", adminRegion: "Zhytomyr Oblast" });
    expect(n.precision).toBe("region");
    expect(n.latitude).toBeCloseTo(50.6, 0);
    const unknownRegion = normalizeLocation({ locationScope: "region", countryCode: "UA", adminRegion: "Nowhere Oblast" });
    expect(unknownRegion).toMatchObject({ precision: "region", latitude: null, longitude: null });
  });

  test("city scope resolves gazetteer coordinates, precision CITY; unresolvable cities are an error", () => {
    const n = normalizeLocation({ locationScope: "city", city: "Kharkiv", countryCode: "UA" });
    expect(n).toMatchObject({ precision: "city", scope: "city" });
    expect(n.latitude).toBeCloseTo(49.99, 1);
    expect(() => normalizeLocation({ locationScope: "city", city: "Atlantis" })).toThrow(/Coordinates for "Atlantis"/);
    expect(() => normalizeLocation({ locationScope: "city" })).toThrow(/city/i);
  });

  test("an exact point still supports exact coordinates; a point without them is an error", () => {
    expect(normalizeLocation({ locationScope: "point", latitude: 50.45, longitude: 30.52 })).toMatchObject({ scope: "point", precision: "exact", latitude: 50.45, longitude: 30.52 });
    expect(() => normalizeLocation({ locationScope: "point" })).toThrow(/latitude/i);
    // Older callers: coordinates without a scope mean a point, keeping their given precision.
    expect(normalizeLocation({ latitude: 1, longitude: 2, locationPrecision: "approximate" })).toMatchObject({ scope: "point", precision: "approximate" });
  });

  test("unknown and global carry no point and are publishable", () => {
    expect(normalizeLocation({ locationScope: "unknown", latitude: 1, longitude: 2 })).toMatchObject({ scope: "unknown", latitude: null, longitude: null, precision: "unknown" });
    expect(normalizeLocation({})).toMatchObject({ scope: "unknown", latitude: null });
    expect(normalizeLocation({ locationScope: "global", countryCode: "FR" })).toMatchObject({ scope: "global", countryCode: null, latitude: null });
  });
});

test.describe("review form requirements follow the scope", () => {
  const base = { countryCode: "", adminRegion: "", city: "", latitude: "", longitude: "" };
  test("coordinates are mandatory only for an exact point", () => {
    for (const scope of ["global", "country", "region", "city", "unknown"] as const) expect(SCOPE_RULES[scope].coordinates).not.toBe("required");
    expect(SCOPE_RULES.point.coordinates).toBe("required");
    expect(locationDraftError({ ...base, locationScope: "point" })).toMatch(/latitude and longitude/);
    expect(locationDraftError({ ...base, locationScope: "point", latitude: "50", longitude: "30" })).toBeNull();
    expect(locationDraftError({ ...base, locationScope: "point", latitude: "95", longitude: "30" })).toMatch(/range/);
  });
  test("country, region and city scopes ask for their own fields, not coordinates", () => {
    expect(locationDraftError({ ...base, locationScope: "country" })).toMatch(/country/i);
    expect(locationDraftError({ ...base, locationScope: "country", countryCode: "LY" })).toBeNull();
    expect(locationDraftError({ ...base, locationScope: "region", countryCode: "UA" })).toMatch(/region/i);
    expect(locationDraftError({ ...base, locationScope: "region", countryCode: "UA", adminRegion: "Zhytomyr Oblast" })).toBeNull();
    expect(locationDraftError({ ...base, locationScope: "city", countryCode: "UA" })).toMatch(/city/i);
    expect(locationDraftError({ ...base, locationScope: "unknown" })).toBeNull();
    expect(locationDraftError({ ...base, locationScope: "global" })).toBeNull();
  });
});

test.describe("automatic title and summary", () => {
  test("a good source headline is reused unchanged", () => {
    expect(deriveTitle("Russia election results show Putin's party winning: What we know", "Body text.")).toEqual({ title: "Russia election results show Putin's party winning: What we know", source: "source_title" });
  });
  test("an unusable headline falls back to the first sentence of the text, and to nothing rather than inventing one", () => {
    expect(deriveTitle("", "Rescue teams reached the village on Sunday. More followed.")).toEqual({ title: "Rescue teams reached the village on Sunday.", source: "text_excerpt" });
    expect(deriveTitle("", "").source).toBe("none");
  });
  test("the summary is the source's own opening sentences: nothing added, markup and entities cleaned", async () => {
    const text = "<p>Officials said 3 people were <b>killed</b> &amp; 5 injured in the town.</p><p>The ministry gave no further details. Investigators arrived later. A third sentence.</p>";
    const s = await deriveSummary("Deadly attack in town", text);
    expect(s.source).toBe("source_excerpt");
    expect(s.summary).toBe("Officials said 3 people were killed & 5 injured in the town. The ministry gave no further details.");
    // Every number in the summary is in the source (no invented casualty figures).
    for (const n of s.summary.match(/\d+/g) ?? []) expect(cleanText(text)).toContain(n);
    expect((await deriveSummary("Only a headline here", "")).source).toBe("title_only");
  });
  test("a failing or absent AI provider never blocks the summary", async () => {
    setSummaryProvider(async () => {
      throw new Error("provider down");
    });
    try {
      expect((await deriveSummary("Headline of the report", "First sentence of the report text. Second one.")).source).toBe("source_excerpt");
      setSummaryProvider(async () => "A neutral AI summary.");
      expect(await deriveSummary("Headline of the report", "First sentence of the report text.")).toEqual({ summary: "A neutral AI summary.", source: "ai" });
    } finally {
      setSummaryProvider(null);
    }
  });
});
