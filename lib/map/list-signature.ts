import type { ConflictEvent } from "@/lib/types";

/** Cheap identity of an event list: it changes exactly when something a viewer can see changes (an event
 * added/removed, edited, re-sourced or re-classified). Used by the live-events poll so an unchanged payload
 * does not replace React state, recompute the heat clock or call setData on every map source. */
export function eventListSignature(list: readonly ConflictEvent[]): string {
  return list.map((e) => `${e.id}:${e.updatedAt}:${e.sourceCount}:${e.severity}:${e.verificationStatus}:${e.disputed ? 1 : 0}`).join("|");
}
