import { prisma } from "@/lib/db/client";
import { aliasesOf, ACTOR_REGISTRY, resolveActorName } from "@/lib/actors/registry";
import { ALIAS_TYPE_LABEL, ENTITY_TYPE_LABEL, RELATION_LABEL, isEntityType, type AliasType, type RelationType } from "@/lib/military/entity-types";
import { describeFreshness, latestOf, relationshipFreshness, type Freshness } from "@/lib/military/freshness";
import { sourceTrust, type SourceTrust } from "@/lib/sources/trust";
import { summarizeEvidence } from "@/lib/sources/trust";

// The public knowledge layer: actors, units, commanders and equipment as connected, sourced
// records. Strategic reference knowledge only — there are no coordinates, movements or
// readiness statements here. "Last observed" means the last time Vigil SOURCED a mention of the
// entity, never where it is now. Old relationships are shown as old, unknown as unknown.

export type EntityHrefKind = "unit" | "commander" | "equipment";

export function entityHref(kind: EntityHrefKind, id: string, entityType?: string | null): string {
  const enc = encodeURIComponent(id);
  if (kind === "commander") return `/commander/${enc}`;
  if (kind === "equipment") return `/equipment/${enc}`;
  return entityType === "military_unit" ? `/unit/${enc}` : `/actor/${enc}`;
}

export interface EntityRef {
  id: string;
  name: string;
  href: string;
}

export interface Provenance {
  sourceName: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  confidence: number | null;
  freshness: Freshness;
  /** e.g. "last sourced 4 months ago (2026-05-02) · may be out of date" */
  freshnessText: string;
  /** Public trust presentation when the named source is a known Vigil source. */
  trust: SourceTrust | null;
}

export interface PublicEntity {
  id: string;
  name: string;
  entityType: string | null;
  entityTypeLabel: string;
  country: string | null;
  nativeName: string | null;
  status: string | null;
  branch: string | null;
  unitType: string | null;
  aliases: { alias: string; typeLabel: string; note: string | null }[];
  /** Root organisation above this unit (for units), when a parent chain exists. */
  organization: EntityRef | null;
  parent: (EntityRef & { provenance: Provenance }) | null;
  parentHistory: { parent: EntityRef | null; validFrom: string | null; validTo: string | null; provenance: Provenance; current: boolean }[];
  subordinates: EntityRef[];
  relationships: { type: string; label: string; other: EntityRef; conflictName: string | null; provenance: Provenance }[];
  conflicts: { slug: string; name: string; role: string; provenance: Provenance | null }[];
  events: PublicEntityEvent[];
  territory: { conflictSlug: string; conflictName: string; areas: number; contested: number; changes: { id: string; description: string; changeType: string; role: "claimed" | "previous"; observedAt: string | null; sourceName: string | null; sourceUrl: string | null }[] } | null;
  commanders: { commander: EntityRef; rank: string | null; role: string | null; startDate: string | null; endDate: string | null; current: boolean; provenance: Provenance }[];
  equipment: { equipment: EntityRef; category: string | null; provenance: Provenance }[];
  sources: { label: string; name: string | null; url: string | null; trust: SourceTrust | null; observedAt: string | null }[];
  /** Last SOURCED appearance in Vigil (a report or event naming it) — not a location or deployment. */
  lastObservedAt: string | null;
  lastObservedText: string;
  provenance: Provenance;
  isUnit: boolean;
}

