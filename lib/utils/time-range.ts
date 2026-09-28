import type { TimeRange } from "@/lib/types";

export const TIME_RANGE_MS: Record<TimeRange, number> = {
  "1H": 3_600_000,
  "6H": 21_600_000,
  "24H": 86_400_000,
  "7D": 604_800_000,
  "30D": 2_592_000_000,
};

export function isWithinRange(occurredAtIso: string, range: TimeRange, nowIso: string): boolean {
  const age = new Date(nowIso).getTime() - new Date(occurredAtIso).getTime();
  return age <= TIME_RANGE_MS[range];
}

/** Human-readable phrasing for a TimeRange, for any summary text quoting the selected window back to the
 * user (e.g. "N published events (last 24 hours)") — one canonical wording, not a copy per caller. */
export const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  "1H": "last hour",
  "6H": "last 6 hours",
  "24H": "last 24 hours",
  "7D": "last 7 days",
  "30D": "last 30 days",
};
