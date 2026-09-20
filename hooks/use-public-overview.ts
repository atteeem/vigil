"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { PublicOverview } from "@/lib/public/overview";

// Shared client cache for the bounded public payload (real DB conflicts, recent
// events, latest territorial changes, freshness). One in-flight request and one
// poll timer regardless of how many components subscribe.

export type OverviewState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: PublicOverview; error: null }
  | { status: "error"; data: PublicOverview | null; error: string };

const POLL_MS = 60_000;
let state: OverviewState = { status: "loading", data: null, error: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight: Promise<void> | null = null;

function set(next: OverviewState) {
  state = next;
  for (const l of listeners) l();
}

export function refreshPublicOverview(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/public/overview");
      if (!res.ok) throw new Error(`Overview request failed (${res.status})`);
      set({ status: "ready", data: (await res.json()) as PublicOverview, error: null });
    } catch (err) {
      // Keep the last good payload visible; say that it may be out of date.
      set({ status: "error", data: state.data, error: err instanceof Error ? err.message : "Request failed" });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshPublicOverview();
    timer = setInterval(() => void refreshPublicOverview(), POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const LOADING: OverviewState = { status: "loading", data: null, error: null };

export function usePublicOverview(): OverviewState {
  return useSyncExternalStore(subscribe, () => state, () => LOADING);
}

/** Convenience: re-fetch now (e.g. after the tab regains focus). */
export function useRefreshOnFocus() {
  useEffect(() => {
    const onFocus = () => void refreshPublicOverview();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
}
