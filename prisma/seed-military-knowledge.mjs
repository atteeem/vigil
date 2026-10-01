// MilitaryLand Phase 2 / knowledge-layer backfill. Runs after the Phase 1 reference seed and
// turns what is already stored into the connected model — WITHOUT new external fetching and
// without inventing facts:
//   - every entity gets its canonical alias row; registry actor spellings become alias rows
//   - entity type / country are set only where the name form or the source makes them plain
//   - each unit's current parent is recorded in the parent history (with the unit's own source)
//   - relationships that lack an observation date get one from when they were sourced
//   - a unit's primary conflict becomes an explicit, sourced participant link
// Idempotent. MilitaryLand is a reference source: nothing here is live positioning and no
// protected imagery is copied.
import { readFileSync } from "node:fs";
import { normalizeEntityText } from "./entity-text.mjs";

const registry = JSON.parse(readFileSync(new URL("../data/actor-registry.json", import.meta.url), "utf8"));
const DESIGNATION = /^\d+(?:st|nd|rd|th)\s+.+\b(Brigade|Corps|Battalion|Regiment|Division|Group|Army|Task Force)$/;
const KIND_TYPE = { state: "state_military", armed_group: "armed_group" };

export async function seedMilitaryKnowledge(prisma) {
  const stats = { aliases: 0, typed: 0, history: 0, participants: 0, observed: 0 };
  // Everything is read up front and written in ONE transaction: per-row round trips made this
  // backfill dominate seed time on SQLite.
  const ops = [];
  const existing = await prisma.entityAlias.findMany();
  const owned = new Set(existing.map((a) => `${a.entityKind}|${a.entityId}|${a.normalized}`));
  const byName = new Map();
  for (const a of existing) {
    const k = `${a.entityKind}|${a.normalized}|${a.countryScope ?? ""}`;
    byName.set(k, (byName.get(k) ?? new Set()).add(a.entityId));
  }
  const creates = [];

  const ensureAlias = (entityKind, entityId, alias, aliasType, extra = {}) => {
    const normalized = normalizeEntityText(alias);
    if (!normalized || owned.has(`${entityKind}|${entityId}|${normalized}`)) return;
    // Never let an alias point at two entities: skip when another entity already owns the name.
    const others = [...(byName.get(`${entityKind}|${normalized}|${extra.countryScope ?? ""}`) ?? [])].filter((id) => id !== entityId);
    if (others.length > 0 && !extra.countryScope) return;
    owned.add(`${entityKind}|${entityId}|${normalized}`);
    const key = `${entityKind}|${normalized}|${extra.countryScope ?? ""}`;
    byName.set(key, (byName.get(key) ?? new Set()).add(entityId));
    creates.push({ entityKind, entityId, alias, normalized, aliasType, countryScope: extra.countryScope ?? null, sourceName: extra.sourceName ?? null, sourceUrl: extra.sourceUrl ?? null });
    stats.aliases += 1;
  };

  const units = await prisma.militaryUnit.findMany();
  // 1. Canonical aliases for every entity.
  for (const u of units) ensureAlias("unit", u.id, u.name, "canonical");
  for (const c of await prisma.commander.findMany()) ensureAlias("commander", c.id, c.name, "canonical");
  for (const e of await prisma.militaryEquipment.findMany()) ensureAlias("equipment", e.id, e.name, "canonical");

  // 2. Registry actor spellings for actors that exist as entities.
  const unitByName = new Map(units.map((u) => [u.name, u]));
  for (const actor of registry.actors) {
    const unit = unitByName.get(actor.canonical);
    if (!unit) continue;
    for (const raw of actor.aliases) {
      const alias = typeof raw === "string" ? raw : raw.alias;
      const scope = typeof raw === "string" ? null : raw.countryCode;
      const type = /^[A-Z0-9.-]{2,6}$/.test(alias) ? "abbreviation" : "alternate";
      ensureAlias("unit", unit.id, alias, type, { countryScope: scope, sourceName: "Actor registry" });
    }
  }
  if (creates.length) ops.push(prisma.entityAlias.createMany({ data: creates }));

  // 3. Entity type and country, only where plain.
  const typedUnits = new Map();
  for (const u of units.filter((x) => x.entityType == null || x.country == null)) {
    const reg = registry.actors.find((a) => a.canonical === u.name);
    const fromMilitaryLand = (u.sourceUrl ?? "").includes("militaryland.net");
    const entityType = u.entityType ?? (reg ? (KIND_TYPE[reg.kind] ?? "other") : DESIGNATION.test(u.name) || fromMilitaryLand ? "military_unit" : null);
    const country = u.country ?? reg?.country ?? (fromMilitaryLand ? "UA" : null);
    if (entityType !== u.entityType || country !== u.country) {
      ops.push(prisma.militaryUnit.update({ where: { id: u.id }, data: { entityType, country } }));
      typedUnits.set(u.id, entityType);
      stats.typed += 1;
    }
  }

  // 4. Parent history for the current parent pointers.
  const openHistory = new Set((await prisma.unitParentHistory.findMany({ where: { validTo: null } })).map((h) => `${h.unitId}|${h.parentUnitId}`));
  const history = units.filter((u) => u.parentUnitId && !openHistory.has(`${u.id}|${u.parentUnitId}`)).map((u) => ({ unitId: u.id, parentUnitId: u.parentUnitId, sourceName: u.sourceName, sourceUrl: u.sourceUrl, observedAt: u.lastUpdatedAt }));
  if (history.length) ops.push(prisma.unitParentHistory.createMany({ data: history }));
  stats.history = history.length;

  // 5. Observation dates for relationships that only have creation times.
  stats.observed += await prisma.militaryUnitEquipment.count({ where: { observedAt: null } });
  ops.push(prisma.militaryUnitEquipment.updateMany({ where: { observedAt: null }, data: { observedAt: new Date() } }));
  for (const a of await prisma.commanderAppointment.findMany({ where: { observedAt: null } })) {
    ops.push(prisma.commanderAppointment.update({ where: { id: a.id }, data: { observedAt: a.createdAt } }));
    stats.observed += 1;
  }

  // 6. A unit's primary conflict as an explicit, sourced participant link.
  const links = new Set((await prisma.conflictParticipant.findMany()).map((l) => `${l.conflictId}|${l.unitId}`));
  const participants = units
    .filter((u) => u.primaryConflictId && (typedUnits.has(u.id) ? typedUnits.get(u.id) : u.entityType) === "military_unit" && !links.has(`${u.primaryConflictId}|${u.id}`))
    .map((u) => ({ conflictId: u.primaryConflictId, unitId: u.id, role: "belligerent", sourceName: u.sourceName, sourceUrl: u.sourceUrl, observedAt: u.lastUpdatedAt }));
  if (participants.length) ops.push(prisma.conflictParticipant.createMany({ data: participants }));
  stats.participants = participants.length;

  // Prisma's default interactive-transaction timeout (5s) was sized for SQLite's near-zero local
  // latency; each of these ops is its own round trip over a real network connection to Postgres,
  // so the batch as a whole needs more headroom.
  await prisma.$transaction(ops, { timeout: 30_000 });
  console.log(`Seeded military knowledge layer: ${stats.aliases} aliases, ${stats.typed} typed, ${stats.history} parent-history rows, ${stats.participants} participant links, ${stats.observed} observation dates.`);
}
