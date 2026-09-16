// Geocoding provider abstraction (spec §4: "Keep provider behind an
// interface so it can be changed later"). Never silently resolves an
// ambiguous place name — callers always get every candidate back and a
// human picks.

export interface GeocodeCandidate {
  label: string; // e.g. "Novoselivka, Donetsk Oblast, Ukraine"
  lat: number;
  lng: number;
  countryCode?: string;
  region?: string;
}

export interface GeocodingProvider {
  search(query: string): Promise<GeocodeCandidate[]>;
}
