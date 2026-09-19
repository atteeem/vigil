import type { EventType } from "@/lib/types";

// Myanmar Specialist Source Integration — spec §5 "Map IISS/Myanmar-
// specific event types into Vigil's centralized taxonomy... Do not create
// duplicate global categories unnecessarily." IISS's Myanmar Conflict Map
// reclassifies ACLED's 25 sub-event types into five categories (per its
// own published methodology: myanmar.iiss.org/methodology) — every one of
// those five maps cleanly onto an EXISTING lib/types/severity.ts
// EVENT_TYPES value, so no new global category is added here.
const IISS_CATEGORY_TO_EVENT_TYPE: Record<string, EventType> = {
  "attack/armed clash": "ground_clash",
  "armed clash": "ground_clash",
  "remote explosive/ieds": "explosion",
  "remote explosive": "explosion",
  "ied": "explosion",
  "air/drone strike": "airstrike",
  "airstrike": "airstrike",
  "drone strike": "drone",
  "crackdowns": "civil_unrest",
  "crackdown": "civil_unrest",
  "infrastructure destruction": "infrastructure",
};

/** Maps an IISS/ACLED-style category label to Vigil's centralized
 * EventType, or null if unrecognized (caller falls back to its own
 * keyword-based detection, same as any other source). Case-insensitive. */
export function mapIissCategoryToEventType(category: string): EventType | null {
  return IISS_CATEGORY_TO_EVENT_TYPE[category.trim().toLowerCase()] ?? null;
}

/** Spec "Preserve source-specific subtype metadata where useful rather
 * than discarding it" — the ORIGINAL label is never thrown away even once
 * mapped; callers store this alongside rawMetadata.sourceSubtype so an
 * admin can still see "IISS called this a 'Crackdown', mapped to
 * civil_unrest" rather than losing that provenance. */
export interface TaxonomyMapping {
  eventType: EventType;
  sourceSubtype: string;
}

export function mapIissSubtype(sourceSubtype: string): TaxonomyMapping | null {
  const eventType = mapIissCategoryToEventType(sourceSubtype);
  if (!eventType) return null;
  return { eventType, sourceSubtype };
}
