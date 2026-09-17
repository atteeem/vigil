// Deterministic regex-based casualty-figure extraction — not NLP, and
// deliberately conservative: only an explicit number next to explicit
// casualty language counts (spec "casualties/injuries if explicitly
// reported"). A report with no such language yields zero matches, which
// the caller must treat as "unknown", never as zero casualties.

export interface CasualtyMatch {
  count: number;
  matchedText: string;
}

const KILLED_PATTERNS = [
  /(\d+)\s*(?:people\s*)?(?:were\s+|was\s+)?(?:reportedly\s+)?killed/gi,
  /(\d+)\s*(?:people\s*)?(?:have\s+|has\s+)?died/gi,
  /(\d+)\s*dead/gi,
  /(\d+)\s*fatalities/gi,
  /killed\s+(?:at least\s+)?(\d+)/gi,
];

const INJURED_PATTERNS = [
  /(\d+)\s*(?:people\s*)?(?:were\s+|was\s+)?(?:reportedly\s+)?injured/gi,
  /(\d+)\s*wounded/gi,
  /(\d+)\s*hurt/gi,
  /injured\s+(?:at least\s+)?(\d+)/gi,
];

// Plain substring matching can't distinguish "3 killed" from "no
// casualties reported" — bail out entirely on an explicit negation
// rather than risk a false extraction (same rule as
// lib/ingestion/event-type-keywords.ts's NEGATED_SEVERITY_PHRASES).
const NEGATED_PHRASES = ["no casualties", "no deaths", "no fatalities", "no one killed", "nobody killed", "no injuries"];

function extract(text: string, patterns: RegExp[]): CasualtyMatch[] {
  const lower = text.toLowerCase();
  if (NEGATED_PHRASES.some((p) => lower.includes(p))) return [];

  const byCount = new Map<number, CasualtyMatch>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const count = Number(match[1]);
      if (!Number.isFinite(count) || count < 0) continue;
      // Multiple patterns can match the same underlying claim phrased
      // slightly differently — dedupe by count so "5 killed" and "killed
      // 5" (if both somehow present) don't become two facts, while two
      // GENUINELY different figures (5 vs. 8) still both survive as
      // separate facts (spec "conflicting casualty figures").
      if (!byCount.has(count)) byCount.set(count, { count, matchedText: match[0].trim() });
    }
  }
  return [...byCount.values()];
}

export function extractKilled(text: string): CasualtyMatch[] {
  return extract(text, KILLED_PATTERNS);
}

export function extractInjured(text: string): CasualtyMatch[] {
  return extract(text, INJURED_PATTERNS);
}
