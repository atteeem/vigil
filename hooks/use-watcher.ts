"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/hooks/use-app-store";
import type { WatchEntityType, WatcherSettings, WatchMode, WatchRules, RuleDef, Priority } from "@/lib/alerts/types";

// Client side of watchlists/notifications. There are no server accounts yet: this device's profile is
// identified by a random client id kept in localStorage and sent as x-vigil-client (see lib/alerts/watcher.ts).

const KEY = "vigil-client-id";

export function getClientId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || id.length < 22) {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      id = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 40);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "session-only-" + Math.random().toString(36).slice(2).padEnd(24, "x");
  }
}

export async function meFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/me/${path}`, { ...init, headers: { "content-type": "application/json", "x-vigil-client": getClientId(), ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface WatchDTO {
  id: string;
  entityType: WatchEntityType;
  entityKey: string;
  label: string;
  mode: WatchMode;
  rules: WatchRules;
  effectiveRules: WatchRules;
  ruleSchema: RuleDef[];
  muted: boolean;
  pausedUntil: string | null;
  href: string | null;
}

export interface NotificationDTO {
  id: string;
  alertType: string;
  category: string;
  priority: Priority;
  priorityScore: number;
  title: string;
  summary: string;
  entityType: string;
  entityKey: string;
  entityLabel: string;
  deepLink: string;
  snapshot: Record<string, unknown> & { snapshotLink?: string | null };
  reason: { follows?: { typeLabel: string; label: string }; modeLabel?: string; rule?: string; priorityFactors?: { name: string; value: number; weight: number }[]; priorityNotes?: string[]; changeNote?: string | null; alsoMatched?: string[]; category?: string };
  isPartyClaim: boolean;
  isResolution: boolean;
  suppressedCount: number;
  createdAt: string;
  readAt: string | null;
}

export function useWatches() {
  return useQuery<WatchDTO[]>({ queryKey: ["me", "watches"], queryFn: () => meFetch<WatchDTO[]>("watches"), staleTime: 10_000 });
}

export function useNotificationFeed(enabled = true) {
  return useQuery<{ items: NotificationDTO[]; unreadCount: number }>({ queryKey: ["me", "notifications"], queryFn: () => meFetch("notifications?limit=50"), refetchInterval: 30_000, staleTime: 5_000, enabled });
}

export function useWatcherSettings() {
  return useQuery<WatcherSettings>({ queryKey: ["me", "settings"], queryFn: () => meFetch<WatcherSettings>("settings"), staleTime: 10_000 });
}

export function useWatcherMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["me", "watches"] }), qc.invalidateQueries({ queryKey: ["me", "notifications"] }), qc.invalidateQueries({ queryKey: ["me", "settings"] })]);
  return {
    follow: useMutation({ mutationFn: (v: { entityType: WatchEntityType; entityKey: string; label?: string; mode?: WatchMode; rules?: WatchRules }) => meFetch<WatchDTO>("watches", { method: "POST", body: JSON.stringify(v) }), onSuccess: refresh }),
    update: useMutation({ mutationFn: (v: { id: string; mode?: WatchMode; rules?: WatchRules; muted?: boolean; pauseHours?: number | null }) => meFetch<WatchDTO>(`watches/${v.id}`, { method: "PATCH", body: JSON.stringify(v) }), onSuccess: refresh }),
    unfollow: useMutation({ mutationFn: (id: string) => meFetch<{ ok: boolean }>(`watches/${id}`, { method: "DELETE" }), onSuccess: refresh }),
    notify: useMutation({ mutationFn: (v: { action: "read" | "unread" | "dismiss" | "archive"; ids?: string[]; all?: boolean }) => meFetch<{ unreadCount: number }>("notifications", { method: "POST", body: JSON.stringify(v) }), onSuccess: refresh }),
    settings: useMutation({ mutationFn: (v: Partial<WatcherSettings>) => meFetch<WatcherSettings>("settings", { method: "PUT", body: JSON.stringify(v) }), onSuccess: refresh }),
  };
}

/** Keeps the server-side profile in step with two app preferences the alerts depend on: the selected
 * country (impact/relevance) and the party-claims setting. Never infers anything. */
export function useWatcherSync() {
  const baseCountry = useAppStore((s) => s.baseCountryCode);
  const showPartyClaims = useAppStore((s) => s.showPartyClaims);
  useEffect(() => {
    // Debounced: on load the store first shows defaults and is then rehydrated; only the settled value is sent.
    const t = setTimeout(() => void meFetch("settings", { method: "PUT", body: JSON.stringify({ baseCountry, partyClaims: showPartyClaims }) }).catch(() => undefined), 400);
    return () => clearTimeout(t);
  }, [baseCountry, showPartyClaims]);
}

/** Follow state for one entity (used by every FollowButton). */
export function useFollowState(entityType: WatchEntityType, entityKey: string) {
  const { data: watches } = useWatches();
  return watches?.find((w) => w.entityType === entityType && w.entityKey === entityKey) ?? null;
}
