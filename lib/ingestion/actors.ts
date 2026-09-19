import { textMatchTable } from "@/lib/actors/registry";

// A small curated table of state/non-state actors and organizations
// relevant to the seeded conflicts (see prisma/seed.mjs), in the same
// spirit as lib/geocoding/gazetteer.ts and lib/ingestion/event-type-
// keywords.ts — deterministic substring matching, not AI/NLP. Several
// entries deliberately map multiple surface forms to one canonical name
// (e.g. "IDF" and "Israeli forces" both resolve to "Israel") so the same
// actor mentioned two different ways in one report doesn't produce two
// near-duplicate facts, but distinct actors (e.g. Israel AND Hamas named
// in the same report) still do — spec's "multiple actors" case.
// The alias table lives in the central actor registry (lib/actors/registry.ts,
// data/actor-registry.json) so every consumer shares one set of spellings.
const ACTOR_ALIASES: [canonical: string, aliases: string[]][] = textMatchTable();

export interface ActorMatch {
  name: string;
  /** The exact alias text matched, for provenance — kept separate from
   * the canonical name so the admin can see what the source actually
   * said. */
  matchedText: string;
}

/** Finds every distinct actor named in the text — deliberately returns
 * ALL matches, not just the first, since a report naming two or more
 * actors is the normal case this extraction is meant to surface (spec
 * "multiple actors"), not an ambiguity to collapse to one. Two aliases
 * for the SAME canonical actor collapse to one match (longest alias
 * wins as the reported matchedText) so mentioning "IDF" and "Israeli
 * forces" in one report doesn't produce two facts for the same actor. */
export function detectActors(text: string): ActorMatch[] {
  const lower = text.toLowerCase();
  const matches = new Map<string, ActorMatch>();
  for (const [canonical, aliases] of ACTOR_ALIASES) {
    let best: string | null = null;
    for (const alias of aliases) {
      if (lower.includes(alias) && (best === null || alias.length > best.length)) {
        best = alias;
      }
    }
    if (best !== null) matches.set(canonical, { name: canonical, matchedText: best });
  }
  return [...matches.values()];
}
