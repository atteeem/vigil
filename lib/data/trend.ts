import { seededRandom } from "@/lib/utils/seed";
import { clamp } from "@/lib/utils/format";

/** Deterministic illustrative trend series ending at `endValue`, for mock sparklines. */
export function generateTrendSeries(seedKey: string, endValue: number, points = 14): number[] {
  const rand = seededRandom(seedKey);
  const series = [endValue];
  let current = endValue;
  for (let i = 1; i < points; i++) {
    current = clamp(current + (rand() - 0.52) * 6, 0, 100);
    series.unshift(current);
  }
  series[series.length - 1] = endValue;
  return series;
}
