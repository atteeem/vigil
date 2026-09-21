"use client";

import { useEffect, useRef, useState } from "react";
import type { ConflictEvent } from "@/lib/types";
import { eventListSignature } from "@/lib/map/list-signature";

const POLL_INTERVAL_MS = 20_000;

/** Polls /api/events (published DB events) so newly published admin
 * reports appear on /world without a full page reload — see spec §15
 * ("Frontend should refresh new published events automatically... Use
 * polling/SSE as appropriate"). Polling was chosen over SSE for this local-
 * development build: one plain GET endpoint, no extra transport/reconnect
 * logic, easily swapped for SSE later if the poll interval becomes a real
 * latency concern. */
export function useLiveEvents(): ConflictEvent[] {
  const [events, setEvents] = useState<ConflictEvent[]>([]);
  const signature = useRef("");

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      // A hidden tab needs no fresh data; it refreshes as soon as it becomes visible again.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/events");
        if (!res.ok) return;
        const data = (await res.json()) as ConflictEvent[];
        // An unchanged payload keeps the previous array: no re-render, no heat/label recomputation, no setData.
        const sig = eventListSignature(data);
        if (!cancelled && sig !== signature.current) {
          signature.current = sig;
          setEvents(data);
        }
      } catch {
        // Network hiccup — keep showing the last known set, try again next tick.
      }
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return events;
}
