import { prisma } from "@/lib/db/client";
import { canonicalizeActor } from "@/lib/actors/registry";
import type { AliasType } from "./entity-types";

// Alias resolution for units/actors, commanders and equipment.
//
// Every entity has a "canonical" alias row for its own name, so resolution is ONE exact
// lookup over EntityAlias (plus the central actor registry, which supplies the built-in
// actor spellings: SAC / Tatmadaw / Myanmar Armed Forces ...). Matching is exact after
// normalisation — never fuzzy. A text that matches more than one entity is AMBIGUOUS and is
// reported as such: the caller decides (extraction queues it for review; nothing is merged or
// linked on a guess). Two organisations with similar names stay two organisations.

export type EntityKind = "unit" | "commander" | "equipment";

export function normalizeEntityText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // fold diacritics only (Zaïts == Zaits), nothing looser
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s.-]+/gu, " ")
    .replace(/^\s*the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResolveContext {
  /** ISO country of the conflict/source: enables country-scoped aliases. */
  country?: string | null;
  /** Name of the source: enables source-specific aliases. */
  source?: string | null;
}

export type Resolution =
  | { status: "resolved"; id: string; via: "canonical" | "alias" | "registry"; aliasType: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unknown" };

/** Exact resolution of a name to ONE entity of `kind`, or a truthful ambiguous/unknown. */
export async function resolveEntity(kind: EntityKind, text: string, context: ResolveContext = {}): Promise<Resolution> {
  const norms = new Set<string>([normalizeEntityText(text)]);
  let viaRegistry = false;
  if (kind === "unit") {
    const canonical = canonicalizeActor(text, { countryCode: context.country ?? undefined });
    if (canonical) {
      norms.add(normalizeEntityText(canonical));
      viaRegistry = true;
    }
  }
  const rows = await prisma.entityAlias.findMany({ where: { entityKind: kind, normalized: { in: [...norms] } } });
  const usable = rows.filter((r) => {
    if (r.countryScope && context.country && r.countryScope.toUpperCase() !== context.country.toUpperCase()) return false;
    if (r.countryScope && !context.country) return false;
    if (r.sourceScope && r.sourceScope !== context.source) return false;
    return true;
  });
  const ids = [...new Set(usable.map((r) => r.entityId))];
  if (ids.length === 0 && rows.length === 0) {
    // An entity written directly (no canonical alias row yet): fall back to its exact stored name.
    const names = [text.trim(), ...(kind === "unit" ? [canonicalizeActor(text, { countryCode: context.country ?? undefined })].filter((n): n is string => Boolean(n)) : [])];
    const direct =
      kind === "unit"
        ? await prisma.militaryUnit.findMany({ where: { name: { in: names } }, select: { id: true } })
        : kind === "commander"
          ? await prisma.commander.findMany({ where: { name: { in: names } }, select: { id: true } })
          : await prisma.militaryEquipment.findMany({ where: { name: { in: names } }, select: { id: true } });
    if (direct.length === 1) return { status: "resolved", id: direct[0]!.id, via: "canonical", aliasType: "canonical" };
    if (direct.length > 1) return { status: "ambiguous", candidates: direct.map((d) => d.id) };
  }
  if (ids.length === 0) {
    // The name exists only under scopes we cannot evaluate (no country/source context): if several
    // entities claim it, that is ambiguity, not absence.
    const scoped = [...new Set(rows.map((r) => r.entityId))];
    return scoped.length > 1 ? { status: "ambiguous", candidates: scoped } : { status: "unknown" };
  }
  if (ids.length > 1) return { status: "ambiguous", candidates: ids };
  const row = usable.find((r) => r.entityId === ids[0])!;
  return { status: "resolved", id: ids[0]!, via: viaRegistry && row.aliasType === "canonical" ? "registry" : row.aliasType === "canonical" ? "canonical" : "alias", aliasType: row.aliasType };
}

export interface AddAliasOptions {
  aliasType?: AliasType;
  sourceScope?: string | null;
  countryScope?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
}

export type AddAliasResult = { ok: true; created: boolean } | { ok: false; reason: string; conflictsWith: string };

/** Registers a name for an entity. The same name for the same entity is a no-op. A name that
 * already identifies a DIFFERENT entity is refused (unless scoped to a country/source that
 * makes the two distinguishable): aliases never merge organisations. */
export async function addEntityAlias(kind: EntityKind, entityId: string, alias: string, options: AddAliasOptions = {}): Promise<AddAliasResult> {
  const trimmed = alias.trim();
  const normalized = normalizeEntityText(trimmed);
  if (!normalized) return { ok: false, reason: "Alias is empty.", conflictsWith: "" };
  const same = await prisma.entityAlias.findUnique({ where: { entityKind_entityId_normalized: { entityKind: kind, entityId, normalized } } });
  if (same) return { ok: true, created: false };
  const others = await prisma.entityAlias.findMany({ where: { entityKind: kind, normalized, entityId: { not: entityId } } });
  const clash = others.find((o) => !(options.countryScope && o.countryScope !== options.countryScope) && !(options.sourceScope && o.sourceScope !== options.sourceScope));
  if (clash && !options.countryScope && !options.sourceScope) return { ok: false, reason: `"${trimmed}" already names another ${kind}.`, conflictsWith: clash.entityId };
  await prisma.entityAlias.create({
    data: {
      entityKind: kind,
      entityId,
      alias: trimmed,
      normalized,
      aliasType: options.aliasType ?? "alternate",
      sourceScope: options.sourceScope ?? null,
      countryScope: options.countryScope ?? null,
      sourceName: options.sourceName ?? null,
      sourceUrl: options.sourceUrl ?? null,
    },
  });
  return { ok: true, created: true };
}

/** Every entity's own name is its canonical alias. Idempotent. */
export async function ensureCanonicalAlias(kind: EntityKind, entityId: string, name: string): Promise<void> {
  const normalized = normalizeEntityText(name);
  if (!normalized) return;
  await prisma.entityAlias.upsert({
    where: { entityKind_entityId_normalized: { entityKind: kind, entityId, normalized } },
    update: {},
    create: { entityKind: kind, entityId, alias: name, normalized, aliasType: "canonical" },
  });
}

export async function listAliases(kind: EntityKind, entityId: string) {
  const rows = await prisma.entityAlias.findMany({ where: { entityKind: kind, entityId, aliasType: { not: "canonical" } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, alias: r.alias, aliasType: r.aliasType as AliasType, sourceScope: r.sourceScope, countryScope: r.countryScope, sourceName: r.sourceName, sourceUrl: r.sourceUrl }));
}
