import { HEAT_BASELINE } from "./scale";
import { HEAT_GRID, KM_PER_DEGREE, cellIndexAt, cellLat, countriesMask, distanceTransformKm, landMask, windowAround, type GridWindow } from "./grid";

// Continuous conflict-intensity field ("observed conflict intensity / conflict
// pressure", 0-100) over the world grid. It is NOT a probability of future war,
// personal danger, political alignment or legal status.
//
// Two conceptual layers share one field:
//   A. sustained conflict base — broad and persistent, from a conflict's
//      severityScore and its geography (fighting-country cells near the
//      conflict, decaying smoothly outward with geodesic distance);
//   B. recent incidents — small and temporary, from event severity, recency
//      and importance (geographic scope), giving hotter local cores.
//
// Report / article COUNT is not an input anywhere in this module: a place does
// not get hotter because more outlets wrote about it. Confidence is carried per
// cell only so renderers can vary saturation/opacity subtly; it never changes
// the intensity value.
//
// Combination is dominant-contribution-first with a bounded secondary term, so
// many low-intensity contributors can never dilute a severe local value and
// stacking never exceeds 100. Everything is deterministic: contributors are
// sorted by id, arithmetic is fixed-order, nothing reads the clock.

export const HEAT_MODEL = {
  baseline: HEAT_BASELINE,
  /** Weight of the non-dominant contributions folded into a cell. */
  secondaryWeight: 0.2,
  /** ...and never more than this fraction of the dominant contribution. */
  secondaryCap: 0.35,
  /** Inside a conflict's fighting-country footprint the value eases from the
   * peak at its anchors toward (1 - this) of the peak at the footprint's reach. */
  insideEase: 0.3,
  /** Decay length (km) outside a conflict footprint: L = base + perPoint * (severity - 30)+. */
  decayBaseKm: 160,
  decayPerPointKm: 4.5,
  /** Footprint reach (km) from the nearest anchor: clamp(spread + 300, min, max). */
  reachMinKm: 400,
  reachMaxKm: 800,
  /** Incident scope: radius (km) = clamp(base + importance * perPoint, min, max). */
  incidentBaseKm: 40,
  incidentPerPointKm: 0.7,
  incidentMaxKm: 100,
  /** Incident intensity halves every this many hours, and is dropped after maxAge. */
  incidentHalfLifeHours: 30,
  incidentMaxAgeHours: 168,
} as const;

export interface HeatConflict {
  id: string;
  /** Central scoring engine severityScore, 0-100 (100 = active full-scale war). */
  severityScore: number;
  /** Evidence confidence 0-1 — visual only. */
  confidence: number;
  /** Where it is being fought: the conflict's own point plus its events' points. */
  anchors: { lat: number; lng: number }[];
  /** ISO alpha-2 codes of countries where fighting occurs (footprint geometry). */
  countryCodes: string[];
  /** Geographic spread (km) of its events. */
  spreadKm: number;
}

export interface HeatIncident {
  id: string;
  lat: number;
  lng: number;
  severityScore: number;
  confidence: number;
  ageHours: number;
  /** 0-100 event importance — the incident's geographic scope, not its severity. */
  importance: number;
  precision?: string | null;
}

export interface HeatInput {
  conflicts: HeatConflict[];
  incidents: HeatIncident[];
}

export interface HeatField {
  intensity: Float32Array;
  /** 0-1, confidence of the dominant contributor (1 where nothing contributes). */
  confidence: Float32Array;
  /** 1 where the cell is land (the only cells that are painted). */
  land: Uint8Array;
  signature: string;
  /** Highest intensity on land. */
  peak: number;
}

const N = HEAT_GRID.cols * HEAT_GRID.rows;
const R = 100 - HEAT_MODEL.baseline;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
const round = (v: number, p = 100) => Math.round(v * p) / p;

// --- Conflict base ---------------------------------------------------------

