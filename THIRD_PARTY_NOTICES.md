# Third-party notices

Vigil's basemap and map infrastructure use the following open data and software. Attribution required by these
licences is displayed in the map's attribution control and repeated here.

## Map data

| Data | Licence | Attribution / obligation |
|---|---|---|
| **OpenStreetMap** (via a Protomaps basemap PMTiles archive) | ODbL 1.0 | "© OpenStreetMap contributors" must remain visible on any map that shows OSM-derived data. The share-alike clause applies to a derived *database* (the archive), not to Vigil's own intelligence data drawn over it. https://www.openstreetmap.org/copyright |
| **Natural Earth** (world-atlas 110m: land, coastline, country borders, and the bundled fallback geography) | Public domain | Attribution appreciated: "Made with Natural Earth". https://www.naturalearthdata.com |
| **ACAPS Yemen Analysis Hub — Yemen: Areas of control** (via HDX; `data/territorial/acaps-yemen-areas-of-control.json`, dissolved per actor and simplified by Vigil) | CC BY 4.0 | "Areas of control: ACAPS Yemen Analysis Hub, via HDX (CC BY 4.0)". Shown with every area in the Territorial Control selector and detail panel. https://data.humdata.org/dataset/yemen-areas-of-control |

## Software

| Package | Licence | Use |
|---|---|---|
| **PMTiles** (`pmtiles`, Protomaps LLC) | BSD-3-Clause (the format specification is public domain / CC0) | `pmtiles://` protocol for MapLibre |
| **@protomaps/basemaps** (Protomaps LLC) | BSD-3-Clause | Basemap style layers for the Protomaps tile schema |
| **MapLibre GL JS** | BSD-3-Clause | Map renderer |
| **topojson-client**, **world-atlas** | ISC / ISC | Land, coastline and border geometry |
| **h3-js** (development only) | Apache-2.0 | Benchmark script only, not shipped |
| **shapefile**, **fflate** (development only) | BSD-3-Clause / MIT | Territorial dataset import script only, not shipped |

## Fonts (glyphs)

**Noto Sans** (Regular, Medium, Italic) — Copyright Google LLC / The Noto Project Authors, licensed under the
SIL Open Font License 1.1 (https://openfontlicense.org). The pre-rendered glyph ranges 0-255 and 256-511 in
`public/fonts/` come from `protomaps/basemaps-assets` (fonts) and are redistributed under the same licence. Other
ranges are loaded from the configured glyph host at run time.

## Optional external provider

**MapTiler** map styles and tiles are used only when `NEXT_PUBLIC_MAPTILER_KEY` is set (Satellite, and Street/Intel
when no PMTiles archive is configured). MapTiler's own attribution is shown by its style. The key is never
committed.
