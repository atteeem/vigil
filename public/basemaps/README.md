# Local basemap archives

Put a Protomaps-compatible PMTiles archive here for local development, for example `vigil-basemap-2026-09.pmtiles`,
and set `NEXT_PUBLIC_BASEMAP_PMTILES_URL=/basemaps/vigil-basemap-2026-09.pmtiles` in `.env.local`.

`*.pmtiles` files are git-ignored (a world archive is tens of gigabytes; a regional one is still too large for Git).
See `docs/PMTILES_DEPLOYMENT.md` and `docs/BASEMAP_STYLING.md`. Validate a configured archive with `npm run basemap:check`.
