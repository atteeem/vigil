import { test, expect } from "@playwright/test";
import { MOCK_CONFLICTS } from "@/lib/dev-fixtures/mock-conflicts";
import { MOCK_EVENTS } from "@/lib/dev-fixtures/mock-events";
import { MOCK_NOW } from "@/lib/dev-fixtures/constants";
import { HEAT_MODEL, computeHeatField, heatInputSignature, isLandAt, sampleIntensity, type HeatConflict, type HeatIncident } from "@/lib/heat/field";
import { HEAT_GRID, cellIndexAt, distanceTransformKm, landMask } from "@/lib/heat/grid";
import { buildHeatInput } from "@/lib/heat/inputs";
import { HEAT_BASELINE, HEAT_STOPS, heatColor, heatRgb } from "@/lib/heat/scale";
import type { ConflictEvent } from "@/lib/types";

// The continuous conflict-intensity surface: pure model tests (no browser).
// Fixtures use invented places on real land so nothing depends on curated data.

const conflict = (over: Partial<HeatConflict> = {}): HeatConflict => ({
  id: "c1",
  severityScore: 82,
  confidence: 0.8,
  anchors: [{ lat: 15.5, lng: 32.5 }], // central Sudan (land)
  countryCodes: [],
  spreadKm: 0,
  ...over,
});
const incident = (over: Partial<HeatIncident> = {}): HeatIncident => ({
  id: "i1",
  lat: 50,
  lng: 10, // central Germany (land)
  severityScore: 80,
  confidence: 0.8,
  ageHours: 0,
  importance: 50,
  ...over,
});
const field = (conflicts: HeatConflict[], incidents: HeatIncident[] = []) => computeHeatField({ conflicts, incidents });
const at = (f: ReturnType<typeof field>, lat: number, lng: number) => sampleIntensity(f, lat, lng);
/** The value of the grid cell containing a point (no interpolation) — where a conflict's anchor lives. */
const cellAt = (f: ReturnType<typeof field>, lat: number, lng: number) => f.intensity[cellIndexAt(lat, lng)]!;

function makeEvent(over: Partial<ConflictEvent>): ConflictEvent {
  return {
    id: "e1", slug: "e1", title: "t", summary: "s", eventType: "other", lat: 15.5, lng: 32.5, countryCode: "SD", region: "Africa", conflictId: null,
    occurredAt: MOCK_NOW, severity: "severe", importance: 60, verificationStatus: "reported", disputed: false, sourceCount: 1, sources: [], timeline: [], ...over,
  };
}

test.describe("World grid and land mask", () => {
  test("the grid covers the world and land cells are a plausible share of it; oceans are excluded", () => {
    const land = landMask();
    expect(land.length).toBe(HEAT_GRID.cols * HEAT_GRID.rows);
    const share = land.reduce((a, b) => a + b, 0) / land.length;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.36);
    expect(isLandAt(15.5, 32.5)).toBe(true); // Sudan
    expect(isLandAt(50, 10)).toBe(true); // Germany
    expect(isLandAt(-3, -60)).toBe(true); // Amazon
    expect(isLandAt(20, -40)).toBe(false); // mid-Atlantic
    expect(isLandAt(-30, -120)).toBe(false); // South Pacific
    expect(isLandAt(30, 165)).toBe(false); // North Pacific
    // The field marks the same cells as land, so renderers paint only those.
    expect(field([]).land).toBe(land);
  });

  test("distance transform is ~geodesic: km from a source cell, ~0 inside, wrapping across the antimeridian", () => {
    const src = new Uint8Array(HEAT_GRID.cols * HEAT_GRID.rows);
    src[cellIndexAt(0, 0)] = 1;
    const d = distanceTransformKm(src);
    expect(d[cellIndexAt(0, 0)]).toBe(0);
    // 10 degrees east along the equator ~ 1112 km; 10 north ~ 1112 km; diagonal ~ 1573 km (within chamfer error).
    expect(d[cellIndexAt(0, 10)]!).toBeGreaterThan(1080);
    expect(d[cellIndexAt(0, 10)]!).toBeLessThan(1150);
    expect(d[cellIndexAt(10, 0)]!).toBeGreaterThan(1080);
    expect(d[cellIndexAt(10, 0)]!).toBeLessThan(1150);
    expect(d[cellIndexAt(10, 10)]!).toBeGreaterThan(1520);
    expect(d[cellIndexAt(10, 10)]!).toBeLessThan(1620);
    // Round: the four compass points and the diagonal agree within a few percent (no octagon).
    expect(Math.abs(d[cellIndexAt(10, 10)]! - Math.hypot(1112, 1112))).toBeLessThan(0.04 * 1573);
    // Wraps: a source at lng 179.75 is close to lng -179.75.
    const s2 = new Uint8Array(src.length);
    s2[cellIndexAt(0, 179.75)] = 1;
    expect(distanceTransformKm(s2)[cellIndexAt(0, -179.25)]!).toBeLessThan(120);
  });
});

