# TASKS.md — Vigil

Status legend: `TODO` / `IN PROGRESS` / `DONE`

## Phase 1 — Foundation & Homepage Milestone

| # | Task | Status |
|---|---|---|
| 1 | Documentation: PROJECT.md, ARCHITECTURE.md, DESIGN_SYSTEM.md, DATA_MODEL.md, TASKS.md | DONE |
| 2 | Scaffold Next.js + TS + Tailwind, design tokens, base layout | DONE |
| 3 | Mock data layer: types + 29 countries, 14 conflicts, 100+ events, markets, sources | DONE |
| 4 | Global navigation (desktop top nav + mobile bottom tab bar) | DONE |
| 5 | Interactive 3D globe: rotation, hotspots, click-to-focus, loading/fallback state | DONE |
| 6 | Homepage overlays: Global Status card, Most Relevant To You card, time/layer controls, conflict preview panel | DONE |
| 7 | Mobile homepage composition (bottom-sheet patterns, latest events feed, top-exposure card) | DONE |
| 8 | `/world` operational map: MapLibre, clustering, filters, feed, event detail | DONE |
| 9 | `/conflicts` list + `/conflict/[slug]` detail (Overview/Impact/Timeline/Live Map/Markets/Sources tabs, radar chart) | DONE |
| 10 | `/event/[slug]` detail page | DONE |
| 11 | Responsive cleanup across mobile/tablet/desktop/large-desktop | DONE |
| 12 | Accessibility pass (ARIA labels, keyboard focus, reduced-motion media query, no color-only severity signaling) | DONE |
| 13 | Typecheck / lint / production build clean | DONE |
| 14 | Visual verification via headless screenshot (desktop + mobile, all routes) | DONE |
| 15 | Package and deliver Phase 1 build | DONE |

## Phase 1.5 — Focused Refinement

| # | Task | Status |
|---|---|---|
| 16 | Globe view modes: compact Intel/Satellite switch, camera-preserving, optional Conflicts/Events/Borders/Labels layers | DONE |
| 17 | Centralized severity color system (`lib/utils/severity.ts`): 6-tier thresholds, wine-red Extreme, applied to globe/map/badges/cards/charts | DONE |
| 18 | Navigation audit + restructure: `/world` promoted to primary nav on desktop and mobile, every route reachable | DONE |
| 19 | Profile V1: full accountless Preferences page, localStorage-persisted, auth-gated features clearly marked | DONE |
| 20 | Source/verification consistency audit: verification status derived from source count, contradictions eliminated at the data layer | DONE |
| 21 | Event page: fixed self-referential "Open full event page" link; sources show name/classification/timestamp/URL with dev-data labeling | DONE |
| 22 | Severity vs. Intensity audit: severity now derived directly from intensity via centralized thresholds, no contradictory pairs possible | DONE |
| 23 | Full re-verification: typecheck / lint / production build clean; 30/30 Playwright checks (homepage desktop+mobile, globe touch, Intel/Satellite switching + camera preservation, all routes, nav, source-count consistency) | DONE |
| 24 | Update DESIGN_SYSTEM.md / PROJECT.md / TASKS.md for all Phase 1.5 changes | DONE |
| 25 | Package and deliver Phase 1.5 build | DONE |

## Phase 2 — Local-Development Functional Build

Full spec: see [[Map Requirements]] / [[Globe Requirements]] / [[Profile and Accounts]] / [[Decisions]] in the Obsidian vault (`D:\GLOBAL CONFLICT CLAUDE`).

