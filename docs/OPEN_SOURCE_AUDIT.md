# Open-Source Acceleration Audit

Audit date: 2026-09-21. Vigil commit audited: `d0e3f78` (Next.js 16 / TypeScript / Prisma 7 SQLite / MapLibre GL JS 6).

## Method and honesty notes

- Each upstream repository was shallow-cloned (`git clone --depth 1`) into a scratch directory and read directly: LICENSE files, top-level layout, package manifests, README, and the specific modules named below. Nothing was installed globally and no upstream code was copied into Vigil.
- **Repomix was not found** in this environment (`repomix` is not on PATH and not in the npm cache; `npx --no-install repomix` fails). Per the instructions it was not installed. Shallow clones plus targeted reads were used instead, which is what a Repomix pack would have been used for.
- The MapLibre Agent Skills **were already installed** (`.claude/skills/*`, committed in `d0e3f78`). Verified: all 9 upstream skills exist locally and every `SKILL.md` is byte-identical (CRLF-normalised) to upstream HEAD `098e7e6` (2026-09-20). Nothing to do.
- "Maintenance" is the date of the latest upstream commit seen on 2026-09-21.
- Licensing is read from the repository's own LICENSE files. This is engineering due diligence, not legal advice; anything marked "ask before shipping" should be checked by the project owner.

## Summary table

| # | Repository | License (verified in repo) | Last commit | Vigil subsystem | Action |
|---|---|---|---|---|---|
| 1 | maplibre-agent-skills | MIT | 2026-09-20 | Dev tooling, map work | **Already installed** — use (C: dev tooling) |
| 2 | playwright-mcp | Apache-2.0 | 2026-09-18 | Dev tooling, visual verification | Recommend install (dev only) |
| 3 | serena | GPL-3.0-or-later app; MIT for SolidLSP | 2026-09-19 | Dev tooling | Dev tool only; never embed |
| 4 | github-mcp-server | MIT | 2026-09-16 | Dev tooling | Recommend (dev only) |
| 5 | spec-kit | MIT | 2026-09-18 | Dev workflow | Optional; not adopted |
| 6 | maplibre-gl-js | BSD-3-Clause | 2026-09-20 | Map renderer | Already the renderer; architecture audited, **fixes adopted** |
| 7 | maputnik | MIT | 2026-09-18 | Basemap styling | Dev/style tool only |
| 8 | maplibre-gl-geo-editor | MIT | 2026-09-15 | Territorial editor | **B: partially adapted** (history, simplify, holes, snapping ideas) |
| 9 | h3-js | Apache-2.0 | 2026-08-24 | Geo aggregation | **Prototype + benchmark**; not adopted (see benchmark) |
| 10 | deck.gl | MIT | 2026-09-20 | Large-data rendering | C: reference; threshold documented |
| 11 | kepler.gl | MIT | 2026-09-20 | Exploration app | D: ignored (application, not a library fit) |
| 12 | PMTiles | BSD-3-Clause (reference impls); spec public domain / CC0 | 2026-09-16 | Basemap | C: plan (`docs/BASEMAP_MIGRATION_PLAN.md`) |
| 13 | protomaps/basemaps | BSD-3-Clause code; **data outputs carry OSM ODbL** attribution/share-alike terms | 2026-09-11 | Basemap | C: plan |
| 14 | martin | Apache-2.0 OR MIT | 2026-09-20 | Vector tile server | C: later phase only |
| 15 | Third-Eye | MIT | 2026-06-12 | OSINT reference | C: patterns only |
| 16 | OSIRIS | **No LICENSE file** (README badge says MIT; fork lineage of Third-Eye) | 2026-05-26 | OSINT reference | C: read-only reference; **do not copy** |
| 17 | IRONSIGHT | MIT | 2026-08-31 | OSINT reference | C: patterns only |
| 18 | WorldMirror | MIT | 2026-03-02 | OSINT reference | C: patterns only |
| 19 | OpenCTI | Apache-2.0 (Community Edition); **Enterprise Edition files under a separate EE licence** (per-file header) | 2026-09-21 | Data model | C: concepts only |
| 20 | RSSHub | **AGPL-3.0** | 2026-09-20 | Source adapters | **Optional external sidecar only**; small config hook adopted |
| 21 | AntV L7 | MIT | 2026-07-30 | Rendering (WebGL layers) | D: ignored (second renderer) |
| 22 | AntV G6 | MIT | 2026-07-15 | Graph visualisation | C: design plan (`docs/RELATIONSHIP_GRAPH_PLAN.md`) |
| 23 | AntV L7Draw | MIT | 2024-08-22 | Drawing/editing | B: snapping algorithm idea only (project is L7-bound and stale) |
| 24 | Mars3D | Apache-2.0 on the repo, but **the library source is not in the repo** (docs/changelog shell; distributed via npm, Cesium-based) | 2026-06-03 | Globe | D/C: idea reference only |
| 25 | mapannai-plus | **No LICENSE file** | 2026-09-20 | MCP architecture | C: read-only architecture reference; **do not copy** |

