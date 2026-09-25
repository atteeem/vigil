"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { meFetch } from "@/hooks/use-watcher";
import { RelativeTime } from "@/components/ui/relative-time";
import { LoadingLine } from "@/components/public/data-states";
import type { ForYouFeed } from "@/lib/discovery/for-you";
import { Search } from "lucide-react";
import { useAppStore } from "@/hooks/use-app-store";

const ACTION = "inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-border-strong px-3.5 text-xs font-medium text-ink hover:bg-card";

/** Developments related to what the user follows or their selected country, each labelled with WHY it is shown. */
export function ForYouDevelopments({ country }: { country: string | null }) {
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const q = useQuery<ForYouFeed>({ queryKey: ["me", "for-you", country], queryFn: () => meFetch<ForYouFeed>(`for-you${country ? `?country=${country}` : ""}`), staleTime: 30_000 });
  if (q.isPending) return <LoadingLine label="Loading your feed…" />;
  if (q.isError)
    return (
      <p className="text-sm text-ink-dim" data-testid="for-you-feed-error">
        Your feed could not be loaded.{" "}
        <button type="button" onClick={() => q.refetch()} className="text-accent hover:underline">
          Try again
        </button>
      </p>
    );
  const items = q.data?.items ?? [];
  return (
    <div data-testid="for-you-feed">
      {q.data && q.data.watches === 0 && (
        <div className="mb-3 rounded-xl border border-border bg-card/50 p-4" data-testid="for-you-no-watches">
          <p className="text-sm font-medium text-ink">Watch countries, conflicts or actors to build your intelligence feed.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setSearchOpen(true)} className={ACTION} data-testid="for-you-action-search">
              <Search className="h-3.5 w-3.5" aria-hidden /> Search
            </button>
            <Link href="/conflicts" className={ACTION} data-testid="for-you-action-conflicts">
              Browse conflicts
            </Link>
            <Link href="/world" className={ACTION} data-testid="for-you-action-map">
              Open World Map
            </Link>
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-sm text-ink-dim" data-testid="for-you-feed-empty">
          No meaningful developments in this period for what you follow or your country.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card/50">
          {items.map((i) => (
            <li key={i.id} className="px-3.5 py-2.5" data-testid="for-you-item">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
                <RelativeTime iso={i.occurredAt} />
                <span className="uppercase tracking-wide">{i.category}</span>
                {i.conflictName && <span>· {i.conflictName}</span>}
                {i.stateChange && <span className="rounded border border-accent/40 px-1 text-accent">state change</span>}
                {i.corroborated && <span className="rounded border border-stable/40 px-1 text-stable">independently corroborated</span>}
              </p>
              <Link href={i.deepLink} className="mt-0.5 block text-sm font-medium leading-snug text-ink hover:text-accent">
                {i.title}
              </Link>
              <p className="mt-0.5 text-[11px] text-ink-dim" data-testid="for-you-reason">
                {i.reasons.join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
