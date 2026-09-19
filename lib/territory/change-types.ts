// Territorial Change Intelligence — shared vocabularies. Plain strings in
// the DB (SQLite), validated here, same convention as the rest of the schema.

export const TERRITORIAL_CHANGE_TYPES = [
  "captured",
  "recaptured",
  "lost_control",
  "transferred",
  "contested",
  "control_uncertain",
  "withdrawn",
  "control_restored",
] as const;
export type TerritorialChangeType = (typeof TERRITORIAL_CHANGE_TYPES)[number];

export const CHANGE_TYPE_LABEL: Record<TerritorialChangeType, string> = {
  captured: "Captured",
  recaptured: "Recaptured",
  lost_control: "Lost control",
  transferred: "Handed / transferred",
  contested: "Contested",
  control_uncertain: "Control uncertain",
  withdrawn: "Withdrawal / vacated",
  control_restored: "Control restored",
};

export function isChangeType(value: string): value is TerritorialChangeType {
  return (TERRITORIAL_CHANGE_TYPES as readonly string[]).includes(value);
}

/** Comparison of a candidate against the CURRENT published territorial state. */
export const COMPARISON_OUTCOMES = ["genuine_change", "already_known", "conflicting_claim", "insufficient_evidence"] as const;
export type ComparisonOutcome = (typeof COMPARISON_OUTCOMES)[number];

export const COMPARISON_LABEL: Record<ComparisonOutcome, string> = {
  genuine_change: "Genuine change",
  already_known: "Already-known state",
  conflicting_claim: "Conflicting claim",
  insufficient_evidence: "Insufficient evidence",
};

/** Territorial status a change type proposes (strategic control only). */
export function proposedStatusFor(changeType: TerritorialChangeType, hasClaimedActor: boolean): "controlled" | "contested" | "uncertain" {
  switch (changeType) {
    case "captured":
    case "recaptured":
    case "transferred":
    case "control_restored":
      return hasClaimedActor ? "controlled" : "uncertain";
    case "contested":
      return "contested";
    case "lost_control":
    case "withdrawn":
      return hasClaimedActor ? "controlled" : "uncertain";
    case "control_uncertain":
      return "uncertain";
  }
}