| # | Task | Status |
|---|---|---|
| 26 | `/world` map: MapTiler-backed Intel/Street/Satellite basemap modes, camera-preserving switch, zoom 1–22, `NEXT_PUBLIC_MAPTILER_KEY` env wiring with graceful no-key fallback | DONE |
| 27 | Fixed latent bug: CARTO's free anonymous raster tiles now require their own key and were rendering "API KEY REQUIRED" watermarks; no-key fallback is now a clean solid background | DONE |
| 28 | Map label/zoom hierarchy (continents → buildings) | TODO — relies on MapTiler's built-in style cartography once a real key is added; not hand-tuned per-layer yet |
| 29 | Original Vigil event icon system: 21-category canvas-drawn SDF icon set, severity-tinted, zoom-tiered (clusters → simplified dots → full icons at zoom 11+) | DONE |
| 30 | SQLite + Prisma repository layer (sources, raw_ingestion_items, events, event_sources, conflicts). Prisma 7's driver-adapter model required `@prisma/adapter-better-sqlite3` + `prisma.config.ts` rather than the older schema-embedded `url` — see prisma.config.ts / lib/db/client.ts comments | DONE |
| 31 | Source ingestion adapters (RSS — dependency-free regex parser; Manual; Telegram-authorized placeholder, verified disabled end-to-end via admin "Test") | DONE |
| 32 | Admin Source Manager (`/admin/sources`) | DONE |
| 33 | Admin Incoming Reports queue (`/admin/incoming`) — Publish/Edit/Merge/Reject, no auto-publish | DONE |
| 34 | Event publishing workflow → live `/world` map, via `/api/events` polling (`hooks/use-live-events.ts`) merged with mock data | DONE |
| 34a | Known gap: published events can't be linked to a `Conflict` from the admin UI yet — the `conflicts` table has no seed data or admin CRUD, so `conflictId` stays null. Not blocking; flagged rather than silently skipped. | TODO |
| 35 | Local-development account system: `AuthProvider`/`AccountProfile` abstraction (`lib/auth/`), localStorage-backed, SHA-256 password digest (explicitly documented as not secure production auth), profile picture accepted as JPEG/PNG/WebP and downscaled client-side to a small data URI | DONE |
| 36 | Profile page upgrade: logged-out header (Create Account / Sign In) + authenticated header (avatar/name/email, Edit Profile, Sign Out), all existing device preferences kept intact, new "Default map mode" card added alongside the existing "Default globe view" card | DONE |
| 37 | Full responsive/testing pass: `playwright.config.ts` + `tests/` (map, filters, admin Source Manager, admin Incoming Reports publish/reject, profile/account, responsive nav smoke test) across Desktop + Mobile projects. `npm run test`. Scope note: true multi-touch pinch-zoom gesture simulation isn't covered (Playwright's touch emulation doesn't model it well) — mobile viewport rendering/interaction is | DONE |

## Beyond the Phase 1 floor (built ahead of schedule)

The spec listed these as later-phase, but they were straightforward
extensions of the same mock-data engine, so they were built as bonus pages
rather than left as stubs:

- `/for-you` — full personalized exposure breakdown (5-dimension radar,
  driver explanations, top conflicts affecting the selected country).
- `/markets` and `/markets/[id]` — market index cards + detail with
  non-causal "geopolitical pressure" language per spec's information-ethics
  rules.
- `/intel` — regional briefing summaries generated from the same
  transparent computation as the conflict situation snapshots (no AI).
- `/country/[code]` — per-country profile with exposure + related
  conflicts.
- `/profile` — base-country selector stub.

## Explicitly deferred (not Phase 1, per spec §31 scope boundary)

- Real API integrations (news/RSS, conflict data, market data, geocoding).
- AI briefing generation (situation snapshots are template/data-driven, not
  LLM-generated, and are labeled as such in the UI).
- Alerts/notifications delivery, subscriptions/payments.
- Supabase Auth / real accounts, PostGIS-backed database (DATA_MODEL.md
  documents the target schema; Phase 1 runs entirely on in-memory mock
  data).
- Automated data ingestion pipeline.

## Decision log

- **Product name**: "Vigil" (original branding; "Impact Score" kept as the
  spec's working name for the personalized exposure metric).
- **Map library**: MapLibre GL JS chosen over Mapbox GL to avoid a
  proprietary token dependency, per spec's "similarly production-ready"
  allowance.
- **Globe library**: `react-globe.gl` (Three.js-based) per spec's suggested
  option. Uses three-globe's `polygonsData` (flat/extruded polygon) layer
  for landmass rendering rather than `hexPolygonsData` — the hex-binned
  layer's underlying `h3-js` dependency throws on the antimeridian-crossing
  polygon geometry in the bundled `world-atlas` land data, and the flat
  polygon layer gives an equivalent look (including a faint accent-colored
  border stroke) without that dependency.
- No custom Three.js objects are constructed in app code and passed into
  `react-globe.gl` props (e.g. no hand-built `THREE.Material`). Doing so
  risks a duplicate Three.js module instance alongside the one bundled
  inside `three-globe`, which crashes the whole render tree at runtime
  (`instanceof`-based internals fail across module boundaries). The globe
  uses `react-globe.gl`'s built-in materials/lighting only.
- MapLibre's basemap raster tiles come from CARTO's free `dark_all` style
  (no token required). Tile *fetch* failure (offline, corporate proxy, ad
  blocker) is handled as a progressive-enhancement gap: a solid background
  layer underneath the raster layer keeps the map reading as an
  intentional dark surface, and MapLibre's vector layers (clusters, point
  markers, heatmap) never depend on tile network access, so the map stays
  fully interactive with zero tiles loaded.
  **Superseded** — see `D:\GLOBAL CONFLICT CLAUDE\Decisions.md` §
  Basemap provider. MapTiler is now the basemap provider decision for the
  map upgrade (high-detail vector mapping, deep zoom, dynamic labels,
  buildings, multiple styles); this entry is kept for historical context
  only.