interface Geography {
  dAnchor: Float32Array;
  /** Decay distance for cells INSIDE one of the conflict's own fighting countries — the country's whole
   * territory is "core" within reach of a real anchor (a full-scale war plausibly affects the whole
   * fighting nation, not just the exact incident point). */
  dCoreCountry: Float32Array;
  /** Decay distance for cells OUTSIDE every fighting country (every other country, including direct
   * neighbors) — deliberately NEVER inherits the country mask: it is always distance to the nearest REAL
   * anchor, so a neighboring country can only warm up from genuine nearby evidence, never merely from
   * bordering a country that is (elsewhere, far from that border) a fighting country. Final Intelligence
   * Consistency & Map Correctness v1 §4 — this is the fix for a Severity-100 war painting Belarus/Poland/
   * Moldova-style neighbors orange/red purely from being within the old reach radius of ANY anchor: the
   * old single `dCore` used the country-extended core mask everywhere, so a neighbor cell sitting right
   * across the border was ~0 km from that core (the mask reached the political border) regardless of how
   * far it actually was from a real incident. */
  dCoreOutside: Float32Array;
  inCountry: Uint8Array;
  reachKm: number;
  /** Cells that can be influenced at all: reach + the widest decay (a full-scale war's). */
  window: GridWindow;
}
const geographyCache = new Map<string, Geography>();
const contributionCache = new Map<string, Float32Array>();
const CACHE_LIMIT = 48;

function remember<V>(cache: Map<string, V>, key: string, value: V): V {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return value;
}

function geographyOf(c: HeatConflict): Geography {
  const anchors = [...c.anchors].map((a) => ({ lat: round(a.lat, 4), lng: round(a.lng, 4) })).sort((a, b) => a.lat - b.lat || a.lng - b.lng);
  const codes = [...new Set(c.countryCodes.map((x) => x.toUpperCase()))].sort();
  const reachKm = clamp(c.spreadKm + 300, HEAT_MODEL.reachMinKm, HEAT_MODEL.reachMaxKm);
  const discKm = clamp(c.spreadKm * 0.5, 35, 250);
  const key = `${anchors.map((a) => `${a.lat},${a.lng}`).join(";")}|${codes.join(",")}|${Math.round(reachKm)}|${Math.round(discKm)}`;
  const hit = geographyCache.get(key);
  if (hit) return hit;

  const anchorMask = new Uint8Array(N);
  for (const a of anchors) {
    const i = cellIndexAt(a.lat, a.lng);
    if (i >= 0) anchorMask[i] = 1;
  }
  // Nothing beyond reach + 3 decay lengths (at the widest, severity 100) can matter,
  // so distances are only computed in that window; outside it the cells stay "infinitely far".
  const maxDecayKm = HEAT_MODEL.decayBaseKm + HEAT_MODEL.decayPerPointKm * 70;
  const window = windowAround(anchors, reachKm + 3 * maxDecayKm);
  const dAnchor = distanceTransformKm(anchorMask, window);
  const country = countriesMask(codes);
  // The anchor-only disc is unconditional (a real incident's own immediate vicinity is always core,
  // in or out of a fighting country); the country-extended core additionally treats the WHOLE fighting
  // country as core within reach — but only that mask, never a neighbor's.
  const coreAnchorOnly = new Uint8Array(N);
  const coreCountry = new Uint8Array(N);
  const inCountry = new Uint8Array(N);
  for (let r = window.r0; r < window.r1; r++) {
    for (let cc = window.c0; cc < window.c1; cc++) {
      const i = r * HEAT_GRID.cols + ((cc + HEAT_GRID.cols) % HEAT_GRID.cols);
      const disc = dAnchor[i]! <= discKm;
      if (disc) coreAnchorOnly[i] = 1;
      const within = country && country[i] === 1;
      if (within) inCountry[i] = 1;
      if (disc || (within && dAnchor[i]! <= reachKm)) coreCountry[i] = 1;
    }
  }
  return remember(geographyCache, key, {
    dAnchor,
    dCoreCountry: distanceTransformKm(coreCountry, window),
    dCoreOutside: distanceTransformKm(coreAnchorOnly, window),
    inCountry,
    reachKm,
    window,
  });
}

