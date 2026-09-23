"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils/format";
import { DATASET_FILTER_LABEL, DATASET_TYPE_LABEL, matchesDatasetFilter, type DatasetFilter, type PublicTerritorialDataset } from "@/lib/territory/dataset-types";

const FILTERS: DatasetFilter[] = ["all", "control", "contested", "influence"];

/** Territorial Control selector: lists ONLY datasets Vigil actually has published geometry for (metadata, no geometry).
 * The map draws nothing until a dataset is ticked, and the dataset's geometry is fetched at that moment. Influence and
 * presence datasets are labelled as such and never as control. */
export function TerritorySelector({ datasets, loading, error, selectedIds, onToggle, onClose }: { datasets: PublicTerritorialDataset[] | undefined; loading: boolean; error: boolean; selectedIds: readonly string[]; onToggle: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DatasetFilter>("all");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (datasets ?? []).filter((d) => matchesDatasetFilter(d.datasetType, filter) && (!q || `${d.name} ${d.conflictName ?? ""} ${d.provider} ${d.countryCodes.join(" ")} ${d.actors.join(" ")}`.toLowerCase().includes(q)));
  }, [datasets, query, filter]);

  return (
    <div className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-border bg-surface/90 p-3 backdrop-blur-xl" data-testid="territory-selector" role="region" aria-label="Territorial Control datasets">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Territorial control</h3>
        <button type="button" onClick={onClose} aria-label="Close territorial control panel" className="text-ink-faint hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading && <p className="mt-2 text-xs text-ink-faint">Loading available datasets…</p>}
      {error && <p className="mt-2 text-xs text-ink-faint">The list of territorial datasets could not be loaded.</p>}

      {!loading && !error && (datasets?.length ?? 0) === 0 && (
        <p className="mt-2 text-xs text-ink-dim" data-testid="territory-no-datasets">
          No territorial datasets are currently available.
        </p>
      )}

      {(datasets?.length ?? 0) > 0 && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="flex min-w-[10rem] flex-1 items-center gap-1.5 rounded-full border border-border bg-bg/60 px-2.5 py-1 text-xs text-ink-dim">
              <Search className="h-3 w-3" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search conflicts or countries" aria-label="Search territorial datasets" className="w-full bg-transparent text-ink outline-none placeholder:text-ink-faint" data-testid="territory-search" />
            </label>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Dataset type">
              {FILTERS.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)} data-testid={`territory-filter-${f}`} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", filter === f ? "border-ink bg-ink text-bg" : "border-border text-ink-dim hover:text-ink")}>
                  {DATASET_FILTER_LABEL[f]}
                </button>
              ))}
            </div>
          </div>

          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Available</p>
          <ul className="mt-1 max-h-[42vh] space-y-1.5 overflow-y-auto pr-1" data-testid="territory-dataset-list">
            {shown.map((d) => {
              const on = selectedIds.includes(d.id);
              const notControl = d.kind !== "control";
              return (
                <li key={d.id}>
                  <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2", on ? "border-accent/50 bg-card" : "border-border/60 bg-card/40 hover:bg-card")} data-testid={`territory-dataset-${d.id}`} data-dataset-type={d.datasetType}>
                    <input type="checkbox" checked={on} onChange={() => onToggle(d.id)} className="mt-1 shrink-0" aria-label={`Show ${d.name}`} data-testid={`territory-check-${d.id}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[13px] font-medium text-ink">{d.name}</span>
                        <span data-testid="territory-dataset-type" className={cn("rounded border px-1 py-px text-[9px] font-semibold uppercase tracking-wide", notControl ? "border-dashed border-ink-faint text-ink-dim" : "border-stable/40 text-stable")}>
                          {DATASET_TYPE_LABEL[d.datasetType]}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-faint">
                        {d.provider}
                        {d.lastUpdated && <> · Updated {timeAgo(d.lastUpdated)}</>}
                        {d.hasHistory && <> · {d.versionCount} dated versions</>}
                      </span>
                      {d.actors.length > 0 && <span className="mt-0.5 block text-[11px] text-ink-dim">Actors: {d.actors.join(", ")}</span>}
                      {d.coverageDescription && <span className="mt-0.5 block text-[11px] text-ink-faint">Coverage: {d.coverageDescription}</span>}
                      {notControl && <span className="mt-0.5 block text-[11px] text-ink-faint">Reported {d.kind} only: this is not territorial control.</span>}
                      {d.sourceUrl && (
                        <a href={d.sourceUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-accent hover:underline">
                          Source <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {shown.length === 0 && <p className="mt-2 text-xs text-ink-faint">No datasets match the filter.</p>}
        </>
      )}
      <p className="mt-2 text-[10px] text-ink-faint">Only datasets with reviewed, published geometry are listed. Turning one on draws it for the time shown on the timeline.</p>
    </div>
  );
}
