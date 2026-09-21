// Benchmark: Vigil's current lat/lng bucketing (the 0.5-degree heat grid and the zoom-dependent hotspot cells in
// lib/map/report-counts.ts) against H3 (uber/h3-js, Apache-2.0). Development tool only; h3-js is a devDependency.
//   node scripts/bench-h3-vs-grid.mjs            (add --expose-gc for cleaner heap numbers)
// Synthetic but realistic workloads: clustered conflict events (including a high-latitude theatre) and a
// FIRMS-sized thermal-detection set. Results are summarised in docs/H3_BENCHMARK.md.
import { latLngToCell, cellToLatLng, cellArea, getResolution } from "h3-js";

const rng = (() => {
  let s = 123456789;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
})();
const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-12)) * Math.cos(2 * Math.PI * rng());
const KM_PER_DEG = 111.195;

/** A physical cluster (sigma in km) so the same real-world spread is generated at any latitude. */
function cluster(lat, lng, n, sigmaKm, t0 = 0) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const dLat = (gauss() * sigmaKm) / KM_PER_DEG;
    const dLng = (gauss() * sigmaKm) / (KM_PER_DEG * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
    out.push({ lat: Math.max(-89.9, Math.min(89.9, lat + dLat)), lng: lng + dLng, w: 1 + Math.floor(rng() * 4), t: t0 + rng() * 86400_000 * 7 });
  }
  return out;
}

const centers = Array.from({ length: 40 }, () => [(rng() - 0.5) * 120, (rng() - 0.5) * 340]);
const conflict = centers.flatMap(([la, ln]) => cluster(la, ln, 100 + Math.floor(rng() * 200), 45));
const fires = [...Array.from({ length: 300 }, () => [(rng() - 0.5) * 140, (rng() - 0.5) * 340]).flatMap(([la, ln]) => cluster(la, ln, 250, 12)), ...Array.from({ length: 25000 }, () => ({ lat: (rng() - 0.5) * 150, lng: (rng() - 0.5) * 360, w: 1, t: rng() * 86400_000 * 7 }))];

// ---- bucketers ------------------------------------------------------------------------------------
const gridKey = (cell) => (p) => `${Math.floor(p.lat / cell)}:${Math.floor(p.lng / cell)}`;
const h3Key = (res) => (p) => latLngToCell(p.lat, p.lng, res);
const methods = [
  { name: "grid 0.5°", key: gridKey(0.5), kind: "grid", cell: 0.5 },
  { name: "H3 res 4", key: h3Key(4), kind: "h3", res: 4 },
  { name: "grid 3° (hotspot zoom 4)", key: gridKey(3), kind: "grid", cell: 3 },
  { name: "H3 res 2", key: h3Key(2), kind: "h3", res: 2 },
  { name: "H3 res 5", key: h3Key(5), kind: "h3", res: 5 },
];

function bucket(points, key) {
  const m = new Map();
  for (const p of points) {
    const k = key(p);
    const a = m.get(k);
    if (a) {
      a.w += p.w;
      a.n++;
      a.lat += p.lat * p.w;
      a.lng += p.lng * p.w;
    } else m.set(k, { w: p.w, n: 1, lat: p.lat * p.w, lng: p.lng * p.w });
  }
  return m;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function time(fn, runs = 7) {
  fn(); // warm
  const t = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn();
    t.push(performance.now() - s);
  }
  return median(t);
}
const heap = () => {
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
};

/** Physical area of one cell at a latitude (km^2). */
function cellAreaKm2(m, lat) {
  if (m.kind === "grid") return m.cell * KM_PER_DEG * m.cell * KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return cellArea(latLngToCell(lat, 10, m.res), "km2");
}

