// Recently opened entities, kept only in this browser (localStorage). Nothing is sent anywhere; a blocked or cleared
// storage simply means an empty list.

export interface RecentEntity {
  type: string;
  key: string;
  title: string;
  kind: string;
  href: string;
  at: number;
}

const KEY = "vigil.recent-entities";
export const RECENT_MAX = 8;
export const RECENT_EVENT = "vigil:recent-changed";

export function readRecent(): RecentEntity[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? (raw as RecentEntity[]).filter((r) => r && typeof r.href === "string" && typeof r.title === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Most recent first, one entry per href. */
export function recordRecent(entry: Omit<RecentEntity, "at">): void {
  try {
    const next = [{ ...entry, at: Date.now() }, ...readRecent().filter((r) => r.href !== entry.href)].slice(0, RECENT_MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(KEY);
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    /* ignore */
  }
}