---

## Per-repository audit

### 1. MapLibre Agent Skills — `maplibre/maplibre-agent-skills`
- **License:** MIT (a note states it is not a derivative work of the MapLibre docs).
- **Relevant Vigil subsystem:** developing/maintaining `/world`, the globe, basemap styles and sources.
- **Useful capability:** nine focused skills: cartography, fonts/glyphs, Mapbox migration, PMTiles patterns, skill authoring, source wiring, terrain rendering, tile sources, v6 migration.
- **Existing Vigil equivalent:** none (Vigil has repo docs, not agent skills).
- **Recommended action:** already installed. Used during this audit (source wiring / glyph / PMTiles guidance informed Phases 3 and 7).
- **Expected benefit:** fewer map-lifecycle mistakes in future map work.
- **Integration difficulty:** none. **Risk:** none (dev-time text files).
- **Upstream files:** `skills/*/SKILL.md`.

### 2. Playwright MCP — `microsoft/playwright-mcp`
- **License:** Apache-2.0. **Language:** TypeScript/Node. **Active.**
- **Subsystem:** development verification (Vigil already has a Playwright test suite).
- **Capability:** lets Claude drive a real browser through accessibility snapshots.
- **Existing equivalent:** the Claude desktop "Browser pane" tools in this session (`mcp__Claude_Browser__*`) and the repo's own `tests/*.spec.ts`.
- **Action:** recommend installing for visual verification in terminals that do not have a browser pane (see Phase 14 below). Not a Vigil dependency.
- **Benefit:** medium. **Difficulty:** low (`claude mcp add playwright npx @playwright/mcp@latest`). **Risk:** low; it runs a browser with the user's permissions.
- **Upstream:** `README.md` (client configuration), `packages/playwright-mcp`.

### 3. Serena — `oraios/serena`
- **License:** per component — the Serena application is **GPL-3.0-or-later**, SolidLSP is MIT (verified in `LICENSE`). Python 3.13, installed with `uv`.
- **Subsystem:** development tooling (symbol-aware navigation over LSP).
- **Action:** dev-only. **Never embed or import** into Vigil (GPL). Not installed by this milestone (the environment has no `uv` verified; see Phase 14).
- **Benefit:** medium on a 100k-line TypeScript repo (find references/rename by symbol). **Risk:** GPL only if redistributed with Vigil — not applicable to a tool on a developer machine.

### 4. GitHub MCP Server — `github/github-mcp-server`
- **License:** MIT. **Language:** Go. Remote endpoint `https://api.githubcopilot.com/mcp/`, or local binary with a PAT.
- **Action:** dev-only; recommend the remote server with read-only toolsets for issue/commit inspection. Vigil has no remote GitHub repository configured yet (local commits only), so there is nothing to inspect today.

