// Conflict geography — three deliberately separate sets of ISO country codes:
//
//   fighting      countries where fighting actually occurs. The ONLY set the
//                 scoring hard rules use (own-country war = 100, bordering
//                 war >= 75).
//   participants  belligerent / party states. A participant is not
//                 automatically a fighting venue (Russia is a participant in
//                 Ukraine; a state that only arms one side is not even that).
//   supporters    external supporters / interveners. Never trigger a floor.
//
// Keeping them apart is what stops "every participant country" being treated
// as "a country where the war is happening".

export type GeographyRole = "fighting" | "participant" | "supporter" | "none";

export interface ConflictGeography {
  fighting: string[];
  participants: string[];
  supporters: string[];
  /** "curated" (registry audit) | "admin" | "legacy_countries" (backfilled, not yet reviewed). */
  basis: string;
}

export function parseCodes(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string").map((c) => c.toUpperCase()) : [];
  } catch {
    return [];
  }
}

export interface GeographyRow {
  fightingCountries: string | null;
  participantCountries: string | null;
  supporterCountries: string | null;
  geographyBasis: string;
}

/** Reads a Conflict row's geography. Deliberately does NOT fall back to the
 * legacy `countries` list: a conflict with no recorded fighting countries has
 * no fighting geography, and the coverage dashboard flags that. */
export function conflictGeographyOf(row: GeographyRow): ConflictGeography {
  return {
    fighting: parseCodes(row.fightingCountries),
    participants: parseCodes(row.participantCountries),
    supporters: parseCodes(row.supporterCountries),
    basis: row.geographyBasis,
  };
}

/** How a country relates to a conflict. Fighting wins over participant wins over supporter. */
export function geographyRole(geo: Pick<ConflictGeography, "fighting" | "participants" | "supporters">, countryCode: string): GeographyRole {
  const code = countryCode.toUpperCase();
  if (geo.fighting.includes(code)) return "fighting";
  if (geo.participants.includes(code)) return "participant";
  if (geo.supporters.includes(code)) return "supporter";
  return "none";
}

export interface GeographyIssues {
  /** Active/reduced conflict with no fighting countries recorded. */
  missingFighting: boolean;
  /** Active/reduced conflict with no participant countries recorded. */
  missingParticipants: boolean;
  /** Geography is only a backfill of the legacy list — not reviewed. */
  unreviewed: boolean;
}

/** Whether geography metadata is incomplete. Dormant/ended records (a tension
 * with no fighting) legitimately have no fighting countries. */
export function geographyIssues(geo: ConflictGeography, status: string): GeographyIssues {
  const live = status === "active" || status === "reduced";
  return {
    missingFighting: live && geo.fighting.length === 0,
    missingParticipants: live && geo.participants.length === 0,
    unreviewed: geo.basis === "legacy_countries",
  };
}