- MapLibre's own GeoJSON/vector-tile source processing runs in a dedicated
  module Worker whose script URL it derives from `import.meta.url` at
  runtime; that derivation does not resolve to a usable URL under Next.js
  16's Turbopack bundling (dev or prod), so without a fix the worker
  silently never loads and no source data renders — clusters, point
  markers, and the heatmap all stay empty even though the map canvas
  itself looks fine. Fixed by shipping the two files MapLibre's worker
  needs (`maplibre-gl-worker.mjs` + its `maplibre-gl-shared.mjs`
  dependency, copied from `node_modules/maplibre-gl/dist/`) as static
  assets under `public/` and pointing `maplibre-gl`'s `config.WORKER_URL`
  at `/maplibre-gl-worker.mjs` directly, bypassing the broken runtime URL
  derivation. If `maplibre-gl` is upgraded, re-copy both files from the
  new version's `dist/` folder.
- No external paid APIs or backend implemented in Phase 1, per spec §31.

### Phase 1.5 decisions

- **Satellite globe mode did not require a new globe library.**
  `react-globe.gl`/`three-globe` already expose `globeImageUrl`/
  `bumpImageUrl` texture props, satisfying the "least destructive
  compatible method" requirement without touching the globe engine.
  Imagery (`earth-blue-marble.jpg`/`earth-topology.png`) and border/label
  vector data (`country-borders.json`) are public-domain NASA/Natural
  Earth assets, self-hosted from copies already bundled as example data
  inside the project's own `three-globe` dependency — not fetched from or
  derived from Google Earth or any other third-party mapping product.
- **Borders/Labels layer performance**: three-globe's `pathsData` layer
  builds one mesh/line object per path with no merge/batch support
  (unlike `pointsData`, which is merged). Initial timing measurements
  using Playwright's `locator.click()` showed a 3–6s stall toggling
  Borders, which led to three real mitigations (default-off, one ring per
  country instead of every ring [289→177], raised `pathResolution`,
  dropping `pathStroke` to avoid three-globe's heavier per-path
  `Line2`/`LineMaterial` "fat line" renderer). Direct in-page
  `performance.now()` instrumentation subsequently showed most of that
  measured time was actually Playwright's own actionability-check retry
  loop fighting an actively auto-rotating canvas under this sandbox's
  *software-rendered* (swiftshader) WebGL, not synchronous application
  work — real cost is a ~1.1s one-time lazy-import (paid once, only if a
  user opts in) plus ~550–600ms for the actual geometry build + first
  paint under software rendering, which should be substantially cheaper
  on real GPU hardware. The mitigations above are kept regardless, since
  they're genuine, real reductions in work and specifically help weaker
  mobile GPUs.
- **Severity/verification "single source of truth"**: both are now
  *computed*, not independently authored. `Conflict.severity` is
  `severityFromScore(intensity)` (see `mock-conflicts.ts`); event
  `verificationStatus` is picked from a weighted distribution keyed by
  `sourceCount`, not the other way around (see `mock-events.ts`). This
  makes the two classes of contradiction the spec flagged (severity vs.
  intensity; verification vs. source count) structurally impossible
  rather than something to catch by review, and is the pattern any future
  real-data ingestion pipeline should preserve.
- **Placeholder source URLs**: mock event sources link to
  `https://example.com/...` (the IANA-reserved documentation domain,
  guaranteed to never resolve to a real or spoofable site) with an
  explicit "Development data — placeholder link, not a live source" note,
  rather than fabricating URLs that look like real outlets.