### 5. GitHub Spec Kit — `github/spec-kit`
- **License:** MIT. Python CLI (`uv tool install specify-cli`), `/speckit-*` skills.
- **Existing equivalent:** Vigil's milestone specs plus `TASKS.md`, `CLAUDE.md` and the Obsidian vault already provide structured planning.
- **Action:** not adopted; would duplicate the existing planning workflow. Re-evaluate if multiple contributors join.

### 6. MapLibre GL JS — `maplibre/maplibre-gl-js`
- **License:** BSD-3-Clause. TypeScript, WebGL/WebGL2, worker-based. Very active.
- **Subsystem:** `components/map/world-map.tsx` (845 lines), the globe map layer, hazard/territory/heat layers.
- **Findings against Vigil (Phase 3, see below):** the map already creates each source once and updates with `setData`; one real defect found and fixed (event-listener accumulation on every `style.load`), plus polling inefficiencies.
- **Action:** already the primary renderer; keep. Vigil already runs v6 (`public/maplibre-gl-*.mjs`), matching the v6 migration skill.
- **Upstream reference:** `ARCHITECTURE.md`, `docs/`, `developer-guides/`.

### 7. Maputnik — `maplibre/maputnik`
- **License:** MIT. React style editor; hosted at maplibre.org/maputnik.
- **Action:** development/style tool only, for designing the future self-hosted basemap style. Not a dependency.

### 8. maplibre-gl-geo-editor — `opengeos/maplibre-gl-geo-editor`
- **License:** MIT. TypeScript; builds on Geoman Free 0.9.x + `@turf/turf`; requires MapLibre 6.x. Active.
- **Subsystem:** territorial drawing/editing (`components/admin/territory-editor-map.tsx`, `lib/territory/geometry.ts`).
- **Capability:** draw/edit tools, **Undo/Redo** (`HistoryManager` + command objects, default 50 operations), union, difference, split, **simplify (Douglas-Peucker)**, lasso, scale, rotate, cut holes (Geoman), copy, attribute side panel, GeoJSON open/save, **snapping** (`snapEvents.ts`), topology checks (`topology.ts`).
- **Existing Vigil equivalent:** Vigil's editor already has: polygon draw, MultiPolygon, vertex move/insert/remove, validation (self-intersection), union/difference/intersection/split via `polygon-clipping` (`lib/territory/geometry.ts`), versioned publishing (`ConflictTerritory` supersession). **Missing:** undo/redo of edits, hole cutting, snapping, simplify, merge.
- **Recommended action: B — partially adapted.** Adopt the *ideas* (snapshot history with bounded depth, Douglas-Peucker simplify, hole = difference of a drawn ring, vertex/edge snapping) implemented natively in Vigil's own pure geometry module with tests. Do **not** add Geoman/Turf or the plugin: it would create a second polygon editor (Phase 16) and a large dependency for behaviour Vigil already has.
- **Benefit:** high for editors; **difficulty:** medium; **risk:** low (pure functions + UI; territorial history untouched).
- **Upstream files:** `src/lib/core/HistoryManager.ts`, `src/lib/core/commands/*`, `src/lib/features/{UnionFeature,DifferenceFeature,SimplifyFeature,SplitFeature,LassoFeature}.ts`, `src/lib/utils/turfOperations.ts`, `src/lib/core/snapEvents.ts`.

### 9. H3 JS — `uber/h3-js`
- **License:** Apache-2.0 (with NOTICE). JS/WASM-free transpile of H3 v4. Last commit 2026-08-24.
- **Subsystem:** geographic bucketing: report-count hotspot labels (`lib/map/report-counts.ts`), brief hotspots (`lib/brief/activity.ts`), FIRMS aggregation, heat grid.
- **Existing equivalent:** 0.5° lat/lng grid for the heat surface (`lib/heat/grid.ts`), zoom-dependent degree cells for labels, 0.5° cells for briefing hotspots, FIRMS grid aggregates in `GlobalEventAggregate`.
- **Action:** **prototype + benchmark done** (`scripts/bench-h3-vs-grid.mjs`, `docs/H3_BENCHMARK.md`). Result: H3 is 12–15× slower to bucket in JS, memory is comparable, hotspot stability is only marginally better at coarse resolution, and its real advantage (near-uniform cell area at high latitude) can be had far more cheaply. **Not adopted**; current implementation stays. `h3-js` is recorded as a devDependency for the benchmark only.
- **Upstream:** `lib/h3core.js`, `benchmark/`.

