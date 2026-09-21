# H3 vs Vigil's current grid — benchmark and decision

Script: `scripts/bench-h3-vs-grid.mjs` (`node --expose-gc scripts/bench-h3-vs-grid.mjs`). `h3-js` 4.5.0 (Apache-2.0) is a **devDependency for this benchmark only**.
Run 2026-09-21 on the development machine (Node, single thread). Synthetic but realistic: 40 conflict-event clusters (8,040 events, σ ≈ 45 km) and a FIRMS-sized set (100,000 detections: 300 fire complexes + 25,000 scattered). Numbers are medians of 7 runs (3 for the timeline).

## What Vigil actually uses today

| Use | Implementation | Would H3 fit? |
|---|---|---|
| Continuous heat surface | 720×360 (0.5°) **raster** filled by a distance transform, smoothly upsampled (`lib/heat/*`) | No. It is a smooth image, not counts per cell; hexagons would show as visible cells. |
| Hotspot report-count labels | zoom-dependent degree cells (`48°/2^zoom`), `aggregateReportBuckets` | Yes (bucketing). |
| Briefing hotspots / escalation geography | 0.5° cell keys (`lib/brief/activity.ts`) | Yes (bucketing). |
| FIRMS aggregation | server-side per-day grid aggregates (`GlobalEventAggregate`) | Yes (bucketing). |

## Results

| Data | Method | Cells | Bucket time | 60-step timeline | Heap | Cell area @0° / @70°N |
|---|---|---:|---:|---:|---:|---|
| conflict (8,040) | grid 0.5° | 888 | **0.87 ms** | **15.7 ms** | 140 KB | 3,091 / **1,057** km² |
| | H3 res 4 | 1,162 | 13.7 ms | 134.9 ms | 604 KB | 1,663 / 1,283 km² |
| | grid 3° | 116 | **0.65 ms** | 13.4 ms | 27 KB | 111,279 / 38,060 km² |
| | H3 res 2 | 120 | 12.1 ms | 113.4 ms | 24 KB | 79,648 / 63,447 km² |
| FIRMS (100,000) | grid 0.5° | 24,894 | **11 ms** | **280 ms** | 3.6 MB | 3,091 / 1,057 km² |
| | H3 res 4 | 25,253 | 167.7 ms | 1,670.6 ms | 4.6 MB | 1,663 / 1,283 km² |
| | grid 3° | 5,923 | **9.2 ms** | 255.5 ms | 0.5 MB | 111,279 / 38,060 km² |
| | H3 res 2 | 5,590 | 155.4 ms | 1,528 ms | 1.1 MB | 79,648 / 63,447 km² |

**Pole distortion** — share of a 400-point, 45 km-σ physical cluster that lands in its single busiest cell (higher = the cluster stays together):

| Method | 0° | 30° | 60° | 70° | 80° |
|---|---:|---:|---:|---:|---:|
| grid 0.5° | 18% | 16% | 11% | **8%** | **5%** |
| H3 res 4 | 14% | 15% | 10% | 10% | 12% |
| grid 3° | 47% | 50% | 42% | 70% | 43% |
| H3 res 2 | 86% | 62% | 88% | 76% | 99% |

**Hotspot stability** — overlap of the top-20 cell centroids after shifting every point by (0.2°, 0.3°): grid 0.5° 70 %, H3 res 4 75 %, grid 3° 90 %, H3 res 2 95 %, H3 res 5 15 % (too fine).

## Findings

1. **Speed:** H3 is **12–16× slower** to bucket in JavaScript (`latLngToCell` costs far more than two `floor`s). A 60-step playback re-bucketing of FIRMS-sized data goes from 0.28 s to 1.7 s.
2. **Memory / cells:** comparable; H3 uses 10–30 % more heap.
3. **Visual quality:** irrelevant for the heat raster; for labels, hexagons are prettier but not more useful.
4. **Pole distortion:** real for the 0.5° grid (a cell at 70°N has one third of the equatorial area, so a cluster fragments across more cells: 18 % → 8 % → 5 %). H3 is near-uniform (1,663 → 1,283 km²). It matters for Arctic/Nordic geography, but little for most conflicts Vigil tracks.
5. **Hotspot stability:** H3 is marginally better at equal resolution (75 % vs 70 %); coarse cells of either kind are stable.
6. **Timeline:** dominated by the bucketing cost above; H3 loses.

## Decision

**Keep the current grid; do not migrate to H3.** There is no clear improvement, a large speed regression, and the main heat surface cannot use it. If pole distortion ever matters, the cheap fix is a latitude-adaptive longitude step (`lngStep = cell / cos(lat)` rounded to a divisor of 360) inside the existing bucketing functions: roughly equal-area, no dependency, no slowdown. That is recorded as a staged option and not implemented (it would change briefing hotspot outputs and their tests).

Staged plan **if** H3 is ever wanted (e.g. global density analytics or server-side joins): (1) store `h3Cell` (res 4) on structured events at ingest, so the cost is paid once per row rather than per request; (2) build hotspot detection on the stored column server-side; (3) leave the raster heat surface unchanged; (4) re-benchmark with real table sizes.
