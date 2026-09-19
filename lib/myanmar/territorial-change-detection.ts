// Myanmar Specialist Source Integration originally owned this two-phrase
// detector. Territorial Change Intelligence moved phrase normalization to
// lib/territory/change-detection.ts (one central rule table, many change
// types); this module stays as the Myanmar-scoped entry point so existing
// imports keep working. Nothing here ever touches ConflictTerritory.
import { detectTerritorialChangeMentions as detectCentral, type TerritorialChangeMention } from "@/lib/territory/change-detection";

export type { TerritorialChangeMention };

export function detectTerritorialChangeMentions(text: string): TerritorialChangeMention[] {
  return detectCentral(text, { countryCode: "MM" });
}
