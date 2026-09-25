"use client";

import { useState } from "react";
import { BellRing, Check } from "lucide-react";
import { useFollowState, useWatcherMutations } from "@/hooks/use-watcher";
import type { WatchEntityType } from "@/lib/alerts/types";
import { cn } from "@/lib/utils";

/** The ONE Watch control used on country, conflict, actor / unit, airport / port / chokepoint / volcano pages and in
 * context panels: the same watch system everywhere ((entityType, entityKey) + label) and the same visual language —
 * "Watch" / "Watching ✓". */
export function FollowButton({ entityType, entityKey, label, className }: { entityType: WatchEntityType; entityKey: string; label: string; className?: string }) {
  const watch = useFollowState(entityType, entityKey);
  const { follow, unfollow } = useWatcherMutations();
  const [error, setError] = useState<string | null>(null);
  const following = !!watch;
  const busy = follow.isPending || unfollow.isPending;

  async function toggle() {
    setError(null);
    try {
      if (watch) await unfollow.mutateAsync(watch.id);
      else await follow.mutateAsync({ entityType, entityKey, label });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update");
    }
  }

  return (
    <span className={cn("inline-flex flex-col items-start", className)}>
      <button
        onClick={toggle}
        disabled={busy}
        aria-pressed={following}
        data-testid="follow-button"
        data-following={following}
        aria-label={following ? `Watching ${label}` : `Watch ${label}`}
        title={following ? `Stop watching ${label}` : `Watch ${label}: get alerts for major developments`}
        className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60", following ? "border-accent/40 bg-accent-dim text-accent" : "border-border-strong text-ink-dim hover:text-ink")}
      >
        {following ? <Check className="h-3.5 w-3.5" aria-hidden /> : <BellRing className="h-3.5 w-3.5" aria-hidden />}
        {following ? "Watching" : "Watch"}
      </button>
      {error && <span className="mt-1 text-[11px] text-elevated">{error}</span>}
    </span>
  );
}