const rows = [];
for (const [dataName, pts] of [["conflict events (n=" + conflict.length + ")", conflict], ["FIRMS-sized detections (n=" + fires.length + ")", fires]]) {
  console.log(`\n### ${dataName}`);
  for (const m of methods) {
    const before = heap();
    let buckets = bucket(pts, m.key);
    const after = heap();
    const ms = time(() => bucket(pts, m.key));
    // Timeline: 60 steps, each a rolling 24 h window (what the playback slider re-buckets).
    const steps = Array.from({ length: 60 }, (_, i) => i * ((86400_000 * 6) / 60));
    const tl = time(() => {
      for (const s of steps) bucket(pts.filter((p) => p.t >= s && p.t < s + 86400_000), m.key);
    }, 3);
    const row = { data: dataName.split(" ")[0], method: m.name, cells: buckets.size, ms: +ms.toFixed(2), timelineMs: +tl.toFixed(1), heapKB: Math.round((after - before) / 1024), areaEq: Math.round(cellAreaKm2(m, 0)), area70: Math.round(cellAreaKm2(m, 70)) };
    rows.push(row);
    buckets = null;
    console.log(`${m.name.padEnd(26)} cells=${String(row.cells).padStart(6)}  bucket=${String(row.ms).padStart(7)} ms  timeline(60 steps)=${String(row.timelineMs).padStart(8)} ms  heap≈${String(row.heapKB).padStart(6)} KB  cell area equator=${row.areaEq} km²  at 70°N=${row.area70} km²`);
  }
}

// ---- pole distortion: the same physical cluster (sigma 45 km, 400 points) at several latitudes ---------------
console.log("\n### Pole distortion: share of a 400-point, 45 km-sigma cluster that lands in its single busiest cell");
const lats = [0, 30, 60, 70, 80];
for (const m of methods.filter((x) => ["grid 0.5°", "H3 res 4", "grid 3° (hotspot zoom 4)", "H3 res 2"].includes(x.name))) {
  const shares = lats.map((la) => {
    const runs = [];
    for (let i = 0; i < 20; i++) {
      const c = cluster(la, 20 + rng() * 5, 400, 45);
      const b = bucket(c, m.key);
      runs.push(Math.max(...[...b.values()].map((x) => x.n)) / 400);
    }
    return median(runs);
  });
  console.log(`${m.name.padEnd(26)} ` + lats.map((la, i) => `${la}°: ${(shares[i] * 100).toFixed(0)}%`).join("  "));
}

// ---- hotspot consistency: shift every point by a fraction of a cell; how stable is the top-20 ---------------
console.log("\n### Hotspot stability: top-20 cells after shifting all points by 0.2° / 0.3° (overlap of cell centroids within one cell diameter)");
const centroidOf = (m, k, v) => (m.kind === "grid" ? [(Number(k.split(":")[0]) + 0.5) * m.cell, (Number(k.split(":")[1]) + 0.5) * m.cell] : cellToLatLng(k));
function top(m, pts, k = 20) {
  return [...bucket(pts, m.key).entries()].sort((a, b) => b[1].w - a[1].w).slice(0, k).map(([key, v]) => centroidOf(m, key, v));
}
const km = (a, b) => Math.hypot((a[0] - b[0]) * KM_PER_DEG, (a[1] - b[1]) * KM_PER_DEG * Math.cos((a[0] * Math.PI) / 180));
for (const m of methods) {
  const base = top(m, conflict);
  const shifted = top(m, conflict.map((p) => ({ ...p, lat: p.lat + 0.2, lng: p.lng + 0.3 })));
  const diameter = Math.sqrt(cellAreaKm2(m, 30)) * 1.15;
  const overlap = base.filter((a) => shifted.some((b) => km(a, b) <= diameter)).length / base.length;
  console.log(`${m.name.padEnd(26)} overlap ${(overlap * 100).toFixed(0)}%`);
}

// ---- Existing heat field: what it actually is -----------------------------------------------------------------------------------
console.log("\nNote: the continuous heat surface (lib/heat) is a distance-transform RASTER (720x360, smoothly upsampled), not a bucket count;\nH3 cells would replace it with visible hexagons, so the comparison above concerns bucketing (report-count labels, hotspot detection, FIRMS aggregation).");
console.log("\nJSON " + JSON.stringify(rows));
void getResolution;
