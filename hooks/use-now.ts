"use client";

import { useMemo } from "react";

/** The real clock, read once per data change (not every render), for ranking/recency maths.
 * Only used after client data has loaded, so it never disagrees with a server render. */
export function useNowMs(refreshKey: unknown): number {
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/purity -- deliberately re-read when the data changes.
  return useMemo(() => Date.now(), [refreshKey]);
}
