import { test, expect } from "@playwright/test";
import { resolveLocationScope } from "@/lib/geocoding/location-scope";
import { disambiguateCountryByConflictGeography } from "@/lib/ingestion/conflict-match";

// Location Resolution & Review-Queue Reduction v1 — deterministic coverage for the real gaps found
// auditing the NEEDS_REVIEW backlog (see docs/LAUNCH_DATA_HEALTH.md §17): a country-name substring
// collision that made single-country reports look ambiguous, and the country-only fallback that lets a
// country genuinely named only in the article body (not the 200-char lead) still resolve — never
// upgraded to city/region precision, since that's still exactly the incident-location evidence the
// original lead-only design was protecting.

test.describe("resolveLocationScope — country resolution (pure)", () => {
  test("a country name that is a substring of a DIFFERENT country's name is not falsely ambiguous", () => {
    // Real bug: "Guinea" is a real word inside "Papua New Guinea" / "Guinea-Bissau" / "Equatorial Guinea".
    const png = resolveLocationScope("Green forest fire notification in Papua New Guinea", "A forest fire started in Papua New Guinea.");
    expect(png.scope).toBe("country");
    expect(png.countryCode).toBe("PG");

    const bissau = resolveLocationScope("Unrest reported across Guinea-Bissau", "Officials confirmed the reports.");
    expect(bissau.countryCode).toBe("GW");

    const guinea = resolveLocationScope("Election results announced in Guinea", "The vote passed peacefully.");
    expect(guinea.countryCode).toBe("GN");
  });

  test("a short country code (UK, US) only resolves when the source itself wrote it upper-case", () => {
    const upper = resolveLocationScope("Five arrested near UK RAF base over explosives plot", "Officers made the arrests overnight.");
    expect(upper.countryCode).toBe("GB");
    // lower-case "us"/"uk" as ordinary words must never be misread as the country.
    const lower = resolveLocationScope("Let us know what you think", "Readers can share feedback below.");
    expect(lower.countryCode).toBeNull();
  });

  test("a country named only in the article body (not the lead) still resolves — country-level, marked evidenceSource body", () => {
    const result = resolveLocationScope(
      "Morning update",
      "Good morning readers. Here are the latest developments: Iran's foreign ministry issued a statement overnight regarding regional tensions.",
    );
    expect(result.scope).toBe("country");
    expect(result.countryCode).toBe("IR");
    expect(result.evidenceSource).toBe("body");
    // Still country-level only — a body-only mention never invents city/region precision.
    expect(result.latitude).toBeNull();
    expect(result.city).toBeNull();
  });

  test("a place named in the lead still takes priority over body-only country resolution, and stays lead-sourced", () => {
    const result = resolveLocationScope("Drone strike hits Kyiv overnight", "Ukrainian officials reported the incident this morning.");
    expect(result.scope).toBe("city");
    expect(result.evidenceSource).toBe("lead");
  });

  test("two countries named with nothing to prefer stays unresolved, with the codes retained for a caller to disambiguate", () => {
    const result = resolveLocationScope("Israel, Morocco agree to mutually open embassies", "The two countries' diplomats met this week.");
    expect(result.scope).toBe("unknown");
    expect(result.ambiguousCountryCodes?.sort()).toEqual(["IL", "MA"]);
  });

  test("region alias resolves without inventing city precision (Sistan and Baluchestan)", () => {
    const result = resolveLocationScope("Senior IRGC commander killed in Sistan-Baluchestan clashes", "Officials confirmed the operation.");
    expect(result.scope).toBe("region");
    expect(result.precision).toBe("region");
    expect(result.countryCode).toBe("IR");
    expect(result.city).toBeNull(); // a region centroid is never promoted to city precision
  });

  test("a genuinely non-spatial article stays unknown — country context is never invented from nothing", () => {
    const result = resolveLocationScope("Why can't the UN stop wars?", "The UN was created to help prevent conflict.");
    expect(result.scope).toBe("unknown");
    expect(result.countryCode).toBeNull();
  });
});

test.describe("Conflict-geography country disambiguation (lib/ingestion/conflict-match.ts)", () => {
  test("returns null (never guesses) when both named countries fight in the same conflict", async () => {
    // Russia and Ukraine are both listed as fighting countries for russia-ukraine — a real asymmetry
    // (attacker vs. attacked) exists in the text, but this function only uses registry fighting-geography
    // symmetry, and correctly declines to guess rather than pick one arbitrarily.
    const result = await disambiguateCountryByConflictGeography(["RU", "UA"]);
    expect(result).toBeNull();
  });

  test("returns null when the two countries don't share a single tracked conflict", async () => {
    const result = await disambiguateCountryByConflictGeography(["JP", "DE"]);
    expect(result).toBeNull();
  });
});
