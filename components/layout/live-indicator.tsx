"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils/format";

interface Freshness {
  state: "live" | "delayed" | "stale" | "no-data";
  label: string;
  lastIngestionAt: string | null;
}

const TONE: Record<Freshness["state"] | "unknown", string> = {
  live: "border-stable/30 bg-stable-dim text-stable",
  delayed: "border-accent/30 bg-accent-dim text-accent",
  stale: "border-extreme/30 bg-extreme/10 text-extreme",
  "no-data": "border-border text-ink-faint",
  unknown: "border-border text-ink-faint",
};

/** The global data-freshness badge. LIVE only while the newest successful ingestion is recent (same rule as the World
 * Command Center); otherwise DELAYED, STALE or NO DATA — never a hard-coded "LIVE". */
export function LiveIndicator({ className }: { className?: string }) {
  const { data, isError } = useQuery<Freshness>({
    queryKey: ["status-freshness"],
    queryFn: async () => {
      const res = await fetch("/api/status/freshness");
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
  const state = data?.state ?? "unknown";
  const label = data?.label ?? (isError ? "STATUS ?" : "…");
  const title = data?.lastIngestionAt ? `Newest successful source update ${timeAgo(data.lastIngestionAt)}` : isError ? "Data freshness could not be checked" : data ? "No successful source update recorded" : "Checking data freshness";
  return (
    <span
      className={cn("inline-flex min-w-[52px] items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider", TONE[state], className)}
      data-testid="global-live-indicator"
      data-live-state={state}
      title={title}
      aria-label={`Data status: ${data?.label ?? "checking"}. ${title}`}
      role="status"
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className={cn("absolute inline-flex h-full w-full rounded-full bg-current", state === "live" && "animate-pulse-soft")} />
      </span>
      {label}
    </span>
  );
}
