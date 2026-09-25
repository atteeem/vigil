"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)";

/** True below the `sm` breakpoint. The server (and the first client pass) render the desktop layout. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