/** Excess-over-baseline contribution of one conflict's sustained base. */
function conflictContribution(c: HeatConflict): Float32Array {
  const s = clamp(c.severityScore, 0, 100);
  const geo = geographyOf(c);
  const key = `${Math.round(s * 10)}|${geo.reachKm}|${geo.dAnchor.length}|${geographyKeyOf(c)}`;
  const hit = contributionCache.get(key);
  if (hit) return hit;
  const amp = Math.max(0, s - HEAT_MODEL.baseline);
  const decayKm = HEAT_MODEL.decayBaseKm + HEAT_MODEL.decayPerPointKm * Math.max(0, s - 30);
  const out = new Float32Array(N);
  if (amp > 0) {
    const w = geo.window;
    for (let r = w.r0; r < w.r1; r++) {
      for (let cc = w.c0; cc < w.c1; cc++) {
        const i = r * HEAT_GRID.cols + ((cc + HEAT_GRID.cols) % HEAT_GRID.cols);
        const ease = 1 - HEAT_MODEL.insideEase * Math.min(1, geo.dAnchor[i]! / geo.reachKm);
        // Outside every fighting country, decay is measured from the nearest REAL anchor (never from the
        // country-extended core, which would put a neighbor cell ~0 km from "core" merely for sitting
        // across the border) — see the Geography interface's own comment.
        const d = geo.inCountry[i] ? geo.dCoreCountry[i]! : geo.dCoreOutside[i]!;
        const x = d / decayKm;
        if (x > 3) continue; // exp(-9) ~ 1e-4: negligible
        out[i] = amp * ease * Math.exp(-x * x);
      }
    }
  }
  return remember(contributionCache, key, out);
}

function geographyKeyOf(c: HeatConflict): string {
  return `${c.anchors.map((a) => `${round(a.lat, 4)},${round(a.lng, 4)}`).sort().join(";")}|${[...new Set(c.countryCodes.map((x) => x.toUpperCase()))].sort().join(",")}|${Math.round(c.spreadKm)}`;
}

