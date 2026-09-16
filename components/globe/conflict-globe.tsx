"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type GlobeType from "react-globe.gl";
import type { GlobeMethods } from "react-globe.gl";
import dynamic from "next/dynamic";
import type { Conflict, ConflictEvent } from "@/lib/types";
import { SEVERITY_HEX } from "@/lib/utils/severity";
import { getLandFeatures } from "@/lib/globe/land-geo";
import { ENERGY_ARCS, TRADE_ARCS, type GlobeArc } from "@/lib/globe/arcs";
import type { MapLayer, GlobeViewMode, GlobeLayerVisibility, ContentSensitivity } from "@/hooks/use-app-store";
import type { GlobePath, CountryLabel } from "@/lib/globe/country-borders";
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
const SATELLITE_IMAGE_URL = "/globe/earth-blue-marble.jpg";
const SATELLITE_BUMP_URL = "/globe/earth-topology.png";

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

  useEffect(() => {
    // One-time client-only capability probe: must run after mount since
    // `detectWebGL` touches `document`, which does not exist during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWebglOk(detectWebGL());
  }, []);
  const landFeatures = useMemo(() => getLandFeatures(), []);

  const isMobile = size.width < 640;

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
  // first paint) never pay for it.
  useEffect(() => {
    if (!globeLayers.borders && !globeLayers.labels) return;
    let cancelled = false;
    import("@/lib/globe/country-borders").then((mod) => {
      if (cancelled) return;
      if (globeLayers.borders) setBorderPaths(mod.getCountryBorderPaths());
      if (globeLayers.labels) setCountryLabels(mod.getCountryLabels(isMobile ? 2 : 3));
    });
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

  const arcs = layer === "energy" ? ENERGY_ARCS : layer === "trade" ? TRADE_ARCS : [];
  const isSatellite = viewMode === "satellite";

  const conflictHotspots = globeLayers.conflicts ? conflicts : [];
  const eventPoints = useMemo(() => {
    if (!globeLayers.events) return [];
    // Most-recent-first (mock data is generated pre-sorted); cap harder on
    // mobile to keep the point mesh cheap for "excellent mobile performance".
    return events.slice(0, isMobile ? 25 : 70);
  }, [events, globeLayers.events, isMobile]);

  if (webglOk === false) {
    return (
      <div ref={containerRef} className={className}>
        <GlobeUnavailable />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={className} aria-label="Interactive global conflict map">
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
          globeImageUrl={isSatellite ? SATELLITE_IMAGE_URL : null}
          bumpImageUrl={isSatellite ? SATELLITE_BUMP_URL : null}
          // Continental landmass fill is Intel mode's own stylized
          // rendering; Satellite mode's photographic texture already shows
          // land, so the fill layer is switched off there (political
          // border lines below still render in both modes).
          polygonsData={isSatellite ? [] : landFeatures}
          polygonCapColor={() => "rgba(141, 150, 165, 0.4)"}
          polygonSideColor={() => "rgba(20, 24, 30, 0.35)"}
          polygonStrokeColor={() => "rgba(76, 194, 255, 0.28)"}
          polygonAltitude={0.006}
          polygonsTransitionDuration={0}
          pathsData={globeLayers.borders ? borderPaths : []}
          pathPoints={(d: object) => (d as GlobePath).points}
          pathColor={() => (isSatellite ? "rgba(255,255,255,0.4)" : "rgba(76,194,255,0.4)")}
          // Deliberately NOT setting pathStroke: a numeric stroke switches
          // three-globe to its "fat line" renderer (a Line2 + brand-new
          // LineMaterial + LineGeometry per path, instanced-geometry-backed
          // and considerably more expensive to construct/dispose per path
          // than a plain THREE.Line). At globe scale a 1px line reads fine
          // for a country-outline overlay, and this is what actually kept
          // the Borders toggle cheap — mesh/point-count reduction alone
          // did not (measured).
          // Higher = less great-circle interpolation between our already
          // (deliberately coarse) border points — keeps the toggle cheap.
          pathResolution={6}
          pathTransitionDuration={0}
          labelsData={globeLayers.labels ? countryLabels : []}
          labelLat={(d: object) => (d as CountryLabel).lat}
          labelLng={(d: object) => (d as CountryLabel).lng}
          labelText={(d: object) => (d as CountryLabel).name}
          labelSize={0.55}
          labelColor={() => "rgba(243,245,247,0.8)"}
          labelDotRadius={0.25}
          labelAltitude={0.011}
          labelResolution={2}
          labelsTransitionDuration={0}
          pointsData={eventPoints}
          pointLat={(d: object) => (d as ConflictEvent).lat}
          pointLng={(d: object) => (d as ConflictEvent).lng}
          pointColor={(d: object) => SEVERITY_HEX[(d as ConflictEvent).severity]}
          pointAltitude={0.006}
          pointRadius={0.22}
          pointResolution={6}
          pointsMerge
          htmlElementsData={conflictHotspots}
          htmlLat={(d: object) => (d as Conflict).lat}
          htmlLng={(d: object) => (d as Conflict).lng}
          htmlAltitude={0.012}
          htmlElement={(d: object) =>
            makeHotspotEl(d as Conflict, onSelectConflict, layer, contentSensitivity)
          }
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
  onSelect: (c: Conflict) => void,
  layer: MapLayer,
  contentSensitivity: ContentSensitivity,
): HTMLElement {
  const wrapper = document.createElement("button");
  wrapper.type = "button";
  wrapper.setAttribute(
    "aria-label",
    `${conflict.shortName}, severity ${conflict.severity}, intensity ${conflict.intensity} of 100`,
  );
  wrapper.style.pointerEvents = "auto";
  wrapper.style.cursor = "pointer";
  wrapper.style.border = "none";
  wrapper.style.background = "transparent";
  wrapper.style.padding = "10px";
  wrapper.style.transform = "translate(-50%, -50%)";

  const dimmed = layer === "energy" || layer === "trade";
  const color = SEVERITY_HEX[conflict.severity];
  const scale = 0.55 + conflict.intensity / 130;
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
      <span style="position:relative;display:block;width:100%;height:100%;border-radius:9999px;background:${color};box-shadow:0 0 0 2px rgba(8,10,13,0.8);"></span>
    </span>
  `;

  wrapper.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(conflict);
  });

  return wrapper;
}
