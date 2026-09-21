"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils/format";
import type { CommandCenter, EntityWindow, TopEntity, WorldItem } from "@/lib/world/types";
import { CATEGORY_ICON } from "./ticker";
import { ConfidenceBadge } from "./confidence-badge";

const EMPTY = "No major developments in this window.";

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="border-b border-border pb-4 last:border-0" data-testid={testId}>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

function ItemRow({ item, onSelect, testId }: { item: WorldItem; onSelect: (i: WorldItem) => void; testId: string }) {
  const Icon = CATEGORY_ICON[item.category];
  return (
    <li>
      <button type="button" onClick={() => onSelect(item)} data-testid={testId} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-card">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-snug text-ink">{item.headline}</span>
          <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
            {timeAgo(item.occurredAt)}
            <ConfidenceBadge level={item.confidenceLabel} />
          </span>
        </span>
      </button>
    </li>
  );
}

/** Default right rail (no selection): What changed, Top entities, Global signals. */
export function WorldRail({ data, loading, error, onSelectItem, onSelectEntity }: { data: CommandCenter | undefined; loading: boolean; error: boolean; onSelectItem: (i: WorldItem) => void; onSelectEntity: (e: TopEntity) => void }) {
  const [win, setWin] = useState<EntityWindow>("6h");
  const empty = loading ? "Loading…" : error ? "Unavailable right now." : EMPTY;
  const entities = data?.topEntities[win] ?? [];
  return (
    <div className="space-y-4" data-testid="world-rail">
      <Section title="What changed" testId="rail-what-changed">
        {data && data.whatChanged.length > 0 ? (
          <ul className="space-y-0.5">
            {data.whatChanged.map((i) => (
              <ItemRow key={i.id} item={i} onSelect={onSelectItem} testId="rail-change-item" />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-faint">{empty}</p>
        )}
      </Section>
      <Section title="Top entities" testId="rail-entities">
        <div className="mb-2 flex gap-1" role="tablist" aria-label="Top entities window">
          {(["1h", "6h", "24h"] as const).map((w) => (
            <button key={w} type="button" role="tab" aria-selected={win === w} onClick={() => setWin(w)} data-testid={`entities-${w}`} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase", win === w ? "border-ink bg-ink text-bg" : "border-border text-ink-dim hover:text-ink")}>
              {w}
            </button>
          ))}
        </div>
        {entities.length > 0 ? (
          <ol className="space-y-0.5">
            {entities.map((e, n) => (
              <li key={`${e.kind}:${e.key}`}>
                <button type="button" onClick={() => onSelectEntity(e)} data-testid="entity-row" data-entity={`${e.kind}:${e.key}`} title={e.lead} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-card">
                  <span className="w-4 text-[11px] tabular-nums text-ink-faint">{n + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{e.label}</span>
                  <span className="text-[10px] uppercase text-ink-faint">{e.kind}</span>
                  <span className="text-[11px] tabular-nums text-ink-dim">{e.developments}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-ink-faint">{empty}</p>
        )}
        <p className="mt-1.5 text-[10px] text-ink-faint">Ranked by distinct meaningful developments, not article volume.</p>
      </Section>
      <Section title="Global signals" testId="rail-signals">
        <ul className="space-y-1.5">
          {(data?.globalSignals ?? []).map((s) => (
            <li key={s.key} data-testid={`signal-${s.key}`}>
              <div className="flex items-center justify-between px-2 text-[12px] text-ink-dim">
                <span>{s.label}</span>
                <span className="tabular-nums text-ink-faint">{s.count}</span>
              </div>
              {s.items.length > 0 ? (
                <ul>
                  {s.items.map((i) => (
                    <ItemRow key={i.id} item={i} onSelect={onSelectItem} testId="signal-item" />
                  ))}
                </ul>
              ) : (
                <p className="px-2 text-[11px] text-ink-faint">{EMPTY}</p>
              )}
            </li>
          ))}
          {!data && <li className="text-xs text-ink-faint">{empty}</li>}
        </ul>
      </Section>
    </div>
  );
}
