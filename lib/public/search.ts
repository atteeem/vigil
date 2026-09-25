import { prisma } from "@/lib/db/client";
import { getCountryRecord, normalizeName, searchCountries } from "@/lib/countries/registry";
import { CONFLICT_ALIASES } from "@/lib/conflicts/resolve";
import { normalizeEntityText } from "@/lib/military/aliases";
import { ADMIN_REGIONS } from "@/lib/geocoding/admin-regions";
import { gazetteerLookup, gazetteerPlaceNames } from "@/lib/geocoding/gazetteer";
import { searchAirports } from "@/lib/hazards/reference";
import { searchHazards } from "@/lib/hazards/query";
import { STATUS_CATEGORIES } from "@/lib/hazards/types";
import { entityHref } from "./entities";

// One canonical entity search over the existing registries and tables. Nothing is indexed twice: countries come from
// the country registry, conflicts from the conflict table (+ curated aliases), actors / units / commanders / equipment
// from the knowledge layer and its alias rows, places from the admin-region and gazetteer tables the geocoder uses,
// airports from the static OurAirports reference, ports / chokepoints / hazards from stored provider events, sources
// from the source table. Every result routes to an EXISTING page or map deep link; no page is created for search.
// Bounded: every lookup is limited and there is no N+1 (related rows are fetched in one query per kind).

import { SEARCH_GROUPS, type SearchGroup, type SearchResult, type SearchResultType } from "./search-types";
export { SEARCH_GROUPS, type SearchGroup, type SearchResult, type SearchResultType };

const MILITARY_TYPES = new Set(["military_unit"]);
const countryName = (code: string | null | undefined) => (code ? (getCountryRecord(code)?.name ?? code) : null);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const world = (lat: number, lng: number, zoom: number, extra: Record<string, string> = {}) => `/world?${new URLSearchParams({ focus: `${lat.toFixed(3)},${lng.toFixed(3)},${zoom}`, ...extra }).toString()}`;

/** Word-prefix match on a normalized name: "russia ukraine" matches "Russia–Ukraine", "zhyt" matches "Zhytomyr Oblast". */
function nameMatches(query: string, candidate: string): boolean {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return false;
  if (c === q || c.startsWith(q) || c.includes(` ${q}`)) return true;
  const qWords = q.split(" ");
  const cWords = c.split(" ");
  return qWords.length > 1 && qWords.every((w) => cWords.some((cw) => cw.startsWith(w)));
}

