"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search, Newspaper } from "lucide-react";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { RelativeTime } from "@/components/ui/relative-time";
import { EmptyState, LoadingLine } from "@/components/public/data-states";
import type { DirectoryRow } from "@/lib/public/conflict-directory";
import type { Region, Severity } from "@/lib/types";
import { REGIONS } from "@/lib/types";
import { SEVERITY_LEVELS } from "@/lib/utils/severity";
import { cn } from "@/lib/utils";
import { SCORE_COPY } from "@/lib/copy/scores";

type RegionFilter = "All" | Region;
type StatusFilter = "live" | "active" | "reduced" | "dormant" | "ended" | "all";
type SortKey = "recent" | "severity" | "name";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "live", label: "Active + reduced" },
  { value: "active", label: "Active" },
  { value: "reduced", label: "Reduced" },
  { value: "dormant", label: "Dormant" },
  { value: "ended", label: "Ended" },
  { value: "all", label: "All" },
];

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const isEnded = (s: string) => ["ended", "resolved", "archived"].includes(s);

/** The conflict directory: every registry conflict, filterable by status / region / text. Deterministic order — most
 * recent published incident, then severity, then name — never an editorial or political ranking. */
export default function ConflictsPage() {
  const directory = useQuery<DirectoryRow[]>({ queryKey: ["conflict-directory"], queryFn: async () => (await fetch("/api/conflicts/directory")).json(), staleTime: 60_000 });
  const [region, setRegion] = useState<RegionFilter>("All");
  const [status, setStatus] = useState<StatusFilter>("live");
  const [sort, setSort] = useState<SortKey>("recent");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = norm(query);
    const sev = (s: string) => SEVERITY_LEVELS.indexOf(s as Severity);
    const list = (directory.data ?? []).filter((c) => {
      if (region !== "All" && c.region !== region) return false;
      if (status === "live" && !["active", "reduced"].includes(c.status)) return false;
      if (status === "ended" && !isEnded(c.status)) return false;
      if (!["live", "ended", "all"].includes(status) && c.status !== status) return false;
      if (q && !norm(`${c.name} ${c.shortName} ${c.slug.replace(/-/g, " ")}`).includes(q)) return false;
      return true;
    });
    const byRecent = (a: DirectoryRow, b: DirectoryRow) => (b.lastEventAt ?? "").localeCompare(a.lastEventAt ?? "");
    const bySev = (a: DirectoryRow, b: DirectoryRow) => sev(b.severity) - sev(a.severity);
    const byName = (a: DirectoryRow, b: DirectoryRow) => a.name.localeCompare(b.name);
    return [...list].sort(sort === "recent" ? (a, b) => byRecent(a, b) || bySev(a, b) || byName(a, b) : sort === "severity" ? (a, b) => bySev(a, b) || byRecent(a, b) || byName(a, b) : byName);
  }, [directory.data, region, status, sort, query]);

  return (
    <main className="mx-auto w-full max-w-[1200px] overflow-x-hidden px-4 pb-28 pt-24 sm:px-6 sm:pt-28">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Conflicts</h1>
          <p className="mt-1 text-sm text-ink-dim">Every conflict in the registry. Ordered by most recent published incident, then severity, then name — never ranked best or worst.</p>
        </div>
        <Link href="/intel" className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-accent hover:underline">
          <Newspaper className="h-3.5 w-3.5" />
          Regional Intel Briefings
        </Link>
      </div>

      <div className="mt-5 flex flex-col gap-2.5">
        <label className="flex max-w-md items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter conflicts…" aria-label="Filter conflicts" className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none" data-testid="conflicts-filter" />
        </label>
        <div className="no-scrollbar flex gap-2 overflow-x-auto" data-testid="conflicts-status-filter">
          <SegmentedControl aria-label="Status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          <SegmentedControl aria-label="Region" options={[{ value: "All", label: "All regions" }, ...REGIONS.map((r) => ({ value: r, label: r }))]} value={region} onChange={setRegion} />
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          <SegmentedControl
            aria-label="Sort"
            options={[
              { value: "recent", label: "Recent update" },
              { value: "severity", label: "Severity" },
              { value: "name", label: "Name" },
            ]}
            value={sort}
            onChange={setSort}
          />
        </div>
      </div>

      {directory.isPending && <LoadingLine className="mt-8" label="Loading conflicts…" />}
      {directory.isError && <EmptyState className="mt-8" title="Conflicts could not be loaded" detail="Try again in a moment." testId="conflicts-error" />}

      {directory.data && (
        <p className="mt-4 text-[11px] text-ink-faint" data-testid="conflicts-count">
          {filtered.length} of {directory.data.length} conflicts
        </p>
      )}
      <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border bg-card/40" data-testid="conflict-grid">
        {filtered.map((c) => (
          <li key={c.id} data-testid="conflict-row" data-status={c.status}>
            <Link href={`/conflict/${c.slug}`} className="grid grid-cols-1 gap-1 px-4 py-3 hover:bg-card sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{c.shortName}</span>
                  <SeverityBadge severity={c.severity as Severity} size="sm" />
                  {c.fullScaleWar && <span className="text-[10px] font-semibold uppercase text-severe">full-scale war</span>}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">
                  {c.region} · <span className={cn(isEnded(c.status) && "text-ink-faint", c.status === "active" && "text-ink-dim")} data-testid="conflict-status">{c.statusLabel}</span>
                </span>
              </span>
              <span className="text-[11px] text-ink-dim">{c.lastEventAt ? <RelativeTime iso={c.lastEventAt} prefix="Latest incident " /> : "No published incident"}</span>
              <span className="flex gap-4 text-[11px] text-ink-faint sm:justify-end">
                <span title={`Confidence: ${SCORE_COPY.confidence.question}`} data-testid="conflict-confidence">
                  Confidence <span className="font-semibold tabular-nums text-ink">{c.confidence ?? "—"}</span>
                </span>
                <span title="Unique published reports, last 7 days" data-testid="conflict-report-count">
                  Reports 7d <span className="font-semibold tabular-nums text-ink">{c.reportCount7d}</span>
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {directory.data && filtered.length === 0 && <EmptyState className="mt-8" title="No matching conflicts" detail="Change the status, region or text filter." testId="conflicts-empty" />}
    </main>
  );
}