### 10. deck.gl — `visgl/deck.gl`
- **License:** MIT. TypeScript, WebGL2/WebGPU, v9.4 beta. `@deck.gl/mapbox` `MapboxOverlay` supports MapLibre interleaving.
- **Action:** C — reference. Vigil's largest layer (FIRMS) is server-aggregated and clustered before it reaches the client (≤ a few thousand features) so MapLibre's GeoJSON/cluster rendering is not the bottleneck. Threshold for adopting deck.gl documented in Phase 6 below.

### 11. Kepler.gl — `keplergl/kepler.gl`
- **License:** MIT. React + Redux application/component library.
- **Action:** D — ignored. It is an exploratory analysis application with its own state/store; embedding it would create a second map application and a Redux dependency.

### 12. PMTiles — `protomaps/PMTiles`
- **License:** BSD-3-Clause for the reference implementations; the format specification is public domain/CC0; sample tilesets carry their own terms.
- **Subsystem:** basemap hosting. **Capability:** single-file tile archive served with HTTP range requests; `pmtiles` JS registers a MapLibre protocol.
- **Action:** C — plan only (see Phase 7): needs a tile file and a style; cannot be verified end-to-end offline in this environment.

### 13. Protomaps Basemaps — `protomaps/basemaps`
- **License:** code BSD-3-Clause (Protomaps LLC). **Data:** defaults to OpenStreetMap (**ODbL, share-alike/attribution**) plus Natural Earth (public domain); attribution `© OpenStreetMap` is mandatory. Fonts/sprites live in `protomaps/basemaps-assets`.
- **Capability:** Planetiler build profile generating `planet.pmtiles` from OSM + Natural Earth in 2–3 h; `styles/` TypeScript package generating MapLibre styles in several themes and languages.
- **Action:** C — plan. The glyph endpoint `protomaps.github.io/basemaps-assets/fonts/...` (HTTP 200 verified) is adopted as the **offline-fallback glyph source** for Vigil's key-less style (see Phase 7).

### 14. Martin — `maplibre/martin`
- **License:** Apache-2.0 OR MIT. Rust tile server for PostGIS, PMTiles, MBTiles, GeoJSON/GeoParquet.
- **Action:** C — later phase only. Vigil uses SQLite/Prisma and serves aggregated GeoJSON; Martin is only worth adding when territorial/hazard data moves to PostGIS.

