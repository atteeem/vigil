"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RelativeTime } from "@/components/ui/relative-time";
import type { SignificantHazard } from "@/lib/hazards/query";
import { CATEGORY_LABEL } from "@/lib/hazards/types";

/** Restrained "Global events" list: only genuinely notable, current natural hazards (a major
 * earthquake, a Red/Orange cyclone, a volcano at watch/warning, an extreme alert). Renders nothing
 * when there are none — routine minor observations never appear here. */
export function GlobalEvents({ className }: { className?: string }) {
  const { data } = useQuery<SignificantHazard[]>({
    queryKey: ["public", "global-events"],
    queryFn: async () => (await fetch("/api/public/global-events")).json(),
    refetchInterval: 120_000,
  });
  if (!data || data.length === 0) return null;
  return (
    <section className={className} data-testid="global-events">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">Global events</h2>
      <ul className="space-y-2">
        {data.map((h) => (
          <li key={h.id}>
            <Link href={`/hazard/${h.id}`} className="block rounded-xl border border-border bg-card/60 px-3.5 py-2.5 hover:border-border-strong" data-testid="global-event">
              <span className="block text-sm text-ink">{h.title}</span>
              <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
                <span>{CATEGORY_LABEL[h.category]}</span>
                <span className="truncate">{h.subtitle}</span>
                <RelativeTime iso={h.observedAt} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
