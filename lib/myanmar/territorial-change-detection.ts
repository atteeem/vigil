// Myanmar Specialist Source Integration — spec §7 "If Myanmar Now/IISS
// reporting suggests territorial control changed: flag it as a potential
// territorial-change candidate... do NOT automatically modify published
// control polygons." Deterministic keyword/regex detection, same
// philosophy as lib/military/extract-entities.ts and
// lib/ingestion/actors.ts — this ONLY ever proposes a
// TerritorialChangeCandidate row (a review-queue entry); nothing it
// produces is ever written to ConflictTerritory.

export interface TerritorialChangeMention {
  /** The actor reported to have gained the location — null if the
   * sentence doesn't name one (e.g. "X was captured" with no clear actor). */
  claimedActorName: string | null;
  /** The actor reported to have lost/ceded the location, where named. */
  previousActorName: string | null;
  locationName: string;
  /** The exact sentence/phrase matched — stored as the candidate's own
   * description, so an admin reviewing it sees the real reported claim
   * verbatim, not a paraphrase. */
  description: string;
}

const PROPER_NOUN = "[A-Z][a-zA-Z'\\-]*(?:\\s+[A-Z][a-zA-Z'\\-]*){0,3}";

// "Tatmadaw recaptured Moebye from KNDF" / "KNLA seized control of
// Kawkareik from the junta" / "AA regained control of Paletwa from the
// Tatmadaw" — actor VERB [control of] LOCATION from actor.
const GAINED_FROM_PATTERN = new RegExp(
  `(?:[Tt]he\\s+)?(${PROPER_NOUN})\\s+(?:recaptured|captured|seized(?:\\s+control\\s+of)?|took\\s+control\\s+of|regained(?:\\s+control\\s+of)?)\\s+(${PROPER_NOUN})\\s+from\\s+(?:the\\s+)?(${PROPER_NOUN})`,
  "g",
);

// "MNDAA handed Lashio control to Tatmadaw" / "MNDAA handed Lashio to the Tatmadaw"
const HANDED_TO_PATTERN = new RegExp(
  `(?:[Tt]he\\s+)?(${PROPER_NOUN})\\s+handed\\s+(${PROPER_NOUN})(?:\\s+control)?\\s+to\\s+(?:the\\s+)?(${PROPER_NOUN})`,
  "g",
);

export function detectTerritorialChangeMentions(text: string): TerritorialChangeMention[] {
  const mentions: TerritorialChangeMention[] = [];

  for (const match of text.matchAll(GAINED_FROM_PATTERN)) {
    const [full, claimedActor, location, previousActor] = match;
    if (!claimedActor || !location || !previousActor) continue;
    mentions.push({
      claimedActorName: claimedActor.trim(),
      previousActorName: previousActor.trim(),
      locationName: location.trim(),
      description: full.trim(),
    });
  }

  for (const match of text.matchAll(HANDED_TO_PATTERN)) {
    const [full, previousActor, location, claimedActor] = match;
    if (!claimedActor || !location || !previousActor) continue;
    mentions.push({
      claimedActorName: claimedActor.trim(),
      previousActorName: previousActor.trim(),
      locationName: location.trim(),
      description: full.trim(),
    });
  }

  return mentions;
}
