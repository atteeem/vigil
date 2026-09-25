"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";
import { useAppStore } from "@/hooks/use-app-store";
import { RelativeTime } from "@/components/ui/relative-time";
import type { DevelopmentItem } from "@/lib/countries/intelligence";
import { cn } from "@/lib/utils";

const WINDOWS = [
  { key: "6H", label: "6H", ms: 6 * 3_600_000 },
  { key: "24H", label: "24H", ms: 24 * 3_600_000 },
  { key: "3D", label: "3D", ms: 3 * 86_400_000 },
  { key: "7D", label: "7D", ms: 7 * 86_400_000 },
] as const;

const SCOPE_LABEL: Record<string, string> = { point: "exact point", city: "city", region: "region", country: "country-level", conflict: "conflict-wide", global: "global", unknown: "location unknown" };

/** Latest developments with a time filter. Party / aligned claims arrive flagged and stay hidden unless the user
 * turned them on (Profile → Sources); when shown they are labelled as claims. */
export function CountryDevelopments({ items, generatedAt }: { items: DevelopmentItem[]; generatedAt: string }) {
  const [win, setWin] = useState<(typeof WINDOWS)[number]["key"]>("24H");
  const showClaims = useAppStore((s) => s.showPartyClaims);
  const ref = new Date(generatedAt).getTime();
  const ms = WINDOWS.find((w) => w.key === win)!.ms;
  const inWindow = items.filter((d) => ref - new Date(d.occurredAt).getTime() <= ms);
  const shown = inWindow.filter((d) => showClaims || !d.isPartyClaim);
  const hidden = inWindow.length - shown.length;
  return (
    <div data-testid="country-developments">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="radiogroup" aria-label="Development window">
          {WINDOWS.map((w) => (
            <button key={w.key} type="button" role="radio" aria-checked={win === w.key} onClick={() => setWin(w.key)} data-testid={`dev-window-${w.key}`} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", win === w.key ? "border-ink bg-ink text-bg" : "border-border text-ink-dim hover:text-ink")}>
              {w.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-faint" data-testid="dev-count">
          {shown.length} shown{hidden > 0 ? ` · ${hidden} party / aligned claim${hidden === 1 ? "" : "s"} hidden` : ""}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-xs text-ink-faint" data-testid="dev-empty">
          No meaningful development in this window.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60 rounded-xl border border-border bg-card/50" data-testid="dev-list">
          {shown.map((d) => (
            <li key={d.id} className="px-3.5 py-2.5" data-testid="dev-item" data-scope={d.locationScope} data-party={d.isPartyClaim}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
                <RelativeTime iso={d.occurredAt} />
                <span className="uppercase tracking-wide">{d.category}</span>
                <span>· {SCOPE_LABEL[d.locationScope] ?? d.locationScope}</span>
                <span>· confidence {d.confidenceLabel}</span>
                {d.reportCount != null && <span data-testid="dev-report-count">· {d.reportCount} report{d.reportCount === 1 ? "" : "s"}</span>}
                {d.isPartyClaim && <span className="rounded border border-orange-400/40 px-1 text-orange-300">party / aligned claim</span>}
              </div>
              <Link href={d.deepLink} className="mt-0.5 block text-sm font-medium leading-snug text-ink hover:text-accent">
                {d.title}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-faint">
                {d.sources.length > 0 && <span className="min-w-0 truncate">Sources: {d.sources.map((s) => s.name).join(", ")}</span>}
                {d.conflictName && <span>{d.conflictName}</span>}
                {d.mapHref && (
                  <Link href={d.mapHref} className="inline-flex items-center gap-0.5 text-accent hover:underline" data-testid="dev-map-link">
                    <MapPin className="h-3 w-3" aria-hidden /> {d.locationScope === "country" ? "Country on map" : "Map"}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A <details> section: primary sections always open; secondary ones open on wider screens and start collapsed on
 * phones, so the country header, situation, exposure, developments and conflicts come first there. */
export function CountrySection({ id, title, aside, children, secondary = false }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode; secondary?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- viewport read after mount (SSR renders open)
    if (secondary && window.innerWidth < 640) setOpen(false);
  }, [secondary]);
  return (
    <details ref={ref} className="group mt-7 min-w-0" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid={`section-${id}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border/60 pb-1.5 [&::-webkit-details-marker]:hidden">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
          {title}
          <span className="ml-2 text-ink-faint/60 group-open:hidden" aria-hidden>
            ＋
          </span>
        </h2>
        {aside}
      </summary>
      <div className="mt-3 min-w-0">{children}</div>
    </details>
  );
}