export interface PublicEntityEvent {
  slug: string;
  title: string;
  eventType: string;
  occurredAt: string;
  countryCode: string | null;
  locationPrecision: string | null;
  severity: string;
  conflict: { slug: string; name: string } | null;
  reportCount: number;
  /** Independent outlets behind it (0 = only party claims / nothing independent). */
  independentSources: number;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

async function trustByName(names: (string | null)[]): Promise<Map<string, SourceTrust>> {
  const unique = [...new Set(names.filter((n): n is string => Boolean(n)))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.source.findMany({ where: { name: { in: unique } }, select: { name: true, independenceClass: true, claimPolicy: true, sourceRole: true, perspective: true } });
  return new Map(rows.map((r) => [r.name, sourceTrust(r)]));
}

function provenanceOf(p: { sourceName: string | null; sourceUrl: string | null; observedAt: Date | null; confidence: number | null }, verb: string, trust: Map<string, SourceTrust>, now: number, fallbackObserved?: Date | null): Provenance {
  const observedAt = iso(p.observedAt ?? fallbackObserved ?? null);
  return {
    sourceName: p.sourceName,
    sourceUrl: p.sourceUrl && p.sourceUrl.trim() ? p.sourceUrl : null,
    observedAt,
    confidence: p.confidence,
    freshness: relationshipFreshness(observedAt, now),
    freshnessText: describeFreshness(verb, observedAt, now),
    trust: p.sourceName ? (trust.get(p.sourceName) ?? null) : null,
  };
}

async function eventsForUnit(unitId: string, limit = 12): Promise<PublicEntityEvent[]> {
  const links = await prisma.militaryUnitEvent.findMany({
    where: { unitId, event: { published: true } },
    include: { event: { include: { conflict: { select: { slug: true, name: true } }, sources: { include: { rawIngestionItem: { include: { source: true } } } } } } },
    orderBy: { event: { occurredAt: "desc" } },
    take: limit,
  });
  return links.map((l) => toEntityEvent(l.event));
}

type EventForEntity = Awaited<ReturnType<typeof prisma.event.findFirstOrThrow>> & { conflict: { slug: string; name: string } | null; sources: { relationship: string; rawIngestionItem: { originalUrl: string | null; source: { id: string; independenceClass: string | null; claimPolicy: string | null; sourceRole: string | null; perspective: string | null } } }[] };

function toEntityEvent(e: EventForEntity): PublicEntityEvent {
  const summary = summarizeEvidence(e.sources.map((s) => ({ sourceId: s.rawIngestionItem.source.id, url: s.rawIngestionItem.originalUrl, trust: sourceTrust(s.rawIngestionItem.source), relay: s.relationship === "relay" })));
  return {
    slug: e.slug,
    title: e.title,
    eventType: e.eventType,
    occurredAt: e.occurredAt.toISOString(),
    countryCode: e.countryCode,
    locationPrecision: e.locationPrecision,
    severity: e.severity,
    conflict: e.conflict,
    reportCount: e.sources.length,
    independentSources: summary.independentSources,
  };
}

/** Resolves a reference (a MilitaryUnit id, a territory-actor id, or a name) to the unit row. */
async function resolveUnitRef(ref: string) {
  const decoded = decodeURIComponent(ref);
  const byId = await prisma.militaryUnit.findUnique({ where: { id: decoded } });
  if (byId) return byId;
  const territoryActor = await prisma.conflictActor.findUnique({ where: { id: decoded } });
  if (territoryActor) return prisma.militaryUnit.findUnique({ where: { name: resolveActorName(territoryActor.name) } });
  return prisma.militaryUnit.findUnique({ where: { name: resolveActorName(decoded) } });
}

export async function findUnitIdForRef(ref: string): Promise<{ id: string; entityType: string | null } | null> {
  const unit = await resolveUnitRef(ref);
  return unit ? { id: unit.id, entityType: unit.entityType } : null;
}

export async function getPublicEntity(ref: string, now: number = Date.now()): Promise<PublicEntity | null> {
  const unit = await resolveUnitRef(ref);
  if (!unit) return null;

  const [aliasRows, parent, children, history, relFrom, relTo, participants, appointments, equipmentLinks, eventLinks, articleLinks, territoryActor, claimedChanges, previousChanges, primaryConflict] = await Promise.all([
    prisma.entityAlias.findMany({ where: { entityKind: "unit", entityId: unit.id, aliasType: { not: "canonical" } }, orderBy: { createdAt: "asc" } }),
    unit.parentUnitId ? prisma.militaryUnit.findUnique({ where: { id: unit.parentUnitId } }) : Promise.resolve(null),
    prisma.militaryUnit.findMany({ where: { parentUnitId: unit.id }, orderBy: { name: "asc" }, take: 40 }),
    prisma.unitParentHistory.findMany({ where: { unitId: unit.id }, include: { parent: true }, orderBy: [{ validTo: "asc" }, { createdAt: "desc" }], take: 20 }),
    prisma.actorRelationship.findMany({ where: { fromId: unit.id }, include: { to: true } }),
    prisma.actorRelationship.findMany({ where: { toId: unit.id }, include: { from: true } }),
    prisma.conflictParticipant.findMany({ where: { unitId: unit.id }, include: { conflict: { select: { id: true, slug: true, name: true } } } }),
    prisma.commanderAppointment.findMany({ where: { unitId: unit.id }, include: { commander: true }, orderBy: [{ endDate: "asc" }, { createdAt: "desc" }], take: 30 }),
    prisma.militaryUnitEquipment.findMany({ where: { unitId: unit.id }, include: { equipment: true }, take: 40 }),
    prisma.militaryUnitEvent.findMany({ where: { unitId: unit.id, event: { published: true } }, include: { event: { select: { occurredAt: true } } }, orderBy: { event: { occurredAt: "desc" } }, take: 1 }),
    prisma.articleMilitaryUnitLink.findMany({ where: { unitId: unit.id }, include: { rawIngestionItem: { select: { publishedAt: true, receivedAt: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.conflictActor.findFirst({ where: { name: unit.name }, include: { conflict: { select: { id: true, slug: true, name: true } } } }),
    prisma.territorialChangeCandidate.findMany({ where: { claimedActorId: unit.id, status: "approved" }, include: { conflict: { select: { slug: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.territorialChangeCandidate.findMany({ where: { previousActorId: unit.id, status: "approved" }, include: { conflict: { select: { slug: true, name: true } } }, orderBy: { createdAt: "desc" }, take: 6 }),
    unit.primaryConflictId ? prisma.conflict.findUnique({ where: { id: unit.primaryConflictId }, select: { id: true, slug: true, name: true } }) : Promise.resolve(null),
  ]);

  // Root organisation: follow the parent chain upward (bounded).
  let organization: EntityRef | null = null;
  {
    let cursor: typeof parent = parent;
    let guard = 0;
    while (cursor && guard++ < 12) {
      organization = { id: cursor.id, name: cursor.name, href: entityHref("unit", cursor.id, cursor.entityType) };
      cursor = cursor.parentUnitId ? await prisma.militaryUnit.findUnique({ where: { id: cursor.parentUnitId } }) : null;
    }
  }

  const trustNames = [unit.sourceName, ...history.map((h) => h.sourceName), ...appointments.map((a) => a.sourceName), ...equipmentLinks.map((e) => e.sourceName), ...relFrom.map((r) => r.sourceName), ...relTo.map((r) => r.sourceName), ...participants.map((p) => p.sourceName)];
  const trust = await trustByName(trustNames);

  const territoryRows = territoryActor
    ? await prisma.conflictTerritory.findMany({ where: { actorId: territoryActor.id, published: true, validTo: null }, select: { status: true } })
    : [];
  const contestedAreas = territoryActor ? await prisma.conflictTerritory.count({ where: { conflictId: territoryActor.conflictId, published: true, validTo: null, status: { in: ["contested", "uncertain"] } } }) : 0;

  const [events] = await Promise.all([eventsForUnit(unit.id)]);

  const reg = ACTOR_REGISTRY.find((a) => a.canonical === unit.name);
  const registryAliases = aliasesOf(unit.name);
  const seenAlias = new Set(aliasRows.map((a) => a.alias.toLowerCase()));
  const aliases = [
    ...aliasRows.map((a) => ({ alias: a.alias, typeLabel: ALIAS_TYPE_LABEL[(a.aliasType as AliasType) ?? "alternate"] ?? a.aliasType, note: [a.sourceScope ? `used by ${a.sourceScope}` : null, a.countryScope ? `in ${a.countryScope} context` : null].filter(Boolean).join(" · ") || null })),
    ...registryAliases.filter((a) => !seenAlias.has(a.toLowerCase())).map((alias) => ({ alias, typeLabel: ALIAS_TYPE_LABEL.alternate, note: "central actor registry" })),
  ];

  const lastObservedAt = latestOf(eventLinks[0]?.event.occurredAt, ...articleLinks.map((l) => l.rawIngestionItem.publishedAt ?? l.rawIngestionItem.receivedAt));
  const own = provenanceOf({ sourceName: unit.sourceName, sourceUrl: unit.sourceUrl, observedAt: unit.lastUpdatedAt, confidence: null }, "last updated", trust, now);

  const conflicts = new Map<string, PublicEntity["conflicts"][number]>();
  for (const p of participants) {
    conflicts.set(p.conflict.slug, { slug: p.conflict.slug, name: p.conflict.name, role: p.role, provenance: provenanceOf(p, "last sourced", trust, now) });
  }
  if (primaryConflict && !conflicts.has(primaryConflict.slug)) conflicts.set(primaryConflict.slug, { slug: primaryConflict.slug, name: primaryConflict.name, role: "linked", provenance: null });
  for (const e of events) if (e.conflict && !conflicts.has(e.conflict.slug)) conflicts.set(e.conflict.slug, { slug: e.conflict.slug, name: e.conflict.name, role: "appears in reports", provenance: null });

  const sourceRows: PublicEntity["sources"] = [];
  const addSource = (label: string, p: { sourceName: string | null; sourceUrl: string | null; observedAt?: Date | null }) => {
    if (!p.sourceName && !p.sourceUrl) return;
    if (sourceRows.some((s) => s.url === (p.sourceUrl ?? null) && s.name === p.sourceName && s.label === label)) return;
    sourceRows.push({ label, name: p.sourceName, url: p.sourceUrl && p.sourceUrl.trim() ? p.sourceUrl : null, trust: p.sourceName ? (trust.get(p.sourceName) ?? null) : null, observedAt: iso(p.observedAt ?? null) });
  };
  addSource("Entity record", unit);
  history.forEach((h) => addSource("Parent formation", h));
  appointments.forEach((a) => addSource("Commander", a));
  equipmentLinks.forEach((e) => addSource("Equipment", e));
  relFrom.forEach((r) => addSource("Relationship", r));
  participants.forEach((p) => addSource("Conflict role", p));

  return {
    id: unit.id,
    name: unit.name,
    entityType: unit.entityType,
    entityTypeLabel: isEntityType(unit.entityType) ? ENTITY_TYPE_LABEL[unit.entityType] : "Type not recorded",
    country: unit.country ?? reg?.country ?? null,
    nativeName: unit.nativeName,
    status: unit.status,
    branch: unit.branch,
    unitType: unit.unitType,
    aliases,
    organization,
    parent: parent ? { id: parent.id, name: parent.name, href: entityHref("unit", parent.id, parent.entityType), provenance: provenanceOf(history.find((h) => !h.validTo && h.parentUnitId === parent.id) ?? { sourceName: unit.sourceName, sourceUrl: unit.sourceUrl, observedAt: unit.lastUpdatedAt, confidence: null }, "last sourced", trust, now) } : null,
    parentHistory: history.map((h) => ({ parent: h.parent ? { id: h.parent.id, name: h.parent.name, href: entityHref("unit", h.parent.id, h.parent.entityType) } : null, validFrom: iso(h.validFrom), validTo: iso(h.validTo), current: !h.validTo, provenance: provenanceOf(h, "last sourced", trust, now) })),
    subordinates: children.map((c) => ({ id: c.id, name: c.name, href: entityHref("unit", c.id, c.entityType) })),
    relationships: [
      ...relFrom.map((r) => ({ type: r.relationType, label: RELATION_LABEL[r.relationType as RelationType] ?? r.relationType, other: { id: r.to.id, name: r.to.name, href: entityHref("unit", r.to.id, r.to.entityType) }, conflictName: null, provenance: provenanceOf(r, "last sourced", trust, now) })),
      ...relTo.map((r) => ({ type: r.relationType, label: r.relationType === "coalition_member" ? "Coalition includes" : (RELATION_LABEL[r.relationType as RelationType] ?? r.relationType), other: { id: r.from.id, name: r.from.name, href: entityHref("unit", r.from.id, r.from.entityType) }, conflictName: null, provenance: provenanceOf(r, "last sourced", trust, now) })),
    ],
    conflicts: [...conflicts.values()],
    events,
    territory:
      territoryActor || claimedChanges.length > 0 || previousChanges.length > 0
        ? {
            conflictSlug: territoryActor?.conflict.slug ?? (claimedChanges[0] ?? previousChanges[0])!.conflict.slug,
            conflictName: territoryActor?.conflict.name ?? (claimedChanges[0] ?? previousChanges[0])!.conflict.name,
            areas: territoryRows.length,
            contested: contestedAreas,
            changes: [
              ...claimedChanges.map((c) => ({ id: c.id, description: c.description, changeType: c.changeType, role: "claimed" as const, observedAt: iso(c.observedAt), sourceName: c.sourceName, sourceUrl: c.sourceUrl && c.sourceUrl.trim() ? c.sourceUrl : null })),
              ...previousChanges.map((c) => ({ id: c.id, description: c.description, changeType: c.changeType, role: "previous" as const, observedAt: iso(c.observedAt), sourceName: c.sourceName, sourceUrl: c.sourceUrl && c.sourceUrl.trim() ? c.sourceUrl : null })),
            ],
          }
        : null,
    commanders: appointments.map((a) => ({ commander: { id: a.commander.id, name: a.commander.name, href: entityHref("commander", a.commander.id) }, rank: a.commander.rank, role: a.role, startDate: iso(a.startDate), endDate: iso(a.endDate), current: !a.endDate, provenance: provenanceOf({ ...a, observedAt: a.lastConfirmedAt ?? a.observedAt }, "last confirmed", trust, now) })),
    equipment: equipmentLinks.map((e) => ({ equipment: { id: e.equipment.id, name: e.equipment.name, href: entityHref("equipment", e.equipment.id) }, category: e.equipment.category, provenance: provenanceOf(e, "last sourced", trust, now) })),
    sources: sourceRows,
    lastObservedAt,
    lastObservedText: lastObservedAt ? describeFreshness("Last sourced appearance in Vigil", lastObservedAt, now) : "No sourced appearance recorded in Vigil",
    provenance: own,
    isUnit: unit.entityType === "military_unit",
  };
}

// ---- commanders ------------------------------------------------------------------

export interface PublicCommander {
  id: string;
  name: string;
  rank: string | null;
  aliases: { alias: string; typeLabel: string }[];
  currentUnit: EntityRef | null;
  appointments: { unit: EntityRef; role: string | null; startDate: string | null; endDate: string | null; current: boolean; provenance: Provenance }[];
  events: PublicEntityEvent[];
  provenance: Provenance;
  lastSourcedText: string;
}

export async function getPublicCommander(id: string, now: number = Date.now()): Promise<PublicCommander | null> {
  const c = await prisma.commander.findUnique({ where: { id: decodeURIComponent(id) }, include: { currentUnit: true } });
  if (!c) return null;
  const [aliasRows, appointments, eventLinks] = await Promise.all([
    prisma.entityAlias.findMany({ where: { entityKind: "commander", entityId: c.id, aliasType: { not: "canonical" } } }),
    prisma.commanderAppointment.findMany({ where: { commanderId: c.id }, include: { unit: true }, orderBy: [{ endDate: "asc" }, { createdAt: "desc" }] }),
    prisma.eventCommanderLink.findMany({ where: { commanderId: c.id, event: { published: true } }, include: { event: { include: { conflict: { select: { slug: true, name: true } }, sources: { include: { rawIngestionItem: { include: { source: true } } } } } } }, orderBy: { event: { occurredAt: "desc" } }, take: 12 }),
  ]);
  const trust = await trustByName([c.sourceName, ...appointments.map((a) => a.sourceName)]);
  const lastSourced = latestOf(c.lastUpdatedAt, ...appointments.map((a) => a.lastConfirmedAt ?? a.observedAt));
  return {
    id: c.id,
    name: c.name,
    rank: c.rank,
    aliases: aliasRows.map((a) => ({ alias: a.alias, typeLabel: ALIAS_TYPE_LABEL[a.aliasType as AliasType] ?? a.aliasType })),
    currentUnit: c.currentUnit ? { id: c.currentUnit.id, name: c.currentUnit.name, href: entityHref("unit", c.currentUnit.id, c.currentUnit.entityType) } : null,
    appointments: appointments.map((a) => ({ unit: { id: a.unit.id, name: a.unit.name, href: entityHref("unit", a.unit.id, a.unit.entityType) }, role: a.role, startDate: iso(a.startDate), endDate: iso(a.endDate), current: !a.endDate, provenance: provenanceOf({ ...a, observedAt: a.lastConfirmedAt ?? a.observedAt }, "last confirmed", trust, now, a.createdAt) })),
    events: eventLinks.map((l) => toEntityEvent(l.event)),
    provenance: provenanceOf({ sourceName: c.sourceName, sourceUrl: c.sourceUrl, observedAt: c.lastUpdatedAt, confidence: null }, "last updated", trust, now),
    lastSourcedText: describeFreshness("Last sourced update", lastSourced, now),
  };
}

// ---- equipment -------------------------------------------------------------------

export interface PublicEquipment {
  id: string;
  name: string;
  category: string | null;
  countryOfOrigin: string | null;
  aliases: { alias: string; typeLabel: string }[];
  /** Units sourced as fielding this equipment TYPE. Not an inventory, not a sighting. */
  knownOperators: { unit: EntityRef; provenance: Provenance }[];
  /** Events whose sourced reports name this equipment — a distinct fact from being an operator. */
  observedInEvents: PublicEntityEvent[];
  provenance: Provenance;
}

export async function getPublicEquipment(id: string, now: number = Date.now()): Promise<PublicEquipment | null> {
  const e = await prisma.militaryEquipment.findUnique({ where: { id: decodeURIComponent(id) } });
  if (!e) return null;
  const [aliasRows, operators, eventLinks] = await Promise.all([
    prisma.entityAlias.findMany({ where: { entityKind: "equipment", entityId: e.id, aliasType: { not: "canonical" } } }),
    prisma.militaryUnitEquipment.findMany({ where: { equipmentId: e.id }, include: { unit: true }, take: 60 }),
    prisma.eventEquipmentLink.findMany({ where: { equipmentId: e.id, event: { published: true } }, include: { event: { include: { conflict: { select: { slug: true, name: true } }, sources: { include: { rawIngestionItem: { include: { source: true } } } } } } }, orderBy: { event: { occurredAt: "desc" } }, take: 12 }),
  ]);
  const trust = await trustByName([e.sourceName, ...operators.map((o) => o.sourceName)]);
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    countryOfOrigin: e.countryOfOrigin,
    aliases: aliasRows.map((a) => ({ alias: a.alias, typeLabel: ALIAS_TYPE_LABEL[a.aliasType as AliasType] ?? a.aliasType })),
    knownOperators: operators.map((o) => ({ unit: { id: o.unit.id, name: o.unit.name, href: entityHref("unit", o.unit.id, o.unit.entityType) }, provenance: provenanceOf(o, "last sourced", trust, now, o.createdAt) })),
    observedInEvents: eventLinks.map((l) => toEntityEvent(l.event)),
    provenance: provenanceOf({ sourceName: e.sourceName, sourceUrl: e.sourceUrl, observedAt: e.lastUpdatedAt, confidence: null }, "last updated", trust, now),
  };
}