// --- Field assembly ---------------------------------------------------------

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Stable identity of a field's inputs (also useful as a memo/cache key and a test hook). */
export function heatInputSignature(input: HeatInput): string {
  const conflicts = [...input.conflicts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const incidents = [...input.incidents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const text = JSON.stringify([
    conflicts.map((c) => [c.id, round(c.severityScore, 10), round(c.confidence), geographyKeyOf(c)]),
    incidents.map((i) => [i.id, round(i.lat, 1000), round(i.lng, 1000), round(i.severityScore, 10), round(i.confidence), round(i.ageHours, 4), Math.round(i.importance), i.precision ?? ""]),
  ]);
  return fnv1a(text);
}

const fieldCache = new Map<string, HeatField>();

export function computeHeatField(input: HeatInput): HeatField {
  const signature = heatInputSignature(input);
  const cached = fieldCache.get(signature);
  if (cached) return cached;

  const best = new Float32Array(N); // dominant excess
  const sum = new Float32Array(N); // total excess
  const conf = new Float32Array(N).fill(1);
  const add = (i: number, e: number, c: number) => {
    if (e <= 0) return;
    sum[i]! += e;
    if (e > best[i]!) {
      best[i] = e;
      conf[i] = c;
    }
  };

  const conflicts = [...input.conflicts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const c of conflicts) {
    const contribution = conflictContribution(c);
    const cc = clamp(c.confidence, 0, 1);
    for (let i = 0; i < N; i++) {
      const e = contribution[i]!;
      if (e > 0.05) add(i, e, cc);
    }
  }

  const { cols, rows, cell } = HEAT_GRID;
  const dyKm = cell * KM_PER_DEGREE;
  const incidents = [...input.incidents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const inc of incidents) {
    if (inc.ageHours < 0 || inc.ageHours > HEAT_MODEL.incidentMaxAgeHours) continue;
    const recency = Math.pow(0.5, inc.ageHours / HEAT_MODEL.incidentHalfLifeHours);
    const amp = Math.max(0, clamp(inc.severityScore, 0, 100) - HEAT_MODEL.baseline) * recency;
    if (amp < 0.5) continue;
    const scope = inc.precision === "area_level" || inc.precision === "region" ? 2 : inc.precision === "approximate" || inc.precision === "city" ? 1.4 : 1;
    const radiusKm = Math.min(HEAT_MODEL.incidentMaxKm * scope, (HEAT_MODEL.incidentBaseKm + HEAT_MODEL.incidentPerPointKm * clamp(inc.importance, 0, 100)) * scope);
    const reach = radiusKm * 3;
    const centreRow = Math.floor((90 - inc.lat) / cell);
    const dRows = Math.ceil(reach / dyKm) + 1;
    const ic = clamp(inc.confidence, 0, 1);
    for (let r = Math.max(0, centreRow - dRows); r <= Math.min(rows - 1, centreRow + dRows); r++) {
      const lat = cellLat(r);
      const dy = (lat - inc.lat) * KM_PER_DEGREE;
      const dxKm = dyKm * Math.max(0.02, Math.cos((lat * Math.PI) / 180));
      const dCols = Math.min(cols / 2, Math.ceil(reach / dxKm) + 1);
      const centreCol = Math.floor((inc.lng + 180) / cell);
      for (let k = -dCols; k <= dCols; k++) {
        const c = (((centreCol + k) % cols) + cols) % cols;
        const lng = -180 + (c + 0.5) * cell;
        let dLng = lng - inc.lng;
        dLng = ((((dLng + 180) % 360) + 360) % 360) - 180;
        const dx = dLng * KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
        const x = Math.sqrt(dx * dx + dy * dy) / radiusKm;
        if (x > 3) continue;
        add(r * cols + c, amp * Math.exp(-x * x), ic);
      }
    }
  }

  const intensity = new Float32Array(N);
  const land = landMask();
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const m = best[i]!;
    let e = m;
    if (m > 0) {
      // Bounded secondary influence: the other contributions can lift a cell a
      // little above its strongest one (saturating, and never more than a
      // fraction of it), but can neither dilute it nor stack up to a colour the
      // strongest contribution alone would not justify.
      const secondary = Math.max(0, sum[i]! - m);
      const lift = HEAT_MODEL.secondaryWeight * (R - m) * (1 - Math.exp(-secondary / R));
      e = m + Math.min(lift, HEAT_MODEL.secondaryCap * m, R - m);
    }
    const v = Math.min(100, HEAT_MODEL.baseline + Math.min(R, e));
    intensity[i] = v;
    if (land[i] && v > peak) peak = v;
  }

  const field: HeatField = { intensity, confidence: conf, land, signature, peak };
  return remember(fieldCache, signature, field);
}

/** Bilinear read of the field at a point (for tooltips/tests; renderers use their own resampling). */
export function sampleIntensity(field: HeatField, lat: number, lng: number): number {
  const { cols, rows, cell } = HEAT_GRID;
  const fy = (90 - lat) / cell - 0.5;
  const fx = (lng + 180) / cell - 0.5;
  const y0 = clamp(Math.floor(fy), 0, rows - 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const x0 = ((Math.floor(fx) % cols) + cols) % cols;
  const x1 = (x0 + 1) % cols;
  const ty = clamp(fy - Math.floor(fy), 0, 1);
  const tx = fx - Math.floor(fx);
  const a = field.intensity[y0 * cols + x0]! * (1 - tx) + field.intensity[y0 * cols + x1]! * tx;
  const b = field.intensity[y1 * cols + x0]! * (1 - tx) + field.intensity[y1 * cols + x1]! * tx;
  return a * (1 - ty) + b * ty;
}

/** Is this point on land (cell resolution)? */
export function isLandAt(lat: number, lng: number): boolean {
  const i = cellIndexAt(lat, lng);
  return i >= 0 && landMask()[i] === 1;
}
