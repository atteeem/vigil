import { gazetteerLookup, gazetteerPlaceNames } from "@/lib/geocoding/gazetteer";
import { ADMIN_REGIONS, type AdminRegion } from "@/lib/geocoding/admin-regions";
import { COUNTRY_RECORDS, normalizeName } from "@/lib/countries/registry";
import type { LocationPrecision, LocationScope } from "@/lib/types/db";

// Hierarchical location resolution for a report. It answers "how much does the source actually tell us?", never
// "what does the map need?":
//   city named          -> scope city,    precision city,    the city's canonical coordinates
//   admin region named  -> scope region,  precision region,  the region's canonical CENTROID (a render point)
//   country only        -> scope country, precision country, NO coordinates (no fake marker)
//   nothing reliable    -> scope unknown, precision unknown, no coordinates
// Only the report's LEAD (the headline plus the first sentence of the text) is considered: a place mentioned later in
// background text does not say where the event happened. Several different places in the lead are ambiguous and are
// reduced to what they share (same region -> region, same country -> country, otherwise unknown) instead of picking
// one. This resolver never returns scope "point": an exact point is only ever entered by a person.

/** At most this many characters of the FIRST sentence of the body count as the lead (after the headline). */
export const LEAD_CHARS = 200;

/** The lead of a report: its headline and the first sentence of its text. */
export function leadOf(title: string, body: string): string {
  const first = body.trim().match(/^[^.!?]*[.!?]?/)?.[0] ?? "";
  return `${title.trim()}. ${first.slice(0, LEAD_CHARS)}`;
}

