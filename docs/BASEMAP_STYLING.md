# Basemap styling (Maputnik workflow)

Maputnik (https://maplibre.org/maputnik/, MIT) is a **development tool only**. Vigil has no runtime dependency on it;
you use it to design and inspect a style, then copy the decisions into the repo's style code.

## Where the Vigil style lives

| Piece | File | Notes |
|---|---|---|
| Provider selection, env config, fallback order, attribution | `lib/map/basemap.ts` | The one authority. Map components never contain provider logic. |
| Style builders | `lib/map/vigil-style.ts` | `buildPmtilesStyle()` (Protomaps schema over PMTiles) and `buildBundledStyle()` (key-less geography). |
| Colours | `VIGIL_INTEL_FLAVOR` in `lib/map/vigil-style.ts` | A Protomaps `Flavor` (dark, quiet). |
| Road/label tuning | `tune()` in `lib/map/vigil-style.ts` | Removes POIs/buildings/addresses, raises road `minzoom`, sets the label hierarchy. |
| Protocols | `lib/map/pmtiles-protocol.ts`, `lib/map/glyph-protocol.ts` | `pmtiles://` and `vigil-glyphs://`, each registered once. |

Every basemap layer id is prefixed `bm-` and carries `metadata["vigil:role"]` = `basemap-border`, `basemap-label` or
`basemap-fill`. Vigil's own layers (`heat-surface`, `territory-*`, `clusters`, `hz-*`, ...) never use that prefix.

## Load the style into Maputnik

1. Export the current style from the repo (writes nothing to the app):
   ```bash
   node --input-type=module -e "import('@protomaps/basemaps').then(m=>{const s={version:8,glyphs:'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',sources:{protomaps:{type:'vector',url:'pmtiles://https://YOUR-HOST/vigil-basemap-2026-09.pmtiles'}},layers:m.layers('protomaps',m.namedFlavor('dark'),{lang:'en'})};console.log(JSON.stringify(s,null,2))})" > vigil-style.json
   ```
   (This is the vendor dark style; Vigil's tuning is applied in `tune()`. For the exact production JSON, add a temporary
   `console.log(JSON.stringify(buildPmtilesStyle("intel", url, glyphs)))` in a scratch test.)
2. Open https://maplibre.org/maputnik/ → **Open** → **Upload** `vigil-style.json`.
3. The PMTiles source needs the `pmtiles://` protocol, which Maputnik's hosted build does not register. Edit the
   `protomaps` source to a TileJSON/`tiles` URL from a tile server (for example Martin serving the same archive), or use
   the standalone viewer at https://pmtiles.io to inspect the archive layers and the style separately.

## Source definitions
- One vector source, `protomaps` (`url: pmtiles://<archive>`), with attribution "Protomaps © OpenStreetMap".
- Source layers in the Protomaps schema: `earth`, `landcover`, `landuse`, `water`, `roads`, `buildings`, `boundaries`,
  `places`, `pois`. Layer `source-layer` names must match; a typo draws nothing and raises no error (see the *source
  wiring* skill in `.claude/skills/maplibre-source-wiring`).

## Glyphs and sprites
- `glyphs` is `vigil-glyphs://{fontstack}/{range}` in the app (local-first). In Maputnik use the remote template above.
- Fonts used: `Noto Sans Regular`, `Noto Sans Medium`, `Noto Sans Italic`. Shipped ranges: 0-255 and 256-511 under
  `public/fonts/` (OFL). Adding a font stack means adding its ranges there **and** to `basemap:check`.
- Sprites are **not used**: the style has no icon layers (POIs are removed). Vigil registers its own map icons with
  `map.addImage`. If a future style needs sprites, add `sprite` to the builder and a sprite section to `basemap:check`.

## Edit, export, validate, test
1. Edit colours/zoom ranges in Maputnik; note the values.
2. Apply them in `VIGIL_INTEL_FLAVOR` / `tune()` (keep changes declarative; do not fork vendor layer JSON).
3. Validate: `npm run basemap:check` (style spec validation, required layers, fonts, glyph ranges, attribution).
4. Test: `npx playwright test tests/basemap.spec.ts` (layers, glyphs, fallback, style switching) and look at the map at
   world / Europe / Middle East / Africa / Central Asia / East Asia / Americas zoom levels.

## Style rules
- The heat surface must stay visually dominant: land `#141a22`, water `#090d13`, borders `#566178`, labels ≤ 60 % white.
- Labels sit above the heat surface (Vigil inserts the heat layer beneath the first basemap symbol layer) and below
  interactive markers; they have no click handlers.
- Never put conflicts, reports, events, heat, territory, hazards, infrastructure or actors into the archive.
- Disputed boundaries: the Protomaps schema draws the `boundaries` layer as delivered; Vigil does not infer disputed
  status from styling. If a dedicated disputed layer is added later it must be driven by a data attribute.