test.describe("Continuous field", () => {
  test("every land cell has a value, floored at the baseline; values stay within 0-100", () => {
    const f = field([conflict()], [incident()]);
    const land = f.land;
    let min = 1e9;
    let max = -1;
    let landCount = 0;
    for (let i = 0; i < land.length; i++) {
      if (!land[i]) continue;
      landCount++;
      min = Math.min(min, f.intensity[i]!);
      max = Math.max(max, f.intensity[i]!);
      expect(Number.isFinite(f.intensity[i]!)).toBe(true);
    }
    expect(landCount).toBeGreaterThan(50_000);
    expect(min).toBeGreaterThanOrEqual(HEAT_BASELINE);
    expect(min).toBeLessThan(HEAT_BASELINE + 0.5); // most of the world sits at the bottom of the scale
    expect(max).toBeLessThanOrEqual(100);
  });

  test("with no conflicts the whole land surface is exactly the baseline — nothing is invented", () => {
    const f = field([]);
    expect(f.peak).toBe(HEAT_BASELINE);
    expect(at(f, 15.5, 32.5)).toBe(HEAT_BASELINE);
    expect(at(f, 50, 10)).toBe(HEAT_BASELINE);
  });

  test("a severe conflict is much hotter at its core than the baseline, and cools smoothly with distance (no cliffs)", () => {
    const f = field([conflict()]);
    const core = at(f, 15.5, 32.5);
    expect(core).toBeGreaterThan(75);
    // Walk 30 degrees north along the meridian: monotonically non-increasing, no single step larger than a few points per 0.5 degree.
    let prev = core;
    let biggestStep = 0;
    for (let lat = 15.5; lat <= 45; lat += 0.5) {
      const v = at(f, lat, 32.5);
      expect(v).toBeLessThanOrEqual(prev + 0.25);
      biggestStep = Math.max(biggestStep, prev - v);
      prev = v;
    }
    expect(biggestStep).toBeLessThan(11); // per 0.5 degree (~55 km): a gradient, not a cliff
    // Distance decay: near > middle > far > very far, ending at the baseline.
    const near = at(f, 17.5, 32.5);
    const mid = at(f, 21, 32.5);
    const far = at(f, 27, 32.5);
    const veryFar = at(f, 45, 32.5);
    expect(core).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(veryFar).toBeLessThan(HEAT_BASELINE + 0.5);
    // Distant areas get a weaker contribution than nearby ones on every side.
    expect(at(f, 15.5, 60)).toBeLessThan(at(f, 15.5, 40));
  });

  test("full-scale war (severityScore 100) reaches 100 locally and is the strongest core", () => {
    const war = field([conflict({ severityScore: 100 })]);
    expect(cellAt(war, 15.5, 32.5)).toBe(100);
    expect(at(war, 15.5, 32.5)).toBeGreaterThan(93); // smooth right around it too
    expect(war.peak).toBe(100);
    const severe = field([conflict({ severityScore: 82 })]);
    expect(at(war, 15.5, 32.5)).toBeGreaterThan(at(severe, 15.5, 32.5));
    // A broad war also reaches farther than a lesser one at the same distance.
    expect(at(war, 24, 32.5)).toBeGreaterThan(at(severe, 24, 32.5));
  });

  test("the scoring engine's active-full-scale-war rule feeds the field: extreme + active => 100 at the anchor", () => {
    const input = buildHeatInput({
      conflicts: [{ ...MOCK_CONFLICTS.find((c) => c.slug === "sudan")!, severity: "extreme", status: "active" }],
      events: [],
      nowIso: MOCK_NOW,
    });
    expect(input.conflicts[0]!.severityScore).toBe(100);
    const sudan = MOCK_CONFLICTS.find((c) => c.slug === "sudan")!;
    expect(cellAt(computeHeatField(input), sudan.lat, sudan.lng)).toBe(100);
  });

  test("many low-intensity conflicts cannot dilute a severe local value", () => {
    const severeOnly = field([conflict({ id: "war", severityScore: 90 })]);
    const crowd: HeatConflict[] = Array.from({ length: 12 }, (_, i) => conflict({ id: `low-${i}`, severityScore: 25 + i, anchors: [{ lat: 15.5 + (i % 4) * 0.5, lng: 32.5 + Math.floor(i / 4) * 0.5 }] }));
    const both = field([conflict({ id: "war", severityScore: 90 }), ...crowd]);
    for (const [lat, lng] of [[15.5, 32.5], [17, 32.5], [20, 34]] as const) {
      expect(at(both, lat, lng)).toBeGreaterThanOrEqual(at(severeOnly, lat, lng) - 1e-6);
    }
    // ...and a stack of lows alone never reaches severe-conflict territory.
    expect(field(crowd).peak).toBeLessThan(60);
    // Stacking is bounded: overlapping severe conflicts never exceed 100.
    const stacked = field(Array.from({ length: 6 }, (_, i) => conflict({ id: `s${i}`, severityScore: 95 })));
    expect(stacked.peak).toBeLessThanOrEqual(100);
  });

  test("a town-scale incident stays local; a regional conflict is broad", () => {
    const local = field([], [incident({ importance: 20 })]);
    const regional = field([conflict({ severityScore: 90, anchors: [{ lat: 50, lng: 10 }], spreadKm: 600 })]);
    expect(at(local, 50, 10)).toBeGreaterThan(HEAT_BASELINE + 20);
    // ~350 km away the incident is gone; the regional war is still well above baseline.
    expect(at(local, 53.2, 10)).toBeLessThan(HEAT_BASELINE + 1);
    expect(at(regional, 53.2, 10)).toBeGreaterThan(HEAT_BASELINE + 20);
  });
});

