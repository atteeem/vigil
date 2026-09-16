import type { GeocodingProvider } from "@/lib/geocoding/types";
import { gazetteerProvider, gazetteerLookup } from "@/lib/geocoding/gazetteer";
import { nominatimProvider } from "@/lib/geocoding/nominatim";

const combinedProvider: GeocodingProvider = {
  async search(query: string) {
    const local = gazetteerLookup(query);
    if (local.length > 0) return local;
    return nominatimProvider.search(query);
  },
};

/** GEOCODING_PROVIDER=fixture forces gazetteer-only (no network), keeping
 * Playwright's automated suite fully deterministic — set in
 * playwright.config.ts's webServer env. Real dev/admin use falls through
 * to Nominatim for anything not in the local gazetteer. */
export function getGeocodingProvider(): GeocodingProvider {
  return process.env.GEOCODING_PROVIDER === "fixture" ? gazetteerProvider : combinedProvider;
}
