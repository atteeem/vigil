"use client";

import Link from "next/link";
import { useState } from "react";
import { useAppStore } from "@/hooks/use-app-store";
import { saveBrief, useBrief, type BriefParams } from "@/hooks/use-brief";
import { BRIEF_WINDOWS, SECTION_TITLE, WINDOW_LABEL, type Brief, type BriefSection, type BriefWindow, type HotspotAssessment } from "@/lib/brief/types";
import { EmptyState, LoadingLine } from "@/components/public/data-states";
import { DevelopmentCard } from "./development-card";
import { cn } from "@/lib/utils";

const SECTION_ORDER: BriefSection[] = ["escalation", "resolution", "territory", "conflict", "infrastructure", "hazards", "claims"];
const WINDOW_SHORT: Record<string, string> = { "1h": "1H", "6h": "6H", "12h": "12H", "24h": "24H", "3d": "3D", "7d": "7D", custom: "Custom" };

export function WindowTabs({ value, onChange }: { value: string; onChange: (w: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="Brief window" data-testid="brief-windows">
      {BRIEF_WINDOWS.map((w) => (
        <button key={w} type="button" role="tab" aria-selected={value === w} onClick={() => onChange(w)} data-testid={`window-${w}`} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", value === w ? "border-ink bg-ink text-bg" : "border-border text-ink-dim hover:text-ink")}>
          {WINDOW_SHORT[w]}
        </button>
      ))}
    </div>
  );
}

export function HotspotList({ hotspots }: { hotspots: HotspotAssessment[] }) {
  if (hotspots.length === 0) return null;
  return (
    <section className="mt-8" data-testid="brief-section-hotspots">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-ink-faint">Emerging hotspots</h2>
      <p className="mb-3 text-xs text-ink-faint">Areas whose recent activity differs from their own previous 7 days. A change in pattern, not a measure of size or an assessment of intent.</p>
      <div className="space-y-2">
        {hotspots.slice(0, 6).map((h) => (
          <Link key={h.key} href={h.deepLink} className="block rounded-xl border border-border bg-card/60 px-4 py-3 hover:border-border-strong" data-testid="hotspot-card">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{h.label}</span>
              <span className="rounded-full border border-border-strong px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-dim" data-testid="hotspot-label">
                {h.label2}
              </span>
              <span className="ml-auto text-[11px] text-ink-faint">
                change {h.score}/100 · {h.confidenceLabel} confidence
              </span>
            </div>
            <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-dim" data-testid="hotspot-reasons">
              {h.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** The brief body shared by the global, country, conflict and watchlist views. */
export function BriefBody({ brief, compact = false }: { brief: Brief; compact?: boolean }) {
  const byId = new Map(brief.developments.map((d) => [d.id, d]));
  const sections = SECTION_ORDER.map((s) => ({ s, items: brief.developments.filter((d) => d.section === s) })).filter((x) => x.items.length > 0);
  return (
    <div data-testid="brief-body">
      <p className="text-sm font-medium text-ink" data-testid="brief-headline">
        {brief.headline}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        {brief.from.slice(0, 16).replace("T", " ")} → {brief.to.slice(0, 16).replace("T", " ")} UTC · what materially changed, from recorded events, state changes and reviewed evidence — not article counts
      </p>
      {brief.counts.partyClaimsHidden > 0 && (
        <p className="mt-1 text-[11px] text-ink-faint" data-testid="brief-hidden-claims">
          {brief.counts.partyClaimsHidden} party claim{brief.counts.partyClaimsHidden === 1 ? "" : "s"} hidden (Profile → Sources).
        </p>
      )}
      {brief.assessment && (
        <div className="mt-4 rounded-xl border border-border bg-card/70 p-4" data-testid="brief-assessment">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Assessment</p>
          <p className="mt-1 text-sm text-ink" data-testid="assessment-text">
            {brief.assessment.text}
          </p>
          <ul className="mt-1 list-disc pl-4 text-[12px] text-ink-dim" data-testid="assessment-reasons">
            {brief.assessment.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {brief.top.length > 0 && !compact && (
        <section className="mt-6" data-testid="brief-top">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">Top developments</h2>
          <ol className="space-y-1.5 text-sm text-ink">
            {brief.top.map((id) => {
              const d = byId.get(id);
              return d ? (
                <li key={id} className="flex gap-2" data-testid="top-item">
                  <span className="text-ink-faint">•</span>
                  <span>{d.title}</span>
                </li>
              ) : null;
            })}
          </ol>
        </section>
      )}
      {sections.map(({ s, items }) => (
        <section key={s} className="mt-8" data-testid={`brief-section-${s}`}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-faint">{SECTION_TITLE[s]}</h2>
          <div className="space-y-2">
            {items.slice(0, compact ? 4 : 12).map((d) => (
              <DevelopmentCard key={d.id} d={d} historical={!brief.live} />
            ))}
          </div>
        </section>
      ))}
      {!compact && <HotspotList hotspots={brief.hotspots} />}
      {brief.developments.length === 0 && brief.hotspots.length === 0 && <EmptyState className="mt-6" title="No material developments in this period" detail="Routine observations, repeated reports and unreviewed leads are not counted as developments." testId="brief-empty" />}
    </div>
  );
}

/** Window selector + fetch + body for one scope. */
export function BriefPanel({ scope, title, initialWindow = "6h", allowSave = true, compact = false }: { scope: Omit<BriefParams, "window">; title?: string; initialWindow?: string; allowSave?: boolean; compact?: boolean }) {
  const [window, setWindow] = useState(initialWindow);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const claims = useAppStore((s) => s.showPartyClaims);
  const custom = window === "custom";
  const ready = !custom || (!!from && !!to);
  const params: BriefParams = { ...scope, window, ...(custom && ready ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : {}) };
  const { data, status, error } = useBrief(params, ready);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {title && <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">{title}</h1>}
        <WindowTabs
          value={window}
          onChange={(w) => {
            setWindow(w);
            setSaved(null);
          }}
        />
      </div>
      {custom && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-dim" data-testid="custom-range">
          <label>
            From <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-border bg-surface px-2 py-1" aria-label="From" />
          </label>
          <label>
            To <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-border bg-surface px-2 py-1" aria-label="To" />
          </label>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-faint" data-testid="brief-window-label">
        {WINDOW_LABEL[window as BriefWindow]}
      </p>
      <div className="mt-4">
        {!ready ? (
          <EmptyState title="Choose a start and end time" testId="brief-custom-hint" />
        ) : status === "pending" ? (
          <LoadingLine />
        ) : status === "error" || !data ? (
          <EmptyState title="The brief could not be loaded" detail={(error as Error | null)?.message} testId="brief-error" />
        ) : (
          <BriefBody brief={data} compact={compact} />
        )}
      </div>
      {allowSave && data && (
        <div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
          <button type="button" className="rounded-full border border-border px-3 py-1 hover:text-ink" data-testid="brief-save" onClick={() => void saveBrief(params, claims).then((s) => setSaved(s.id)).catch(() => setSaved(null))}>
            Save this brief
          </button>
          {saved && (
            <Link href={`/brief?snapshot=${saved}`} className="text-accent hover:underline" data-testid="brief-saved-link">
              Saved — open the stored copy
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
