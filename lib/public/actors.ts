import { prisma } from "@/lib/db/client";
import { aliasesOf, resolveActorName } from "@/lib/actors/registry";

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

const hrefFor = (id: string) => `/actor/${encodeURIComponent(id)}`;

/** Links for a list of actor names (event.actors, territorial claim actors...). */
export async function resolveActorLinks(names: readonly string[]): Promise<ActorLink[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return [];
  const canonical = unique.map((n) => resolveActorName(n));
  const [units, territoryActors] = await Promise.all([
    prisma.militaryUnit.findMany({ where: { name: { in: [...new Set([...unique, ...canonical])] } }, select: { id: true, name: true } }),
    prisma.conflictActor.findMany({ where: { name: { in: unique } }, select: { id: true, name: true } }),
  ]);
  const unitByName = new Map(units.map((u) => [u.name, u.id]));
  const actorByName = new Map(territoryActors.map((a) => [a.name, a.id]));
  return unique.map((name, i) => {
    const id = unitByName.get(name) ?? unitByName.get(canonical[i]!) ?? actorByName.get(name);
    return { name, href: id ? hrefFor(id) : null };
  });
}

export interface ActorPage {
  kind: "unit" | "territory_actor";
  id: string;
  /** Canonical name. */
  name: string;
  aliases: string[];
  branch: string | null;
  unitType: string | null;
  status: string | null;
  parent: { id: string; name: string } | null;
  children: { id: string; name: string }[];
  conflicts: { slug: string; name: string }[];
  events: { slug: string; title: string; occurredAt: string }[];
  equipment: { id: string; name: string; category: string | null }[];
  commanders: { id: string; name: string; rank: string | null }[];
  /** Territorial-control presence (published areas currently held), for territory actors. */
  territory: { areas: number; conflictSlug: string; conflictName: string } | null;
  provenance: { sourceName: string | null; sourceUrl: string | null; lastUpdatedAt: string | null };
}

/** Resolves an actor reference: a MilitaryUnit id, a ConflictActor id, or a name. */
export async function getPublicActor(ref: string): Promise<ActorPage | null> {
  const decoded = decodeURIComponent(ref);
  let unit = await prisma.militaryUnit.findUnique({ where: { id: decoded } });
  if (!unit) {
    const actor = await prisma.conflictActor.findUnique({ where: { id: decoded }, include: { conflict: true } });
    if (actor) {
      // A territory actor that is also a registered unit shows the richer unit page.
      unit = await prisma.militaryUnit.findUnique({ where: { name: resolveActorName(actor.name) } });
      if (!unit) {
        const areas = await prisma.conflictTerritory.count({ where: { actorId: actor.id, published: true, validTo: null } });
        return {
          kind: "territory_actor",
          id: actor.id,
          name: actor.name,
          aliases: aliasesOf(resolveActorName(actor.name)),
          branch: null,
          unitType: null,
          status: null,
          parent: null,
          children: [],
          conflicts: [{ slug: actor.conflict.slug, name: actor.conflict.name }],
          events: [],
          equipment: [],
          commanders: [],
          territory: { areas, conflictSlug: actor.conflict.slug, conflictName: actor.conflict.name },
          provenance: { sourceName: "Territorial control records", sourceUrl: null, lastUpdatedAt: actor.createdAt.toISOString() },
        };
      }
    } else {
      unit = await prisma.militaryUnit.findUnique({ where: { name: resolveActorName(decoded) } });
    }
  }
  if (!unit) return null;

  const [parent, children, primaryConflict, eventLinks, equipment, commanders] = await Promise.all([
    unit.parentUnitId ? prisma.militaryUnit.findUnique({ where: { id: unit.parentUnitId }, select: { id: true, name: true } }) : null,
    prisma.militaryUnit.findMany({ where: { parentUnitId: unit.id }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 25 }),
    unit.primaryConflictId ? prisma.conflict.findUnique({ where: { id: unit.primaryConflictId }, select: { slug: true, name: true } }) : null,
    prisma.militaryUnitEvent.findMany({
      where: { unitId: unit.id, event: { published: true } },
      include: { event: { select: { slug: true, title: true, occurredAt: true, conflict: { select: { slug: true, name: true } } } } },
      orderBy: { event: { occurredAt: "desc" } },
      take: 15,
    }),
    prisma.militaryUnitEquipment.findMany({ where: { unitId: unit.id }, include: { equipment: true }, take: 25 }),
    prisma.commander.findMany({ where: { currentUnitId: unit.id }, select: { id: true, name: true, rank: true }, take: 10 }),
  ]);

  const conflicts = new Map<string, { slug: string; name: string }>();
  if (primaryConflict) conflicts.set(primaryConflict.slug, primaryConflict);
  for (const l of eventLinks) if (l.event.conflict) conflicts.set(l.event.conflict.slug, l.event.conflict);

  return {
    kind: "unit",
    id: unit.id,
    name: unit.name,
    aliases: aliasesOf(unit.name),
    branch: unit.branch,
    unitType: unit.unitType,
    status: unit.status,
    parent,
    children,
    conflicts: [...conflicts.values()],
    events: eventLinks.map((l) => ({ slug: l.event.slug, title: l.event.title, occurredAt: l.event.occurredAt.toISOString() })),
    equipment: equipment.map((e) => ({ id: e.equipment.id, name: e.equipment.name, category: e.equipment.category })),
    commanders,
    territory: null,
    provenance: { sourceName: unit.sourceName, sourceUrl: unit.sourceUrl, lastUpdatedAt: unit.lastUpdatedAt.toISOString() },
  };
}
