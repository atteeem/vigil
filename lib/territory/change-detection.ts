import { detectActors } from "@/lib/ingestion/actors";
import type { TerritorialChangeType } from "@/lib/territory/change-types";

// Central territorial-change phrase normalizer. Every phrasing ("seized",
// "took control of", "retook", "withdrew from", "handed X to Z", "became
// contested", ...) is declared ONCE in the RULES table below and normalized
// to a change type — no per-source regexes. Deterministic rules only; a
// mention never invents an actor or location the sentence doesn't name.

export interface TerritorialChangeMention {
  changeType: TerritorialChangeType;
  /** Actor reported to have gained/hold the location; null if not named. */
  claimedActorName: string | null;
  /** Actor reported to have lost/ceded/vacated it, where named. */
  previousActorName: string | null;
  locationName: string;
  /** Administrative suffix in the source ("Sagaing Region" -> "region"). */
  locationSuffix: string | null;
  /** Matched phrase, stored verbatim as the candidate description. */
  description: string;
  /** Full sentence the phrase came from. */
  sentence: string;
  ruleId: string;
  /** True when the sentence is hedged ("reportedly", "claimed", ...). */
  hedged: boolean;
}

export interface DetectionContext {
  /** ISO country code of the conflict/source — scopes country-specific aliases. */
  countryCode?: string | null;
}

// ---- building blocks -------------------------------------------------------

function cap(word: string): string {
  return word
    .split(/\s+/)
    .map((w) => `[${w[0]!.toLowerCase()}${w[0]!.toUpperCase()}]${w.slice(1)}`)
    .join("\\s+");
}
function verbs(...forms: string[]): string {
  return `(?:${forms.map(cap).join("|")})`;
}

const STOP = "(?!(?:From|To|By|After|Amid|And|As|With|In|On|At|Near|Following|Says|Say|After|While|Which|Who)\\b)";
const NAME_TOKEN = `${STOP}[A-Z][\\p{L}'’\\-]+`;
const PROPER = `${NAME_TOKEN}(?:\\s+${NAME_TOKEN}){0,2}`;
const GROUP_NOUN = "(?:forces|troops|army|fighters|militia|rebels|military|brigade|battalion|group|movement|units)";
const GENERIC_ACTOR = "(?:military\\s+)?junta|regime|rebels|rebel\\s+forces|government\\s+forces|resistance\\s+forces|insurgents|militants|separatists|opposition\\s+forces";
const ACTOR = `(?:[Tt]he\\s+)?(${PROPER}(?:\\s+${GROUP_NOUN})?|${GENERIC_ACTOR})`;
const AREA_SUFFIX = "(?:\\s+(township|town|city|village|district|region|state|province|oblast|area|county)\\b)?";
const LOC = `(?:[Tt]he\\s+)?(${PROPER})${AREA_SUFFIX}`;
const FROM_ACTOR = `(?:\\s+[Ff]rom\\s+${ACTOR})?`;
const TO_ACTOR = `(?:\\s+to\\s+${ACTOR})?`;

type Slot = "claimed" | "previous" | "location" | "suffix";
interface Rule {
  id: string;
  changeType: TerritorialChangeType;
  pattern: RegExp;
  /** Capture-group order of the pattern. */
  slots: Slot[];
}

const rx = (source: string) => new RegExp(source, "gu");

