import registry from "@/data/actor-registry.json";

// Central armed-actor registry. ONE canonical name per actor and every spelling
// variant as an alias, so "the junta", "SAC" and "Tatmadaw" — or "IDF" and
// "Israeli forces" — are the same actor everywhere: report-text actor
// detection (lib/ingestion/actors.ts), territorial-change extraction
// (lib/territory/change-detection.ts), MilitaryUnit creation and the conflict
// registry all resolve through here. Add a variant to data/actor-registry.json,
// never as a one-off regex in a caller.

export type ActorAlias = string | { alias: string; countryCode: string };
export type ActorKind = "state" | "armed_group" | "organization";

export interface ActorEntry {
  canonical: string;
  kind: ActorKind;
  country?: string;
  aliases: ActorAlias[];
  /** Lowercase substrings the report-text detector scans for (subset of actors). */
  textAliases?: string[];
}

export const ACTOR_REGISTRY: readonly ActorEntry[] = registry.actors as unknown as ActorEntry[];

/** Case/punctuation-insensitive form used for matching: drops a leading
 * "the", unifies apostrophes and collapses whitespace. */
export function normalizeActorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface IndexEntry {
  canonical: string;
  /** Present when the alias only applies in one country's context. */
  countryCode?: string;
}

function buildIndex(): Map<string, IndexEntry[]> {
  const index = new Map<string, IndexEntry[]>();
  const add = (key: string, entry: IndexEntry) => {
    const list = index.get(key) ?? [];
    list.push(entry);
    index.set(key, list);
  };
  for (const actor of ACTOR_REGISTRY) {
    add(normalizeActorName(actor.canonical), { canonical: actor.canonical });
    for (const alias of actor.aliases) {
      if (typeof alias === "string") add(normalizeActorName(alias), { canonical: actor.canonical });
      else add(normalizeActorName(alias.alias), { canonical: actor.canonical, countryCode: alias.countryCode });
    }
  }
  return index;
}

const INDEX = buildIndex();

export interface ActorContext {
  /** ISO country of the conflict/source — enables country-scoped aliases. */
  countryCode?: string | null;
}

/** The canonical actor name for `raw`, or null if it names no registered actor.
 * Exact-name matching only (after normalization) — never fuzzy, so an unknown
 * group is left alone rather than merged into the wrong actor. */
export function canonicalizeActor(raw: string | null | undefined, context: ActorContext = {}): string | null {
  if (!raw) return null;
  const hits = INDEX.get(normalizeActorName(raw));
  if (!hits) return null;
  const unscoped = hits.find((h) => !h.countryCode);
  if (unscoped) return unscoped.canonical;
  return hits.find((h) => h.countryCode === context.countryCode)?.canonical ?? null;
}

/** Canonical name if registered, otherwise the input trimmed — what
 * MilitaryUnit creation stores so spelling variants collapse to one row. */
export function resolveActorName(raw: string, context: ActorContext = {}): string {
  return canonicalizeActor(raw, context) ?? raw.trim().replace(/^the\s+/i, "");
}

/** True when `name` is the canonical name of a registered actor. */
export function isRegisteredActor(name: string): boolean {
  return ACTOR_REGISTRY.some((a) => a.canonical === name);
}

export function aliasesOf(canonical: string): string[] {
  const actor = ACTOR_REGISTRY.find((a) => a.canonical === canonical);
  return actor ? actor.aliases.map((a) => (typeof a === "string" ? a : a.alias)) : [];
}

/** [canonical, lowercase text aliases] for the report-text detector. */
export function textMatchTable(): [canonical: string, aliases: string[]][] {
  return ACTOR_REGISTRY.filter((a) => a.textAliases && a.textAliases.length > 0).map((a) => [a.canonical, [...a.textAliases!]]);
}

/** Aliases that resolve to more than one canonical actor without a country
 * scope to tell them apart — a registry data error. Empty when healthy. */
export function findAmbiguousAliases(): string[] {
  const bad: string[] = [];
  for (const [key, hits] of INDEX) {
    const unscoped = new Set(hits.filter((h) => !h.countryCode).map((h) => h.canonical));
    if (unscoped.size > 1) bad.push(key);
  }
  return bad;
}
