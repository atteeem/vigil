"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/hooks/use-app-store";
import { useHazards, type HazardViewport } from "@/hooks/use-hazards";
import { useLiveEvents } from "@/hooks/use-live-events";
import { usePublicOverview } from "@/hooks/use-public-overview";
import { useTerritorialControl } from "@/hooks/use-territorial-control";
import { useFollowState } from "@/hooks/use-watcher";
import { GlobeLoading } from "@/components/globe/globe-loading";
import { DevelopmentCard } from "@/components/brief/development-card";
import { RelativeTime } from "@/components/ui/relative-time";
import { selectHeatConflicts } from "@/lib/heat/public-inputs";
import { distanceKm } from "@/lib/utils/geo";
import { ruleSchemaFor, MODE_LABEL } from "@/lib/alerts/types";
import { HAZARD_LAYERS, HAZARD_LAYER_LABEL, type HazardLayer } from "@/lib/hazards/types";
import type { BriefDevelopment } from "@/lib/brief/types";
import { cn } from "@/lib/utils";

const WorldMap = dynamic(() => import("@/components/map/world-map").then((m) => m.WorldMap), { ssr: false, loading: () => <GlobeLoading /> });

/** Country map: the SAME WorldMap component and data hooks /world uses, framed on the country. Layers are
 * independent toggles; "Open in World Map" carries the layers, focus and country context across. */
export function CountryMap({ code, name, lat, lng, zoom, neighbourCodes }: { code: string; name: string; lat: number; lng: number; zoom: number; neighbourCodes: string[] }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [layers, setLayers] = useState<HazardLayer[]>([]);
  const [heat, setHeat] = useState(false);
  const [territorial, setTerritorial] = useState(true);
  const [viewport, setViewport] = useState<HazardViewport | null>(null);
  const basemapMode = useAppStore((s) => s.mapBasemapMode);
  const focus = useMemo(() => ({ lat, lng, zoom }), [lat, lng, zoom]);
  const events = useLiveEvents();
  const overview = usePublicOverview();
  const { featureCollection } = useTerritorialControl(null, null);
  const { data: hazards } = useHazards(show ? layers : [], null, viewport);

  // Nearby context, bounded: events in this country, its neighbours or within ~1,500 km of its centre.
  const nearbyEvents = useMemo(() => events.filter((e) => e.countryCode === code || neighbourCodes.includes(e.countryCode) || distanceKm({ lat, lng }, e) <= 1500).slice(0, 300), [events, code, neighbourCodes, lat, lng]);
  const heatConflicts = useMemo(() => (heat ? selectHeatConflicts(overview.data?.conflicts) : undefined), [heat, overview.data]);
  const nowIso = useMemo(() => new Date().toISOString(), [events]); // eslint-disable-line react-hooks/exhaustive-deps -- re-read the clock when new data arrives

  const worldHref = (() => {
    const p = new URLSearchParams();
    if (layers.length) p.set("layers", layers.join(","));
    p.set("focus", `${lat.toFixed(3)},${lng.toFixed(3)},${zoom}`);
    if (territorial) p.set("territory", "1");
    p.set("country", code);
    return `/world?${p.toString()}`;
  })();
  const toggle = (l: HazardLayer) => setLayers((prev) => (prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]));

  return (
    <div data-testid="country-map">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={worldHref} className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-medium text-accent hover:bg-white/5" data-testid="open-in-world">
          Open in World Map
        </Link>
        {!show && (
          <button type="button" onClick={() => setShow(true)} className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-ink-dim hover:text-ink" data-testid="show-country-map">
            Show map
          </button>
        )}
      </div>
      {show && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5" data-testid="country-map-layers">
            <button type="button" onClick={() => setHeat((v) => !v)} aria-pressed={heat} className={cn("rounded-full border px-2.5 py-1 text-[11px]", heat ? "border-ink bg-ink text-bg" : "border-border text-ink-dim")}>
              Conflict heat
            </button>
            <button type="button" onClick={() => setTerritorial((v) => !v)} aria-pressed={territorial} className={cn("rounded-full border px-2.5 py-1 text-[11px]", territorial ? "border-ink bg-ink text-bg" : "border-border text-ink-dim")}>
              Territorial control
            </button>
            {HAZARD_LAYERS.map((l) => (
              <button key={l} type="button" onClick={() => toggle(l)} aria-pressed={layers.includes(l)} className={cn("rounded-full border px-2.5 py-1 text-[11px]", layers.includes(l) ? "border-ink bg-ink text-bg" : "border-border text-ink-dim")}>
                {HAZARD_LAYER_LABEL[l]}
              </button>
            ))}
          </div>
          <div className="mt-3 h-[380px] overflow-hidden rounded-2xl border border-border sm:h-[460px]" aria-label={`Map of ${name}`}>
            <WorldMap
              events={nearbyEvents}
              conflicts={heatConflicts}
              nowIso={nowIso}
              live
              viewMode={heat ? "heatmap" : "markers"}
              basemapMode={basemapMode}
              onSelectEvent={(e) => router.push(`/event/${e.slug}`)}
              territorialFeatures={featureCollection}
              showTerritorial={territorial}
              hazards={hazards}
              hazardLayers={layers}
              onSelectHazard={(id) => router.push(`/hazard/${id}`)}
              onViewportChange={setViewport}
              focus={focus}
              className="h-full w-full"
            />
          </div>
        </>
      )}
    </div>
  );
}

