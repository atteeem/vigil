"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Map as MapLibreMap, config as maplibreConfig, type GeoJSONSource, type MapMouseEvent } from "maplibre-gl";
import { Eraser, MousePointer2, PenTool, Trash2, Undo2, Redo2, Check, X, Minus, Scissors, Combine, Magnet, Spline } from "lucide-react";
import { getMapStyle, getMapTilerKey } from "@/lib/map/style";
import { createContestedPatternImageData } from "@/lib/map/territorial-pattern";
import {
  bboxOf,
  edgeMidpoint,
  fromPolygons,
  insertVertex,
  moveVertex,
  polygonFromPoints,
  polygonsOf,
  removePolygon,
  removeVertex,
  validateTerritorialGeometry,
  type Position,
  type PolygonRings,
  type VertexRef,
} from "@/lib/territory/geometry";
import { canRedo, canUndo, createHistory, cutHole, mergePolygons, pushHistory, redo, simplifyPolygons, snapPoint, undo, type History } from "@/lib/territory/edit-tools";
import type { AssignableTerritorialStatus, TerritorialGeometry } from "@/lib/types/territorial-control";
import { cn } from "@/lib/utils";

if (typeof window !== "undefined") {
  maplibreConfig.WORKER_URL = "/maplibre-gl-worker.mjs";
}

// Visual territory editor: draw Polygon / MultiPolygon, select, move / add /
// remove vertices, delete geometry — on a MapLibre map, with the current
// territory and old-vs-proposed previews drawn underneath. The geometry
// operations themselves are the pure functions in lib/territory/geometry.ts;
// this component is only the interaction layer. The admin never has to write
// GeoJSON for normal use, and nothing here ever derives geometry from text.

export interface EditorOverlay {
  geometry: TerritorialGeometry;
  color: string;
  status: string;
  /** "old": the territory as it is now; "remainder": stays with the old controller; "affected": goes to the new one. */
  kind: "old" | "remainder" | "affected";
}

interface Props {
  value: TerritorialGeometry | null;
  onChange: (geometry: TerritorialGeometry | null) => void;
  /** Actor color and status of the geometry being drawn. */
  color: string;
  status: AssignableTerritorialStatus;
  /** Context drawn beneath the draft (current territory, split preview). */
  overlays?: EditorOverlay[];
  /** Change to re-fit the camera to the value / overlays. */
  fitKey?: string;
  /** Centre here when there is nothing to fit (e.g. a candidate's reported place). */
  focus?: { lng: number; lat: number } | null;
  className?: string;
}

const FILL_OPACITY: Record<string, number> = { controlled: 0.35, contested: 0.22, uncertain: 0.12 };
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const CLOSE_PX = 12;
const SNAP_PX = 10;
/** Simplify strength in degrees (~55 m / ~220 m / ~1.1 km). */
const SIMPLIFY_LEVELS = { light: 0.0005, medium: 0.002, strong: 0.01 } as const;

const same = (a: TerritorialGeometry | null, b: TerritorialGeometry | null) => JSON.stringify(a) === JSON.stringify(b);

function polysFrom(geometry: TerritorialGeometry | null): PolygonRings[] {
  return geometry ? polygonsOf(geometry).map((p) => p.map((r) => r.map((pt) => [pt[0], pt[1]] as Position))) : [];
}