test.describe("Incidents: recency", () => {
  test("a recent incident raises the local field above the sustained base and creates a hotter core", () => {
    const base = field([conflict({ severityScore: 60 })]);
    const withStrike = field([conflict({ severityScore: 60 })], [incident({ lat: 15.5, lng: 32.5, severityScore: 92, ageHours: 1, importance: 60 })]);
    expect(at(withStrike, 15.5, 32.5)).toBeGreaterThan(at(base, 15.5, 32.5) + 15);
  });

  test("a stale incident decays and eventually disappears; a sustained conflict base does not decay with report age", () => {
    const at0 = at(field([], [incident({ ageHours: 0 })]), 50, 10);
    const at30 = at(field([], [incident({ ageHours: HEAT_MODEL.incidentHalfLifeHours })]), 50, 10);
    const at90 = at(field([], [incident({ ageHours: 90 })]), 50, 10);
    expect(at30).toBeLessThan(at0);
    expect(at90).toBeLessThan(at30);
    // Half-life: excess over baseline roughly halves.
    expect((at30 - HEAT_BASELINE) / (at0 - HEAT_BASELINE)).toBeGreaterThan(0.42);
    expect((at30 - HEAT_BASELINE) / (at0 - HEAT_BASELINE)).toBeLessThan(0.58);
    expect(at(field([], [incident({ ageHours: HEAT_MODEL.incidentMaxAgeHours + 1 })]), 50, 10)).toBe(HEAT_BASELINE);
    // A future incident is not part of the state.
    expect(at(field([], [incident({ ageHours: -5 })]), 50, 10)).toBe(HEAT_BASELINE);
    // The conflict base has no age input: it is the same whether or not incidents are old.
    const base = field([conflict()], [incident({ id: "old", lat: 15.5, lng: 32.5, ageHours: 160 })]);
    expect(at(base, 15.5, 32.5)).toBeGreaterThan(at(field([conflict()]), 15.5, 32.5) - 1e-6);
  });
});

