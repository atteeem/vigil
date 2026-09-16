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
