"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type GlobeType from "react-globe.gl";
import type { GlobeMethods } from "react-globe.gl";
import dynamic from "next/dynamic";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { SEVERITY_HEX } from "@/lib/utils/severity";
import { getLandFeatures } from "@/lib/globe/land-geo";
import { reportCountOf } from "@/lib/map/report-counts";
import { useHeatField } from "@/hooks/use-heat-field";
import { HeatLegend } from "@/components/heat/heat-legend";
import { clusterEvents, clusterRadiusForAltitude, formatClusterCount, type EventCluster } from "@/lib/globe/event-clusters";
import { ENERGY_ARCS, TRADE_ARCS, type GlobeArc } from "@/lib/globe/arcs";
import type { MapLayer, GlobeViewMode, GlobeLayerVisibility, ContentSensitivity } from "@/hooks/use-app-store";
import type { GlobePath, CountryLabel } from "@/lib/globe/country-borders";
import type { CityLabel } from "@/lib/globe/city-labels";
import { cityLabelTierForAltitude } from "@/lib/globe/city-labels";
import { LAND_FILL_COLOR, BORDER_COLOR } from "@/lib/globe/globe-colors";
import { GlobeLoading, GlobeUnavailable } from "./globe-loading";

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl2") || canvas.getContext("webgl"))
    );
  } catch {
    return false;
  }
}

const Globe = dynamic(() => import("react-globe.gl"), {
  ssr: false,
  loading: () => <GlobeLoading />,
}) as unknown as typeof GlobeType;

const AUTO_ROTATE_SPEED = 0.42;
const RESUME_DELAY_MS = 4000;

// Self-hosted (copied from our own three-globe dependency's bundled example
// assets — NASA "Blue Marble" imagery, public domain; not a Google Earth or
// other third-party product asset). See ARCHITECTURE.md.
//
// Mobile variants are the same source images downscaled 2x (4096x2048 →
// 2048x1024 color, 2048x1024 → 1024x512 bump) — a mobile GPU/connection
// doesn't benefit from the full-resolution version and it meaningfully
// cuts texture memory + initial fetch size (color: 1.46MB → 0.29MB).
const SATELLITE_IMAGE_URL = "/globe/earth-blue-marble.jpg";
const SATELLITE_BUMP_URL = "/globe/earth-topology.png";
const SATELLITE_IMAGE_URL_MOBILE = "/globe/earth-blue-marble-mobile.jpg";
const SATELLITE_BUMP_URL_MOBILE = "/globe/earth-topology-mobile.jpg";

// Module-level (not per-component-instance) guard: the homepage only ever
// mounts one globe, but this keeps a remount (e.g. fast refresh) from
// re-triggering the preload fetches — the browser's own HTTP cache would
// dedupe the network request either way, but this also skips the redundant
// Image() construction.
let satelliteTexturesPreloaded = false;

/** Warms the browser cache for the Satellite-mode texture pair matching
 * this device (mobile vs. desktop size) so switching to Satellite mode is
 * instant even the first time — called once, shortly after the homepage's
 * own first paint (never blocking it), regardless of which mode is
 * currently active. Deliberately fetches only the one size a mobile
 * device would ever render, not the heavier desktop pair too. */