test.describe("Inputs: what does and does not set the heat", () => {
  test("report count never changes severity or intensity: a well-reported event is not hotter than a barely-reported one", () => {
    const sources = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `S${i}`, sourceType: "news", publishedAt: MOCK_NOW, url: "" }) as unknown as ConflictEvent["sources"][number]);
    const few = buildHeatInput({ events: [makeEvent({ id: "few", sourceCount: 1, sources: sources(1) })], nowIso: MOCK_NOW });
    const many = buildHeatInput({ events: [makeEvent({ id: "many", sourceCount: 40, sources: sources(40) })], nowIso: MOCK_NOW });
    expect(many.incidents[0]!.severityScore).toBe(few.incidents[0]!.severityScore);
    // Only the visual-only confidence differs.
    expect(many.incidents[0]!.confidence).toBeGreaterThan(few.incidents[0]!.confidence);
    const a = computeHeatField({ conflicts: [], incidents: [{ ...few.incidents[0]!, id: "x" }] });
    const b = computeHeatField({ conflicts: [], incidents: [{ ...many.incidents[0]!, id: "x" }] });
    expect(Array.from(b.intensity)).toEqual(Array.from(a.intensity));
  });

  test("many low-severity events in one conflict do not make it red (severity is the worst event's, not a count)", () => {
    const events = Array.from({ length: 30 }, (_, i) => makeEvent({ id: `low-${i}`, conflictId: "c-many", severity: "guarded", importance: 30, lat: 15.5 + (i % 5) * 0.2, lng: 32.5 + Math.floor(i / 5) * 0.2 }));
    const f = computeHeatField(buildHeatInput({ events, nowIso: MOCK_NOW }));
    expect(f.peak).toBeLessThan(65);
    const one = computeHeatField(buildHeatInput({ events: [makeEvent({ id: "sev", conflictId: "c-one", severity: "severe" })], nowIso: MOCK_NOW }));
    expect(one.peak).toBeGreaterThan(75);
  });

  test("inactive conflicts (dormant/ended) add no sustained base; active and reduced ones do", () => {
    const base = MOCK_CONFLICTS.find((c) => c.slug === "russia-ukraine")!;
    const count = (status: (typeof base)["status"]) => buildHeatInput({ conflicts: [{ ...base, status }], events: [], nowIso: MOCK_NOW }).conflicts.length;
    expect(count("active")).toBe(1);
    expect(count("reduced")).toBe(1);
    expect(count("dormant")).toBe(0);
    expect(count("ended")).toBe(0);
    expect(count("resolved")).toBe(0);
  });

  test("the sustained base follows the conflict's own fighting-country geography, not a fixed circle", () => {
    // UA is a fighting country: cells inside Ukraine near the anchor are core; far Western Europe is baseline.
    const ua = MOCK_CONFLICTS.find((c) => c.slug === "russia-ukraine")!;
    const f = computeHeatField(buildHeatInput({ conflicts: [ua], events: [], nowIso: MOCK_NOW }));
    expect(at(f, 50.4, 30.5)).toBeGreaterThan(50); // Kyiv, inside the fighting country
    expect(at(f, 48.9, 2.3)).toBeLessThan(HEAT_BASELINE + 1); // Paris
    expect(at(f, -3, -60)).toBe(HEAT_BASELINE); // Amazon
  });

  test("border safety: a Severity-100 war does not paint a directly bordering, non-fighting country orange/red merely from proximity (Final Intelligence Consistency & Map Correctness v1 §6)", () => {
    // Real-world regression case named in the spec: Russia-Ukraine, canonical Severity 100 (active
    // full-scale war), must not make Belarus/Poland/Moldova read as though fighting is happening there —
    // they are not in fightingCountryCodes ["UA", "RU"], so under the fix they can only warm from genuine
    // anchor proximity (a short, anchor-distance-only decay), never from the country-wide "whole fighting
    // nation is core" treatment that legitimately keeps Kyiv hot.
    const ua = MOCK_CONFLICTS.find((c) => c.slug === "russia-ukraine")!;
    expect(ua.fullScaleWar).toBe(true);
    const f = computeHeatField(buildHeatInput({ conflicts: [ua], events: [], nowIso: MOCK_NOW }));
    // Kyiv still reads as a real war zone (unchanged from the test above).
    expect(at(f, 50.4, 30.5)).toBeGreaterThan(50);
    // Neighbors: nowhere near "red" (76+) or even "orange" (61+) — the old country-mask-edge decay put
    // a cell just across the border at ~0 km from "core", i.e. close to full amplitude; the fix requires
    // real distance from an actual anchor instead.
    const minsk = at(f, 53.9, 27.57); // Belarus
    const warsaw = at(f, 52.23, 21.0); // Poland
    const chisinau = at(f, 47.01, 28.86); // Moldova
    for (const [place, v] of [["Minsk", minsk], ["Warsaw", warsaw], ["Chisinau", chisinau]] as const) {
      expect(v, place).toBeLessThan(61);
    }
    // Warsaw, being farthest, is at least as cool as the two nearer neighbors.
    expect(warsaw).toBeLessThanOrEqual(minsk + 1e-6);
    expect(warsaw).toBeLessThanOrEqual(chisinau + 1e-6);
  });

  test("border safety generalizes beyond the named Russia-Ukraine case: Sudan, Myanmar and Israel-Palestine neighbors (§6)", () => {
    // The fix is generic (per-cell inCountry branch in conflictContribution, no conflict-specific logic),
    // but §6 explicitly asks that Israel-Palestine, Sudan and Myanmar also be inspected, not assumed.
    const sudan = MOCK_CONFLICTS.find((c) => c.slug === "sudan")!;
    const fSudan = computeHeatField(buildHeatInput({ conflicts: [sudan], events: [], nowIso: MOCK_NOW }));
    expect(at(fSudan, 15.5, 32.5)).toBeGreaterThan(50); // Khartoum area, inside the fighting country (SD)
    const ndjamena = at(fSudan, 12.1, 15.0); // Chad
    const cairo = at(fSudan, 30.0, 31.2); // Egypt
    for (const [place, v] of [["N'Djamena", ndjamena], ["Cairo", cairo]] as const) {
      expect(v, place).toBeLessThan(61);
    }

    const myanmar = MOCK_CONFLICTS.find((c) => c.slug === "myanmar")!;
    const fMyanmar = computeHeatField(buildHeatInput({ conflicts: [myanmar], events: [], nowIso: MOCK_NOW }));
    expect(at(fMyanmar, 21.9, 96.0)).toBeGreaterThan(30); // inside Myanmar (MM)
    const maesot = at(fMyanmar, 16.7, 98.57); // Thailand
    const coxsbazar = at(fMyanmar, 21.45, 91.97); // Bangladesh
    for (const [place, v] of [["Mae Sot", maesot], ["Cox's Bazar", coxsbazar]] as const) {
      expect(v, place).toBeLessThan(61);
    }

    const israelPalestine = MOCK_CONFLICTS.find((c) => c.slug === "israel-palestine")!;
    const fIP = computeHeatField(buildHeatInput({ conflicts: [israelPalestine], events: [], nowIso: MOCK_NOW }));
    // Jordan/Sinai sit genuinely close to Gaza/the West Bank (~100-150 km) — real, evidence-based proximity
    // decay legitimately keeps them warmer than Ukraine's 900+ km neighbors, which is not the failure mode
    // §6 guards against. Riyadh and Baghdad are comparably distant, uninvolved neighbors instead.
    const riyadh = at(fIP, 24.71, 46.68); // Saudi Arabia
    const baghdad = at(fIP, 33.31, 44.36); // Iraq
    for (const [place, v] of [["Riyadh", riyadh], ["Baghdad", baghdad]] as const) {
      expect(v, place).toBeLessThan(61);
    }
  });

  test("historical asOf: only events known at that time count, and ages are measured from asOf", () => {
    const events = [makeEvent({ id: "past", occurredAt: "2026-09-10T12:00:00Z", lat: 50, lng: 10, severity: "severe", conflictId: "c-hist" }), makeEvent({ id: "later", occurredAt: "2026-09-14T12:00:00Z", lat: -3, lng: -60, severity: "extreme", conflictId: "c-later" })];
    const early = computeHeatField(buildHeatInput({ events, nowIso: "2026-09-10T18:00:00Z" }));
    const late = computeHeatField(buildHeatInput({ events, nowIso: "2026-09-14T13:00:00Z" }));
    // At the early time the later event has not happened: no heat at its location.
    expect(at(early, -3, -60)).toBe(HEAT_BASELINE);
    expect(at(early, 50, 10)).toBeGreaterThan(HEAT_BASELINE + 20);
    // Later: the new one is hot; the old incident has decayed (its conflict base persists).
    expect(at(late, -3, -60)).toBeGreaterThan(HEAT_BASELINE + 50);
    expect(early.signature).not.toBe(late.signature);
    // Live mode: an event dated after the reference time counts as brand new instead of being dropped.
    const live = buildHeatInput({ events: [makeEvent({ id: "fresh", occurredAt: "2026-12-01T00:00:00Z" })], nowIso: MOCK_NOW, live: true });
    expect(live.incidents).toHaveLength(1);
    expect(live.incidents[0]!.ageHours).toBe(0);
    expect(buildHeatInput({ events: [makeEvent({ id: "fresh", occurredAt: "2026-12-01T00:00:00Z" })], nowIso: MOCK_NOW }).incidents).toHaveLength(0);
  });
});

