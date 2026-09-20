import { feature } from "topojson-client";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { countriesObject, worldTopology } from "@/lib/globe/world-topology";
import { getLandFeatures } from "@/lib/globe/land-geo";

// World grid for the continuous conflict-intensity surface. One regular
// lat/lng grid (row 0 is the northernmost band, column 0 starts at -180) is
// the single representation both the flat map and the globe render from.
// 0.5-degree cells (720 x 360): fine enough that a town-scale incident (tens
// of km) still resolves, coarse enough that the whole field computes in a few
// tens of milliseconds. Renderers upsample the field smoothly, so cells never
// show.

export const HEAT_GRID = { cell: 0.5, cols: 720, rows: 360 } as const;
export type HeatGrid = typeof HEAT_GRID;

const KM_PER_DEG = 111.195;

export function cellLat(row: number): number {
  return 90 - (row + 0.5) * HEAT_GRID.cell;
}
export function cellLng(col: number): number {
  return -180 + (col + 0.5) * HEAT_GRID.cell;
}
/** Grid index of the cell containing a point, or -1 outside the grid. */
export function cellIndexAt(lat: number, lng: number): number {
  if (!(lat >= -90 && lat <= 90) || !Number.isFinite(lng)) return -1;
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  const row = Math.min(HEAT_GRID.rows - 1, Math.max(0, Math.floor((90 - lat) / HEAT_GRID.cell)));
  const col = Math.min(HEAT_GRID.cols - 1, Math.max(0, Math.floor((wrapped + 180) / HEAT_GRID.cell)));
  return row * HEAT_GRID.cols + col;
}

type Poly = Feature<Polygon | MultiPolygon> | { geometry: Polygon | MultiPolygon };

/** Rasterizes polygons onto the grid (even-odd scanline at cell-centre
 * latitudes; holes handled). Each feature is filled independently and the
 * results are OR-ed. */
export function rasterizePolygons(features: readonly Poly[]): Uint8Array {
  const { cols, rows, cell } = HEAT_GRID;
  const out = new Uint8Array(cols * rows);
  const crossings: number[][] = Array.from({ length: rows }, () => []);
  for (const f of features) {
    const geometry = f.geometry;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const list of crossings) list.length = 0;
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i]!;
          const b = ring[i + 1]!;
          const x0 = a[0]!;
          const y0 = a[1]!;
          const x1 = b[0]!;
          const y1 = b[1]!;
          if (y0 === y1) continue;
          const lo = Math.min(y0, y1);
          const hi = Math.max(y0, y1);
          // Rows whose centre latitude y satisfies lo <= y < hi.
          const rowHi = Math.floor((90 - lo) / cell - 0.5) + 1; // generous; exact test below
          const rowLo = Math.floor((90 - hi) / cell - 0.5); // generous; exact test below
          for (let r = Math.max(0, rowLo); r <= Math.min(rows - 1, rowHi); r++) {
            const y = cellLat(r);
            if (y < lo || y >= hi) continue;
            crossings[r]!.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
          }
        }
      }
      for (let r = 0; r < rows; r++) {
        const xs = crossings[r]!;
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.ceil((xs[k]! + 180) / cell - 0.5));
          const c1 = Math.min(cols - 1, Math.ceil((xs[k + 1]! + 180) / cell - 0.5) - 1);
          for (let c = c0; c <= c1; c++) out[r * cols + c] = 1;
        }
      }
    }
  }
  return out;
}

let landCache: Uint8Array | null = null;
/** 1 for land cells, 0 for ocean. Cached. */
export function landMask(): Uint8Array {
  if (!landCache) landCache = rasterizePolygons(getLandFeatures());
  return landCache;
}

// ISO 3166-1 alpha-2 -> ISO numeric (the id Natural Earth countries carry) for
// every country the registry can name as a place where a conflict is fought.
// A code missing here just means that conflict's footprint falls back to its
// event/anchor geography — never an error.
const ISO_NUMERIC: Record<string, string> = {
  AF: "004", BF: "854", CD: "180", CF: "140", CM: "120", CO: "170", EC: "218", ET: "231", HT: "332",
  IL: "376", IN: "356", IQ: "368", IR: "364", LB: "422", LY: "434", ML: "466", MM: "104", MX: "484",
  NE: "562", NG: "566", PH: "608", PK: "586", PS: "275", RU: "643", SD: "729", SO: "706", SY: "760",
  TR: "792", UA: "804", YE: "887", SS: "728", KP: "408", KR: "410", TW: "158", AM: "051", AZ: "031",
  TD: "148", MZ: "508", SN: "686", GN: "324", KE: "404", UG: "800", BI: "108", RW: "646", EG: "818",
  JO: "400", SA: "682", CN: "156", MY: "458", TH: "764", BD: "050", NP: "524", LK: "144", VE: "862",
  PE: "604", BR: "076", GE: "268", BY: "112", MD: "498", CY: "196", DZ: "012", TN: "788", MR: "478",
};

let countryFeatures: Map<string, Feature<Polygon | MultiPolygon>> | null = null;
const countryMaskCache = new Map<string, Uint8Array>();

