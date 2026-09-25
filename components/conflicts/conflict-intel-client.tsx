"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, MapPin } from "lucide-react";
import { useAppStore } from "@/hooks/use-app-store";
import { useLiveEvents } from "@/hooks/use-live-events";
import { useWorldEvents } from "@/hooks/use-world-events";
import { useWorldTimeline } from "@/hooks/use-world-timeline";
import { useTerritorialControl } from "@/hooks/use-territorial-control";
import { useHazards, type HazardViewport } from "@/hooks/use-hazards";
import { TimelineControls } from "@/components/map/timeline-controls";
import { SourceTrustHelp } from "@/components/sources/source-trust-help";
import { TerritoryLegend } from "@/components/map/territory-legend";
import { GlobeLoading } from "@/components/globe/globe-loading";
import { RelativeTime } from "@/components/ui/relative-time";
import { getCountryByCode } from "@/lib/reference/countries";
import { HAZARD_LAYERS, HAZARD_LAYER_LABEL, type HazardLayer } from "@/lib/hazards/types";
import type { Conflict } from "@/lib/types";
import type { EvidenceReportView, FeedItem, ImpactEntry, WhatChangedWindow } from "@/lib/conflicts/intelligence";
import { SEVERITY_TEXT_CLASS, severityFromScore } from "@/lib/utils/severity";
import { cn } from "@/lib/utils";
import { SCORE_COPY } from "@/lib/copy/scores";

const WorldMap = dynamic(() => import("@/components/map/world-map").then((m) => m.WorldMap), { ssr: false, loading: () => <GlobeLoading /> });

const SCOPE_LABEL: Record<string, string> = { point: "exact point", city: "city-level", region: "region-level", country: "country-level", conflict: "conflict-wide", global: "global", unknown: "location unknown" };

/** Impact for the user's selected country: read from the server's per-country impact map (central model); React
 * computes nothing. */
export function ImpactScoreCard({ byCountry, explanation }: { byCountry: Record<string, ImpactEntry>; explanation: string }) {
  const base = useAppStore((s) => s.baseCountryCode);
  const country = base ? getCountryByCode(base) : undefined;
  const entry = country ? byCountry[country.code] : undefined;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4" data-testid="score-impact" title={explanation}>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-faint">Impact{country ? ` on ${country.name}` : ""}</p>
      <p className="text-[11px] text-ink-dim" data-testid="score-impact-question">
        {SCORE_COPY.impact.question}
      </p>
      {entry ? (
        <p className={cn("mt-1 text-3xl font-semibold tabular-nums", SEVERITY_TEXT_CLASS[severityFromScore(entry.score)])} data-testid="score-impact-value">
          {entry.score}
          <span className="text-sm font-medium text-ink-faint"> / 100</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-faint">Choose your impact country in Settings to see Impact.</p>
      )}
      {entry && <p className="mt-1 text-xs text-ink-dim" data-testid="score-impact-reason">{entry.reason}</p>}
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">{explanation}</p>
    </div>
  );
}

const FEED_WINDOWS = [
  { key: "1H", ms: 3_600_000 },
  { key: "6H", ms: 6 * 3_600_000 },
  { key: "24H", ms: 24 * 3_600_000 },
  { key: "3D", ms: 3 * 86_400_000 },
  { key: "7D", ms: 7 * 86_400_000 },
  { key: "30D", ms: 30 * 86_400_000 },
] as const;

const GROUPS: { key: string; title: string; match: (r: EvidenceReportView) => boolean }[] = [
  { key: "strong", title: "Independent / Strong Verification", match: (r) => r.trustCategory === "strong" && !r.evidenceRole.startsWith("relay") },
  { key: "perspective", title: "Independent / Perspective", match: (r) => (r.trustCategory === "perspective" || r.trustCategory === "unclassified") && !r.evidenceRole.startsWith("relay") },
  { key: "party", title: "Party / Aligned Claim", match: (r) => r.trustCategory === "party_claim" },
  { key: "other", title: "Discovery leads and repeats (not counted)", match: (r) => r.trustCategory === "discovery" || r.evidenceRole.startsWith("relay") },
];

