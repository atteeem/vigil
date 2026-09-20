import { prisma } from "@/lib/db/client";
import { COUNTRIES, getCountryByCode } from "@/lib/reference/countries";
import { searchAirports, findAirport, allCountries, countryCentroid } from "@/lib/hazards/reference";
import { HAZARD_LAYERS, HAZARD_LAYER_LABEL, type HazardLayer } from "@/lib/hazards/types";
import type { WatchEntityType } from "./types";

// What can be followed, and how a (type, key) pair is validated and labelled. Adding an entity type means
// adding a case here (and, if it needs its own rules, in types.ts); watches, notifications and the engine
// are generic.

export interface Watchable {
  entityType: WatchEntityType;
  entityKey: string;
  label: string;
  detail?: string;
}

export const normKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Resolves and validates a followable thing; null = not followable (unknown key for a type that must exist). */
export async function describeWatchable(type: WatchEntityType, key: string, labelHint?: string | null): Promise<Watchable | null> {
  switch (type) {
    case "country": {
      const code = key.toUpperCase();
      const c = getCountryByCode(code);
      const named = c ? { code: c.code, name: c.name } : countryCentroid(code) ? { code, name: countryCentroid(code)!.name } : null;
      return named ? { entityType: type, entityKey: named.code, label: named.name } : null;
    }
    case "conflict": {
      const c = await prisma.conflict.findUnique({ where: { slug: key }, select: { slug: true, name: true, shortName: true } });
      return c ? { entityType: type, entityKey: c.slug, label: c.shortName ?? c.name } : null;
    }
    case "actor":
    case "unit": {
      const u = await prisma.militaryUnit.findUnique({ where: { id: key }, select: { id: true, name: true } });
      return u ? { entityType: type, entityKey: u.id, label: u.name } : null;
    }
    case "airport": {
      const a = findAirport(key);
      return a ? { entityType: type, entityKey: a.icao || a.iata, label: a.name, detail: `${a.icao}${a.iata ? ` / ${a.iata}` : ""}` } : null;
    }
    case "layer":
      return (HAZARD_LAYERS as readonly string[]).includes(key) ? { entityType: type, entityKey: key, label: `${HAZARD_LAYER_LABEL[key as HazardLayer]} (all)` } : null;
    case "chokepoint":
    case "volcano":
    case "watchkey": {
      // Structured entities are created by providers; a known one is labelled from its latest record, an
      // as-yet-unseen one is followable with the label the user was shown.
      const row = await prisma.globalEvent.findFirst({
        where: type === "watchkey" ? { AND: [{ entityKey: key.split(":").slice(1).join(":") }, { category: key.split(":")[0]! }] } : { entityKey: key, category: type === "chokepoint" ? "chokepoint_status" : "volcano" },
        orderBy: { lastSeenAt: "desc" },
        select: { title: true },
      });
      const label = row?.title ?? labelHint;
      return label ? { entityType: type, entityKey: key, label } : null;
    }
    case "port": {
      const k = normKey(key);
      return k ? { entityType: type, entityKey: k, label: labelHint?.trim() || key.trim() } : null;
    }
  }
}

/** Search for the follow picker: bounded, per type. */
export async function searchWatchables(type: WatchEntityType, q: string, limit = 8): Promise<Watchable[]> {
  const term = q.trim();
  switch (type) {
    case "country": {
      const l = term.toLowerCase();
      const regionOf = new Map(COUNTRIES.map((c) => [c.code, c.region]));
      // The reference countries (with impact scoring) first, then every other named country.
      const all = [...COUNTRIES.map((c) => ({ code: c.code, name: c.name })), ...allCountries().filter((c) => !regionOf.has(c.code))];
      return all.filter((c) => !l || c.name.toLowerCase().includes(l) || c.code.toLowerCase() === l).slice(0, limit).map((c) => ({ entityType: type, entityKey: c.code, label: c.name, detail: regionOf.get(c.code) }));
    }
    case "conflict": {
      const rows = await prisma.conflict.findMany({ where: term ? { OR: [{ name: { contains: term } }, { shortName: { contains: term } }] } : {}, select: { slug: true, name: true, shortName: true, region: true }, orderBy: { name: "asc" }, take: limit });
      return rows.map((c) => ({ entityType: type, entityKey: c.slug, label: c.shortName ?? c.name, detail: c.region }));
    }
    case "actor":
    case "unit": {
      const rows = await prisma.militaryUnit.findMany({ where: { name: { contains: term }, ...(type === "unit" ? { entityType: "military_unit" } : { NOT: { entityType: "military_unit" } }) }, select: { id: true, name: true, country: true }, take: limit });
      return rows.map((u) => ({ entityType: type, entityKey: u.id, label: u.name, detail: u.country ?? undefined }));
    }
    case "airport":
      return searchAirports(term, limit).map((a) => ({ entityType: type, entityKey: a.icao || a.iata, label: a.name, detail: `${a.icao}${a.iata ? ` / ${a.iata}` : ""} · ${a.country}` }));
    case "layer":
      return HAZARD_LAYERS.filter((l) => !term || l.includes(term.toLowerCase()) || HAZARD_LAYER_LABEL[l].toLowerCase().includes(term.toLowerCase())).map((l) => ({ entityType: type, entityKey: l, label: `${HAZARD_LAYER_LABEL[l]} (all)` }));
    case "chokepoint":
    case "volcano": {
      const rows = await prisma.globalEvent.findMany({ where: { category: type === "chokepoint" ? "chokepoint_status" : "volcano", entityKey: { not: null }, title: { contains: term } }, distinct: ["entityKey"], select: { entityKey: true, title: true }, take: limit });
      return rows.map((r) => ({ entityType: type, entityKey: r.entityKey!, label: r.title.replace(/ — alert level.*/, "") }));
    }
    case "watchkey": {
      const rows = await prisma.globalEvent.findMany({ where: { category: { in: ["energy_disruption", "internet_disruption", "airspace_event"] }, entityKey: { not: null }, title: { contains: term } }, distinct: ["entityKey", "category"], select: { entityKey: true, category: true, title: true }, take: limit });
      return rows.map((r) => ({ entityType: type, entityKey: `${r.category}:${r.entityKey}`, label: r.title }));
    }
    case "port": {
      if (!term) return [];
      return [{ entityType: type, entityKey: normKey(term), label: term, detail: "Follow by port name" }];
    }
  }
}

/** Where a watch's page lives (for the Watchlist page links). */
export function watchHref(type: WatchEntityType, key: string): string | null {
  switch (type) {
    case "country":
      return `/country/${key}`;
    case "conflict":
      return `/conflict/${key}`;
    case "actor":
    case "unit":
      return `/actor/${key}`;
    case "layer":
      return `/world?layers=${key}`;
    default:
      return null;
  }
}
