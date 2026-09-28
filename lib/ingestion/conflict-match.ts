import { prisma } from "@/lib/db/client";
import { findConflictByCountryCode } from "@/lib/db/repositories/conflicts";
import { parseCodes } from "@/lib/registry/geography";
import { CONFLICT_ALIASES } from "@/lib/conflicts/resolve";
import { ACTOR_REGISTRY, type ActorAlias } from "@/lib/actors/registry";
import type { Conflict } from "@prisma/client";
import type { EventType } from "@/lib/types";

// Real-data audit finding (Real Data Quality v1): country association alone used to be sufficient to
// auto-link a report to that country's one tracked conflict — a Ukrainian business/tourism/culture
// article got "Russia-Ukraine conflict" purely because the place resolved to Ukraine. This is the
// canonical, central matcher every caller (draft.ts, extract-facts.ts, bulk reprocessing) must use
// instead of a bare findConflictByCountryCode lookup. It requires real evidence, keeps the reasons that
// justified the match, and returns null (never a guess) when the evidence is only country-level.

export interface ConflictMatchResult {
  conflictId: string | null;
  conflictName: string | null;
  /** 0 when conflictId is null. Otherwise the evidence band: ~0.9 explicit name/alias, ~0.85 actor +
   * conflict-relevant event type, ~0.6 conflict-relevant event type alone, ~0.55 actor alone, ~0.45
   * dedicated source with a compatible topic. */
  matchConfidence: number;
  matchReasons: string[];
}

/** Event types that are themselves evidence of armed-conflict activity (as opposed to diplomacy,
 * sanctions, infrastructure, or the natural-hazard/health/"other" types NON_CONFLICT_EVENT_TYPES
 * already excludes upstream in event-type-keywords.ts). */
const VIOLENT_EVENT_TYPES = new Set<EventType>([
  "missile", "drone", "airstrike", "artillery", "explosion", "naval",
  "air_defense", "ground_clash", "terrorism", "border", "civil_unrest",
]);

// Short, high-precision phrase list: real evidence AGAINST a conflict link, used only to break a tie
// when no positive conflict evidence was found (or the positive evidence is itself weak) — never
// overrides a genuine strong/medium match (a real war report that also mentions tourism fallout must
// still link). Deliberately small: a giant keyword blacklist is brittle and was explicitly ruled out.
const FALSE_POSITIVE_PATTERNS: RegExp[] = [
  /\bappointed as\b/i,
  /\bnamed (?:ceo|chairman|chairwoman|chair|president) of\b/i,
  /\bdistribution agreement\b/i,
  /\bpartnership agreement\b/i,
  /\bbox office\b/i,
  /\bfilm festival\b/i,
  /\b(?:concert|album|tour dates)\b/i,
  /\btourism\b/i,
  /\btourists?\b/i,
  /\brecipe\b/i,
  /\bfashion (?:week|show)\b/i,
  /\bquarterly (?:earnings|results)\b/i,
  /\bstock (?:market|price|exchange)\b/i,
  /\bGDP (?:grew|growth)\b/i,
  /\bwins? (?:the )?(?:award|championship|medal|title)\b/i,
];

/** A single bare word ("Libya", "Haiti", "Gaza", "Syria" — several conflicts are literally named after
 * their country, and several curated aliases are just a bare place name) is exactly the weak,
 * country/place-name-alone evidence this matcher must reject, not strong "explicit conflict name"
 * evidence — real conflict names/aliases are always distinctive multi-word phrases ("Gaza war",
 * "Israeli-Palestinian conflict", "Mexican drug war"). Requiring a space is a simple, robust proxy for
 * that distinction without hand-listing every offending single-word case. */
function isSpecificEnough(name: string): boolean {
  return name.trim().includes(" ");
}

function conflictAliasHit(textLower: string, conflict: Pick<Conflict, "slug" | "name" | "shortName">): string | null {
  const names = [conflict.name, conflict.shortName, ...(CONFLICT_ALIASES[conflict.slug] ?? [])].filter((n): n is string => !!n && isSpecificEnough(n));
  for (const n of names) if (textLower.includes(n.toLowerCase())) return n;
  return null;
}

interface ActorHit {
  name: string;
  matchedText: string;
}

