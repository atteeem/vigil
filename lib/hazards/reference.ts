import airportData from "@/data/airports.json";
import centroidData from "@/data/country-centroids.json";

// Static reference data used to LOCATE structured events that name a place but carry no coordinates.
// Airports: OurAirports (public domain), large airports and scheduled-service medium airports.
// Country centroids: Natural Earth label points (public domain). A country-level marker is an honest
// "somewhere in this country" (locationPrecision area_level), never a facility position.

export interface AirportRef {
  icao: string;
  iata: string;
  name: string;
  lat: number;
  lng: number;
  country: string;
  size: "L" | "M";
}

const airports: AirportRef[] = (airportData.airports as (string | number)[][]).map((a) => ({ icao: a[0] as string, iata: a[1] as string, name: a[2] as string, lat: a[3] as number, lng: a[4] as number, country: a[5] as string, size: a[6] as "L" | "M" }));
const byIata = new Map(airports.filter((a) => a.iata).map((a) => [a.iata, a]));
const byIcao = new Map(airports.filter((a) => a.icao).map((a) => [a.icao, a]));

export const findAirport = (code: string | null | undefined): AirportRef | null => {
  const c = (code ?? "").trim().toUpperCase();
  return byIata.get(c) ?? byIcao.get(c) ?? null;
};

export function searchAirports(query: string, limit = 5): AirportRef[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return airports.filter((a) => a.iata.toLowerCase() === q || a.icao.toLowerCase() === q || a.name.toLowerCase().includes(q)).slice(0, limit);
}

const centroids = centroidData as unknown as Record<string, [number, number, string]>;
const codeByName = new Map(Object.entries(centroids).map(([code, v]) => [v[2].toLowerCase(), code]));
const US_STATES = new Set(["alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming", "puerto rico"]);
const NAME_ALIASES: Record<string, string> = { "united states": "US", usa: "US", russia: "RU", "south korea": "KR", "north korea": "KP", "czech republic": "CZ", "ivory coast": "CI", burma: "MM", "myanmar (burma)": "MM" };

/** ISO country from a USGS-style place string ("62 km SW of Town, Japan"): exact country / US-state names only, never guessed. */
export function countryFromPlace(place: string | null | undefined): string | null {
  const last = (place ?? "").split(",").pop()?.trim().toLowerCase() ?? "";
  if (!last) return null;
  if (US_STATES.has(last)) return "US";
  return NAME_ALIASES[last] ?? codeByName.get(last) ?? null;
}

/** Every country we can name (the reference list plus the Natural Earth centroid table). */
export function allCountries(): { code: string; name: string }[] {
  return Object.entries(centroids).map(([code, v]) => ({ code, name: v[2] }));
}

export function countryCentroid(iso2: string | null | undefined): { lat: number; lng: number; name: string } | null {
  const c = iso2 ? centroids[iso2.toUpperCase()] : undefined;
  return c ? { lat: c[0], lng: c[1], name: c[2] } : null;
}
