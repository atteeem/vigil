"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { FollowButton } from "@/components/watch/follow-button";
import { timeAgo } from "@/lib/utils/format";
import { SEVERITY_LABEL } from "@/lib/utils/severity";
import type { Severity } from "@/lib/types/severity";
import type { CountryIntelligence } from "@/lib/countries/intelligence";
import type { ConflictContext } from "@/lib/world/conflict-context";
import type { WorldItem } from "@/lib/world/types";
import { CATEGORY_ICON } from "./ticker";
import { ConfidenceBadge, CONFIDENCE_TOOLTIP } from "./confidence-badge";

function Stat({ label, value, sub, testId, title }: { label: string; value: string; sub?: string; testId: string; title?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-2.5 py-2" title={title}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-ink" data-testid={testId}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink-faint">{sub}</div>}
    </div>
  );
}

function Header({ title, kicker, onClose }: { title: string; kicker: string; onClose: () => void }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{kicker}</div>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
        <X className="h-3.5 w-3.5" /> Close
      </button>
    </div>
  );
}

function Latest({ items, onSelect, empty }: { items: WorldItem[]; onSelect: (i: WorldItem) => void; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-ink-faint">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {items.map((i) => {
        const Icon = CATEGORY_ICON[i.category];
        return (
          <li key={i.id}>
            <button type="button" onClick={() => onSelect(i)} data-testid="context-latest-item" className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-card">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-snug text-ink">{i.headline}</span>
                <span className="text-[11px] text-ink-faint">{timeAgo(i.occurredAt)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-4">
    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
    {children}
  </section>
);

/** Selected conflict: severity, impact for the user country and confidence stay three separate numbers. */
export function ConflictContextPanel({ slug, country, onClose, onSelectItem }: { slug: string; country: string | null; onClose: () => void; onSelectItem: (i: WorldItem) => void }) {
  const q = useQuery<ConflictContext>({
    queryKey: ["world-conflict", slug, country],
    queryFn: async () => {
      const res = await fetch(`/api/world/conflict?slug=${encodeURIComponent(slug)}${country ? `&country=${country}` : ""}`);
      if (!res.ok) throw new Error("Conflict context unavailable");
      return (await res.json()) as ConflictContext;
    },
    staleTime: 30_000,
  });
  const c = q.data;
  return (
    <div data-testid="conflict-context" data-slug={slug}>
      <Header title={c?.name ?? slug} kicker="Conflict" onClose={onClose} />
      {q.isPending && <p className="text-xs text-ink-faint">Loading…</p>}
      {q.isError && <p className="text-xs text-ink-faint">Conflict context is unavailable right now.</p>}
      {c && (
        <>
          <p className="mb-2 text-xs text-ink-dim" data-testid="conflict-status">
            {c.statusLabel}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Severity" value={String(c.severity.score)} sub={SEVERITY_LABEL[c.severity.label as Severity] ?? c.severity.label} testId="ctx-severity" title="How severe the conflict itself is." />
            <Stat label="Impact" value={c.impact ? String(c.impact.score) : "n/a"} sub={c.impact ? `on ${c.impact.countryName}` : "no country set"} testId="ctx-impact" title="Effect on your country; independent of severity." />
            <Stat label="Confidence" value={String(c.confidence.score)} sub="evidence" testId="ctx-confidence" title={CONFIDENCE_TOOLTIP} />
          </div>
          <p className="mt-1 text-[10px] text-ink-faint">{CONFIDENCE_TOOLTIP}</p>
          {c.impact && c.impact.reasons.length > 0 && <p className="mt-1 text-[11px] text-ink-dim">{c.impact.reasons[0]}</p>}
          {c.summary && <p className="mt-3 text-[13px] leading-snug text-ink-dim">{c.summary}</p>}
          <Block title="Latest developments">
            <Latest items={c.latest} onSelect={onSelectItem} empty="No major developments in this window." />
          </Block>
          <Block title="Territorial summary">
            {c.territory ? (
              <p className="text-[13px] text-ink-dim" data-testid="ctx-territory">
                {c.territory.areas} mapped area{c.territory.areas === 1 ? "" : "s"}
                {c.territory.actors.length > 0 && ` · ${c.territory.actors.map((a) => `${a.name} (${a.areas})`).join(", ")}`}
              </p>
            ) : (
              <p className="text-xs text-ink-faint">No published territorial control data.</p>
            )}
          </Block>
          <Block title="Participants">
            {c.participants.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {c.participants.map((p) => (
                  <li key={p.name} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-ink-dim" title={p.role}>
                    {p.href ? <Link href={p.href}>{p.name}</Link> : p.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-faint">No participants recorded.</p>
            )}
          </Block>
          <Block title="Corroboration">
            <p className="text-[13px] text-ink-dim">{c.corroboratedSources != null ? `${c.corroboratedSources} independent source${c.corroboratedSources === 1 ? "" : "s"} covering this conflict` : "Source coverage not available."}</p>
          </Block>
          <div className="mt-4 flex items-center gap-2">
            <FollowButton entityType="conflict" entityKey={c.slug} label={c.name} />
            <Link href={c.href} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-card" data-testid="ctx-open-full">
              Open full page
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

/** Selected country: the Country Intelligence aggregation (hard rules live in the central scoring engine). */
export function CountryContextPanel({ code, onClose, onSelectConflict }: { code: string; onClose: () => void; onSelectConflict: (slug: string) => void }) {
  const q = useQuery<CountryIntelligence>({
    queryKey: ["world-country", code],
    queryFn: async () => {
      const res = await fetch(`/api/countries/${code}/intelligence`);
      if (!res.ok) throw new Error("Country context unavailable");
      return (await res.json()) as CountryIntelligence;
    },
    staleTime: 60_000,
  });
  const i = q.data;
  return (
    <div data-testid="country-context" data-code={code}>
      <Header title={i ? `${i.country.flag ?? ""} ${i.country.name}`.trim() : code} kicker="Country" onClose={onClose} />
      {q.isPending && <p className="text-xs text-ink-faint">Loading…</p>}
      {q.isError && <p className="text-xs text-ink-faint">Country context is unavailable right now.</p>}
      {i && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Impact" value={String(i.overview.exposureScore)} sub={i.overview.exposureLabel} testId="ctx-country-impact" title="Exposure to conflicts, computed by the central impact model. War inside the country = 100; full-scale war in a bordering country = at least 75." />
            <Stat label="Domestic" value={String(i.overview.activeDomesticConflicts)} sub="active conflicts" testId="ctx-country-domestic" />
            <Stat label="Nearby" value={String(i.overview.highImpactNearbyConflicts)} sub="high impact" testId="ctx-country-nearby" />
          </div>
          <p className="mt-2 text-[13px] text-ink-dim">{i.overview.statusLine}</p>
          <Block title="Conflicts affecting this country">
            {i.domesticConflicts.length + i.nearbyConflicts.length > 0 ? (
              <ul className="space-y-0.5">
                {i.domesticConflicts.map((d) => (
                  <li key={d.slug}>
                    <button type="button" onClick={() => onSelectConflict(d.slug)} data-testid="country-conflict-row" className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-card">
                      <span>{d.name}</span>
                      <span className="text-[11px] text-ink-faint">inside · {d.severityLabel}</span>
                    </button>
                  </li>
                ))}
                {i.nearbyConflicts.slice(0, 4).map((n) => (
                  <li key={n.conflictSlug}>
                    <button type="button" onClick={() => onSelectConflict(n.conflictSlug)} data-testid="country-conflict-row" className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-card">
                      <span>{n.conflictName}</span>
                      <span className="text-[11px] text-ink-faint">impact {n.impact}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-faint">No conflicts currently affect this country materially.</p>
            )}
          </Block>
          <Block title="Latest developments">
            {i.developments.length === 0 && <p className="text-xs text-ink-faint">No major developments in this window.</p>}
            {i.developments.slice(0, 4).map((d) => (
              <p key={d.id} className="px-2 py-1 text-[13px] text-ink" data-testid="country-development">
                {d.title} <span className="text-[11px] text-ink-faint">{timeAgo(d.occurredAt)}</span> <ConfidenceBadge level={d.confidenceLabel} />
              </p>
            ))}
          </Block>
          <div className="mt-4 flex items-center gap-2">
            <FollowButton entityType="country" entityKey={i.country.code} label={i.country.name} />
            <Link href={`/country/${i.country.code}`} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-card" data-testid="ctx-open-country">
              Open country page
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
