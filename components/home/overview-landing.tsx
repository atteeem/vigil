"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Map as MapIcon } from "lucide-react";
import { useCommandCenter } from "@/hooks/use-command-center";
import { useWatches } from "@/hooks/use-watcher";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState, LoadingLine } from "@/components/public/data-states";
import { ENTITY_TYPE_LABEL } from "@/lib/alerts/types";
import type { WorldItem } from "@/lib/world/types";
import { cn } from "@/lib/utils";

// The Overview landing modules: a SUMMARY of the global picture from the one World Command Center payload (the same
// counts, what-changed items and signals /world shows), the user's watch list and saved briefs. Spatial investigation
// stays on /world; nothing here is computed on its own.

function Heading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">{children}</h2>
      {aside}
    </div>
  );
}

export function OverviewStatus({ className }: { className?: string }) {
  const cc = useCommandCenter();
  const s = cc.data?.status;
  const signals = cc.data?.globalSignals ?? [];
  const disruptions = signals.reduce((n, g) => n + g.count, 0);
  const stat = (label: string, value: number | undefined, testId: string, sub?: string) => (
    <div className="rounded-xl border border-border bg-card/60 px-3 py-2.5" data-testid={testId}>
      <p className="text-2xl font-semibold tabular-nums text-ink">{value ?? "—"}</p>
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</p>
      {sub && <p className="text-[10px] text-ink-faint">{sub}</p>}
    </div>
  );
  return (
    <section className={className} data-testid="overview-status">
      <Heading aside={s ? <span className="text-[11px] text-ink-faint">{s.live.label}</span> : null}>Global status</Heading>
      {cc.isError ? (
        <EmptyState title="Global status could not be loaded" detail="Try again in a moment." />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stat("Active conflicts", s?.activeConflicts, "overview-active-conflicts")}
          {stat("High tension", s?.highTension, "overview-high-tension", "severity score 80+")}
          {stat("Meaningful developments", s?.newDevelopments, "overview-developments", "last 24 h, deduplicated")}
          {stat("Hazards / disruptions", cc.data ? disruptions : undefined, "overview-disruptions", "significant, last 24 h")}
        </div>
      )}
    </section>
  );
}

