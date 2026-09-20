import { prisma } from "@/lib/db/client";
import { aliasesOf, resolveActorName } from "@/lib/actors/registry";
import { entityHref } from "./entities";

// Public actor lookups. An "actor" is a MilitaryUnit (the canonical, registry-
// deduplicated armed actor: aliases, parent/child, equipment, commanders,
// linked events) or, for territorial control, a per-conflict ConflictActor
// (name + map colour). Both resolve to one /actor/[ref] page; a name that maps
// to neither is simply not linked — never an invented page.

export interface ActorLink {
  name: string;
  /** null when the name matches no stored actor (rendered as plain text). */
  href: string | null;
}

const territoryHref = (id: string) => `/actor/${encodeURIComponent(id)}`;

/** Links for a list of actor names (event.actors, territorial claim actors...). */
export async function resolveActorLinks(names: readonly string[]): Promise<ActorLink[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const canonical = unique.map((n) => resolveActorName(n));
  const [units, territoryActors] = await Promise.all([
    prisma.militaryUnit.findMany({ where: { name: { in: [...new Set([...unique, ...canonical])] } }, select: { id: true, name: true, entityType: true } }),
    prisma.conflictActor.findMany({ where: { name: { in: unique } }, select: { id: true, name: true } }),
  ]);
  const unitByName = new Map(units.map((u) => [u.name, u]));
  const actorByName = new Map(territoryActors.map((a) => [a.name, a.id]));
  return unique.map((name, i) => {
    const unit = unitByName.get(name) ?? unitByName.get(canonical[i]!);
    if (unit) return { name, href: entityHref("unit", unit.id, unit.entityType) };
    const territoryId = actorByName.get(name);
    return { name, href: territoryId ? territoryHref(territoryId) : null };
  });
}

/** A territorial-control actor that has no MilitaryUnit record: a small, honest page (name, the
 * conflict it appears in, and the published areas it currently holds). */
export interface TerritoryActorPage {
  id: string;
  name: string;
  aliases: string[];
  conflict: { slug: string; name: string };
  areas: number;
}

export async function getPublicTerritoryActor(ref: string): Promise<TerritoryActorPage | null> {
  const actor = await prisma.conflictActor.findUnique({ where: { id: decodeURIComponent(ref) }, include: { conflict: true } });
  if (!actor) return null;
  const areas = await prisma.conflictTerritory.count({ where: { actorId: actor.id, published: true, validTo: null } });
  return { id: actor.id, name: actor.name, aliases: aliasesOf(resolveActorName(actor.name)), conflict: { slug: actor.conflict.slug, name: actor.conflict.name }, areas };
}