function countryFeatureFor(code: string): Feature<Polygon | MultiPolygon> | undefined {
  if (!countryFeatures) {
    countryFeatures = new Map();
    const collection = feature(worldTopology, countriesObject);
    for (const f of collection.features) if (f.id != null) countryFeatures.set(String(f.id).padStart(3, "0"), f as Feature<Polygon | MultiPolygon>);
  }
  const numeric = ISO_NUMERIC[code.toUpperCase()];
  return numeric ? countryFeatures.get(numeric) : undefined;
}

/** Cells inside the given countries; null when none of the codes has geometry. */
export function countriesMask(codes: readonly string[]): Uint8Array | null {
  const known = [...new Set(codes.map((c) => c.toUpperCase()))].filter((c) => countryFeatureFor(c)).sort();
  if (known.length === 0) return null;
  const key = known.join(",");
  let mask = countryMaskCache.get(key);
  if (!mask) {
    mask = rasterizePolygons(known.map((c) => countryFeatureFor(c)!));
    countryMaskCache.set(key, mask);
  }
  return mask;
}

/** Approximate geodesic distance (km) from every cell to the nearest source
 * cell (0 inside sources). Two-pass 5x5 chamfer (neighbours plus knight moves,
 * so iso-distance lines are round rather than octagonal, error ~1-2%) with
 * per-row cell width (cos latitude) and longitude wrap-around: O(cells),
 * deterministic. */
export interface GridWindow {
  r0: number;
  r1: number;
  /** Column bounds may run past [0, cols) — indices wrap. */
  c0: number;
  c1: number;
}

/** Window (in cells) covering `km` around a set of points, clipped to the poles. */
export function windowAround(points: readonly { lat: number; lng: number }[], km: number): GridWindow {
  const { cols, rows, cell } = HEAT_GRID;
  let latMin = 90;
  let latMax = -90;
  let lngMin = 1e9;
  let lngMax = -1e9;
  for (const p of points) {
    latMin = Math.min(latMin, p.lat);
    latMax = Math.max(latMax, p.lat);
    lngMin = Math.min(lngMin, p.lng);
    lngMax = Math.max(lngMax, p.lng);
  }
  const dLat = km / KM_PER_DEG;
  const worstLat = Math.min(89, Math.max(Math.abs(latMin), Math.abs(latMax)) + dLat);
  const dLng = km / (KM_PER_DEG * Math.cos((worstLat * Math.PI) / 180));
  const r0 = Math.max(0, Math.floor((90 - (latMax + dLat)) / cell));
  const r1 = Math.min(rows, Math.ceil((90 - (latMin - dLat)) / cell) + 1);
  const c0 = Math.floor((lngMin - dLng + 180) / cell);
  const c1 = Math.ceil((lngMax + dLng + 180) / cell) + 1;
  // A window wider than the world is just the whole world.
  return c1 - c0 >= cols ? { r0, r1, c0: 0, c1: cols } : { r0, r1, c0, c1 };
}

export function distanceTransformKm(sources: Uint8Array, window?: GridWindow): Float32Array {
  const { cols, rows, cell } = HEAT_GRID;
  const w0 = window ?? { r0: 0, r1: rows, c0: 0, c1: cols };
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = sources[i] ? 0 : 1e9;
  const dy = cell * KM_PER_DEG;
  const dx = new Float32Array(rows);
  for (let r = 0; r < rows; r++) dx[r] = Math.max(0.5, dy * Math.cos((cellLat(r) * Math.PI) / 180));

  // Forward mask offsets (dr <= 0; dc < 0 when dr == 0) and its mirror for the backward pass.
  const MASK: [number, number][] = [
    [0, -1],
    [-1, -2],
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [-1, 2],
    [-2, -1],
    [-2, 1],
  ];
  const wrap = (c: number) => (c < 0 ? c + cols : c >= cols ? c - cols : c);
  // (window column indices can be several cols out of range only by less than one world width)
  const pass = (rowStart: number, rowEnd: number, step: number, sign: number) => {
    for (let r = rowStart; r !== rowEnd; r += step) {
      const row = r * cols;
      // Per-offset row index and cost for this row.
      const nr: number[] = [];
      const cost: number[] = [];
      const dcs: number[] = [];
      for (const [dr0, dc0] of MASK) {
        const rr = r + dr0 * sign;
        if (rr < 0 || rr >= rows) continue;
        const dxm = (dx[r]! + dx[rr]!) / 2;
        nr.push(rr * cols);
        dcs.push(dc0 * sign);
        cost.push(Math.hypot(dc0 * dxm, dr0 * dy));
      }
      const n = nr.length;
      const cStart = sign === 1 ? w0.c0 : w0.c1 - 1;
      const cEnd = sign === 1 ? w0.c1 : w0.c0 - 1;
      for (let c = cStart; c !== cEnd; c += sign) {
        const cw = wrap(wrap(c));
        let v = d[row + cw]!;
        for (let k = 0; k < n; k++) {
          const t = d[nr[k]! + wrap(cw + dcs[k]!)]! + cost[k]!;
          if (t < v) v = t;
        }
        d[row + cw] = v;
      }
    }
  };
  pass(w0.r0, w0.r1, 1, 1);
  pass(w0.r1 - 1, w0.r0 - 1, -1, -1);
  return d;
}

export const KM_PER_DEGREE = KM_PER_DEG;