const RULES: Rule[] = [
  // X recaptured / retook Y [from Z]
  {
    id: "recaptured",
    changeType: "recaptured",
    pattern: rx(`${ACTOR}\\s+${verbs("recaptured", "recaptures", "retook", "retakes", "retaken", "has retaken", "have retaken")}\\s+${LOC}${FROM_ACTOR}`),
    slots: ["claimed", "location", "suffix", "previous"],
  },
  // X regained / restored control of Y [from Z]
  {
    id: "control_restored",
    changeType: "control_restored",
    pattern: rx(`${ACTOR}\\s+${verbs("regained control of", "regains control of", "restored control of", "restored control over", "regained")}\\s+${LOC}${FROM_ACTOR}`),
    slots: ["claimed", "location", "suffix", "previous"],
  },
  // X captured / seized / took control of Y [from Z]
  {
    id: "captured",
    changeType: "captured",
    pattern: rx(
      `${ACTOR}\\s+${verbs("captured", "captures", "seized control of", "seized", "seizes", "took control of", "takes control of", "overran", "overruns")}\\s+${LOC}${FROM_ACTOR}`,
    ),
    slots: ["claimed", "location", "suffix", "previous"],
  },
  // Y was captured / seized / retaken by X   (passive)
  {
    id: "captured_passive",
    changeType: "captured",
    pattern: rx(`${LOC}\\s+(?:was|has been|were)\\s+${verbs("captured", "seized", "overrun")}\\s+by\\s+${ACTOR}`),
    slots: ["location", "suffix", "claimed"],
  },
  {
    id: "recaptured_passive",
    changeType: "recaptured",
    pattern: rx(`${LOC}\\s+(?:was|has been|were)\\s+${verbs("recaptured", "retaken")}\\s+by\\s+${ACTOR}`),
    slots: ["location", "suffix", "claimed"],
  },
  // Y fell to X
  {
    id: "fell_to",
    changeType: "captured",
    pattern: rx(`${LOC}\\s+${verbs("fell to", "has fallen to")}\\s+${ACTOR}`),
    slots: ["location", "suffix", "claimed"],
  },
  // X lost [control of] Y [to Z]
  {
    id: "lost_control",
    changeType: "lost_control",
    pattern: rx(`${ACTOR}\\s+${verbs("lost control of", "loses control of", "lost")}\\s+${LOC}${TO_ACTOR}`),
    slots: ["previous", "location", "suffix", "claimed"],
  },
  // X withdrew from / pulled out of / vacated Y
  {
    id: "withdrawn",
    changeType: "withdrawn",
    pattern: rx(`${ACTOR}\\s+${verbs("withdrew from", "withdraws from", "has withdrawn from", "pulled out of", "pulled back from", "vacated", "abandoned", "evacuated")}\\s+${LOC}`),
    slots: ["previous", "location", "suffix"],
  },
  // X handed [over] Y [control] to Z / ceded Y to Z / transferred control of Y to Z
  {
    id: "transferred",
    changeType: "transferred",
    pattern: rx(
      `${ACTOR}\\s+${verbs("handed over", "handed", "hands over", "ceded", "cedes", "transferred control of", "transferred")}\\s+${LOC}(?:\\s+control)?\\s+(?:back\\s+)?to\\s+${ACTOR}`,
    ),
    slots: ["previous", "location", "suffix", "claimed"],
  },
  // Y became / is now / remains contested [between X and Z]
  {
    id: "contested",
    changeType: "contested",
    pattern: rx(`${LOC}\\s+(?:became|has become|is now|is still|remains|remained)\\s+contested(?:\\s+between\\s+${ACTOR}\\s+and\\s+${ACTOR})?`),
    slots: ["location", "suffix", "claimed", "previous"],
  },
  // fighting / battle / clashes for control of Y continues
  {
    id: "contested_fighting",
    changeType: "contested",
    pattern: rx(`(?:[Ff]ighting|[Bb]attles?|[Cc]lashes|[Ss]truggle)\\s+for\\s+(?:control\\s+of\\s+)?${LOC}\\s+(?:continues?|continued|rages?|raged|persists?|intensifies)`),
    slots: ["location", "suffix"],
  },
  // control of Y is unclear / uncertain / disputed
  {
    id: "control_uncertain",
    changeType: "control_uncertain",
    pattern: rx(`[Cc]ontrol\\s+of\\s+${LOC}\\s+(?:is|remains|was)\\s+(?:unclear|uncertain|unconfirmed|disputed)`),
    slots: ["location", "suffix"],
  },
];

// ---- false-positive protection --------------------------------------------

// A "captured X" whose X is one of these is metaphor/non-territory.
const NON_TERRITORIAL_OBJECT = new Set(
  [
    "imagination", "attention", "headlines", "headline", "hearts", "heart", "opportunity", "moment", "chance", "initiative",
    "narrative", "conversation", "game", "match", "ball", "vehicle", "car", "bus", "plane", "aircraft", "market", "company",
    "business", "board", "lead", "title", "trophy", "race", "election", "seat", "seats", "votes", "audience", "crown", "gold",
    "silver", "bronze", "cup", "league", "shares", "stock", "stocks", "momentum", "control",
  ].map((w) => w.toLowerCase()),
);

