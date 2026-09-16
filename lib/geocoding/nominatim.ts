import type { GeocodeCandidate, GeocodingProvider } from "@/lib/geocoding/types";

// OpenStreetMap Nominatim — free, keyless public geocoding API. Usage
// policy (https://operations.osmfoundation.org/policies/nominatim/)
// requires a descriptive User-Agent and at most ~1 request/second, which
// fits a human clicking "Search" in the admin review form. This is the
// real, network-backed GeocodingProvider; tests use
// tests/fixtures/geocoder.ts (the gazetteer) instead so the core suite
// never depends on a live third-party service.

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: { country_code?: string };
}

export const nominatimProvider: GeocodingProvider = {
  async search(query: string): Promise<GeocodeCandidate[]> {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "6");

    const res = await fetch(url, {
      headers: { "User-Agent": "VigilLocalDev/1.0 (local-development geocoding, no production traffic)" },
    });
    if (!res.ok) throw new Error(`Nominatim search failed: ${res.status} ${res.statusText}`);
    const results = (await res.json()) as NominatimResult[];

    return results.map((r) => ({
      label: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      countryCode: r.address?.country_code?.toUpperCase(),
    }));
  },
};
