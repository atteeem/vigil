"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Newspaper } from "lucide-react";
import { ConflictCard } from "@/components/conflicts/conflict-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EmptyState, LoadingLine } from "@/components/public/data-states";
import { useAppStore } from "@/hooks/use-app-store";
import { usePublicOverview } from "@/hooks/use-public-overview";
import { computeImpact } from "@/lib/data/impact";
import { getCountryByCode } from "@/lib/reference/countries";
import type { Region } from "@/lib/types";
import { REGIONS } from "@/lib/types";
import { SEVERITY_LEVELS } from "@/lib/utils/severity";

type RegionFilter = "All" | Region;
type SortKey = "activity" | "severity" | "impact";

export default function ConflictsPage() {
  const baseCountryCode = useAppStore((s) => s.baseCountryCode);
  const overview = usePublicOverview();
  const [region, setRegion] = useState<RegionFilter>("All");
  const [sort, setSort] = useState<SortKey>("activity");
  const [query, setQuery] = useState("");
  const conflicts = overview.data?.conflicts;

  const filtered = useMemo(() => {
    let list = (conflicts ?? []).filter((c) => (region === "All" ? true : c.region === region));
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.shortName.toLowerCase().includes(q));
    }
    list = [...list];
    const country = getCountryByCode(baseCountryCode);
    if (sort === "activity") {
      // Most recent published event first; conflicts with no events last.
      list.sort((a, b) => (b.lastEventAt ? new Date(b.lastEventAt).getTime() : -1) - (a.lastEventAt ? new Date(a.lastEventAt).getTime() : -1));
    } else if (sort === "severity") {
      list.sort((a, b) => SEVERITY_LEVELS.indexOf(b.severity) - SEVERITY_LEVELS.indexOf(a.severity));
    } else if (country) {
      list.sort((a, b) => computeImpact(country, b).score - computeImpact(country, a).score);
    }
    return list;
  }, [conflicts, region, sort, query, baseCountryCode]);

  return (
    <main className="mx-auto max-w-[1200px] px-4 pb-28 pt-24 sm:px-6 sm:pt-32">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Active Conflicts</h1>
          <p className="mt-1 text-sm text-ink-dim">Ordered by most recent published event by default — never ranked best or worst.</p>
        </div>
        <Link href="/intel" className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-accent hover:underline">
          <Newspaper className="h-3.5 w-3.5" />
          Regional Intel Briefings
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2">
          <Search className="h-4 w-4 text-ink-faint" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conflicts…"
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none sm:w-56"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl aria-label="Region" options={[{ value: "All", label: "All" }, ...REGIONS.map((r) => ({ value: r, label: r }))]} value={region} onChange={setRegion} />
        </div>
      </div>

      <div className="mt-3">
        <SegmentedControl
          aria-label="Sort"
          options={[
            { value: "activity", label: "Latest Event" },
            { value: "severity", label: "Severity" },
            { value: "impact", label: "Impact on you" },
          ]}
          value={sort}
          onChange={setSort}
        />
      </div>

      {overview.status === "loading" && <LoadingLine className="mt-8" />}
      {overview.status === "error" && !conflicts && <EmptyState className="mt-8" title="Conflicts could not be loaded" detail="Try again in a moment." testId="conflicts-error" />}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="conflict-grid">
        {filtered.map((c) => (
          <ConflictCard key={c.id} conflict={c} baseCountryCode={baseCountryCode} />
        ))}
      </div>

      {conflicts && filtered.length === 0 && <EmptyState className="mt-16" title="No conflicts match your filters" testId="conflicts-empty" />}
    </main>
  );
}