export async function searchPublic(query: string, perGroup = 5): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const norm = normalizeEntityText(q);
  const results: SearchResult[] = [];
  // A 2-3 character query ("FI", "RSF", "SAF", "JFK") is a code or abbreviation: it matches exact codes and aliases only,
  // never as a substring of unrelated names or headlines.
  const short = q.length <= 3;

  // ---- countries (canonical registry: ISO2 / ISO3 / name / alias) ----
  for (const c of short ? searchCountries(q, perGroup).filter((c) => [c.code, c.alpha3, ...c.aliases].some((x) => x.toLowerCase() === q.toLowerCase())) : searchCountries(q, perGroup)) {
    const alias = normalizeName(c.name) !== normalizeName(q) && q.length > 3 ? c.aliases.find((a) => nameMatches(q, a)) : undefined;
    const code = [c.code, c.alpha3].find((x) => x.toLowerCase() === q.toLowerCase());
    results.push({ type: "country", group: "Countries", id: c.code, title: c.name, kind: "Country", context: `${c.region} · ${c.subregion}`, status: null, subtitle: `${c.code} / ${c.alpha3}`, matched: code ? `Code: ${code}` : alias ? `Alias: ${alias}` : undefined, href: `/country/${c.code}` });
  }

  const [conflictRows, aliasHits, nameUnits, nameCommanders, nameEquipment, events, sources, hazards] = await Promise.all([
    prisma.conflict.findMany({ select: { id: true, slug: true, name: true, shortName: true, region: true, status: true, severity: true, fightingCountries: true } }),
    prisma.entityAlias.findMany({ where: short ? { normalized: norm } : { normalized: { contains: norm } }, take: 60 }),
    short ? Promise.resolve([]) : prisma.militaryUnit.findMany({ where: { name: { contains: q } }, select: { id: true }, take: perGroup * 2 }),
    short ? Promise.resolve([]) : prisma.commander.findMany({ where: { name: { contains: q } }, select: { id: true }, take: perGroup }),
    short ? Promise.resolve([]) : prisma.militaryEquipment.findMany({ where: { name: { contains: q } }, select: { id: true }, take: perGroup }),
    short ? Promise.resolve([]) : prisma.event.findMany({ where: { published: true, title: { contains: q } }, select: { id: true, slug: true, title: true, countryCode: true, region: true, occurredAt: true, locationScope: true }, orderBy: { occurredAt: "desc" }, take: perGroup }),
    prisma.source.findMany({ where: { enabled: true, ...(short ? { name: { startsWith: q } } : { name: { contains: q } }) }, select: { id: true, name: true, country: true, sourceRole: true, type: true, conflictLinks: { select: { conflict: { select: { slug: true, shortName: true, name: true } } }, take: 1 } }, take: perGroup }),
    short ? Promise.resolve([]) : searchHazards(q, perGroup * 2),
  ]);

  // ---- conflicts (names, short names, slugs and curated aliases, punctuation-insensitive) ----
  const conflictHits = conflictRows
    .map((c) => {
      const aliases = CONFLICT_ALIASES[c.slug] ?? [];
      const direct = short ? [c.shortName ?? "", c.slug].some((n) => normalizeName(n) === normalizeName(q)) : [c.name, c.shortName ?? "", c.slug.replace(/-/g, " ")].some((n) => nameMatches(q, n));
      const alias = direct ? undefined : aliases.find((a) => (short ? normalizeName(a) === normalizeName(q) : nameMatches(q, a)));
      return { c, hit: direct || !!alias, alias };
    })
    .filter((x) => x.hit)
    // Live conflicts first, then name: deterministic, no editorial ranking.
    .sort((a, b) => Number(["ended", "resolved", "archived"].includes(a.c.status)) - Number(["ended", "resolved", "archived"].includes(b.c.status)) || a.c.name.localeCompare(b.c.name))
    .slice(0, perGroup);
  for (const { c, alias } of conflictHits) {
    let fighting: string[] = [];
    try {
      fighting = JSON.parse(c.fightingCountries ?? "[]") as string[];
    } catch {
      fighting = [];
    }
    results.push({ type: "conflict", group: "Conflicts", id: c.id, title: c.shortName ?? c.name, kind: "Conflict", context: fighting.length ? fighting.map(countryName).join(", ") : c.region, status: cap(c.status), subtitle: `Severity ${c.severity}`, matched: alias ? `Alias: ${alias}` : undefined, href: `/conflict/${c.slug}` });
  }

  // ---- actors, units, commanders, equipment (knowledge layer + alias rows, one query per kind) ----
  const wordMatch = (n: string) => n === norm || n.split(" ").some((w) => w.startsWith(norm)) || n.startsWith(norm);
  const hits = aliasHits.filter((h) => wordMatch(h.normalized));
  const unitIds = [...new Set([...hits.filter((h) => h.entityKind === "unit").map((h) => h.entityId), ...nameUnits.map((u) => u.id)])].slice(0, perGroup * 2);
  const commanderIds = [...new Set([...hits.filter((h) => h.entityKind === "commander").map((h) => h.entityId), ...nameCommanders.map((u) => u.id)])].slice(0, perGroup);
  const equipmentIds = [...new Set([...hits.filter((h) => h.entityKind === "equipment").map((h) => h.entityId), ...nameEquipment.map((u) => u.id)])].slice(0, perGroup);
  const [units, commanders, equipment] = await Promise.all([
    unitIds.length ? prisma.militaryUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true, branch: true, entityType: true, unitType: true, country: true, primaryConflict: { select: { shortName: true, name: true } }, conflictLinks: { select: { role: true, conflict: { select: { shortName: true, name: true } } }, take: 1 } } }) : [],
    commanderIds.length ? prisma.commander.findMany({ where: { id: { in: commanderIds } }, select: { id: true, name: true, rank: true, currentUnit: { select: { name: true, country: true } } } }) : [],
    equipmentIds.length ? prisma.militaryEquipment.findMany({ where: { id: { in: equipmentIds } }, select: { id: true, name: true, category: true } }) : [],
  ]);
  const matchedVia = (kind: string, id: string) => {
    const h = hits.find((x) => x.entityKind === kind && x.entityId === id && x.aliasType !== "canonical");
    return h ? `Alias: ${h.alias}` : undefined;
  };
  // Exact alias hits ("RSF") first, then names.
  const unitOrder = (id: string) => (hits.some((h) => h.entityKind === "unit" && h.entityId === id && h.normalized === norm) ? 0 : 1);
  for (const u of [...units].sort((a, b) => unitOrder(a.id) - unitOrder(b.id) || a.name.localeCompare(b.name))) {
    const military = u.entityType ? MILITARY_TYPES.has(u.entityType) : !!u.unitType;
    const link = u.conflictLinks[0];
    const conflict = link?.conflict ?? u.primaryConflict;
    results.push({
      type: military ? "unit" : "actor",
      group: military ? "Military" : "Actors",
      id: u.id,
      title: u.name,
      kind: military ? (u.unitType ?? "Military unit") : u.entityType ? cap(u.entityType.replace(/_/g, " ")) : "Actor",
      context: countryName(u.country),
      status: link ? cap(link.role.replace(/_/g, " ")) : null,
      subtitle: conflict ? (conflict.shortName ?? conflict.name) : (u.branch ?? ""),
      matched: matchedVia("unit", u.id),
      href: entityHref("unit", u.id, u.entityType),
    });
  }
  for (const c of commanders) results.push({ type: "commander", group: "Military", id: c.id, title: `${c.rank ? `${c.rank} ` : ""}${c.name}`, kind: "Commander", context: countryName(c.currentUnit?.country), status: null, subtitle: c.currentUnit ? `Commands ${c.currentUnit.name}` : "No current unit recorded", matched: matchedVia("commander", c.id), href: entityHref("commander", c.id) });
  for (const e of equipment) results.push({ type: "equipment", group: "Military", id: e.id, title: e.name, kind: "Equipment", context: e.category ?? null, status: null, subtitle: "", matched: matchedVia("equipment", e.id), href: entityHref("equipment", e.id) });

  // ---- places: admin regions (centroid, region precision) and gazetteer cities ----
  const regions = short ? [] : ADMIN_REGIONS.filter((r) => [r.name, ...r.aliases].some((n) => nameMatches(q, n))).slice(0, perGroup);
  for (const r of regions) results.push({ type: "region", group: "Places", id: `region:${r.name}`, title: r.name, kind: "Region", context: countryName(r.countryCode), status: null, subtitle: "Map opens on the region centroid (region-level precision)", href: world(r.lat, r.lng, 7, { country: r.countryCode }) });
  const cityNames = short ? [] : gazetteerPlaceNames().filter((n) => nameMatches(q, n)).slice(0, perGroup);
  for (const n of cityNames) {
    const candidates = gazetteerLookup(n);
    for (const c of candidates.slice(0, 3)) {
      results.push({ type: "city", group: "Places", id: `city:${c.label}`, title: c.label.split(",")[0]!, kind: "City", context: c.label.split(",").slice(1).join(",").trim() || countryName(c.countryCode), status: candidates.length > 1 ? "ambiguous name" : null, subtitle: candidates.length > 1 ? `${candidates.length} places share this name` : "City-level map focus", href: world(c.lat, c.lng, 9, c.countryCode ? { country: c.countryCode } : {}) });
    }
  }

  // ---- live events: published events + significant hazards ----
  for (const e of events) results.push({ type: "event", group: "Live Events", id: e.id, title: e.title, kind: "Event", context: countryName(e.countryCode) ?? e.region, status: e.locationScope === "country" ? "country-level" : null, subtitle: e.occurredAt.toISOString().slice(0, 10), href: `/event/${e.slug}` });
  const infraCats = new Set<string>(STATUS_CATEGORIES);
  for (const h of hazards) {
    const infra = infraCats.has(h.category);
    const type: SearchResultType = h.category === "airport_status" ? "airport" : h.category === "port_disruption" ? "port" : h.category === "chokepoint_status" ? "chokepoint" : infra ? "infrastructure" : "hazard";
    results.push({ type, group: infra ? "Infrastructure" : "Live Events", id: h.id, title: h.title, kind: h.subtitle, context: null, status: h.label ?? null, subtitle: `${h.observedAt.slice(0, 10)}${h.stale ? " · stale record" : ""}`, href: `/hazard/${h.id}` });
  }
  // ---- airports from the static reference (map deep link; a disrupted airport above links its status record) ----
  const airports = short ? searchAirports(q, 20).filter((a) => [a.iata, a.icao].some((c) => c && c.toUpperCase() === q.toUpperCase())) : searchAirports(q, perGroup);
  for (const a of airports) {
    if (results.some((r) => r.type === "airport" && r.title.includes(a.name))) continue;
    results.push({ type: "airport", group: "Infrastructure", id: `airport:${a.icao || a.iata}`, title: a.name, kind: "Airport", context: countryName(a.country), status: null, subtitle: [a.iata, a.icao].filter(Boolean).join(" / "), href: world(a.lat, a.lng, 9, { layers: "aviation" }) });
  }

  // ---- sources: link to where their coverage is shown ----
  for (const s of sources) {
    const conflict = s.conflictLinks[0]?.conflict;
    results.push({ type: "source", group: "Sources", id: s.id, title: s.name, kind: "Source", context: countryName(s.country), status: s.sourceRole ? cap(s.sourceRole.replace(/_/g, " ")) : null, subtitle: conflict ? `Dedicated to ${conflict.shortName ?? conflict.name}` : s.type, href: conflict ? `/conflict/${conflict.slug}#section-sources` : s.country && getCountryRecord(s.country) ? `/country/${getCountryRecord(s.country)!.code}` : "/admin/sources" });
  }

  // Grouped, each group capped, in the fixed group order.
  const out: SearchResult[] = [];
  for (const g of SEARCH_GROUPS) out.push(...results.filter((r) => r.group === g).slice(0, perGroup));
  return out;
}