/** Party / aligned claims: hidden by default (counted); shown separately and labelled when the Profile setting is on. */
export function PartyClaimsPanel({ independentReports, hidden, claims }: { independentReports: number; hidden: number; claims: BriefDevelopment[] }) {
  const show = useAppStore((s) => s.showPartyClaims);
  return (
    <div data-testid="party-claims-panel">
      <p className="text-sm text-ink-dim" data-testid="claims-summary">
        <span className="font-medium text-ink">{independentReports} independent report{independentReports === 1 ? "" : "s"}</span>
        {!show && hidden > 0 && <span data-testid="claims-hidden"> · {hidden} party claim{hidden === 1 ? "" : "s"} hidden</span>}
        {show && <span data-testid="claims-shown"> · {claims.length} party claim{claims.length === 1 ? "" : "s"} shown separately</span>}
      </p>
      {!show && hidden > 0 && <p className="mt-1 text-[11px] text-ink-faint">Party / aligned claims are hidden by default. Turn them on under Profile → Sources; they are always labelled and never counted as independent confirmation.</p>}
      {show && claims.length > 0 && (
        <div className="mt-3 space-y-2" data-testid="party-claims-list">
          {claims.map((d) => (
            <DevelopmentCard key={d.id} d={d} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Watch / alerts: the existing watch system (one Follow button, the same modes and rules). */
export function CountryWatchPanel({ code, name }: { code: string; name: string }) {
  const watch = useFollowState("country", code);
  const rules = ruleSchemaFor("country", code).filter((r) => r.key !== "includePartyClaims");
  return (
    <div data-testid="country-watch-panel">
      <p className="text-sm text-ink-dim">
        {watch ? (
          <>
            You follow {name} · <span data-testid="watch-mode">{MODE_LABEL[watch.mode]}</span>.{" "}
          </>
        ) : (
          <>Follow {name} to be alerted to material developments there. Default: “Major only”.</>
        )}{" "}
        <Link href="/watchlist" className="text-accent hover:underline">
          Manage on your Watchlist
        </Link>
      </p>
      <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">A country watch can monitor</p>
      <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-[12px] text-ink-dim sm:grid-cols-2" data-testid="watch-rules">
        {rules.map((r) => (
          <li key={r.key}>• {r.label}</li>
        ))}
      </ul>
    </div>
  );
}

/** Coloured freshness chip: every dataset carries its own clock; stale ones say so. */
export function FreshnessChip({ label, at, stale, keyName }: { label: string; at: string | null; stale: boolean; keyName: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]", stale ? "border-yellow-400/40 text-yellow-200" : "border-border text-ink-dim")} data-testid={`freshness-${keyName}`} data-stale={stale}>
      <span className={cn("h-1.5 w-1.5 rounded-full", stale ? "bg-yellow-300" : "bg-emerald-400")} aria-hidden />
      {label}: {at ? <RelativeTime iso={at} prefix={stale ? "stale — " : undefined} /> : <span>no data</span>}
    </span>
  );
}