### 15. Third Eye — `eli-labz/Third-Eye`
- **License:** MIT. Next.js 16 + MapLibre; 16 live layers; last commit 2026-06-12.
- **Overlap:** layers panel, live alerts, view presets, keyboard shortcuts. **Distinct/unsafe for Vigil:** CCTV, live aircraft/vessel tracking, `src/lib/stealthFetch.ts` (anti-bot evasion) — all contradict Vigil's rules (no vehicle positions; no bypassing bot protection).
- **Patterns worth noting:** `src/lib/ssrf-guard.ts` (outbound-fetch allowlist for user-supplied URLs — relevant to Vigil's admin-supplied feed URLs; not adopted because test fixtures deliberately fetch localhost), a `smart_system/` layer (ontology → review → audit) that mirrors Vigil's candidate-review flow, one map component holding all layers, periodic refresh intervals sized to how fast a phenomenon changes (e.g. terminator every 5 min).
- **Action:** C — patterns only.

### 16. OSIRIS — `Isaac2/osiris`
- **License:** **no LICENSE file** in the repository (the README badge claims MIT; the repo carries `DO_NOT_PUSH.md` and fork diffs from a Third-Eye lineage). Treat as **all rights reserved**.
- **Action:** C — read for ideas only. Nothing copied. Same unsafe domains as Third-Eye (aircraft, CCTV).

### 17. IRONSIGHT — `NoblerWorks-HQ/IRONSIGHT`
- **License:** MIT. Next.js + Leaflet; two-theatre dashboard. Last commit 2026-08-31.
- **Patterns:** a *conflict context* (`src/lib/conflicts/*`) that re-points every panel/layer/feed to the selected theatre; panel-per-feed composition; `useDataFeed` polling hook (cache-busting `_t` param, keeps previous data on empty response). Vigil already has a stronger equivalent (conflict pages, country pages, briefs); its polling hook does not pause on hidden tabs and cache-busts every request (worse than Vigil's).
- **Action:** C — patterns only (a "keep previous data if the feed returns empty" guard is worth remembering for provider adapters; Vigil's store already treats absence only in COMPLETE snapshots).

### 18. WorldMirror — `houalexdev/WorldMirror`
- **License:** MIT. Python/Flask, 27 layers, GDELT + USGS + EONET + FIRMS + OpenSky etc.
- **Patterns:** a collector process separate from the web tier (`collector.py`) and static reference layers downloaded once (`layers_downloader.py`). Vigil already separates ingestion (scheduler/`poll.ts`) from reads.
- **Action:** C — patterns only. GDELT is a candidate *provider* (not integrated here).

### 19. OpenCTI — `OpenCTI-Platform/opencti`
- **License:** Community Edition Apache-2.0; **Enterprise Edition files carry a separate EE licence** (each source file header declares which). Whole product: GraphQL platform, ElasticSearch, Redis, RabbitMQ, workers, STIX 2.1 model.
- **Action:** C — concepts only; not copied, not integrated. Details in Phase 9 below.

### 20. RSSHub — `DIYgod/RSSHub`
- **License:** **AGPL-3.0**. TypeScript; ~1,900 route namespaces (`lib/routes`), including `telegram`, `twitter`, `liveuamap`, `reuters`, `apnews`, `aljazeera`, `bbc`, `dw`, `kyodonews`, `nhk`, `cna`, `scmp`, `yna`, `tass`, `sputniknews`.
- **Action:** **optional external sidecar only.** No RSSHub code is copied or linked. Adopted: a tiny `rsshub://` feed-URL scheme resolved against a configurable `RSSHUB_BASE_URL` (disabled if unset). Rationale and rules in `docs/RSSHUB_INTEGRATION.md`.
- **Risk:** network-served AGPL software must not be modified-and-hosted without publishing changes; running it unmodified as a separate service is the intended use. Routes that scrape login-walled or bot-protected sites must not be used.

### 21. AntV L7 — `antvis/L7`
- **License:** MIT. Own WebGL layer engine with map adapters (Gaode, Baidu, Google, Mapbox, its own `earth`). v2.
- **Action:** D — ignored. Would be a second renderer (Phase 16).

### 22. AntV G6 — `antvis/G6`
- **License:** MIT. TypeScript graph engine (v5), 3D/React/SSR extensions.
- **Action:** C — design plan `docs/RELATIONSHIP_GRAPH_PLAN.md`; not built in this milestone (needs a graph query endpoint and a ~1 MB dependency for an optional view).

### 23. AntV L7Draw — `antvis/L7Draw`
- **License:** MIT, last commit 2024-08-22 (stale). Requires L7.
- **Useful:** `src/utils/adsorb.ts` — pixel-tolerance snapping to existing vertices **and to the nearest point on a line** (`nearestPointOnLine`), configurable `pointAdsorbPixel`. The algorithm is what Vigil's snapping implements (own code, Turf-free).
- **Action:** B — algorithm idea only.

### 24. Mars3D — `marsgis/mars3d`
- **License:** Apache-2.0 on the repository contents, but the repo contains only `CHANGE.md`, `LICENSE`, README; the library is a compiled npm package built on Cesium. There is no source to audit.
- **Action:** D — reference for effects (atmosphere, camera fly-to, path animation, measurement). Vigil will not adopt Cesium.

### 25. MapAnNai Plus — `RicterZ/mapannai-plus`
- **License:** **no LICENSE file.** Do not copy.
- **Architecture worth studying:** an MCP server (`@modelcontextprotocol/sdk`) exposing map operations as tools with zod schemas, offered two ways from the same `createMcpServer()`: a **stdio** entry (`mcp-server.ts`) and a **stateless Streamable-HTTP route** (`src/app/api/mcp/route.ts`, POST only, GET/DELETE → 405). Tools are grouped (markers, search, trips). This informs `docs/VIGIL_MCP_PLAN.md`; nothing more.

---

## Phase 3 — Map architecture (MapLibre + skills + Third Eye / OSIRIS / IRONSIGHT)

Vigil's map is already close to the recommended pattern: one long-lived `Map`, sources/layers created once, `setData` on updates, `style.load` re-adds sources after a basemap switch, viewport is quantised before hazard queries, hazard layers ship only aggregated features, layer visibility is toggled (not removed).

| Concern | Finding | Action |
|---|---|---|
| Source/layer lifecycle | Correct (guarded add on `style.load`, `setData` for updates). | none |
| **Event-listener leak** | `map.on("click"/"mouseenter"/"mouseleave", <layer>, …)` (≈15 registrations, plus `territory-fill` and cluster handlers) were made **inside the `style.load` handler**, and `style.load` fires again on every basemap switch (`setStyle`). Each Intel↔Street↔Satellite switch stacked another full set: growing memory, and every click ran N handlers (N repeated `onSelectHazard`/`easeTo` calls). | **Fixed**: interactions registered once at map creation (layer-delegated listeners survive `setStyle`). Test added. |
| Duplicate fetch / polling | `useLiveEvents` replaced React state with a freshly parsed array every 20 s even when nothing changed, which recomputed the heat clock, the filtered feed, and called `setData` each time; it kept polling in hidden tabs. | **Fixed**: unchanged payloads keep the previous array (cheap signature); polling pauses while the tab is hidden and refreshes on return. |
| Hazard polling | Same hidden-tab polling. | **Fixed** (same visibility guard). |
| Viewport-aware queries | Already quantised + debounced + `AbortController`. | none |
| Lazy layer loading | Hazard data is fetched only for enabled layers (`layerKey`). | none |
| Fallback glyphs | The key-less fallback style had no `glyphs` URL, so all seven text layers (cluster counts, labels) could not render. | **Fixed**: `glyphs` set (Protomaps basemaps-assets, overridable with `NEXT_PUBLIC_GLYPHS_URL`). |
| Thermal/FIRMS volume | Server-aggregated & clustered; never raw client dump. | none |
| WebGL memory | `map.remove()` on unmount; heat texture regenerated only when the field signature changes. | none |

Patterns adopted and their inspiration: *interval sized to the phenomenon* (Third-Eye's 5-minute terminator vs 1 minute — Vigil already sizes polling per provider; the hidden-tab pause follows the same reasoning); *keep last good data* (IRONSIGHT `useDataFeed`) — Vigil keeps last good data only when the payload is unchanged/unavailable, never when a complete snapshot legitimately empties.

## Phase 4 — Territorial editor (geo-editor, L7Draw)

Gap analysis vs Vigil (`lib/territory/geometry.ts`, `components/admin/territory-editor-map.tsx`):

| Capability | geo-editor | L7Draw | Vigil before | This milestone |
|---|---|---|---|---|
| Union / difference / intersect / split | yes (Turf) | no | **yes** (`polygon-clipping`) | unchanged |
| MultiPolygon | yes | limited | **yes** | unchanged |
| Validation (self-intersection) | topology.ts | – | **yes** | unchanged |
| Undo / redo of edits | yes (HistoryManager, 50) | – | draw-point undo only | **added** (snapshot history, Ctrl+Z / Ctrl+Y) |
| Holes | via Geoman cut | – | rings supported in data, no tool | **added** (cut-hole tool = difference) |
| Snapping | yes | yes (`adsorb.ts`) | none | **added** (vertex + edge, pixel tolerance) |
| Simplify | Douglas-Peucker | – | none | **added** (validity-guarded) |
| Merge polygons | yes | – | none | **added** |
| Lasso, scale, rotate, copy, attribute panel | yes | – | none | **logged**, not needed for territorial control |

Versioning is untouched: the editor only changes the *draft* geometry; publishing still goes through supersession (`validFrom/validTo`).

## Phase 5 — H3

See `docs/H3_BENCHMARK.md`. Decision: keep the current grid; do not migrate. The continuous heat surface is a distance-transform raster and cannot be replaced by hexagons without visible cells.

## Phase 6 — deck.gl / Kepler / L7 (renderer decision)

Payload sizes reaching the browser today are bounded by design: hazards ≤ a few thousand features after zoom aggregation, conflict events ≤ 300 (`PUBLIC_EVENT_LIMIT`), territory polygons per timeline step, a 720×360 heat raster. None of these is a MapLibre bottleneck. Adopt deck.gl (via `@deck.gl/mapbox` `MapboxOverlay`, interleaved with MapLibre — **not** L7 or Kepler) only if all of the following become true: (a) a layer must draw > ~100k points/paths client-side (raw FIRMS per-detection view, ship/aircraft-scale tracks — currently prohibited by policy), (b) Chrome performance profile shows MapLibre main-thread time > 16 ms per frame at that layer, (c) server-side aggregation cannot answer the use case. Until then: no second renderer.

## Phase 7 — Basemap

See `docs/BASEMAP_MIGRATION_PLAN.md`. Implemented now: fallback `glyphs`. Not implemented: PMTiles basemap (needs a tile archive that cannot be produced here).

## Phase 8 — RSSHub

See `docs/RSSHUB_INTEGRATION.md`. Implemented: `RSSHUB_BASE_URL` + `rsshub://` feed URLs (disabled when unset).

## Phase 9 — OpenCTI concepts vs Vigil

| OpenCTI/STIX idea | Vigil today | Assessment |
|---|---|---|
| `confidence` on every object and relationship | Event confidence derived from source system; territorial claim `confidence`; brief `confidence` with reasons | Aligned; brief adds explainability OpenCTI lacks |
| `first_seen` / `last_seen` | `Event.createdAt/occurredAt`, `GlobalEvent.firstSeenAt/lastSeenAt`, `AlertState` | Aligned |
| Relationship objects with `start_time`/`stop_time` | `ConflictParticipant.validFrom/validTo`, `UnitParentHistory`, `ConflictTerritory.validFrom/validTo`, `CommanderAppointment` | Aligned; not uniform (four bespoke tables) |
| Provenance: `created_by`, `external_references`, markings | `sourceName/sourceUrl/observedAt/confidence` columns on relationship tables; `EventSource`; source trust model | Aligned; **gap:** the columns are repeated per table instead of one shared provenance shape |
| Observed-data / sightings | `EventSource` links (originating vs relay) | Aligned |
| State-change history | `EventHistory`, `GlobalEventRevision`, `StateTransition` (new) | Aligned |
| Author/reliability of sources (Admiralty-like) | `independenceClass`, `claimPolicy`, source trust categories | Aligned |

Ideas that would strengthen Vigil (documented, **not** implemented): (1) one shared `Provenance` value type (`sourceName, sourceUrl, observedAt, confidence, lastConfirmedAt`) used by all relationship tables; (2) a uniform `validFrom/validTo` + `supersededBy` convention on relationship tables; (3) exposing `StateTransition` as a generic "what changed" feed. None needs STIX. Small compatible improvement already present: `StateTransition` from the briefings milestone.

## Phase 10 — G6 relationship view
Design only: `docs/RELATIONSHIP_GRAPH_PLAN.md`.

## Phase 11 — OSINT pattern audit

| Pattern | Inspired by | Vigil status |
|---|---|---|
| Central layer registry with per-layer refresh cadence | Third-Eye (`ThirdEyeMap.tsx` intervals), Vigil `HAZARD_PROVIDERS` | Vigil already has one provider registry; cadence is per provider |
| Theatre/context switch re-pointing all panels | IRONSIGHT (`conflicts/context.tsx`) | Vigil: conflict and country pages (stronger, data-driven) |
| Collector separate from web tier | WorldMirror (`collector.py`) | Vigil scheduler/`poll.ts` (already) |
| Ontology → review → audit pipeline | Third-Eye `smart_system/*` | Vigil candidate review + `AlertRecord`/inspector (already) |
| Outbound URL allowlist (SSRF) | Third-Eye `ssrf-guard.ts` | **Logged** in TASKS.md (not enabled: tests fetch localhost fixtures) |
| Hidden-tab polling pause | general practice; absent in IRONSIGHT/Third-Eye | **Adopted** (Phase 3) |
| Attribution shown per layer | all four | Vigil already shows provider/attribution |

## Phase 12 — Mars3D
Only descriptions/changelog are public in the repo. Ideas worth borrowing conceptually (no code): a fly-to camera transition when selecting a country (Vigil's `focus` jump could use `easeTo`/`flyTo`), atmosphere glow on the globe (Vigil's 3D globe already has one), animated dashed paths for *published territorial front lines* (not vehicle tracks). No Cesium.

## Phase 13 — MCP
See `docs/VIGIL_MCP_PLAN.md`.

## Phase 14 — Claude development tooling

| Tool | Present here? | Recommendation |
|---|---|---|
| Playwright (test runner) | yes (`@playwright/test`) | keep |
| Playwright MCP | no (a built-in browser pane is available in the desktop app) | `claude mcp add playwright npx @playwright/mcp@latest` when working outside the desktop app; add `--headless` for CI |
| Serena | no | `uv tool install -p 3.13 serena-agent`, then `serena init`, then register it as an MCP server for Claude Code (see upstream `02-usage/030_clients`). Requires Python 3.13 + `uv`; not verified installable on this machine — **not installed** |
| GitHub MCP | no | when a GitHub remote exists: remote server `https://api.githubcopilot.com/mcp/` with a read-only toolset; PAT in the environment, never committed |
| Spec Kit | no | not needed; the milestone-spec + `TASKS.md` workflow covers it |
| MapLibre skills | yes | keep updated with `skills-lock.json` |

None of these becomes a Vigil runtime dependency.

## Phase 15 — Ranking

| Candidate | Impact | Effort | Maintenance | Runtime complexity | License risk | Overlap | Decision |
|---|---|---|---|---|---|---|---|
| Fix map listener leak + polling | High | Low | Low | none | none | – | **Done** |
| Fallback glyphs | Medium | Low | Low | none | none | – | **Done** |
| Territory editor: undo/redo, holes, snapping, simplify, merge | High | Medium | Low | none | none (own code) | partial | **Done** |
| RSSHub optional support | Medium | Low | Low | none unless configured | AGPL contained (sidecar) | low | **Done (config hook)** |
| H3 benchmark | Low | Low | none | none | none | high | **Done; not adopted** |
| PMTiles basemap | Medium | High | Medium | tile hosting | ODbL attribution | medium | Plan |
| G6 graph | Medium | Medium | Medium | +dependency | none | none | Plan |
| MCP server | Medium | Medium | Medium | new surface | none | none | Plan |
| deck.gl / L7 / Kepler / Cesium | Low now | High | High | second renderer | none | high | Rejected/deferred |
| Geoman / Turf editor stack | Low | Medium | Medium | second editor | none | high | Rejected |
