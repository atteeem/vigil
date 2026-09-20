// Descriptive entity classification for the military/actor knowledge layer. These describe
// what an organisation IS in structural terms. They are not legal designations (never
// "terrorist organisation", "legitimate government", ...), are never inferred from an
// actor's behaviour, and are kept separate from what any source CLAIMS about the actor.

export const ENTITY_TYPES = [
  "state_military",
  "armed_group",
  "militia",
  "political_military_group",
  "security_force",
  "military_unit",
  "coalition",
  "peacekeeping_force",
  "other",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  state_military: "State military",
  armed_group: "Armed group",
  militia: "Militia",
  political_military_group: "Political-military organisation",
  security_force: "Security force",
  military_unit: "Military unit / formation",
  coalition: "Coalition",
  peacekeeping_force: "Peacekeeping force",
  other: "Other",
};

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === "string" && (ENTITY_TYPES as readonly string[]).includes(value);
}

export const ALIAS_TYPES = ["canonical", "native_name", "abbreviation", "transliteration", "historical", "source_specific", "alternate"] as const;
export type AliasType = (typeof ALIAS_TYPES)[number];

export const ALIAS_TYPE_LABEL: Record<AliasType, string> = {
  canonical: "Canonical name",
  native_name: "Native / local name",
  abbreviation: "Abbreviation",
  transliteration: "Alternative transliteration",
  historical: "Historical name",
  source_specific: "Source-specific name",
  alternate: "Alternate name",
};

export const RELATION_TYPES = ["allied", "cooperating", "opposing", "coalition_member"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];
export const RELATION_LABEL: Record<RelationType, string> = { allied: "Allied with", cooperating: "Cooperates with", opposing: "Opposes", coalition_member: "Coalition member" };

/** Registry actor kinds map onto the descriptive types without adding claims. */
export function entityTypeFromRegistryKind(kind: string | undefined): EntityType {
  if (kind === "state") return "state_military";
  if (kind === "armed_group") return "armed_group";
  return "other";
}

// A designation like "25th Airborne Brigade" is structurally a unit/formation.
const UNIT_DESIGNATION = /^\d+(?:st|nd|rd|th)\s+.+\b(Brigade|Corps|Battalion|Regiment|Division|Group|Army|Task Force)$/;

/** Structural type from the name alone, only where the name form is unambiguous. Returns null
 * otherwise (an unknown type stays unknown). */
export function entityTypeFromDesignation(name: string): EntityType | null {
  return UNIT_DESIGNATION.test(name.trim()) ? "military_unit" : null;
}
