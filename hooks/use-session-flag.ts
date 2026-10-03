"use client";

import { useCallback, useEffect, useState } from "react";

/** A boolean UI preference remembered for the browser session (sessionStorage). The server and the first client pass
 * render `initial`; a stored value is applied after mount, so hydration never mismatches. Storage that is blocked
 * (private mode, quota) just means the preference is not remembered. */
export function useSessionFlag(key: string, initial: boolean): [boolean, (next: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring persisted UI state after mount (SSR renders the default)
      if (stored === "1" || stored === "0") setValue(stored === "1");
    } catch {
      /* storage unavailable: keep the default */
    }
  }, [key]);
  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? next(prev) : next;
        try {
          window.sessionStorage.setItem(key, resolved ? "1" : "0");
        } catch {
          /* ignore */
        }
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}
