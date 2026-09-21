# Basemap migration plan: self-hosted PMTiles (optional / fallback)

Status: **plan**. Implemented now: a glyph source for the key-less fallback style (`NEXT_PUBLIC_GLYPHS_URL`, default Protomaps `basemaps-assets`). Not implemented: a PMTiles basemap. It needs a tile archive that cannot be produced or visually verified in this environment, and a wrong basemap is a production-visible regression.

## Current state and problems

- Styles live in `lib/map/style.ts`. With `NEXT_PUBLIC_MAPTILER_KEY` the three modes (Intel/Street/Satellite) use MapTiler-hosted styles; without it every mode is a solid `#0E1116` background.
- Problems: (1) key dependency and a third-party quota; (2) **the fallback style had no `glyphs`**, so the seven text layers (cluster counts, hotspot labels) drew nothing — fixed by adding a glyph URL; (3) borders, labels and disputed boundaries come from the provider and can differ between the flat map and the globe (the globe draws its own borders from Natural Earth); (4) city labels only exist with a key; (5) no control over how disputed boundaries are presented.

## Target architecture

```
OpenStreetMap (ODbL) + Natural Earth (public domain)
   -> Planetiler build profile (protomaps/basemaps/tiles)  -> planet.pmtiles (or regional extract)
   -> object storage / CDN (HTTP range requests)
   -> MapLibre with the pmtiles:// protocol + a style from @protomaps/basemaps (theme "dark" for Intel)

later:
PostGIS (territory, hazards) -> Martin -> vector tiles -> MapLibre     (only when data leaves SQLite)
```

## Requirements

- **Storage:** a full planet basemap is on the order of 100 GB (depends on max zoom). A regional extract (`pmtiles extract --bbox`) for the areas Vigil tracks is a few GB; a low-zoom world (z0–z7) is well under 1 GB and is enough for `/world` and the country pages.
- **Tile generation:** Java 21 + Maven and Planetiler; a planet build takes 2–3 h on a large machine. Alternatively download the daily build from `build.protomaps.com`. A monthly refresh is enough (Vigil's own data is drawn on top).
- **Hosting:** one static file with HTTP range support (S3/R2/nginx). No tile server. CORS must allow `Range`. Cache immutable by build date.
- **Glyphs:** `protomaps/basemaps-assets/fonts/{fontstack}/{range}.pbf` (reachable, HTTP 200 verified; OFL-licensed Noto Sans). For self-hosting copy the fonts directory and set `NEXT_PUBLIC_GLYPHS_URL`. Vigil's text layers use the `"Noto Sans Regular"` stack; keep it.
- **Sprites:** only needed if the basemap style uses icons; Vigil registers its own icons with `map.addImage`.
- **Attribution:** mandatory **© OpenStreetMap contributors** (ODbL: share-alike applies to a derived *database*, not to Vigil's own data drawn over the map) and Protomaps if its hosted assets are used. Put it in the MapLibre attribution control and on the sources page.
- **Expected performance:** one range request per tile (~10–60 KB), cache-friendly, with no per-request key and no style-JSON/sprite/glyph chain from a third party. Client rendering cost is unchanged (vector tiles either way).
- **Disputed boundaries / consistency:** Protomaps draws OSM `disputed=yes` boundaries distinctly. Decide Vigil's cartographic policy once (consistent with the "de facto / reported territorial control" wording) and, if needed, overlay Vigil's own border layer (already used by the heat map: `lib/heat/borders.ts`).

## Migration sequence

1. **Done:** glyphs for the fallback style.
2. Build a small extract (Europe / Middle East / Africa, z0–z10), host it, set `NEXT_PUBLIC_PMTILES_URL`.
3. Add `pmtiles` (BSD-3) and `@protomaps/basemaps` (BSD-3); register the protocol once (`maplibregl.addProtocol("pmtiles", protocol.tile)`); build the style from the `dark` theme and use it as the **key-less fallback only** (never replacing MapTiler while a key exists).
4. Visual regression: Intel/Street/Satellite modes, globe vs flat border consistency, label collisions with hazard layers (layer order: basemap → heat → territory → events → hazards; insert with `beforeId`, per the *source wiring* skill).
5. Optionally make it the default for Intel mode; keep MapTiler for Satellite (imagery is not in Protomaps).
6. Only if Vigil moves to PostGIS: serve territory/hazard vector tiles with Martin.

Use **Maputnik** (development tool) to design the style; never ship it.

## Rollback
The fallback path is env-gated; unsetting `NEXT_PUBLIC_PMTILES_URL` returns to today's behaviour.
