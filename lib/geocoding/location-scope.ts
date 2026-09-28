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

export const LOCATION_EVIDENCE_SOURCES = ["lead", "body"] as const;
export type LocationEvidenceSource = (typeof LOCATION_EVIDENCE_SOURCES)[number];

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
  /** Which pass of the source's own text produced this: "lead" (headline + first sentence — precise
   * enough for city/region) or "body" (the rest of the article text — country-level only, see
   * resolveLocationScope's own comment on why finer precision never comes from here). */
  evidenceSource: LocationEvidenceSource;
  /** Places named that could not be resolved to one (ambiguous name, several countries...). */
  notes: string[];
  /** Set only when resolution failed specifically because 2+ DIFFERENT countries were named with nothing
   * to prefer one over the other — e.g. "Russia attacks Ukraine". A caller with conflict context (the
   * conflict this report already matched, if any) can safely prefer whichever of these is that conflict's
   * own fighting-geography country — see lib/ingestion/draft.ts's own use of this. Never used to invent a
   * location beyond what was actually named. */
  ambiguousCountryCodes?: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();

function findWord(haystack: string, needle: string): number {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${esc(fold(needle))}(?![\\p{L}\\p{N}])`, "u").exec(haystack);
  return m ? m.index : -1;
}

/** Case-SENSITIVE whole-word search (never folds either side) — for the handful of short country
 * codes ("UK", "US") that only mean the country when the source itself wrote them upper-case. */
function findWordCaseSensitive(haystack: string, needle: string): number {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${esc(needle)}(?![\\p{L}\\p{N}])`, "u").exec(haystack);
  return m ? m.index : -1;
}

interface CountryHit {
  code: string;
  name: string;
  at: number;
  end: number;
}

// Names and aliases of at least 4 letters (short 2-3 letter codes like "US"/"UK" are handled separately
// below, case-sensitively, since folded they'd collide with ordinary words like "us").
const COUNTRY_TERMS = COUNTRY_RECORDS.flatMap((c) => [c.name, ...c.aliases].filter((t) => normalizeName(t).length >= 4).map((t) => ({ term: t, code: c.code, name: c.name })));
// A short (2-3 letter) alias only ever means the country when it appears in the source's own text
// ALL-CAPS ("UK", "US") — matched against the original (unfolded, case-preserved) text, never lowercased.
const SHORT_COUNTRY_TERMS = COUNTRY_RECORDS.flatMap((c) => [c.name, ...c.aliases].filter((t) => { const n = normalizeName(t); return n.length >= 2 && n.length <= 3 && t === t.toUpperCase(); }).map((t) => ({ term: t, code: c.code, name: c.name })));

/** Real bug found auditing the NEEDS_REVIEW backlog (Location Resolution v1): "Guinea" is a real,
 * boundary-delimited word inside "Papua New Guinea", "Guinea-Bissau" and "Equatorial Guinea" — three
 * DIFFERENT countries — so a report naming only "Papua New Guinea" was scored as naming two ambiguous
 * countries and left unresolved. Same fix already used for region/city overlap: when one match's span
 * sits entirely inside another match's span, only the longer (more specific) one counts. */
function countriesIn(text: string, original: string): CountryHit[] {
  const raw: CountryHit[] = [];
  for (const { term, code, name } of COUNTRY_TERMS) {
    const at = findWord(text, term);
    if (at >= 0) raw.push({ code, name, at, end: at + fold(term).length });
  }
  for (const { term, code, name } of SHORT_COUNTRY_TERMS) {
    const at = findWordCaseSensitive(original, term);
    if (at >= 0) raw.push({ code, name, at, end: at + term.length });
  }
  raw.sort((a, b) => b.end - b.at - (a.end - a.at)); // longest span first
  const kept: CountryHit[] = [];
  for (const hit of raw) {
    if (kept.some((k) => hit.at >= k.at && hit.end <= k.end)) continue; // fully inside an already-kept, longer match
    kept.push(hit);
  }
  const seen = new Map<string, CountryHit>();
  for (const hit of kept) if (!seen.has(hit.code) || hit.at < seen.get(hit.code)!.at) seen.set(hit.code, hit);
  return [...seen.values()].sort((a, b) => a.at - b.at);
}

const countryNameOf = (code: string | null) => (code ? (COUNTRY_RECORDS.find((c) => c.code === code)?.name ?? null) : null);

const NONE: ResolvedLocationScope = { scope: "unknown", precision: "unknown", countryCode: null, countryName: null, adminRegion: null, city: null, latitude: null, longitude: null, evidence: "No reliable location in the headline or opening text.", evidenceSource: "lead", notes: [] };

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

function resolveFromLead(title: string, body: string): ResolvedLocationScope {
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
      evidenceSource: "lead",
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
      evidenceSource: "lead",
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
  const countries = countriesIn(text, lead);
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
      evidenceSource: "lead",
      notes,
    };
  }
  if (countries.length > 1) {
    notes.push(`Several countries named (${countries.map((c) => c.name).join(", ")}); none is singled out.`);
    return { ...NONE, notes, ambiguousCountryCodes: countries.map((c) => c.code) };
  }
  return { ...NONE, notes };
}

/** Country-only fallback over the FULL article body (not just the 200-char lead), used only when the
 * lead itself gave nothing reliable. This is deliberately country-level only, never city/region: a place
 * named deep in background text doesn't say where the event physically happened (that's still exactly
 * what resolveFromLead's own reasoning already established), but a COUNTRY the whole article is about is
 * much safer to infer from anywhere in the text — and per this milestone's own explicit instruction,
 * leaving a country-level development in NEEDS_REVIEW merely because no city is known is a readiness bug,
 * not a location-quality safeguard. Exactly one unambiguous country match is required; several distinct
 * countries anywhere in the body is exactly as ambiguous as it would be in the lead. */
function countryFromBody(title: string, body: string): ResolvedLocationScope | null {
  const full = `${title.trim()} ${body.trim()}`;
  if (!full.trim()) return null;
  const text = fold(full);
  const countries = countriesIn(text, full);
  if (countries.length !== 1) return null;
  const c = countries[0]!;
  return {
    ...NONE,
    scope: "country",
    precision: "country",
    countryCode: c.code,
    countryName: c.name,
    evidence: `Country "${c.name}" named in the article body (not the headline or opening sentence); no place inside it is identified, so no map point is created.`,
    evidenceSource: "body",
  };
}

export function resolveLocationScope(title: string, body: string): ResolvedLocationScope {
  const fromLead = resolveFromLead(title, body);
  if (fromLead.scope !== "unknown") return fromLead;
  const fromBody = countryFromBody(title, body);
  if (fromBody) return { ...fromBody, notes: fromLead.notes };
  return fromLead;
}