// Sentence must carry a military/territorial context word (or a known armed
// actor) — "Chelsea lost Arsenal" or "Apple took control of Netflix" never do.
const MILITARY_CONTEXT =
  /\b(forces?|troops?|army|militia|rebels?|fighters?|fighting|offensive|insurgents?|junta|garrison|soldiers?|military|battle|clashes|airstrikes?|frontline|front line|resistance|brigade|battalion|armed|combat|war|artillery|shelling|assault|regime|advance|counteroffensive|liberated|occupied)\b/i;

function looksMetaphorical(location: string): boolean {
  return location
    .toLowerCase()
    .split(/\s+/)
    .some((w) => NON_TERRITORIAL_OBJECT.has(w));
}

const HEDGE = /\b(reportedly|allegedly|claimed?|claims|claiming|unconfirmed|unverified|according to|purportedly|says it|said it)\b/i;

// ---- actor normalization ---------------------------------------------------

interface AliasRule {
  canonical: string;
  patterns: RegExp[];
  countryCode?: string;
}

// Country-scoped aliases (a bare "junta" is only the Tatmadaw in Myanmar).
const ACTOR_ALIAS_RULES: AliasRule[] = [
  { canonical: "Tatmadaw", countryCode: "MM", patterns: [/^(?:the\s+)?(?:myanmar\s+)?(?:military\s+)?junta$/i, /^(?:the\s+)?tatmadaw$/i, /^sac$/i, /^state administration council$/i, /^(?:myanmar|burmese)\s+(?:military|army|forces|troops)$/i, /^regime$/i, /^government\s+forces$/i] },
  { canonical: "Arakan Army", patterns: [/^(?:the\s+)?(?:arakan army|aa)$/i] },
  { canonical: "MNDAA", patterns: [/^(?:the\s+)?(?:mndaa|myanmar national democratic alliance army)$/i] },
  { canonical: "TNLA", patterns: [/^(?:the\s+)?(?:tnla|ta'?ang national liberation army)$/i] },
  { canonical: "KIA", patterns: [/^(?:the\s+)?(?:kia|kachin independence army)$/i] },
  { canonical: "KNLA", patterns: [/^(?:the\s+)?(?:knla|karen national liberation army)$/i] },
  { canonical: "KNDF", patterns: [/^(?:the\s+)?(?:kndf|karenni nationalities defence force)$/i] },
  { canonical: "PDF", patterns: [/^(?:the\s+)?(?:pdf|people'?s defen[cs]e forces?)$/i] },
];

const UNNAMED_ACTOR = /^(?:the\s+)?(?:military\s+)?(?:rebels?|rebel forces|insurgents|militants|separatists|resistance forces|opposition forces)$/i;
const UNNAMED_ACTOR_2 = /^(?:the\s+)?(?:rebel|resistance|opposition|local|armed|insurgent|government)\s+(?:fighters|forces|groups?|troops)$/i;

/** Canonical actor name (dedupes "the junta"/"Tatmadaw"/"SAC" etc.), or null
 * for descriptors that don't name an actor ("resistance forces"). */
export function canonicalActorName(raw: string | null | undefined, context: DetectionContext = {}): string | null {
  if (!raw) return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || UNNAMED_ACTOR.test(name) || UNNAMED_ACTOR_2.test(name)) return null;
  for (const rule of ACTOR_ALIAS_RULES) {
    if (rule.countryCode && rule.countryCode !== context.countryCode) continue;
    if (rule.patterns.some((p) => p.test(name))) return rule.canonical;
  }
  // The shared actor table ("Russian forces" -> "Russia") — only when it
  // resolves the phrase to exactly one actor.
  const shared = detectActors(name);
  if (shared.length === 1) return shared[0]!.name;
  // "KNLA fighters" / "Tatmadaw troops": a trailing collective noun doesn't
  // change who the actor is — retry the aliases on the bare name.
  const stripped = name.replace(/\s+(?:forces|troops|fighters|militia|units)$/i, "");
  if (stripped !== name && stripped) {
    const viaStripped = canonicalActorName(stripped, context);
    if (viaStripped) return viaStripped;
  }
  // Bare group nouns ("Junta" without Myanmar context) stay unnamed rather
  // than becoming a fake unit.
  if (/^(?:the\s+)?(?:military\s+)?junta$/i.test(name) || /^(?:the\s+)?(?:government|regime)(?:\s+forces)?$/i.test(name)) return null;
  return name.replace(/^the\s+/i, "");
}

export function normalizeLocationKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Identity of the underlying claim (conflict + place + change type + claimed
 * actor). Restatements of one claim — by any source — share a key. */
export function claimKeyFor(input: { conflictId: string; locationName: string | null; changeType: string; claimedActorName: string | null }): string {
  return [input.conflictId, normalizeLocationKey(input.locationName), input.changeType, normalizeLocationKey(input.claimedActorName)].join("|");
}

// ---- detection ------------------------------------------------------------

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectTerritorialChangeMentions(text: string, context: DetectionContext = {}): TerritorialChangeMention[] {
  const found: TerritorialChangeMention[] = [];

  for (const sentence of splitSentences(text)) {
    const hasContext = MILITARY_CONTEXT.test(sentence);
    for (const rule of RULES) {
      for (const match of sentence.matchAll(rule.pattern)) {
        const slot: Partial<Record<Slot, string | undefined>> = {};
        // Slots repeat (claimed/previous can appear twice for contested);
        // assign by position, first-write wins per slot name.
        rule.slots.forEach((name, i) => {
          if (slot[name] === undefined && match[i + 1] !== undefined) slot[name] = match[i + 1];
        });
        const location = slot.location?.trim();
        if (!location) continue;
        if (looksMetaphorical(location)) continue;

        const claimed = canonicalActorName(slot.claimed, context);
        const previous = canonicalActorName(slot.previous, context);
        // Context gate: military wording in the sentence, or a recognized armed actor.
        if (!hasContext && !claimed && !previous) continue;
        if (!hasContext && !ACTOR_ALIAS_RULES.some((r) => r.canonical === claimed || r.canonical === previous)) continue;
        // An actor phrase that is itself the location is a false parse.
        if (claimed && normalizeLocationKey(claimed) === normalizeLocationKey(location)) continue;

        found.push({
          changeType: rule.changeType,
          claimedActorName: claimed,
          previousActorName: previous,
          locationName: location,
          locationSuffix: slot.suffix?.toLowerCase() ?? null,
          description: match[0].trim(),
          sentence,
          ruleId: rule.id,
          hedged: HEDGE.test(sentence),
        });
      }
    }
  }

  return collapseMentions(found);
}

/** Restatements of one claim within a single report (headline + body)
 * collapse to the richest mention — the one naming the most actors. */
function collapseMentions(mentions: TerritorialChangeMention[]): TerritorialChangeMention[] {
  const best = new Map<string, TerritorialChangeMention>();
  const richness = (m: TerritorialChangeMention) => (m.claimedActorName ? 1 : 0) + (m.previousActorName ? 1 : 0);
  for (const m of mentions) {
    // Same place, and a recapture/capture/restored of it by the same claimed
    // actor is one claim regardless of verb (headline "retakes", body "seized").
    const gainLike = m.changeType === "captured" || m.changeType === "recaptured" || m.changeType === "control_restored";
    const key = `${normalizeLocationKey(m.locationName)}|${gainLike ? "gain" : m.changeType}|${normalizeLocationKey(m.claimedActorName)}`;
    const existing = best.get(key);
    if (!existing || richness(m) > richness(existing)) best.set(key, m);
  }
  return [...best.values()];
}

/** Candidate confidence for a mention — a property of the CLAIM, separate
 * from conflict severity, never scaled by report count. Single source is
 * capped well below certainty. */
export function baseConfidenceFor(m: TerritorialChangeMention, precisionKnown: boolean): number {
  let c = 0.5;
  if (m.hedged) c -= 0.15;
  if (m.claimedActorName && m.previousActorName) c += 0.1;
  if (!m.claimedActorName && m.changeType !== "contested" && m.changeType !== "control_uncertain") c -= 0.1;
  if (m.changeType === "contested" || m.changeType === "control_uncertain") c = Math.min(c, 0.45);
  if (!precisionKnown) c -= 0.05;
  return Math.max(0.1, Math.min(0.7, Math.round(c * 100) / 100));
}