test.describe("Determinism and shared logic", () => {
  test("identical inputs give byte-identical fields, regardless of input order", () => {
    const a = buildHeatInput({ conflicts: MOCK_CONFLICTS, events: MOCK_EVENTS, nowIso: MOCK_NOW });
    const b = { conflicts: [...a.conflicts].reverse(), incidents: [...a.incidents].reverse() };
    const fa = computeHeatField(a);
    const fb = computeHeatField(b);
    expect(heatInputSignature(a)).toBe(heatInputSignature(b));
    expect(Array.from(fb.intensity)).toEqual(Array.from(fa.intensity));
    // Fresh recompute (bypassing the memo) matches too.
    const fc = computeHeatField({ conflicts: a.conflicts.map((c) => ({ ...c })), incidents: [...a.incidents].map((i) => ({ ...i, ageHours: i.ageHours + 0 })) });
    expect(Array.from(fc.intensity)).toEqual(Array.from(fa.intensity));
  });

  test("the flat map and the globe use the same builder and the same field for the same data", () => {
    // Both call hooks/use-heat-field -> buildHeatInput -> computeHeatField; a second, independent call is the same object/value.
    const one = computeHeatField(buildHeatInput({ conflicts: MOCK_CONFLICTS, events: MOCK_EVENTS, nowIso: MOCK_NOW, live: true }));
    const two = computeHeatField(buildHeatInput({ conflicts: MOCK_CONFLICTS, events: MOCK_EVENTS, nowIso: MOCK_NOW, live: true }));
    expect(two).toBe(one);
    expect(one.peak).toBe(100); // Sudan is a full-scale active war in the curated data
    // Severe conflicts in the curated data are clearly hot at their anchors.
    for (const slug of ["russia-ukraine", "sudan", "israel-palestine"]) {
      const c = MOCK_CONFLICTS.find((x) => x.slug === slug)!;
      expect(at(one, c.lat, c.lng), slug).toBeGreaterThan(75);
    }
    // ...and a quiet place stays at the bottom of the scale.
    expect(at(one, -25, 135)).toBe(HEAT_BASELINE);
  });
});