export function TerritoryEditorMap({ value, onChange, color, status, overlays = [], fitKey, focus, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);

  const [polys, setPolys] = useState<PolygonRings[]>(() => polysFrom(value));
  const [mode, setMode] = useState<"select" | "draw" | "hole">("select");
  const [snap, setSnap] = useState(true);
  const [level, setLevel] = useState<keyof typeof SIMPLIFY_LEVELS>("light");
  const [notice, setNotice] = useState<string | null>(null);
  const [hist, setHist] = useState({ undo: false, redo: false });
  const [drawPoints, setDrawPoints] = useState<Position[]>([]);
  const [selected, setSelected] = useState<VertexRef | null>(null);
  const [selectedPolygon, setSelectedPolygon] = useState<number | null>(null);

  // Refs mirror state for the long-lived map handlers registered once.
  const polysRef = useRef(polys);
  const modeRef = useRef(mode);
  const drawRef = useRef(drawPoints);
  const selectedRef = useRef(selected);
  const draggingRef = useRef<VertexRef | null>(null);
  const movedRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const cursorRef = useRef<Position | null>(null);
  const historyRef = useRef<History<PolygonRings[]>>(createHistory(polys));
  const snapRef = useRef(snap);
  const overlaysRef = useRef<PolygonRings[]>([]);
  const selectedPolygonRef = useRef<number | null>(null);
  // polysRef is written only where polys changes (commit / external value /
  // live drag), never from render, so a parent re-render can't reset a drag.
  useLayoutEffect(() => {
    modeRef.current = mode;
    drawRef.current = drawPoints;
    selectedRef.current = selected;
    onChangeRef.current = onChange;
    snapRef.current = snap;
    selectedPolygonRef.current = selectedPolygon;
    overlaysRef.current = overlays.flatMap((o) => polygonsOf(o.geometry) as PolygonRings[]);
  });

  const syncHistory = useCallback(() => setHist({ undo: canUndo(historyRef.current), redo: canRedo(historyRef.current) }), []);

  const commit = useCallback((next: PolygonRings[]) => {
    polysRef.current = next;
    setPolys(next);
    historyRef.current = pushHistory(historyRef.current, next);
    syncHistory();
    onChangeRef.current(fromPolygons(next));
  }, [syncHistory]);

  /** Applies a state taken from the edit history (undo / redo) without recording a new step. */
  const applyHistory = useCallback((h: History<PolygonRings[]>) => {
    historyRef.current = h;
    polysRef.current = h.present;
    setPolys(h.present);
    setSelected(null);
    setSelectedPolygon(null);
    syncHistory();
    onChangeRef.current(fromPolygons(h.present));
  }, [syncHistory]);

  /** Snap a map position to existing vertices/edges (this draft and the context overlays) within a few pixels. */
  const snapped = useCallback((map: MapLibreMap, at: Position, skip?: (polygon: number, ring: number, vertex: number) => boolean): Position => {
    if (!snapRef.current) return at;
    const a = map.unproject([0, 0]);
    const b = map.unproject([SNAP_PX, 0]);
    const tolerance = Math.abs(b.lng - a.lng);
    const draft = snapPoint(at, polysRef.current, tolerance, skip);
    if (draft.kind) return draft.point;
    return snapPoint(at, overlaysRef.current, tolerance).point;
  }, []);

  // ---- render editor state into the map sources -----------------------------
  const paint = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("ed-draft")) return;
    const current = polysRef.current;
    const drawing = modeRef.current !== "select";
    const sel = selectedRef.current;

    const draft: GeoJSON.Feature[] = current.map((rings, p) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: rings },
      properties: { p },
    }));
    (map.getSource("ed-draft") as GeoJSONSource).setData({ type: "FeatureCollection", features: draft });

    const verts: GeoJSON.Feature[] = [];
    const mids: GeoJSON.Feature[] = [];
    if (!drawing) {
      current.forEach((rings, p) =>
        rings.forEach((ring, r) => {
          for (let v = 0; v < ring.length - 1; v++) {
            const isSel = sel?.polygon === p && sel.ring === r && sel.vertex === v ? 1 : 0;
            verts.push({ type: "Feature", geometry: { type: "Point", coordinates: ring[v]! }, properties: { p, r, v, sel: isSel } });
            mids.push({ type: "Feature", geometry: { type: "Point", coordinates: edgeMidpoint(ring, v) }, properties: { p, r, v } });
          }
        }),
      );
    }
    (map.getSource("ed-verts") as GeoJSONSource).setData({ type: "FeatureCollection", features: verts });
    (map.getSource("ed-mids") as GeoJSONSource).setData({ type: "FeatureCollection", features: mids });

    const pts = drawRef.current;
    const drawFeatures: GeoJSON.Feature[] = pts.map((c, i) => ({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: { first: i === 0 ? 1 : 0 } }));
    const lineCoords = cursorRef.current && pts.length > 0 ? [...pts, cursorRef.current] : pts;
    if (lineCoords.length > 1) drawFeatures.push({ type: "Feature", geometry: { type: "LineString", coordinates: lineCoords }, properties: {} });
    (map.getSource("ed-drawing") as GeoJSONSource).setData({ type: "FeatureCollection", features: drawFeatures });
  }, []);

  useEffect(() => {
    paint();
  }, [polys, mode, drawPoints, selected, paint, ready]);

  // ---- map setup (once) -----------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: getMapStyle("intel", getMapTilerKey()),
      center: [20, 25],
      zoom: 1.5,
      attributionControl: { compact: true },
      doubleClickZoom: false,
    });
    mapRef.current = map;
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __vigilEditorMap?: MapLibreMap }).__vigilEditorMap = map;
    }

    map.on("style.load", () => {
      if (map.getSource("ed-draft")) return;
      if (!map.hasImage("ed-hatch")) map.addImage("ed-hatch", createContestedPatternImageData());
      map.addSource("ed-overlay", { type: "geojson", data: EMPTY });
      map.addSource("ed-draft", { type: "geojson", data: EMPTY });
      map.addSource("ed-verts", { type: "geojson", data: EMPTY });
      map.addSource("ed-mids", { type: "geojson", data: EMPTY });
      map.addSource("ed-drawing", { type: "geojson", data: EMPTY });

      // Context: the territory as it is now / split preview halves.
      map.addLayer({ id: "ed-overlay-fill", type: "fill", source: "ed-overlay", paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", ["get", "opacity"], ["match", ["get", "kind"], "old", 0.6, 1]] } });
      map.addLayer({
        id: "ed-overlay-hatch",
        type: "fill",
        source: "ed-overlay",
        filter: ["==", ["get", "status"], "contested"],
        paint: { "fill-pattern": "ed-hatch", "fill-opacity": 0.5 },
      });
      map.addLayer({
        id: "ed-overlay-line",
        type: "line",
        source: "ed-overlay",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["match", ["get", "kind"], "old", 1.5, 2],
          "line-dasharray": ["match", ["get", "kind"], "old", ["literal", [2, 2]], ["literal", [1, 0]]],
          "line-opacity": 0.9,
        },
      });

      // The draft being drawn / edited.
      map.addLayer({ id: "ed-fill", type: "fill", source: "ed-draft", paint: { "fill-color": color, "fill-opacity": FILL_OPACITY[status] ?? 0.3 } });
      map.addLayer({ id: "ed-hatch", type: "fill", source: "ed-draft", layout: { visibility: status === "contested" ? "visible" : "none" }, paint: { "fill-pattern": "ed-hatch", "fill-opacity": 0.6 } });
      map.addLayer({ id: "ed-line", type: "line", source: "ed-draft", paint: { "line-color": color, "line-width": 2.5 } });
      map.addLayer({
        id: "ed-line-dashed",
        type: "line",
        source: "ed-draft",
        layout: { visibility: status === "controlled" ? "none" : "visible" },
        paint: { "line-color": "#f3f5f7", "line-width": 1.5, "line-opacity": 0.75, "line-dasharray": status === "uncertain" ? [1, 2] : [3, 2] },
      });
      map.addLayer({ id: "ed-mids", type: "circle", source: "ed-mids", paint: { "circle-radius": 4, "circle-color": "#0E1116", "circle-stroke-color": "#f3f5f7", "circle-stroke-width": 1, "circle-opacity": 0.85 } });
      map.addLayer({
        id: "ed-verts",
        type: "circle",
        source: "ed-verts",
        paint: {
          "circle-radius": ["case", ["==", ["get", "sel"], 1], 8, 6],
          "circle-color": ["case", ["==", ["get", "sel"], 1], "#ffd60a", "#f3f5f7"],
          "circle-stroke-color": "#0E1116",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({ id: "ed-drawing-line", type: "line", source: "ed-drawing", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#ffd60a", "line-width": 2, "line-dasharray": [2, 1.5] } });
      map.addLayer({
        id: "ed-drawing-pts",
        type: "circle",
        source: "ed-drawing",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": ["case", ["==", ["get", "first"], 1], 8, 5], "circle-color": ["case", ["==", ["get", "first"], 1], "#06d6a0", "#ffd60a"], "circle-stroke-color": "#0E1116", "circle-stroke-width": 2 },
      });
      setReady(true);
    });

    // -- drawing / selecting -------------------------------------------------
    const finishDraw = () => {
      let pts = drawRef.current;
      // A double-click registers two clicks first; drop the duplicate.
      if (pts.length >= 2) {
        const [a, b] = [pts[pts.length - 1]!, pts[pts.length - 2]!];
        if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts = pts.slice(0, -1);
      }
      const polygon = polygonFromPoints(pts);
      if (!polygon) return;
      if (modeRef.current === "hole") {
        const target = selectedPolygonRef.current ?? (polysRef.current.length === 1 ? 0 : null);
        const cut = target === null ? null : cutHole(polysRef.current, target, polygon[0]!);
        setDrawPoints([]);
        cursorRef.current = null;
        setMode("select");
        if (!cut) {
          setNotice(target === null ? "Select a polygon first, then cut a hole in it." : "That ring does not overlap the selected polygon (or is not a valid ring): nothing was cut.");
          return;
        }
        setNotice(null);
        setSelected(null);
        commit(cut);
        return;
      }
      const next = [...polysRef.current, polygon];
      setDrawPoints([]);
      cursorRef.current = null;
      setMode("select");
      setSelectedPolygon(next.length - 1);
      setSelected(null);
      commit(next);
    };
    (map as unknown as { __finishDraw: () => void }).__finishDraw = finishDraw;

    map.on("click", (e: MapMouseEvent) => {
      if (movedRef.current) {
        movedRef.current = false;
        return;
      }
      const handles = map.queryRenderedFeatures(e.point, { layers: ["ed-verts", "ed-mids"].filter((l) => map.getLayer(l)) });
      if (handles.length > 0) return; // handled by the layer-specific handlers below
      const at: Position = snapped(map, [e.lngLat.lng, e.lngLat.lat]);

      if (modeRef.current !== "select") {
        const pts = drawRef.current;
        if (pts.length >= 3) {
          const first = map.project(pts[0]!);
          if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= CLOSE_PX) {
            finishDraw();
            return;
          }
        }
        setDrawPoints([...pts, at]);
        return;
      }
      // Select mode: pick a polygon, or clear the selection.
      const hit = map.getLayer("ed-fill") ? map.queryRenderedFeatures(e.point, { layers: ["ed-fill"] }) : [];
      setSelected(null);
      setSelectedPolygon(hit.length > 0 ? Number(hit[0]!.properties?.p) : null);
    });

    map.on("dblclick", (e: MapMouseEvent) => {
      if (modeRef.current !== "select" && drawRef.current.length >= 3) {
        e.preventDefault();
        finishDraw();
      }
    });

    map.on("mousemove", (e: MapMouseEvent) => {
      const drag = draggingRef.current;
      if (drag) {
        movedRef.current = true;
        const ring = polysRef.current[drag.polygon]?.[drag.ring];
        const last = (ring?.length ?? 1) - 1;
        // Do not snap a vertex to itself or to the two edges that meet at it.
        const skip = (pi: number, ri: number, vi: number) => pi === drag.polygon && ri === drag.ring && (vi === drag.vertex || vi === drag.vertex - 1 || (drag.vertex === 0 && vi === last - 1) || (drag.vertex === last && vi === 0));
        polysRef.current = moveVertex(polysRef.current, drag, snapped(map, [e.lngLat.lng, e.lngLat.lat], skip));
        paint();
        return;
      }
      if (modeRef.current !== "select") {
        cursorRef.current = snapped(map, [e.lngLat.lng, e.lngLat.lat]);
        paint();
      }
    });

    // -- vertex drag / select / remove, midpoint insert ------------------------
    map.on("mousedown", "ed-verts", (e) => {
      if (modeRef.current !== "select" || !e.features?.[0]) return;
      const f = e.features[0].properties as { p: number; r: number; v: number };
      e.preventDefault();
      draggingRef.current = { polygon: Number(f.p), ring: Number(f.r), vertex: Number(f.v) };
      movedRef.current = false;
      map.dragPan.disable();
    });
    const endDrag = () => {
      const drag = draggingRef.current;
      if (!drag) return;
      draggingRef.current = null;
      map.dragPan.enable();
      setSelected(drag);
      setSelectedPolygon(drag.polygon);
      if (movedRef.current) commit(polysRef.current);
      // movedRef is cleared by the click that follows a drag.
    };
    map.on("mouseup", endDrag);
    map.on("click", "ed-verts", (e) => {
      if (!e.features?.[0]) return;
      const f = e.features[0].properties as { p: number; r: number; v: number };
      setSelected({ polygon: Number(f.p), ring: Number(f.r), vertex: Number(f.v) });
      setSelectedPolygon(Number(f.p));
    });
    map.on("dblclick", "ed-verts", (e) => {
      if (!e.features?.[0]) return;
      e.preventDefault();
      const f = e.features[0].properties as { p: number; r: number; v: number };
      const next = removeVertex(polysRef.current, { polygon: Number(f.p), ring: Number(f.r), vertex: Number(f.v) });
      if (next !== polysRef.current) {
        setSelected(null);
        commit(next);
      }
    });
    map.on("click", "ed-mids", (e) => {
      if (!e.features?.[0]) return;
      const f = e.features[0].properties as { p: number; r: number; v: number };
      const ref = { polygon: Number(f.p), ring: Number(f.r), vertex: Number(f.v) };
      const geometry = e.features[0].geometry as GeoJSON.Point;
      commit(insertVertex(polysRef.current, ref, geometry.coordinates as Position));
      setSelected({ ...ref, vertex: ref.vertex + 1 });
      setSelectedPolygon(ref.polygon);
    });
    for (const layer of ["ed-verts", "ed-mids"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    return () => {
      map.remove();
      mapRef.current = null;
      if (process.env.NODE_ENV !== "production") delete (window as unknown as { __vigilEditorMap?: MapLibreMap }).__vigilEditorMap;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- map handlers are registered once and read live state through refs.
  }, []);

  // ---- keep the draft styling in step with the chosen actor/status ------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setPaintProperty("ed-fill", "fill-color", color);
    map.setPaintProperty("ed-fill", "fill-opacity", FILL_OPACITY[status] ?? 0.3);
    map.setPaintProperty("ed-line", "line-color", color);
    map.setLayoutProperty("ed-hatch", "visibility", status === "contested" ? "visible" : "none");
    map.setLayoutProperty("ed-line-dashed", "visibility", status === "controlled" ? "none" : "visible");
    map.setPaintProperty("ed-line-dashed", "line-dasharray", status === "uncertain" ? [1, 2] : [3, 2]);
  }, [color, status, ready]);

  // ---- context overlays --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("ed-overlay") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: overlays.map((o) => ({
        type: "Feature",
        geometry: o.geometry,
        properties: { color: o.color, status: o.status, kind: o.kind, opacity: FILL_OPACITY[o.status] ?? 0.3 },
      })),
    });
  }, [overlays, ready]);

  // ---- external value changes (advanced JSON box, revert, load) ----------------
  useEffect(() => {
    if (same(value, fromPolygons(polysRef.current))) return;
    const next = polysFrom(value);
    polysRef.current = next;
    historyRef.current = createHistory(next); // a reload / revert / JSON edit starts a fresh history
    syncHistory();
    setPolys(next);
    setSelected(null);
    setSelectedPolygon(null);
  }, [value, syncHistory]);

  // ---- camera ------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const target = value ?? overlays[0]?.geometry ?? null;
    try {
      if (target) map.fitBounds(bboxOf(target), { padding: 40, maxZoom: 9, duration: 0 });
      else if (focus) map.jumpTo({ center: [focus.lng, focus.lat], zoom: 6 });
    } catch {
      /* degenerate bounds: leave the camera */
    }
    // Only when the caller asks (fitKey) or the map first becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  // ---- toolbar actions -----------------------------------------------------------
  const startDraw = () => {
    setNotice(null);
    setMode("draw");
    setDrawPoints([]);
    cursorRef.current = null;
    setSelected(null);
    setSelectedPolygon(null);
  };
  const startHole = () => {
    setNotice(null);
    if (selectedPolygon === null && polysRef.current.length !== 1) {
      setNotice("Select the polygon to cut a hole in first.");
      return;
    }
    setMode("hole");
    setDrawPoints([]);
    cursorRef.current = null;
    setSelected(null);
  };
  const undoEdit = () => {
    if (canUndo(historyRef.current)) applyHistory(undo(historyRef.current));
  };
  const redoEdit = () => {
    if (canRedo(historyRef.current)) applyHistory(redo(historyRef.current));
  };
  const merge = () => {
    const merged = mergePolygons(polysRef.current);
    if (merged.length === polysRef.current.length) {
      setNotice("The polygons do not overlap or touch, so there is nothing to merge.");
      return;
    }
    setNotice(`Merged ${polysRef.current.length} polygons into ${merged.length}.`);
    setSelected(null);
    setSelectedPolygon(null);
    commit(merged);
  };
  const simplify = () => {
    const r = simplifyPolygons(polysRef.current, SIMPLIFY_LEVELS[level]);
    if (r.verticesAfter >= r.verticesBefore) {
      setNotice("Nothing to simplify at this strength.");
      return;
    }
    setNotice(`Simplified: ${r.verticesBefore} → ${r.verticesAfter} vertices${r.keptRings ? ` (${r.keptRings} ring${r.keptRings === 1 ? "" : "s"} left as they were to stay valid)` : ""}.`);
    setSelected(null);
    commit(r.polygons);
  };
  const cancelDraw = () => {
    setNotice(null);
    setMode("select");
    setDrawPoints([]);
    cursorRef.current = null;
  };
  const finish = () => (mapRef.current as unknown as { __finishDraw?: () => void } | null)?.__finishDraw?.();
  const undoPoint = () => setDrawPoints((pts) => pts.slice(0, -1));
  const removeSelectedVertex = () => {
    if (!selected) return;
    const next = removeVertex(polysRef.current, selected);
    if (next !== polysRef.current) {
      setSelected(null);
      commit(next);
    }
  };
  const deleteSelectedPolygon = () => {
    if (selectedPolygon === null) return;
    setSelected(null);
    setSelectedPolygon(null);
    commit(removePolygon(polysRef.current, selectedPolygon));
  };
  const clearAll = () => {
    setSelected(null);
    setSelectedPolygon(null);
    commit([]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && mode === "select" && (key === "z" || key === "y")) {
      e.preventDefault();
      if (key === "y" || e.shiftKey) redoEdit();
      else undoEdit();
      return;
    }
    if (mode !== "select") {
      if (e.key === "Enter") finish();
      if (e.key === "Escape") cancelDraw();
      if (e.key === "Backspace") undoPoint();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selected) removeSelectedVertex();
      else deleteSelectedPolygon();
    }
  };

  const validity = value ? validateTerritorialGeometry(value) : null;
  const vertexCount = polys.reduce((n, p) => n + p.reduce((m, r) => m + Math.max(0, r.length - 1), 0), 0);
  const hint =
    mode !== "select"
      ? drawPoints.length === 0
        ? mode === "hole"
          ? "Cutting a hole: click the map to place the first point of the ring (inside the selected polygon, or across its edge to notch it)."
          : "Click the map to place the first point."
        : drawPoints.length < 3
          ? `${drawPoints.length} point${drawPoints.length === 1 ? "" : "s"} placed — at least 3 needed.`
          : "Click the green first point, double-click, or press Finish to close the ring."
      : polys.length === 0
        ? "No geometry yet — choose Draw polygon."
        : "Drag a vertex to move it, click a small dot on an edge to add a vertex, double-click a vertex to remove it. Draw another polygon to make a MultiPolygon.";

  const tool = "inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs text-ink hover:bg-white/5 disabled:opacity-40";

  return (
    <div className={cn("space-y-2", className)} data-testid="territory-editor">
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Geometry tools">
        <button type="button" className={cn(tool, mode === "draw" && "border-accent text-accent")} onClick={startDraw} data-testid="editor-draw">
          <PenTool className="h-3.5 w-3.5" /> Draw polygon
        </button>
        <button type="button" className={cn(tool, mode === "select" && "border-accent text-accent")} onClick={cancelDraw} data-testid="editor-select">
          <MousePointer2 className="h-3.5 w-3.5" /> Select / edit
        </button>
        <button type="button" className={cn(tool, mode === "hole" && "border-accent text-accent")} onClick={startHole} disabled={mode === "draw" || polys.length === 0} data-testid="editor-hole">
          <Scissors className="h-3.5 w-3.5" /> Cut hole
        </button>
        {mode !== "select" ? (
          <>
            <button type="button" className={tool} onClick={finish} disabled={drawPoints.length < 3} data-testid="editor-finish">
              <Check className="h-3.5 w-3.5" /> Finish
            </button>
            <button type="button" className={tool} onClick={undoPoint} disabled={drawPoints.length === 0} data-testid="editor-undo-point">
              <Undo2 className="h-3.5 w-3.5" /> Undo point
            </button>
            <button type="button" className={tool} onClick={cancelDraw} data-testid="editor-cancel-draw">
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className={tool} onClick={removeSelectedVertex} disabled={!selected} data-testid="editor-remove-vertex">
              <Minus className="h-3.5 w-3.5" /> Remove vertex
            </button>
            <button type="button" className={tool} onClick={deleteSelectedPolygon} disabled={selectedPolygon === null} data-testid="editor-delete-polygon">
              <Trash2 className="h-3.5 w-3.5" /> Delete polygon
            </button>
            <button type="button" className={tool} onClick={clearAll} disabled={polys.length === 0} data-testid="editor-clear">
              <Eraser className="h-3.5 w-3.5" /> Clear geometry
            </button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
            <button type="button" className={tool} onClick={undoEdit} disabled={!hist.undo} data-testid="editor-undo" title="Undo (Ctrl+Z)">
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </button>
            <button type="button" className={tool} onClick={redoEdit} disabled={!hist.redo} data-testid="editor-redo" title="Redo (Ctrl+Y)">
              <Redo2 className="h-3.5 w-3.5" /> Redo
            </button>
            <button type="button" className={tool} onClick={merge} disabled={polys.length < 2} data-testid="editor-merge">
              <Combine className="h-3.5 w-3.5" /> Merge polygons
            </button>
            <button type="button" className={tool} onClick={simplify} disabled={polys.length === 0} data-testid="editor-simplify">
              <Spline className="h-3.5 w-3.5" /> Simplify
            </button>
            <select value={level} onChange={(e) => setLevel(e.target.value as keyof typeof SIMPLIFY_LEVELS)} className="rounded-lg border border-border bg-surface px-1.5 py-1 text-xs text-ink" aria-label="Simplify strength" data-testid="editor-simplify-level">
              <option value="light">light (~55 m)</option>
              <option value="medium">medium (~220 m)</option>
              <option value="strong">strong (~1 km)</option>
            </select>
          </>
        )}
      </div>
      <label className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
        <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} data-testid="editor-snap" />
        <Magnet className="h-3.5 w-3.5" /> Snap to vertices and edges
      </label>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="territory-editor-map"
        className="h-80 w-full overflow-hidden rounded-lg border border-border outline-none focus-visible:ring-1 focus-visible:ring-accent"
      />
      <p className="text-xs text-ink-faint" data-testid="editor-hint">
        {hint}
      </p>
      {notice && (
        <p className="text-xs text-accent" data-testid="editor-notice" role="status">
          {notice}
        </p>
      )}
      <p className="text-xs text-ink-faint" data-testid="editor-summary">
        {polys.length} {polys.length === 1 ? "polygon" : "polygons"}, {vertexCount} vertices
        {validity && !validity.valid ? <span className="ml-2 text-high" data-testid="editor-invalid">Invalid: {validity.errors[0]}</span> : null}
      </p>
    </div>
  );
}
