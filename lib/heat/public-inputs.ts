import type { Conflict } from "@/lib/types";

/** THE conflict universe for the heat surface and the globe pins, shared by the homepage
 * and /world so they can never disagree: real conflicts that have a location and have not
 * ended. (buildHeatInput further limits the sustained base to active/reduced ones.) */
export function selectHeatConflicts(conflicts: readonly Conflict[] | undefined): Conflict[] {
  return (conflicts ?? []).filter((c) => c.locationKnown !== false && c.status !== "ended" && c.status !== "resolved");
}