export interface ResolvedLocationScope {
  scope: LocationScope;
  precision: LocationPrecision;
  countryCode: string | null;
  countryName: string | null;
  adminRegion: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  /** What justified the assignment, in words, for the reviewer and the stored record. */
  evidence: string;
  /** Places named that could not be resolved to one (ambiguous name, several countries...). */
  notes: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

function findWord(haystack: string, needle: string): number {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${esc(fold(needle))}(?![\\p{L}\\p{N}])`, "u").exec(haystack);
  return m ? m.index : -1;
}

interface CountryHit {
  code: string;
  name: string;
  at: number;
}

// Names and aliases of at least 4 letters (short aliases such as "US" or "UK" collide with ordinary words).
const COUNTRY_TERMS = COUNTRY_RECORDS.flatMap((c) => [c.name, ...c.aliases].filter((t) => normalizeName(t).length >= 4).map((t) => ({ term: t, code: c.code, name: c.name })));

function countriesIn(text: string): CountryHit[] {
  const seen = new Map<string, CountryHit>();
  for (const { term, code, name } of COUNTRY_TERMS) {
    const at = findWord(text, term);
    if (at >= 0 && (!seen.has(code) || at < seen.get(code)!.at)) seen.set(code, { code, name, at });
  }
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

const countryNameOf = (code: string | null) => (code ? (COUNTRY_RECORDS.find((c) => c.code === code)?.name ?? null) : null);

const NONE: ResolvedLocationScope = { scope: "unknown", precision: "unknown", countryCode: null, countryName: null, adminRegion: null, city: null, latitude: null, longitude: null, evidence: "No reliable location in the headline or opening text.", notes: [] };

/** Region matches in the lead, longest alias first, not overlapping. */
function regionsIn(text: string): { region: AdminRegion; at: number; alias: string }[] {
  const out: { region: AdminRegion; at: number; alias: string }[] = [];
  const claimed: [number, number][] = [];
  const candidates = ADMIN_REGIONS.flatMap((r) => r.aliases.map((alias) => ({ r, alias, bare: !/\b(oblast|region|province|state)\b/i.test(alias) }))).sort((a, b) => b.alias.length - a.alias.length);
  for (const { r, alias, bare } of candidates) {
    if (bare && !r.bareOk) continue;
    const at = findWord(text, alias);
    if (at < 0) continue;
    const end = at + fold(alias).length;
    if (claimed.some(([s, e]) => at < e && end > s)) continue;
    if (out.some((o) => o.region.name === r.name)) continue;
    claimed.push([at, end]);
    out.push({ region: r, at, alias });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** City matches in the lead (gazetteer), skipping spans already claimed by a region name ("Kharkiv Oblast"). */
function citiesIn(text: string, claimed: [number, number][]): { name: string; at: number; unique: boolean; lat?: number; lng?: number; countryCode?: string; adminRegion?: string; label?: string }[] {
  const out: { name: string; at: number; unique: boolean; lat?: number; lng?: number; countryCode?: string; adminRegion?: string; label?: string }[] = [];
  for (const name of gazetteerPlaceNames()) {
    const at = findWord(text, name);
    if (at < 0) continue;
    const end = at + name.length;
    if (claimed.some(([s, e]) => at < e && end > s)) continue;
    if (out.some((o) => at < o.at + o.name.length && end > o.at)) continue; // "gaza" inside "gaza city"
    const hits = gazetteerLookup(name);
    if (hits.length === 1) {
      const h = hits[0]!;
      const parts = h.label.split(",").map((p) => p.trim());
      const admin = parts.slice(1).find((p) => /\b(Oblast|Region|Province|State|Governorate)\b/i.test(p));
      out.push({ name, at, unique: true, lat: h.lat, lng: h.lng, countryCode: h.countryCode, adminRegion: admin, label: h.label });
    } else out.push({ name, at, unique: false });
  }
  return out.sort((a, b) => a.at - b.at);
}

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

export function resolveLocationScope(title: string, body: string): ResolvedLocationScope {
  const head = title.trim();
  const lead = leadOf(head, body);
  const text = fold(lead);
  const notes: string[] = [];
  const inTitle = (at: number) => at <= head.length;

  const regions = regionsIn(text);
  const claimed: [number, number][] = regions.map((r) => [r.at, r.at + fold(r.alias).length]);
  const cities = citiesIn(text, claimed);
  const uniqueCities = cities.filter((c) => c.unique);
  for (const c of cities.filter((x) => !x.unique)) notes.push(`"${titleCase(c.name)}" matches several places; not resolved.`);

  // ---- city
  if (uniqueCities.length === 1) {
    const c = uniqueCities[0]!;
    const region = regions.find((r) => r.region.countryCode === c.countryCode) ?? null;
    const where = inTitle(c.at) ? "the headline" : "the first sentence";
    return {
      scope: "city",
      precision: "city",
      countryCode: c.countryCode ?? null,
      countryName: countryNameOf(c.countryCode ?? null),
      adminRegion: region?.region.name ?? c.adminRegion ?? null,
      city: titleCase(c.name),
      latitude: c.lat ?? null,
      longitude: c.lng ?? null,
      evidence: `City "${titleCase(c.name)}" named in ${where} (canonical city coordinates, not the incident point).`,
      notes,
    };
  }
  const placeCountries = new Set([...uniqueCities.map((c) => c.countryCode), ...regions.map((r) => r.region.countryCode)].filter(Boolean) as string[]);
  if (uniqueCities.length > 1) {
    notes.push(`Several places named (${uniqueCities.map((c) => titleCase(c.name)).join(", ")}); reduced to what they share.`);
    if (placeCountries.size > 1) return { ...NONE, evidence: `Places in different countries are named (${uniqueCities.map((c) => titleCase(c.name)).join(", ")}); the event location is ambiguous.`, notes };
  }

  // ---- administrative region
  if (regions.length === 1 && placeCountries.size <= 1) {
    const r = regions[0]!.region;
    const where = inTitle(regions[0]!.at) ? "the headline" : "the first sentence";
    return {
      scope: "region",
      precision: "region",
      countryCode: r.countryCode,
      countryName: countryNameOf(r.countryCode),
      adminRegion: r.name,
      city: null,
      latitude: r.lat,
      longitude: r.lng,
      evidence: `Region "${r.name}" named in ${where}. Coordinates are the region's centroid, not the incident point.`,
      notes,
    };
  }
  if (regions.length > 1 || uniqueCities.length > 1) {
    if (placeCountries.size === 1) {
      const code = [...placeCountries][0]!;
      return { ...NONE, scope: "country", precision: "country", countryCode: code, countryName: countryNameOf(code), evidence: `Several places in ${countryNameOf(code)} are named; the report is kept at country level.`, notes };
    }
    return { ...NONE, notes, evidence: "Places in different countries are named; the event location is ambiguous." };
  }

  // ---- country
  const countries = countriesIn(text);
  const inHead = countries.filter((c) => inTitle(c.at));
  const pick = countries.length === 1 ? countries[0]! : inHead.length === 1 ? inHead[0]! : null;
  if (pick) {
    return {
      scope: "country",
      precision: "country",
      countryCode: pick.code,
      countryName: pick.name,
      adminRegion: null,
      city: null,
      latitude: null,
      longitude: null,
      evidence: `Country "${pick.name}" named in ${inTitle(pick.at) ? "the headline" : "the first sentence"}; no place inside it is identified, so no map point is created.`,
      notes,
    };
  }
  if (countries.length > 1) notes.push(`Several countries named (${countries.map((c) => c.name).join(", ")}); none is singled out.`);
  return { ...NONE, notes };
}
