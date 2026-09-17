// A small curated table of state/non-state actors and organizations
// relevant to the seeded conflicts (see prisma/seed.mjs), in the same
// spirit as lib/geocoding/gazetteer.ts and lib/ingestion/event-type-
// keywords.ts — deterministic substring matching, not AI/NLP. Several
// entries deliberately map multiple surface forms to one canonical name
// (e.g. "IDF" and "Israeli forces" both resolve to "Israel") so the same
// actor mentioned two different ways in one report doesn't produce two
// near-duplicate facts, but distinct actors (e.g. Israel AND Hamas named
// in the same report) still do — spec's "multiple actors" case.
const ACTOR_ALIASES: [canonical: string, aliases: string[]][] = [
  ["Israel", ["israeli forces", "israel defense forces", "idf", "israeli military", "israel"]],
  ["Hamas", ["hamas"]],
  ["Hezbollah", ["hezbollah", "hizbullah"]],
  ["Palestinian Islamic Jihad", ["palestinian islamic jihad", "pij"]],
  ["Russia", ["russian forces", "russian military", "russian troops", "kremlin", "russia"]],
  ["Ukraine", ["ukrainian forces", "ukrainian military", "ukrainian troops", "kyiv government", "ukraine"]],
  ["Houthi movement", ["houthi", "houthis", "ansar allah"]],
  ["United States", ["u.s. military", "us military", "pentagon", "washington", "united states"]],
  ["United Nations", ["united nations", "un peacekeepers", "u.n."]],
  ["NATO", ["nato"]],
  ["Syrian government", ["syrian army", "syrian government", "damascus government"]],
  ["Iran", ["iranian forces", "revolutionary guard", "irgc", "tehran", "iran"]],
  ["Sudanese Armed Forces", ["sudanese armed forces", "saf"]],
  ["Rapid Support Forces", ["rapid support forces", "rsf"]],
];

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
