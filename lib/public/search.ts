import { prisma } from "@/lib/db/client";
import { COUNTRIES } from "@/lib/reference/countries";
import { normalizeEntityText } from "@/lib/military/aliases";
import { entityHref } from "./entities";
import { searchHazards } from "@/lib/hazards/query";

export interface SearchResult {
  type: "country" | "conflict" | "event" | "actor" | "commander" | "equipment" | "hazard";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Public search over real data: reference countries, DB conflicts, published events and stored actors. */
export async function searchPublic(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const lower = q.toLowerCase();
  const results: SearchResult[] = [];

  for (const c of COUNTRIES) {
    if (c.name.toLowerCase().includes(lower) || c.code.toLowerCase() === lower) {
      results.push({ type: "country", id: c.code, title: c.name, subtitle: c.region, href: `/country/${c.code}` });
    }
  }
  const norm = normalizeEntityText(q);
  const [conflicts, events, aliasHits] = await Promise.all([
    prisma.conflict.findMany({
      where: { status: { notIn: ["ended", "resolved", "archived"] }, OR: [{ name: { contains: q } }, { shortName: { contains: q } }] },
      select: { id: true, slug: true, name: true, shortName: true, region: true, severity: true },
      take: limit,
    }),
    prisma.event.findMany({ where: { published: true, title: { contains: q } }, select: { id: true, slug: true, title: true, region: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: limit }),
    // Entities by canonical name OR any alias (exact or as a whole-word/prefix part of a designation such as "82nd").
    prisma.entityAlias.findMany({ where: { normalized: { contains: norm } }, take: 60 }),
  ]);
  // Entities matched through an alias resolve to their CANONICAL record. A prefix such as "82nd"
  // that names several units returns all of them (the caller shows the ambiguity); one match returns one.
  const wordMatch = (n: string) => n === norm || n.split(" ").some((w) => w.startsWith(norm)) || n.startsWith(norm);
  const hits = aliasHits.filter((h) => wordMatch(h.normalized));
  // Also by stored canonical name (entities written before their alias rows existed).
  const [nameUnits, nameCommanders, nameEquipment] = await Promise.all([
    prisma.militaryUnit.findMany({ where: { name: { contains: q } }, select: { id: true }, take: limit }),
    prisma.commander.findMany({ where: { name: { contains: q } }, select: { id: true }, take: limit }),
    prisma.militaryEquipment.findMany({ where: { name: { contains: q } }, select: { id: true }, take: limit }),
  ]);
  const unitIds = [...new Set([...hits.filter((h) => h.entityKind === "unit").map((h) => h.entityId), ...nameUnits.map((u) => u.id)])].slice(0, limit);
  const commanderIds = [...new Set([...hits.filter((h) => h.entityKind === "commander").map((h) => h.entityId), ...nameCommanders.map((u) => u.id)])].slice(0, limit);
  const equipmentIds = [...new Set([...hits.filter((h) => h.entityKind === "equipment").map((h) => h.entityId), ...nameEquipment.map((u) => u.id)])].slice(0, limit);
  const [units, commanders, equipment] = await Promise.all([
    prisma.militaryUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, name: true, branch: true, entityType: true, country: true } }),
    prisma.commander.findMany({ where: { id: { in: commanderIds } }, select: { id: true, name: true, rank: true, currentUnit: { select: { name: true } } } }),
    prisma.militaryEquipment.findMany({ where: { id: { in: equipmentIds } }, select: { id: true, name: true, category: true } }),
  ]);
  const matchedVia = (kind: string, id: string) => {
    const h = hits.find((x) => x.entityKind === kind && x.entityId === id && x.aliasType !== "canonical");
    return h ? ` · matched alias "${h.alias}"` : "";
  };
  for (const c of conflicts) {
    results.push({ type: "conflict", id: c.id, title: c.shortName ?? c.name, subtitle: `${c.region} · Severity: ${c.severity}`, href: `/conflict/${c.slug}` });
  }
  for (const u of units) {
    results.push({ type: "actor", id: u.id, title: u.name, subtitle: `${u.entityType ? u.entityType.replace(/_/g, " ") : (u.branch ?? "Armed actor")}${u.country ? ` · ${u.country}` : ""}${matchedVia("unit", u.id)}`, href: entityHref("unit", u.id, u.entityType) });
  }
  for (const c of commanders) {
    results.push({ type: "commander", id: c.id, title: `${c.rank ? `${c.rank} ` : ""}${c.name}`, subtitle: `Commander${c.currentUnit ? ` · ${c.currentUnit.name}` : ""}${matchedVia("commander", c.id)}`, href: entityHref("commander", c.id) });
  }
  for (const q2 of equipment) {
    results.push({ type: "equipment", id: q2.id, title: q2.name, subtitle: `Equipment${q2.category ? ` · ${q2.category}` : ""}${matchedVia("equipment", q2.id)}`, href: entityHref("equipment", q2.id) });
  }
  for (const e of events) {
    results.push({ type: "event", id: e.id, title: e.title, subtitle: `${e.region ?? "Global"} · ${e.occurredAt.toISOString().slice(0, 10)}`, href: `/event/${e.slug}` });
  }
  // Major earthquakes, named volcanoes and significant active weather (never raw thermal detections).
  for (const h of await searchHazards(q, 4)) {
    results.push({ type: "hazard", id: h.id, title: h.title, subtitle: `${h.subtitle}${h.stale ? " · stale record" : ""}`, href: `/hazard/${h.id}` });
  }
  return results.slice(0, limit + 4);
}
