# PMTiles basemap deployment

Vigil reads a Protomaps-schema PMTiles archive over HTTP Range requests. There is no tile server. The archive is
**base geography only**; nothing about conflicts, events, heat, territory, hazards, infrastructure or actors is in it.

## Configuration

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_BASEMAP_PMTILES_URL` | `https://host/path/vigil-basemap-2026-09.pmtiles`, or a path served by the app (`/basemaps/vigil-basemap-2026-09.pmtiles`). Unset = the bundled geography is used. |
| `NEXT_PUBLIC_GLYPHS_URL` | Optional glyph template with `{fontstack}` and `{range}`; unset = local-first glyphs. |
| `NEXT_PUBLIC_MAPTILER_KEY` | Optional. Enables Satellite (and Street/Intel when no archive is set). Never required. |

`NEXT_PUBLIC_*` values are baked in at build time; rebuild (or redeploy the frontend) to change them.

## Fallback order (Intel / Street)
1. configured PMTiles archive → 2. MapTiler (only if a key is set) → 3. bundled geography (land, coast, borders,
country labels; needs nothing) → 4. minimal solid background. Satellite: MapTiler imagery, else the bundled geography
with an on-map explanation. A failing provider is skipped after **one** fallback; the reason is shown on the map
notice and at `/admin/basemap`.

## Producing an archive
- **Full planet**: download a daily build from https://maps.protomaps.com/builds/ (order of 100 GB), or build it yourself
  with Planetiler (`protomaps/basemaps` → `tiles/`, Java 21 + Maven; 2–3 h on a large machine).
- **Regional extract** (recommended): `pmtiles extract planet.pmtiles vigil-basemap-2026-09.pmtiles --bbox=-25,-40,180,80 --maxzoom=10`
  using the `pmtiles` CLI (go-pmtiles, BSD-3). A z0–z7 world archive is well under 1 GB; z0–z10 for Europe/Middle East/
  Africa/Asia is a few GB. Vigil does not download archives and never fetches one at startup.
- Attribution requirement: **© OpenStreetMap contributors** (ODbL) and Protomaps stay visible (`THIRD_PARTY_NOTICES.md`).

## Versioned, immutable archives
Name archives by build date and never overwrite: `vigil-basemap-2026-09.pmtiles`, then `vigil-basemap-2026-10.pmtiles`.
Update procedure: upload the new file → `npm run basemap:check` against its URL → change
`NEXT_PUBLIC_BASEMAP_PMTILES_URL` → redeploy → keep the previous archive for a rollback window → delete it later.
Because each URL is unique, caches can be immutable and there is nothing to invalidate.

## Hosting requirements (vendor-neutral)
- **HTTP Range**: the server must answer `Range: bytes=a-b` with `206 Partial Content` and `Content-Range`. A server that
  ignores Range returns the whole file (`200`) — the archive probe reports that and Vigil falls back.
- **Content-Type**: `application/octet-stream` (anything not `text/html`).
- **CORS** (when the archive is on another origin than the app): `Access-Control-Allow-Origin` for the app origin,
  `Access-Control-Allow-Headers: Range, If-Match`, `Access-Control-Expose-Headers: Content-Range, Content-Length, ETag`.
- **Caching**: `Cache-Control: public, max-age=31536000, immutable` for versioned files; enable CDN Range caching
  (or cache-slicing) where the CDN supports it. Prefer HTTP/2 or HTTP/3.
- **Compression**: none (PMTiles is already internally compressed); disable transparent gzip on the archive.

Works with S3-compatible object storage, Cloudflare R2, any CDN in front of object storage, or a plain web server
(nginx/Caddy static files with Range enabled). No provider-specific configuration is hard-coded in the app.

## Verify a deployment
```bash
NEXT_PUBLIC_BASEMAP_PMTILES_URL=https://host/vigil-basemap-2026-09.pmtiles npm run basemap:check
curl -s -o /dev/null -D - -H "Range: bytes=0-126" https://host/vigil-basemap-2026-09.pmtiles   # expect 206 + Content-Range
```
`/admin/basemap` shows the same probe from the running app, the active provider per mode, and what the map did in
your browser.

## Local development
1. Copy or symlink a regional archive into `public/basemaps/` (git-ignored).
2. `.env.local`: `NEXT_PUBLIC_BASEMAP_PMTILES_URL=/basemaps/vigil-basemap-2026-09.pmtiles`
3. Restart `npm run dev`, open `/admin/basemap`, then `/world`.
Without an archive everything still works on the bundled geography.

## Future path (documentation only): PostGIS → Martin
The basemap abstraction returns a MapLibre style, so a Martin tile server can later replace or supplement the archive
without touching map components: add a provider in `lib/map/basemap.ts` whose style uses a `url` TileJSON from Martin
(PostGIS tables/functions or the same PMTiles served through Martin). Dynamic intelligence layers stay Vigil sources
added on top, exactly as they are with PMTiles.
