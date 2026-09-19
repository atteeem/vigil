import { test, expect } from "@playwright/test";
import { getCountryBorderPaths } from "@/lib/globe/country-borders";
import { getCityLabels, cityLabelTierForAltitude } from "@/lib/globe/city-labels";
import { LAND_FILL_COLOR, BORDER_COLOR, colorDistance } from "@/lib/globe/globe-colors";

// Deterministic coverage for the globe-readability fix (borders were
// enabled by default but invisible against the landmass fill; city
// labels didn't exist at all). Pure-function tests, same rationale as
// tests/globe-clusters.spec.ts and tests/world-map-heat.spec.ts — no
// unit-test runner besides Playwright exists in this project, and none
// of this needs a real render pass. tests/globe-rendering.spec.ts covers
// the real-browser side (layer toggle actually reaching the UI, no
// console errors).
test.describe("Globe border/label readability (lib/globe/*)", () => {
  test("1. Border color is genuinely distinct from the landmass fill it renders on top of", () => {
    // This is the regression test for the actual bug: the two used to be
    // the literal same string, which made borders invisible everywhere
    // they crossed land instead of coastline.
    expect(BORDER_COLOR).not.toBe(LAND_FILL_COLOR);
    expect(colorDistance(BORDER_COLOR, LAND_FILL_COLOR)).toBeGreaterThan(40);
  });

  test("3. colorDistance treats identical colors as zero distance", () => {
    expect(colorDistance(BORDER_COLOR, BORDER_COLOR)).toBe(0);
  });

  test("6. City labels: higher maxTier always returns a superset of a lower maxTier", () => {
    const tier1 = getCityLabels(1);
    const tier2 = getCityLabels(2);
    const tier3 = getCityLabels(3);
    expect(tier1.length).toBeGreaterThan(0);
    expect(tier2.length).toBeGreaterThan(tier1.length);
    expect(tier3.length).toBeGreaterThan(tier2.length);
    const namesAt = (list: { name: string }[]) => new Set(list.map((c) => c.name));
    const names1 = namesAt(tier1);
    const names2 = namesAt(tier2);
    for (const name of names1) expect(names2.has(name)).toBe(true);
  });

  test("7. getCityLabels(0) (or below) returns nothing — 'hide labels entirely' is a real, reachable state", () => {
    expect(getCityLabels(0)).toHaveLength(0);
  });

  test("8. Every tier-1 city is a real capital or major global city with valid coordinates", () => {
    for (const city of getCityLabels(1)) {
      expect(city.name.length).toBeGreaterThan(0);
      expect(city.lat).toBeGreaterThanOrEqual(-90);
      expect(city.lat).toBeLessThanOrEqual(90);
      expect(city.lng).toBeGreaterThanOrEqual(-180);
      expect(city.lng).toBeLessThanOrEqual(180);
    }
  });

  test("9. cityLabelTierForAltitude: world view shows tier 1 only, closer zoom reveals more, far enough out hides everything", () => {
    // The globe's own default/resting altitude (ConflictGlobe's
    // pointOfView) is ~2.15 (desktop) / ~2.6 (mobile) — both must land in
    // the tier-1-only bucket, or the very first thing a user sees would
    // be either bare (spec "world view: capitals + major cities only")
    // or already cluttered.
    expect(cityLabelTierForAltitude(2.15)).toBe(1);
    expect(cityLabelTierForAltitude(2.6)).toBe(1);
    expect(cityLabelTierForAltitude(1.5)).toBe(2);
    expect(cityLabelTierForAltitude(0.5)).toBe(3);
    expect(cityLabelTierForAltitude(3.5)).toBe(0);
  });

  test("10. cityLabelTierForAltitude is monotonically non-increasing as altitude grows (zooming out never reveals more)", () => {
    const samples = [0.3, 0.6, 0.9, 1.0, 1.5, 2.0, 2.15, 2.6, 3.0, 3.2, 4.0];
    let prev = Infinity;
    for (const altitude of samples) {
      const tier = cityLabelTierForAltitude(altitude);
      expect(tier).toBeLessThanOrEqual(prev);
      prev = tier;
    }
  });
});