function preloadSatelliteTextures(isMobile: boolean) {
  if (satelliteTexturesPreloaded || typeof window === "undefined") return;
  satelliteTexturesPreloaded = true;
  const sources = isMobile
    ? [SATELLITE_IMAGE_URL_MOBILE, SATELLITE_BUMP_URL_MOBILE]
    : [SATELLITE_IMAGE_URL, SATELLITE_BUMP_URL];
  sources.forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

type GlobeMarker =
  | { kind: "conflict"; lat: number; lng: number; conflict: Conflict; reports: number }
  | { kind: "cluster"; lat: number; lng: number; cluster: EventCluster };

// Country-name labels and city-name labels share three-globe's single
// labelsData layer (it exposes only one), tagged so one set of accessors
// can render each its own way — country names larger/brighter (they name
// a whole region), city names smaller/subtler point labels (spec "labels
// should remain subtle").
type GlobeLabel = ({ kind: "country" } & CountryLabel) | ({ kind: "city" } & CityLabel);

export interface ConflictGlobeProps {
  conflicts: Conflict[];
  events?: ConflictEvent[];
  selectedSlug?: string | null;
  onSelectConflict: (conflict: Conflict) => void;
  layer: MapLayer;
  viewMode: GlobeViewMode;
  globeLayers: GlobeLayerVisibility;
  contentSensitivity?: ContentSensitivity;
  className?: string;
}

export function ConflictGlobe({
  conflicts,
  events = [],
  selectedSlug,
  onSelectConflict,
  layer,
  viewMode,
  globeLayers,
  contentSensitivity = "standard",
  className,
}: ConflictGlobeProps) {
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [size, setSize] = useState({ width: 800, height: 800 });
  const [ready, setReady] = useState(false);
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [borderPaths, setBorderPaths] = useState<GlobePath[]>([]);
  const [countryLabels, setCountryLabels] = useState<CountryLabel[]>([]);
  const [cityLabels, setCityLabels] = useState<CityLabel[]>([]);
  const [cameraAltitude, setCameraAltitude] = useState(2.15);
  const heatMeshRef = useRef<{ material: { map: { needsUpdate: boolean; dispose: () => void }; dispose: () => void }; geometry: { dispose: () => void } } | null>(null);
  const heatCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // One-time client-only capability probe: must run after mount since
    // `detectWebGL` touches `document`, which does not exist during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebglOk(detectWebGL());
  }, []);
  const landFeatures = useMemo(() => getLandFeatures(), []);

  useEffect(() => {
    // Deferred, not blocking: the homepage's own first paint (globe
    // included) always finishes first, then the browser idles before
    // fetching Satellite's textures — regardless of which mode is active,
    // so switching to Satellite later never waits on a cold fetch.
    // preloadSatelliteTextures() is idempotent (module-level guard), so
    // there's nothing meaningful to cancel if this unmounts first.
    //
    // Reads window.innerWidth directly rather than closing over the
    // component's `isMobile` (derived from ResizeObserver-reported
    // `size`, which still holds its 800px default this early — this
    // effect fires before that observer's first callback, so the closure
    // would always see the pre-measurement default, not the real size).
    const preload = () => preloadSatelliteTextures(window.innerWidth < 640);
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(preload, { timeout: 3000 });
    } else {
      window.setTimeout(preload, 1200);
    }
  }, []);

  const isMobile = size.width < 640;

  // Continuous conflict-intensity surface. The SAME field the flat map paints
  // (hooks/use-heat-field), rasterized equirectangularly and wrapped on a
  // sphere just above the land fill (0.006) and below the borders (0.0065):
  // one texture on one sphere, so there are no cells or seams to see.
  // Only conflicts with a real location can be pinned; ended conflicts are not shown.
  const heatConflicts = useMemo(() => conflicts.filter((c) => c.locationKnown !== false && c.status !== "ended" && c.status !== "resolved"), [conflicts]);
  // Reference time = the real clock at the moment this data arrived (never a fixed date).
  const heatNowIso = useMemo(() => new Date().toISOString(), [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const heatField = useHeatField({ enabled: globeLayers.heat !== false, conflicts: heatConflicts, events, nowIso: heatNowIso, live: true });
  useEffect(() => {
    if (!ready || !globeRef.current || !heatField) return;
    let cancelled = false;
    Promise.all([import("three"), import("@/lib/heat/render")]).then(([THREE, render]) => {
      const globe = globeRef.current;
      if (cancelled || !globe) return;
      const canvas = render.renderHeatCanvas(heatField, { projection: "equirect", width: isMobile ? 1024 : 2048 }, heatCanvasRef.current ?? undefined);
      heatCanvasRef.current = canvas;
      const existing = heatMeshRef.current;
      if (existing) {
        existing.material.map.needsUpdate = true;
        return;
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(globe.getGlobeRadius() * 1.0062, 96, 96),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
      );
      // three-globe rotates its own group by -90deg about Y so longitude 0 faces +Z; match it.
      mesh.rotation.y = -Math.PI / 2;
      mesh.renderOrder = 1;
      mesh.name = "heat-surface";
      globe.scene().add(mesh);
      heatMeshRef.current = mesh;
    });
    return () => {
      cancelled = true;
    };
  }, [ready, heatField, isMobile]);
  // Remove the surface when the layer is switched off, the canvas size class
  // changes (mobile/desktop), or the globe unmounts.
  useEffect(() => {
    const dropMesh = () => {
      const mesh = heatMeshRef.current as unknown as { removeFromParent: () => void } & NonNullable<typeof heatMeshRef.current>;
      if (!mesh) return;
      mesh.removeFromParent();
      mesh.material.map.dispose();
      mesh.material.dispose();
      mesh.geometry.dispose();
      heatMeshRef.current = null;
      heatCanvasRef.current = null;
    };
    if (!heatField) dropMesh();
    return dropMesh;
    // isMobile: a different texture size needs a fresh texture.
  }, [heatField === null, isMobile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Political borders + country labels are real Natural Earth vector data
  // (~490KB), not needed unless the corresponding layer is switched on —
  // loaded lazily via dynamic import so Intel-mode-only sessions (and every
  // first paint) never pay for it. City labels (lib/globe/city-labels.ts)
  // are a tiny hand-curated dataset, but fetched the same lazy way for
  // consistency — both live behind the one "labels" toggle.
  useEffect(() => {
    if (!globeLayers.borders && !globeLayers.labels) return;
    let cancelled = false;
    import("@/lib/globe/country-borders").then((mod) => {
      if (cancelled) return;
      if (globeLayers.borders) setBorderPaths(mod.getCountryBorderPaths());
      if (globeLayers.labels) setCountryLabels(mod.getCountryLabels(isMobile ? 2 : 3));
    });
    if (globeLayers.labels) {
      import("@/lib/globe/city-labels").then((mod) => {
        if (cancelled) return;
        // Fetches the full curated list once; the altitude-driven tier
        // filter below (cityLabelsToRender) decides what's actually shown.
        setCityLabels(mod.getCityLabels(3));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [globeLayers.borders, globeLayers.labels, isMobile]);

  useEffect(() => {
    if (!ready || !globeRef.current) return;
    const controls = globeRef.current.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
    controls.enableZoom = true;
    controls.minDistance = 150;
    controls.maxDistance = 520;

    globeRef.current.pointOfView({ lat: 25, lng: 20, altitude: isMobile ? 2.6 : 2.15 }, 0);

    const pauseRotation = () => {
      controls.autoRotate = false;
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(() => {
        controls.autoRotate = true;
      }, RESUME_DELAY_MS);
    };

    const dom = globeRef.current.renderer().domElement;
    dom.addEventListener("pointerdown", pauseRotation);
    return () => {
      dom.removeEventListener("pointerdown", pauseRotation);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
    // Intentionally NOT re-run on viewMode/globeLayers changes — switching
    // Intel/Satellite or toggling a layer must never reset camera position.
    // (Neither is referenced inside this effect, so there is nothing for
    // exhaustive-deps to flag here — the comment is the actual guardrail.)
  }, [ready, isMobile]);

  useEffect(() => {
    if (!ready || !globeRef.current || !selectedSlug) return;
    const conflict = conflicts.find((c) => c.slug === selectedSlug);
    if (!conflict) return;
    globeRef.current.controls().autoRotate = false;
    globeRef.current.pointOfView({ lat: conflict.lat, lng: conflict.lng, altitude: 1.35 }, 900);
  }, [selectedSlug, conflicts, ready]);

  // Event-cluster grouping (spec "globe cluster counts") re-runs whenever
  // the camera's distance from the globe changes meaningfully, so a
  // region's markers merge into fewer, larger counts when zoomed out and
  // split apart again when zoomed in — a cheap polled read of the camera's
  // own altitude, not a per-frame subscription, since only the bucketed
  // (rounded) value ever needs to reach React state.
  useEffect(() => {
    if (!ready || !globeRef.current) return;
    const interval = setInterval(() => {
      const pov = globeRef.current?.pointOfView();
      if (!pov) return;
      const rounded = Math.round(pov.altitude * 10) / 10;
      setCameraAltitude((prev) => (prev === rounded ? prev : rounded));
    }, 300);
    return () => clearInterval(interval);
  }, [ready]);

  const arcs = layer === "energy" ? ENERGY_ARCS : layer === "trade" ? TRADE_ARCS : [];
  const isSatellite = viewMode === "satellite";

  const conflictHotspots = useMemo(
    () => (globeLayers.conflicts ? heatConflicts : []),
    [heatConflicts, globeLayers.conflicts],
  );
  const eventPoints = useMemo(() => {
    if (!globeLayers.events) return [];
    // Most-recent-first (mock data is generated pre-sorted); cap harder on
    // mobile to keep the point mesh cheap for "excellent mobile performance".
    return events.slice(0, isMobile ? 25 : 70);
  }, [events, globeLayers.events, isMobile]);
  // A conflict hotspot's number is the SUM of supporting reports across that
  // conflict's events (independent of the Events layer toggle and of any
  // territorial data), so the default globe's dots carry a report count too.
  const conflictReportCounts = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of events) {
      if (e.conflictId) totals.set(e.conflictId, (totals.get(e.conflictId) ?? 0) + reportCountOf(e));
    }
    return totals;
  }, [events]);
  const eventClusters = useMemo(
    () => clusterEvents(eventPoints, clusterRadiusForAltitude(cameraAltitude)),
    [eventPoints, cameraAltitude],
  );
  // Conflict hotspots and event clusters share one HTML-overlay layer
  // (three-globe only exposes a single htmlElementsData set) — tagged so
  // one htmlElement factory can render each its own way.
  const globeMarkers = useMemo<GlobeMarker[]>(
    () => [
      ...conflictHotspots.map((c): GlobeMarker => ({ kind: "conflict", lat: c.lat, lng: c.lng, conflict: c, reports: conflictReportCounts.get(c.id) ?? 0 })),
      ...eventClusters.map((c): GlobeMarker => ({ kind: "cluster", lat: c.lat, lng: c.lng, cluster: c })),
    ],
    [conflictHotspots, eventClusters, conflictReportCounts],
  );

  // City-label tier reveal (spec "world view: capitals + major global
  // cities only... reveal more cities as the user zooms in... hide or
  // reduce labels when zoomed too far out") reuses the same
  // altitude-polling state the event-cluster radius already depends on —
  // no second interval. Reduced by one tier on mobile (mirrors the
  // existing country-label maxLabelRank reduction) and in Satellite mode
  // (spec "satellite mode can use fewer/fainter labels if needed").
  const cityLabelsToRender = useMemo(() => {
    if (!globeLayers.labels) return [];
    let tier: number = cityLabelTierForAltitude(cameraAltitude);
    if (isMobile) tier -= 1;
    if (isSatellite) tier -= 1;
    return tier <= 0 ? [] : cityLabels.filter((c) => c.tier <= tier);
  }, [globeLayers.labels, cityLabels, cameraAltitude, isMobile, isSatellite]);

  const combinedLabels = useMemo<GlobeLabel[]>(() => {
    if (!globeLayers.labels) return [];
    return [
      ...countryLabels.map((c): GlobeLabel => ({ kind: "country", ...c })),
      ...cityLabelsToRender.map((c): GlobeLabel => ({ kind: "city", ...c })),
    ];
  }, [globeLayers.labels, countryLabels, cityLabelsToRender]);

  if (webglOk === false) {
    return (
      <div ref={containerRef} className={className}>
        <GlobeUnavailable />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className} aria-label="Interactive global conflict map" data-heat-signature={heatField?.signature} data-heat-peak={heatField ? Math.round(heatField.peak) : undefined}>
      {heatField && <HeatLegend className="absolute bottom-3 left-3 z-10" />}
      {webglOk === null ? (
        <GlobeLoading />
      ) : (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          showAtmosphere
          atmosphereColor="#4CC2FF"
          atmosphereAltitude={0.18}
          showGlobe
          onGlobeReady={() => setReady(true)}
          globeImageUrl={isSatellite ? (isMobile ? SATELLITE_IMAGE_URL_MOBILE : SATELLITE_IMAGE_URL) : null}
          bumpImageUrl={isSatellite ? (isMobile ? SATELLITE_BUMP_URL_MOBILE : SATELLITE_BUMP_URL) : null}
          // Continental landmass fill is Intel mode's own stylized
          // rendering; Satellite mode's photographic texture already shows
          // land, so the fill layer is switched off there (political
          // border lines below still render in both modes).
          polygonsData={isSatellite ? [] : landFeatures}
          polygonCapColor={() => LAND_FILL_COLOR}
          polygonSideColor={() => "rgba(20, 24, 30, 0.35)"}
          // No stroke on the fill: the fill's edge IS the coastline, and the
          // border layer below draws interior borders only (see
          // lib/globe/country-borders.ts) — so there is exactly one line
          // layer and no second coast outline.
          polygonStrokeColor={() => null}
          polygonAltitude={0.006}
          polygonsTransitionDuration={0}
          // Spec "normal globe borders": subtle country outlines on the
          // stylized Intel globe specifically — Satellite mode's
          // photographic imagery doesn't need line-art borders overlaid,
          // so they're suppressed there even if the Borders layer toggle
          // (Layers popover) is checked.
          pathsData={globeLayers.borders && !isSatellite ? borderPaths : []}
          pathPoints={(d: object) => (d as GlobePath).points}
          // One neutral color for every border (BORDER_COLOR) — nothing here
          // reads territorial-control, disputed or heat styling.
          pathColor={() => BORDER_COLOR}
          // Above the landmass fill (0.006) so borders actually render on
          // top of it instead of being occluded by it, but still well
          // below htmlElements/markers (0.012) and labels (~0.0105-0.011)
          // — spec "borders must render beneath heatmaps, conflict
          // layers, markers, and future territorial-control overlays".
          pathPointAlt={() => 0.0065}
          // Deliberately NOT setting pathStroke: a numeric stroke switches
          // three-globe to its "fat line" renderer (a Line2 + brand-new
          // LineMaterial + LineGeometry per path, instanced-geometry-backed
          // and considerably more expensive to construct/dispose per path
          // than a plain THREE.Line). At globe scale a 1px line reads fine
          // for a country-outline overlay, and this is what actually kept
          // the Borders toggle cheap — mesh/point-count reduction alone
          // did not (measured). Dashing (above) works fine on this cheap
          // renderer too — it's a shader uniform, not a fat-line feature.
          // Border points are full-resolution Natural Earth 110m vertices
          // (~1° apart), so interpolation is only a safety net for the long
          // straight segments (e.g. 49th parallel) that must still follow
          // the sphere.
          pathResolution={2}
          pathTransitionDuration={0}
          labelsData={combinedLabels}
          labelLat={(d: object) => (d as GlobeLabel).lat}
          labelLng={(d: object) => (d as GlobeLabel).lng}
          labelText={(d: object) => (d as GlobeLabel).name}
          // Country names read as a large, brighter label spanning a
          // region; city names are smaller point labels, subtler still at
          // deeper tiers (2/3) so the busiest, closest-zoom tier doesn't
          // compete visually with tier-1 capitals — spec "labels should
          // remain subtle".
          labelSize={(d: object) => {
            const l = d as GlobeLabel;
            if (l.kind === "country") return 0.55;
            return l.tier === 1 ? 0.38 : l.tier === 2 ? 0.32 : 0.27;
          }}
          labelColor={(d: object) =>
            (d as GlobeLabel).kind === "country" ? "rgba(243,245,247,0.8)" : "rgba(226,232,240,0.72)"
          }
          labelDotRadius={(d: object) => ((d as GlobeLabel).kind === "country" ? 0.25 : 0.16)}
          // Below htmlElements/markers (0.012), and both label kinds sit
          // above the landmass/border layers so text never renders
          // underneath the fill — city labels a hair below country labels
          // so a same-spot country name always wins the z-fight.
          labelAltitude={(d: object) => ((d as GlobeLabel).kind === "country" ? 0.011 : 0.0105)}
          labelResolution={2}
          labelsTransitionDuration={0}
          htmlElementsData={globeMarkers}
          htmlLat={(d: object) => (d as GlobeMarker).lat}
          htmlLng={(d: object) => (d as GlobeMarker).lng}
          htmlAltitude={0.012}
          htmlElement={(d: object) => {
            const marker = d as GlobeMarker;
            return marker.kind === "conflict"
              ? makeHotspotEl(marker.conflict, marker.reports, onSelectConflict, layer, contentSensitivity)
              : makeClusterEl(marker.cluster, layer);
          }}
          arcsData={arcs}
          arcColor={(d: object) => (d as GlobeArc).color}
          arcDashLength={0.4}
          arcDashGap={0.6}
          arcDashAnimateTime={4000}
          arcStroke={0.5}
          arcAltitude={0.22}
        />
      )}
    </div>
  );
}

function makeHotspotEl(
  conflict: Conflict,
  reports: number,
  onSelect: (c: Conflict) => void,
  layer: MapLayer,
  contentSensitivity: ContentSensitivity,
): HTMLElement {
  const wrapper = document.createElement("button");
  wrapper.type = "button";
  wrapper.setAttribute(
    "aria-label",
    `${conflict.shortName}, severity ${conflict.severity}, intensity ${conflict.intensity} of 100${reports > 0 ? `, ${reports} supporting reports` : ""}`,
  );
  wrapper.setAttribute("data-testid", "globe-conflict-marker");
  wrapper.setAttribute("data-report-count", String(reports));
  wrapper.style.pointerEvents = "auto";
  wrapper.style.cursor = "pointer";
  wrapper.style.border = "none";
  wrapper.style.background = "transparent";
  wrapper.style.padding = "10px";
  wrapper.style.transform = "translate(-50%, -50%)";

  const dimmed = layer === "energy" || layer === "trade";
  const color = SEVERITY_HEX[conflict.severity];
  // Never smaller than a dot that can hold its report-count label.
  const scale = Math.max(0.55 + conflict.intensity / 130, 0.95);
  const shouldPulse =
    contentSensitivity === "standard" &&
    (conflict.severity === "severe" || conflict.severity === "extreme");

  wrapper.innerHTML = `
    <span style="position:relative;display:flex;align-items:center;justify-content:center;width:${18 * scale}px;height:${18 * scale}px;opacity:${dimmed ? 0.35 : 1};">
      ${
        shouldPulse
          ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${color};opacity:0.35;animation:pulse-soft 2.4s ease-in-out infinite;"></span>`
          : ""
      }
      <span style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:9999px;background:${color};box-shadow:0 0 0 2px rgba(8,10,13,0.8);">
        ${reports > 0 ? `<span style="font:700 ${formatClusterCount(reports).length > 2 ? 8 : 10}px system-ui, sans-serif;color:#F3F5F7;text-shadow:0 1px 2px rgba(8,10,13,0.9);">${formatClusterCount(reports)}</span>` : ""}
      </span>
    </span>
  `;

  wrapper.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(conflict);
  });

  return wrapper;
}

/** Every marker shows its supporting REPORT count (the sum across the events
 * grouped into it), capped at "99+" for display only — a lone event with 18
 * reports reads "18", a cluster of three events with 1 + 3 + 18 reports
 * reads "22". Color is the cluster's worst severity (see EventCluster's own
 * comment for why max, not an average or the count itself). */
function makeClusterEl(cluster: EventCluster, layer: MapLayer): HTMLElement {
  const wrapper = document.createElement("div");
  const reports = cluster.reportCount;
  const label = formatClusterCount(reports);
  wrapper.setAttribute("data-testid", "globe-marker");
  wrapper.setAttribute("data-report-count", String(reports));
  wrapper.setAttribute(
    "aria-label",
    `${reports} ${reports === 1 ? "report" : "reports"}${cluster.count > 1 ? ` across ${cluster.count} events` : ""}, worst severity ${cluster.severity}`,
  );
  wrapper.style.pointerEvents = "none";
  wrapper.style.transform = "translate(-50%, -50%)";

  const dimmed = layer === "energy" || layer === "trade";
  const color = SEVERITY_HEX[cluster.severity];
  // Big enough to hold the label; grows a little with the number of events
  // grouped but caps out — a cluster of hundreds shouldn't dwarf the globe.
  const size = Math.max(16 + (label.length - 1) * 4, 16 + Math.min(cluster.count - 1, 20) * 0.6);

  wrapper.innerHTML = `
    <span style="position:relative;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;opacity:${dimmed ? 0.35 : 1};">
      <span style="position:absolute;inset:0;border-radius:9999px;background:${color};box-shadow:0 0 0 2px rgba(8,10,13,0.8);"></span>
      <span style="position:relative;font:700 ${label.length > 2 ? 8 : 10}px system-ui, sans-serif;color:#F3F5F7;text-shadow:0 1px 2px rgba(8,10,13,0.9);">${label}</span>
    </span>
  `;

  return wrapper;
}
