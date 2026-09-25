// The one wording for Vigil's three scores and source classes. Every page that names or explains a score imports it
// from here so Overview, /world, country, conflict, For You, the introduction and /methodology never drift apart.

export const SCORE_COPY = {
  severity: { label: "Severity", question: "How intense is the conflict itself?", note: "The same everywhere: it never depends on your country." },
  impact: { label: "Impact", question: "How directly does this affect the selected country?", note: "Changes with your impact country; it does not change global Severity." },
  confidence: { label: "Confidence", question: "How strongly is the current picture supported by evidence?", note: "Rises with independent corroboration, not with the number of articles." },
} as const;

export type ScoreKey = keyof typeof SCORE_COPY;

export const SOURCE_CLASS_COPY = [
  { key: "independent_strong", label: "Independent / Strong Verification", text: "An outlet or official observer independent of the parties, with a record of verifying what it reports. Counts as independent corroboration." },
  { key: "independent_perspective", label: "Independent / Perspective", text: "An independent outlet with a clear editorial or regional perspective. Counts as independent corroboration; its framing is shown as a perspective." },
  { key: "party_aligned", label: "Party / Aligned Claim", text: "Party / Aligned Claim does NOT mean false. It means the source represents a participant or an aligned perspective, so it does not count as independent corroboration by itself." },
] as const;

export const IMPACT_COUNTRY_COPY = {
  question: "What country should Vigil use when calculating Impact?",
  explain: "Impact measures how directly a development affects your selected country. It does not change global Severity.",
} as const;
