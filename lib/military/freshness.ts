// How current is a piece of sourced knowledge? Entity data goes stale: a commander
// appointment, a parent formation or an equipment link is true "as of" the source, not
// forever. These helpers turn a timestamp into an honest label; missing = unknown, and old
// data is flagged rather than implied current.

export const STALE_RELATIONSHIP_DAYS = 180;
const DAY = 86_400_000;

export interface Freshness {
  /** "unknown" when no date is recorded. */
  state: "fresh" | "stale" | "unknown";
  /** ISO date part ("2026-08-10"), or null. */
  date: string | null;
  ageDays: number | null;
}

export function relationshipFreshness(iso: string | null | undefined, now: number = Date.now(), staleAfterDays = STALE_RELATIONSHIP_DAYS): Freshness {
  if (!iso) return { state: "unknown", date: null, ageDays: null };
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return { state: "unknown", date: null, ageDays: null };
  const ageDays = Math.max(0, Math.floor((now - t) / DAY));
  return { state: ageDays > staleAfterDays ? "stale" : "fresh", date: new Date(t).toISOString().slice(0, 10), ageDays };
}

/** "last confirmed 4 months ago" / "last sourced 2026-08-10" style phrase. */
export function describeFreshness(verb: string, iso: string | null | undefined, now: number = Date.now()): string {
  const f = relationshipFreshness(iso, now);
  if (f.state === "unknown") return `${verb}: date unknown`;
  const age = f.ageDays!;
  const rel = age < 1 ? "today" : age < 31 ? `${age} day${age === 1 ? "" : "s"} ago` : age < 365 ? `${Math.round(age / 30)} months ago` : `${Math.round(age / 365)} year${Math.round(age / 365) === 1 ? "" : "s"} ago`;
  return `${verb} ${rel} (${f.date})${f.state === "stale" ? " · may be out of date" : ""}`;
}

/** The newest of several possibly-missing timestamps. */
export function latestOf(...values: (Date | string | null | undefined)[]): string | null {
  let best: number | null = null;
  for (const v of values) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}
