// Deterministic keyword-based infrastructure/damage detection (spec
// "infrastructure/damage if explicitly reported") — same style as
// lib/ingestion/event-type-keywords.ts. Each phrase describes a distinct
// kind of reported damage; a report can reasonably name more than one
// (a strike damaging both a power plant and a hospital), so every match
// is returned, not just the first.
const DAMAGE_PHRASES = [
  "power grid damaged",
  "power plant damaged",
  "power plant struck",
  "pipeline damaged",
  "pipeline hit",
  "bridge collapsed",
  "bridge destroyed",
  "building destroyed",
  "building collapsed",
  "hospital damaged",
  "hospital struck",
  "school damaged",
  "school destroyed",
  "water supply disrupted",
  "water supply damaged",
  "road damaged",
  "railway damaged",
  "airport damaged",
  "port damaged",
  "residential building hit",
  "apartment block hit",
  "infrastructure damaged",
  "infrastructure destroyed",
];

export interface DamageMatch {
  phrase: string;
}

/** Every matched damage phrase, not just the first — a report naming
 * several kinds of damage is the normal case, not an ambiguity to
 * collapse (same reasoning as lib/ingestion/actors.ts's multi-match
 * behavior). */
export function detectInfrastructureDamage(text: string): DamageMatch[] {
  const lower = text.toLowerCase();
  return DAMAGE_PHRASES.filter((phrase) => lower.includes(phrase)).map((phrase) => ({ phrase }));
}
