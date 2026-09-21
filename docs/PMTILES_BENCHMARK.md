# PMTiles basemap benchmark

**Status: BLOCKED for the PMTiles scenario.** No real Protomaps archive exists in this environment, and downloading
one (tens of GB for the planet) was out of scope for an unattended run. No PMTiles numbers are reported; none were
estimated.

## Reproduce
```bash
npm run build && npx next start -p 3000          # production build; `next dev` compiles on demand and is not representative
BASE_URL=http://localhost:3000 node scripts/bench-basemap.mjs
BENCH_PMTILES_URL=https://host/vigil-basemap-2026-09.pmtiles BASE_URL=http://localhost:3000 node scripts/bench-basemap.mjs
```
`scripts/bench-basemap.mjs` drives Chromium (Playwright) at 1280x800 and reports, cold and warm, the median of
`BENCH_RUNS` (default 3) runs: time to style loaded, time to first rendered country label, request count, transferred
KB, median/p95 frame time over 20 camera steps, and JS heap. Without `BENCH_PMTILES_URL` only the configured provider
(the bundled geography when no key/archive is set) is measured.

## What to compare once an archive exists
bundled geography vs. PMTiles (regional z0-z10 and z0-z7 world) vs. MapTiler (if a key is available): style-ready time,
label time, bytes, and frame time while panning Europe / Middle East / East Asia. Record the archive build date, size,
host, and whether the CDN caches Range requests.
