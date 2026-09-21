"use client";

import { useQuery } from "@tanstack/react-query";
import { getClientId } from "@/hooks/use-watcher";
import { useAppStore } from "@/hooks/use-app-store";
import type { Brief } from "@/lib/brief/types";
import type { StoredBrief } from "@/lib/brief/brief";

export interface BriefParams {
  window: string;
  from?: string;
  to?: string;
  asOf?: string | null;
  country?: string | null;
  conflict?: string | null;
  watchlist?: boolean;
}

function toQuery(p: BriefParams, claims: boolean): string {
  const q = new URLSearchParams({ window: p.window });
  if (p.window === "custom" && p.from && p.to) {
    q.set("from", p.from);
    q.set("to", p.to);
  }
  if (p.asOf) q.set("asOf", p.asOf);
  if (p.country) q.set("country", p.country);
  if (p.conflict) q.set("conflict", p.conflict);
  if (p.watchlist) q.set("watchlist", "true");
  if (claims) q.set("claims", "1");
  return q.toString();
}

async function fetchBrief(p: BriefParams, claims: boolean): Promise<Brief> {
  const res = await fetch(`/api/brief?${toQuery(p, claims)}`, { headers: p.watchlist ? { "x-vigil-client": getClientId() } : undefined });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  return (await res.json()) as Brief;
}

/** The brief for a scope and window. Party claims are requested only when the user's Profile setting is on. */
export function useBrief(p: BriefParams, enabled = true) {
  const claims = useAppStore((s) => s.showPartyClaims);
  return useQuery<Brief>({ queryKey: ["brief", toQuery(p, claims), p.watchlist ? "me" : ""], queryFn: () => fetchBrief(p, claims), enabled, staleTime: 30_000, refetchInterval: 120_000 });
}

export async function saveBrief(p: BriefParams, claims: boolean): Promise<StoredBrief> {
  const res = await fetch(`/api/brief/snapshots?${toQuery(p, claims)}`, { method: "POST", headers: p.watchlist ? { "x-vigil-client": getClientId() } : undefined });
  if (!res.ok) throw new Error("Could not save the brief");
  return (await res.json()) as StoredBrief;
}

export function useBriefSnapshot(id: string | null) {
  return useQuery<StoredBrief>({ queryKey: ["brief-snapshot", id], queryFn: async () => { const r = await fetch(`/api/brief/snapshots/${id}`, { headers: { "x-vigil-client": getClientId() } }); if (!r.ok) throw new Error("Snapshot not found"); return (await r.json()) as StoredBrief; }, enabled: !!id });
}