/** Only counts an actor mention as conflict-specific evidence when the alias itself is conflict-specific.
 * A state actor's plain civilian name ("Ukraine", "Israel", "Russia") lives only in `textAliases` for a
 * handful of heavily-tracked states and is exactly the weak, country-name-alone evidence this matcher
 * must reject — so state actors only match against their military-flavored `aliases` ("Ukrainian forces",
 * "IDF"). Non-state actors (armed groups) are inherently conflict-specific by name, so any of their
 * aliases count. Generic international organizations (UN, NATO) are excluded: they appear across too many
 * unrelated diplomatic stories to be conflict-specific evidence on their own. */
function actorEvidenceHit(textLower: string, countryCode: string, fightingGeo: readonly string[]): ActorHit | null {
  for (const actor of ACTOR_REGISTRY) {
    if (actor.kind === "organization") continue;
    if (actor.country && !fightingGeo.includes(actor.country)) continue;
    const pool: ActorAlias[] = actor.kind === "state" ? actor.aliases : [actor.canonical, ...actor.aliases];
    for (const raw of pool) {
      const alias = typeof raw === "string" ? raw : raw.alias;
      const scopeCountry = typeof raw === "string" ? null : raw.countryCode;
      if (scopeCountry && scopeCountry !== countryCode) continue;
      if (alias && textLower.includes(alias.toLowerCase())) return { name: actor.canonical, matchedText: alias };
    }
  }
  return null;
}

async function isDedicatedSource(sourceId: string, conflictId: string): Promise<boolean> {
  const link = await prisma.sourceConflictLink.findUnique({ where: { sourceId_conflictId: { sourceId, conflictId } } });
  return link?.scope === "dedicated";
}

export async function matchConflict(input: {
  title: string;
  bodyText: string;
  countryCode: string | null;
  eventType: EventType;
  sourceId: string;
}): Promise<ConflictMatchResult> {
  const none = (reason: string): ConflictMatchResult => ({ conflictId: null, conflictName: null, matchConfidence: 0, matchReasons: [reason] });
  if (!input.countryCode) return none("no location resolved — country association alone is never enough to imply a conflict");

  const conflict = await findConflictByCountryCode(input.countryCode);
  if (!conflict) return none(`${input.countryCode} has no tracked conflict`);

  const fullText = `${input.title} ${input.bodyText}`;
  const textLower = fullText.toLowerCase();
  const fightingGeo = [...new Set([...parseCodes(conflict.fightingCountries), ...parseCodes(conflict.participantCountries)])];

  const aliasHit = conflictAliasHit(textLower, conflict);
  const actorHit = actorEvidenceHit(textLower, input.countryCode, fightingGeo);
  const isViolent = VIOLENT_EVENT_TYPES.has(input.eventType);
  const dedicated = await isDedicatedSource(input.sourceId, conflict.id);
  const blocked = FALSE_POSITIVE_PATTERNS.some((p) => p.test(fullText));

  const reasons: string[] = [];
  let confidence = 0;

  if (aliasHit) {
    confidence = 0.9;
    reasons.push(`explicit conflict name/alias "${aliasHit}" in the text`);
  } else if (isViolent && actorHit) {
    confidence = 0.85;
    reasons.push(`"${actorHit.matchedText}" (${actorHit.name}) named alongside a conflict-relevant event type (${input.eventType})`);
  } else if (isViolent) {
    confidence = 0.6;
    reasons.push(`conflict-relevant event type (${input.eventType}) in ${conflict.name}'s own fighting geography`);
  } else if (actorHit) {
    confidence = 0.55;
    reasons.push(`"${actorHit.matchedText}" (${actorHit.name}) named in the text`);
  } else if (dedicated) {
    confidence = 0.45;
    reasons.push(`${conflict.name}'s own dedicated source`);
  }

  if (confidence === 0) {
    return none(
      blocked
        ? "country resolved, but the text reads as a non-conflict topic (business/culture/sports/etc.) — not linked"
        : "country resolved, but no conflict-specific evidence in the text (country name alone is never enough) — not linked",
    );
  }
  if (blocked && confidence < 0.6) {
    return none(`weak conflict evidence (${reasons[0]}), but the text also reads as a non-conflict topic — not linked`);
  }

  return { conflictId: conflict.id, conflictName: conflict.name, matchConfidence: confidence, matchReasons: reasons };
}