/** The chronological development feed with inspectable evidence. Party / aligned claims follow the Profile setting:
 * hidden (and counted) by default, labelled PARTY CLAIM when shown, never counted as independent corroboration. */
export function ConflictFeed({ items, generatedAt }: { items: FeedItem[]; generatedAt: string }) {
  const [win, setWin] = useState<(typeof FEED_WINDOWS)[number]["key"]>("7D");
  const [limit, setLimit] = useState(20);
  const showClaims = useAppStore((s) => s.showPartyClaims);
  const ref = new Date(generatedAt).getTime();
  const ms = FEED_WINDOWS.find((w) => w.key === win)!.ms;
  const inWindow = items.filter((d) => ref - new Date(d.occurredAt).getTime() <= ms);
  const shown = inWindow.filter((d) => showClaims || !d.isPartyClaim);
  const hidden = inWindow.length - shown.length;
  return (
    <div data-testid="conflict-feed">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Development window">
          {FEED_WINDOWS.map((w) => (
            <button key={w.key} type="button" role="radio" aria-checked={win === w.key} onClick={() => {
                setWin(w.key);
                setLimit(20);
              }} data-testid={`feed-window-${w.key}`} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium", win === w.key ? "border-ink bg-ink text-bg" : "border-border text-ink-dim hover:text-ink")}>
              {w.key}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-ink-faint" data-testid="feed-count">
          {shown.length} development{shown.length === 1 ? "" : "s"}
          {hidden > 0 && <span data-testid="feed-hidden-claims"> · {hidden} party / aligned claim{hidden === 1 ? "" : "s"} hidden</span>}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-ink-dim" data-testid="feed-empty">
          No meaningful developments in this period.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border/60 rounded-xl border border-border bg-card/50" data-testid="feed-list">
          {shown.slice(0, limit).map((d) => (
            <FeedRow key={d.id} d={d} showClaims={showClaims} />
          ))}
        </ul>
      )}
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit((n) => n + 40)} className="mt-2 text-xs text-accent hover:underline" data-testid="feed-more">
          Show {Math.min(40, shown.length - limit)} more of {shown.length - limit} remaining
        </button>
      )}
    </div>
  );
}