test.describe("Color scale", () => {
  test("one centralized, monotonic-in-severity scale: blue low, neutral, yellow, orange, red, deep red", () => {
    const [r0, g0, b0] = heatRgb(0);
    expect(b0).toBeGreaterThan(r0); // cool blue
    expect(b0).toBeGreaterThan(g0);
    const low = heatRgb(HEAT_BASELINE);
    expect(low[2]).toBeGreaterThan(low[0]); // baseline is blue, never bright
    expect(Math.max(...low)).toBeLessThan(140);
    const yellow = heatRgb(55);
    expect(yellow[0]).toBeGreaterThan(200);
    expect(yellow[1]).toBeGreaterThan(170);
    expect(yellow[2]).toBeLessThan(100);
    const orange = heatRgb(68);
    expect(orange[0]).toBeGreaterThan(220);
    expect(orange[1]).toBeGreaterThan(100);
    expect(orange[1]).toBeLessThan(170);
    const red = heatRgb(82);
    expect(red[0]).toBeGreaterThan(190);
    expect(red[1]).toBeLessThan(90);
    const deep = heatRgb(95);
    const strongest = heatRgb(100);
    expect(deep[0]).toBeLessThan(red[0]);
    expect(strongest[0]).toBeLessThan(deep[0]);
    expect(strongest[0]).toBeGreaterThan(80); // still red, not black
    // Stops are ordered and cover 0-100.
    expect(HEAT_STOPS[0]!.at).toBe(0);
    expect(HEAT_STOPS[HEAT_STOPS.length - 1]!.at).toBe(100);
    // Smooth: adjacent intensities differ by little (no banding).
    for (let v = 0; v < 100; v += 1) {
      const a = heatRgb(v);
      const b = heatRgb(v + 1);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(40);
    }
  });

  test("confidence only nudges saturation/opacity and never turns a severe conflict into a low-intensity color", () => {
    const sure = heatColor(90, 1);
    const unsure = heatColor(90, 0);
    expect(unsure.a).toBeLessThan(sure.a);
    expect(unsure.a).toBeGreaterThan(sure.a * 0.8); // subtle
    expect(unsure.r).toBeGreaterThan(unsure.b + 60); // still clearly red
    expect(unsure.r).toBeGreaterThan(heatColor(20, 1).r + 60);
    // Same intensity, different confidence: the hue ordering is unchanged.
    expect(heatColor(72, 0.2).r).toBeGreaterThan(heatColor(72, 0.2).b);
  });
});