export function OverviewWhatChanged({ className }: { className?: string }) {
  const cc = useCommandCenter();
  const [w, setW] = useState<"6H" | "24H">("6H");
  // 6 h: the command center's "what changed" (brief, 6 h); 24 h: its Pulse (brief, 24 h). Party claims excluded.
  const items: WorldItem[] = (w === "6H" ? cc.data?.whatChanged : cc.data?.pulse)?.filter((i) => !i.isPartyClaim).slice(0, 8) ?? [];
  return (
    <section className={className} data-testid="overview-what-changed">
      <Heading
        aside={
          <div className="flex gap-1" role="radiogroup" aria-label="What changed window">
            {(["6H", "24H"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={w === k} onClick={() => setW(k)} data-testid={`overview-changed-${k}`} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", w === k ? "border-ink bg-ink text-bg" : "border-border text-ink-dim hover:text-ink")}>
                {k}
              </button>
            ))}
          </div>
        }
      >
        What changed
      </Heading>
      {cc.isPending ? (
        <LoadingLine />
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-dim" data-testid="overview-changed-empty">
          No meaningful developments in this period.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card/50" data-testid="overview-changed-list">
          {items.map((i) => (
            <li key={i.id} className="px-3 py-2">
              <p className="text-[11px] text-ink-faint">
                <RelativeTime iso={i.occurredAt} /> · {i.category}
                {i.conflictName ? ` · ${i.conflictName}` : ""}
                {i.place ? ` · ${i.place}` : ""} · confidence {i.confidenceLabel}
              </p>
              <Link href={i.deepLink} className="text-[13px] font-medium text-ink hover:text-accent">
                {i.headline}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OverviewWatching({ className }: { className?: string }) {
  const { data: watches, isPending } = useWatches();
  const list = (watches ?? []).filter((w) => !w.muted);
  return (
    <section className={className} data-testid="overview-watching">
      <Heading aside={<Link href="/watchlist" className="text-[11px] text-accent hover:underline">Manage</Link>}>Watching</Heading>
      {isPending ? (
        <LoadingLine />
      ) : list.length === 0 ? (
        <p className="text-sm text-ink-dim" data-testid="overview-watching-empty">
          No watched entities yet. Use Watch on a country, conflict or actor page.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" data-testid="overview-watching-list">
          {list.slice(0, 12).map((w) =>
            w.href ? (
              <li key={w.id}>
                <Link href={w.href} className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-ink hover:border-border-strong">
                  {w.label}
                  <span className="text-[10px] text-ink-faint">{ENTITY_TYPE_LABEL[w.entityType]}</span>
                </Link>
              </li>
            ) : (
              <li key={w.id} className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-dim">
                {w.label}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

export function OverviewSignals({ className }: { className?: string }) {
  const cc = useCommandCenter();
  const signals = (cc.data?.globalSignals ?? []).filter((g) => g.count > 0);
  return (
    <section className={className} data-testid="overview-signals">
      <Heading>Global signals</Heading>
      {cc.isPending ? (
        <LoadingLine />
      ) : signals.length === 0 ? (
        <p className="text-sm text-ink-dim" data-testid="overview-signals-empty">
          No current infrastructure disruptions or significant hazards recorded.
        </p>
      ) : (
        <ul className="space-y-2">
          {signals.map((g) => (
            <li key={g.key} className="rounded-xl border border-border bg-card/50 px-3 py-2" data-testid="overview-signal">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                {g.label} <span className="font-normal">({g.count})</span>
              </p>
              {g.items.slice(0, 2).map((i) => (
                <Link key={i.id} href={i.deepLink} className="block truncate text-[13px] text-ink hover:text-accent">
                  {i.headline}
                </Link>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OverviewBriefs({ className }: { className?: string }) {
  const saved = useQuery<{ id: string; headline: string; generatedAt: string; window: string }[]>({ queryKey: ["brief-snapshots", "global"], queryFn: async () => (await fetch("/api/brief/snapshots?scope=global&limit=4")).json(), staleTime: 60_000 });
  return (
    <section className={className} data-testid="overview-briefs">
      <Heading>Briefs</Heading>
      <div className="flex flex-wrap gap-1.5">
        {[
          ["6h", "Last 6 hours"],
          ["24h", "Last 24 hours"],
          ["7d", "Last 7 days"],
        ].map(([w, label]) => (
          <Link key={w} href={`/brief?window=${w}`} className="rounded-full border border-border px-2.5 py-1 text-xs text-ink-dim hover:text-ink" data-testid={`overview-brief-${w}`}>
            Global brief · {label}
          </Link>
        ))}
      </div>
      {(saved.data ?? []).length > 0 && (
        <ul className="mt-2 space-y-1" data-testid="overview-saved-briefs">
          {saved.data!.map((b) => (
            <li key={b.id} className="text-[12px]">
              <Link href={`/brief?snapshot=${b.id}`} className="text-ink hover:text-accent">
                {b.headline}
              </Link>
              <span className="ml-2 text-[11px] text-ink-faint">
                saved <RelativeTime iso={b.generatedAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OpenLiveMap({ className }: { className?: string }) {
  return (
    <Link href="/world" className={cn("flex items-center justify-between gap-3 rounded-2xl border border-border-strong bg-card/60 px-4 py-3 hover:bg-card", className)} data-testid="overview-open-map">
      <span className="flex items-center gap-2 text-sm font-medium text-ink">
        <MapIcon className="h-4 w-4 text-accent" aria-hidden /> Open the Live Map
      </span>
      <span className="flex items-center gap-1 text-xs text-ink-faint">
        spatial investigation, layers, timeline <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </span>
    </Link>
  );
}