function FeedRow({ d, showClaims }: { d: FeedItem; showClaims: boolean }) {
  const [open, setOpen] = useState(false);
  const visibleReports = d.reports.filter((r) => showClaims || r.trustCategory !== "party_claim");
  const hiddenReports = d.reports.length - visibleReports.length;
  return (
    <li className="px-3.5 py-2.5" data-testid="feed-item" data-kind={d.kind} data-scope={d.locationScope} data-party={d.isPartyClaim}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
        <RelativeTime iso={d.occurredAt} />
        <span className="uppercase tracking-wide">{d.category}</span>
        <span data-testid="feed-scope">· {SCOPE_LABEL[d.locationScope] ?? d.locationScope}{d.place ? ` (${d.place})` : ""}</span>
        {d.severity && <span className={SEVERITY_TEXT_CLASS[d.severity as keyof typeof SEVERITY_TEXT_CLASS] ?? ""}>· severity {d.severity}</span>}
        {d.significance != null && <span>· significance {d.significance}</span>}
        <span>· confidence {d.confidenceLabel}</span>
        {d.kind === "event" && (
          <span data-testid="feed-report-count">
            · {d.reportCount} report{d.reportCount === 1 ? "" : "s"} · {d.sourceCount} source{d.sourceCount === 1 ? "" : "s"}
          </span>
        )}
        {d.isPartyClaim && <span className="rounded border border-high/50 px-1 font-semibold text-high">PARTY CLAIM</span>}
      </div>
      <Link href={d.deepLink} className="mt-0.5 block text-sm font-medium leading-snug text-ink hover:text-accent">
        {d.title}
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {d.evidence && (
          <span className="text-ink-dim" data-testid="feed-corroboration">
            {d.evidence.independentSources} independent source group{d.evidence.independentSources === 1 ? "" : "s"}
            {d.evidence.partyClaims > 0 ? ` · ${d.evidence.partyClaims} party claim${d.evidence.partyClaims === 1 ? "" : "s"}` : ""}
            {d.evidence.dependentRepeats > 0 ? ` · ${d.evidence.dependentRepeats} repeat${d.evidence.dependentRepeats === 1 ? "" : "s"} not counted` : ""}
          </span>
        )}
        {d.disagreements.length > 0 && (
          <span className="rounded border border-orange-400/40 px-1 font-semibold text-orange-300" data-testid="feed-contested">
            CONTESTED
          </span>
        )}
        {d.mapHref && (
          <Link href={d.mapHref} className="inline-flex items-center gap-0.5 text-accent hover:underline" data-testid="feed-map-link">
            <MapPin className="h-3 w-3" aria-hidden /> {d.locationScope === "country" ? "Country on map" : d.locationScope === "region" ? "Region (centroid) on map" : "Map"}
          </Link>
        )}
        {d.reports.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-accent hover:underline" data-testid="feed-evidence-toggle">
            {open ? "Hide evidence" : "Evidence"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 rounded-lg border border-border/70 bg-bg/40 p-3" data-testid="feed-evidence">
          {d.evidence && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-4" data-testid="corroboration-box">
              <div>
                <dt className="text-ink-faint">Independent reports</dt>
                <dd className="font-semibold text-ink">{d.evidence.strongVerification + d.evidence.perspectives + d.evidence.unclassified}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Independence groups</dt>
                <dd className="font-semibold text-ink" data-testid="corroboration-groups">{d.evidence.independentSources}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Party / aligned claims</dt>
                <dd className="font-semibold text-ink" data-testid="corroboration-party">{d.evidence.partyClaims}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Confidence</dt>
                <dd className="font-semibold text-ink">{Math.round(d.confidence * 100)}%</dd>
              </div>
            </dl>
          )}
          {d.evidence && (
            <p className="mt-1.5 text-[11px] text-ink-dim">
              {d.evidence.independentSources >= 2 ? `Confirmed by ${d.evidence.independentSources} independent source groups.` : d.evidence.independentSources === 1 ? "One independent source group; not yet corroborated." : "No independent confirmation."} Syndicated copies and relays never count as independent confirmation.
            </p>
          )}
          {d.disagreements.map((g) => (
            <p key={g.field} className="mt-1.5 text-[11px] text-orange-200" data-testid="feed-disagreement">
              Sources disagree on {g.label.toLowerCase()}: {g.values.map((v) => `${v.value} (${v.sources.join(", ")}${v.partyOnly ? ", party only" : ""})`).join(" vs ")}. Vigil does not reconcile these.
            </p>
          ))}
          <SourceTrustHelp className="mt-2" />
          {GROUPS.map((grp) => {
            const list = visibleReports.filter(grp.match);
            if (!list.length) return null;
            return (
              <div key={grp.key} className="mt-2" data-testid={`evidence-group-${grp.key}`}>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{grp.title}</p>
                <ul className="mt-1 space-y-1">
                  {list.map((r) => (
                    <li key={r.id} className="text-[11px]" data-testid="evidence-report">
                      <span className="font-medium text-ink">{r.source}</span>
                      {r.badge && <span className="ml-1.5 rounded border border-high/50 px-1 text-[9px] font-semibold text-high">{r.badge}</span>}
                      {r.perspective && <span className="ml-1.5 text-ink-faint">{r.perspective}</span>}
                      <span className="ml-1.5 text-ink-faint">· {r.evidenceRole} · <RelativeTime iso={r.publishedAt} /></span>
                      {r.headline && <span className="block text-ink-dim">{r.headline}</span>}
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-accent hover:underline" data-testid="evidence-link">
                          Original source <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : (
                        <span className="text-ink-faint">Source unavailable</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {hiddenReports > 0 && <p className="mt-2 text-[11px] text-ink-faint">{hiddenReports} party / aligned report{hiddenReports === 1 ? "" : "s"} hidden (Profile → Sources).</p>}
        </div>
      )}
    </li>
  );
}

/** "What changed" by window: state changes and corroborated incidents, never article volume. */
export function WhatChanged({ windows }: { windows: WhatChangedWindow[] }) {
  const [w, setW] = useState<WhatChangedWindow["window"]>("24h");
  const cur = windows.find((x) => x.window === w)!;
  return (
    <div data-testid="what-changed">
      <div className="flex gap-1" role="radiogroup" aria-label="What changed window">
        {windows.map((x) => (
          <button key={x.window} type="button" role="radio" aria-checked={w === x.window} onClick={() => setW(x.window)} data-testid={`changed-window-${x.window}`} className={cn("rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase", w === x.window ? "border-ink bg-ink text-bg" : "border-border text-ink-dim hover:text-ink")}>
            {x.window}
          </button>
        ))}
      </div>
      {cur.items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-dim" data-testid="changed-empty">
          No meaningful change in this period.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5" data-testid="changed-list">
          {cur.items.map((i, n) => (
            <li key={`${i.kind}-${n}`} className="text-[13px]" data-testid="changed-item">
              <span className="mr-2 rounded border border-border px-1 text-[10px] uppercase tracking-wide text-ink-faint">{i.kind}</span>
              {i.href ? (
                <Link href={i.href} className="text-ink hover:text-accent">
                  {i.title}
                </Link>
              ) : (
                <span className="text-ink">{i.title}</span>
              )}
              {i.detail && <span className="ml-2 text-[11px] text-ink-faint">{i.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The conflict map: the SAME WorldMap, timeline playback, territory and hazard hooks /world uses, filtered to this
 * conflict. Marker counts are the canonical per-event unique report counts. */
export function ConflictMap(props: { conflict: Conflict; focus: { lat: number; lng: number; zoom: number }; datasetIds: string[]; worldHref: string }) {
  const [show, setShow] = useState(false);
  return (
    <div data-testid="conflict-map">
      {!show ? (
        <div className="flex flex-wrap items-center gap-2">
          <Link href={props.worldHref} className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-accent hover:bg-white/5" data-testid="map-open-world">
            Open in World Map
          </Link>
          <button type="button" onClick={() => setShow(true)} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-dim hover:text-ink" data-testid="show-map">
            Show map
          </button>
        </div>
      ) : (
        <ConflictMapBody {...props} />
      )}
    </div>
  );
}

/** Mounted only once the map is requested: no event / territory / hazard polling before that. */
function ConflictMapBody({ conflict, focus, datasetIds, worldHref }: { conflict: Conflict; focus: { lat: number; lng: number; zoom: number }; datasetIds: string[]; worldHref: string }) {
  const router = useRouter();
  const [heat, setHeat] = useState(false);
  const [territorial, setTerritorial] = useState(datasetIds.length > 0);
  const [layers, setLayers] = useState<HazardLayer[]>([]);
  const [viewport, setViewport] = useState<HazardViewport | null>(null);
  const basemapMode = useAppStore((s) => s.mapBasemapMode);
  const timeline = useWorldTimeline();
  const live = useLiveEvents();
  const { events: historical } = useWorldEvents(timeline.asOf, timeline.previewNextAsOf);
  const events = useMemo(() => (timeline.isHistorical ? historical : live).filter((e) => e.conflictId === conflict.id), [timeline.isHistorical, historical, live, conflict.id]);
  const { featureCollection } = useTerritorialControl(timeline.asOf, timeline.previewNextAsOf, territorial ? datasetIds : []);
  const { data: hazards } = useHazards(layers, timeline.asOf, viewport);
  const nowIso = useMemo(() => (timeline.asOf ? timeline.asOf.toISOString() : new Date().toISOString()), [timeline.asOf, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const heatConflicts = useMemo(() => (heat && !timeline.isHistorical && conflict.locationKnown ? [conflict] : undefined), [heat, timeline.isHistorical, conflict]);
  const toggle = (l: HazardLayer) => setLayers((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  const href = (() => {
    const u = new URL(worldHref, "http://x");
    if (layers.length) u.searchParams.set("layers", layers.join(","));
    if (timeline.asOf) u.searchParams.set("at", timeline.asOf.toISOString());
    if (territorial && datasetIds.length) u.searchParams.set("territory", "1");
    return `${u.pathname}${u.search}`;
  })();
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={href} className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-accent hover:bg-white/5" data-testid="map-open-world">
          Open in World Map
        </Link>
      </div>
          <div className="mt-3 rounded-xl border border-border bg-surface/60 p-2.5">
            <TimelineControls
              preset={timeline.preset}
              asOf={timeline.asOf}
              rangeStart={timeline.rangeStart}
              rangeEnd={timeline.rangeEnd}
              isPlaying={timeline.isPlaying}
              speed={timeline.speed}
              onSelectPreset={timeline.selectPreset}
              onSelectCustom={timeline.selectCustomTimestamp}
              onReturnToLive={timeline.returnToLive}
              onPlay={timeline.play}
              onPause={timeline.pause}
              onStepForward={timeline.stepForward}
              onStepBackward={timeline.stepBackward}
              onSetSpeed={timeline.setSpeed}
              onScrubProgress={timeline.scrubToProgress}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="conflict-map-layers">
            <button type="button" onClick={() => setHeat((v) => !v)} aria-pressed={heat} className={cn("rounded-full border px-2.5 py-1 text-[11px]", heat ? "border-ink bg-ink text-bg" : "border-border text-ink-dim")}>
              Conflict heat
            </button>
            <button type="button" disabled={datasetIds.length === 0} onClick={() => setTerritorial((v) => !v)} aria-pressed={territorial} title={datasetIds.length === 0 ? "No verified territorial dataset available" : undefined} className={cn("rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-40", territorial ? "border-ink bg-ink text-bg" : "border-border text-ink-dim")} data-testid="map-territory-toggle">
              Territorial data
            </button>
            {HAZARD_LAYERS.map((l) => (
              <button key={l} type="button" onClick={() => toggle(l)} aria-pressed={layers.includes(l)} className={cn("rounded-full border px-2.5 py-1 text-[11px]", layers.includes(l) ? "border-ink bg-ink text-bg" : "border-border text-ink-dim")}>
                {HAZARD_LAYER_LABEL[l]}
              </button>
            ))}
          </div>
          <div className="mt-2 h-[360px] overflow-hidden rounded-xl border border-border sm:h-[460px]" aria-label={`Map of ${conflict.name}`}>
            <WorldMap
              events={events}
              conflicts={heatConflicts}
              nowIso={nowIso}
              live={!timeline.isHistorical}
              viewMode={heat ? "heatmap" : "markers"}
              basemapMode={basemapMode}
              onSelectEvent={(e) => router.push(`/event/${e.slug}`)}
              territorialFeatures={featureCollection}
              showTerritorial={territorial && datasetIds.length > 0}
              hazards={hazards}
              hazardLayers={layers}
              onSelectHazard={(id) => router.push(`/hazard/${id}`)}
              onViewportChange={setViewport}
              focus={focus}
              className="h-full w-full"
            />
          </div>
          {territorial && datasetIds.length > 0 && (
            <div className="mt-2 rounded-xl border border-border bg-surface/60 p-2.5">
              <TerritoryLegend featureCollection={featureCollection} />
            </div>
          )}
    </>
  );
}
