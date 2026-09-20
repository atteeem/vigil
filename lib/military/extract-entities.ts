// MilitaryLand Phase 1 — deterministic keyword/regex extraction of
// military-unit, commander, and equipment mentions from report text, in
// the same spirit as lib/ingestion/actors.ts and lib/ingestion/draft.ts
// (NOT an LLM — see draft.ts's own comment for why this codebase keeps
// extraction deterministic and explainable). Phase 1 scope only: this
// finds mentions of entities that already follow a recognizable naming
// convention (ordinal-numbered units, ranked commanders, named equipment
// models) — it does not attempt general-purpose NLP entity recognition,
// and a top-level command with no ordinal number (e.g. "Ground Forces of
// Ukraine") is not auto-detected; those are curated by hand via the admin
// reference UI instead.

export interface UnitMention {
  name: string;
  unitType: string | null;
  /** The exact text that matched. */
  matched: string;
}

export interface CommanderMention {
  name: string;
  rank: string | null;
  matched: string;
}

export interface EquipmentMention {
  name: string;
  category: string | null;
  matched: string;
}

const UNIT_TYPE_KEYWORDS = [
  "Brigade",
  "Corps",
  "Battalion",
  "Regiment",
  "Division",
  "Group",
  "Army",
  "Task Force",
];

// "25th Airborne Brigade", "8th Air Assault Corps", "446th Unmanned
// Systems Brigade" — an ordinal number, 0-3 capitalized descriptive
// words, then a recognized unit-type keyword. Anchoring on the ordinal is
// what keeps this from over-matching arbitrary capitalized phrases.
const UNIT_PATTERN = new RegExp(
  `\\b(\\d+)(?:st|nd|rd|th)\\s+((?:[A-Z][a-zA-Z]*\\s+){0,3}(?:${UNIT_TYPE_KEYWORDS.join("|")}))\\b`,
  "g",
);

export function extractUnitMentions(text: string): UnitMention[] {
  const seen = new Map<string, UnitMention>();
  for (const match of text.matchAll(UNIT_PATTERN)) {
    const ordinal = match[1];
    const rest = match[2]?.trim();
    if (!ordinal || !rest) continue;
    const name = `${ordinal}${ordinalSuffix(ordinal)} ${rest}`;
    if (seen.has(name)) continue;
    const typeWord = UNIT_TYPE_KEYWORDS.find((k) => rest.endsWith(k)) ?? null;
    seen.set(name, { name, unitType: typeWord, matched: match[0] });
  }
  return [...seen.values()];
}

function ordinalSuffix(n: string): string {
  const num = Number(n);
  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (num % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

const RANKS = [
  "Brigadier General",
  "Major General",
  "Lieutenant General",
  "General",
  "Colonel",
  "Lieutenant Colonel",
  "Major",
  "Captain",
  "Admiral",
];

// Rank keyword followed by a 2-3 word capitalized name — "Brigadier
// General Svyatoslav Zaits", "Colonel Andriy Turchyn". Longest rank
// alternatives first (RANKS is already ordered longest-first) so "Major
// General" matches before the shorter "Major" would.
const COMMANDER_PATTERN = new RegExp(
  `\\b(${RANKS.join("|")})\\s+([A-Z][\\p{L}'-]+(?:\\s+[A-Z][\\p{L}'-]+){1,2})`,
  "gu",
);

export function extractCommanderMentions(text: string): CommanderMention[] {
  const seen = new Map<string, CommanderMention>();
  for (const match of text.matchAll(COMMANDER_PATTERN)) {
    const rank = match[1] ?? null;
    const name = match[2]?.trim();
    if (!name) continue;
    if (!seen.has(name)) seen.set(name, { name, rank, matched: match[0] });
  }
  return [...seen.values()];
}

// Curated real-world equipment names (in the spirit of actors.ts's
// ACTOR_ALIASES table) — deliberately a known list, not free-text
// extraction, since arbitrary equipment-model names don't follow a
// consistent surface pattern the way ordinal-numbered units or ranked
// names do. Sourced from MilitaryLand's own equipment database
// (militaryland.net/equipment/) plus other widely-documented systems.
const EQUIPMENT_CATALOG: [name: string, category: string][] = [
  ["2P22 Bohdana", "Towed Artillery"],
  ["2S22 Bohdana", "Self-Propelled Artillery"],
  ["2S1 Gvozdika", "Self-Propelled Artillery"],
  ["2S19 Msta-S", "Self-Propelled Artillery"],
  ["2A65 Msta-B", "Towed Artillery"],
  ["2A36 Giatsint-B", "Towed Artillery"],
  ["2K22 Tunguska", "Anti-Aircraft"],
  ["2K12 Kub", "Anti-Aircraft"],
  ["HIMARS", "Rocket Artillery"],
  ["Leopard 2", "Main Battle Tank"],
  ["Leopard 1", "Main Battle Tank"],
  ["T-64", "Main Battle Tank"],
  ["T-72", "Main Battle Tank"],
  ["T-80", "Main Battle Tank"],
  ["BMP-1", "Infantry Fighting Vehicle"],
  ["BMP-2", "Infantry Fighting Vehicle"],
  ["Bradley", "Infantry Fighting Vehicle"],
  ["Bayraktar TB2", "Unmanned Aerial Vehicle"],
  ["Javelin", "Anti-Tank Missile"],
  ["NLAW", "Anti-Tank Missile"],
  ["Stinger", "Man-Portable Air Defense"],
  ["Patriot", "Air Defense System"],
  ["M777", "Towed Artillery"],
];

export function extractEquipmentMentions(text: string): EquipmentMention[] {
  const found: EquipmentMention[] = [];
  for (const [name, category] of EQUIPMENT_CATALOG) {
    if (text.includes(name)) found.push({ name, category, matched: name });
  }
  return found;
}
