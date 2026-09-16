# ARCHITECTURE.md — Vigil

## Overview

Vigil is a Next.js (App Router) + TypeScript application. Phase 1 is
frontend-only against a strongly-typed mock data layer that mirrors the
eventual database schema, so swapping mock data for live Supabase/PostGIS
queries later is a data-layer change, not a UI rewrite.

```
Browser (React 19 / Next.js App Router)
   │
   ├── UI components (Tailwind + shadcn/ui primitives)
   ├── Globe (react-globe.gl / three.js), client-only, dynamically imported
   ├── Map (MapLibre GL JS), client-only, dynamically imported
   ├── Charts (Recharts)
   └── Data access hooks (TanStack Query) ── currently backed by /lib/data
                                              (Phase 2+: Supabase client)

Phase 2+:
Next.js Route Handlers / Server Actions
   │
   ├── Supabase (Postgres + PostGIS + Auth + Realtime)
   ├── Ingestion pipeline (news/RSS, conflict-data APIs) → raw_ingestion_items
   ├── AI pipeline (OpenAI) → classification, geocoding assist, briefings
   ├── Market data pipeline → market_prices
   └── Notification pipeline (push / email) → alerts
```

## Frontend

- **Next.js (latest stable), App Router, TypeScript, React 19.**
- **Tailwind CSS** for styling, tokens defined in `tailwind.config.ts` and
  `app/globals.css` from `DESIGN_SYSTEM.md`.
- **shadcn/ui** primitives (button, sheet, dialog, tabs, command palette,
  tooltip) restyled to the Vigil dark theme — used as a base, not a look.
- **Lucide** icons throughout; no emoji, no icon font.
- **Recharts** for trend sparklines, radar (impact dimensions), and market
  price charts.
- **Framer Motion** for panel transitions, count-up numbers, bottom sheets.
- **TanStack Query** wraps all data access (mock now, network later) so
  loading/error states and caching behavior don't change when the source
  does.
- **Zustand** is used only for truly cross-tree client state that doesn't
  belong in the URL: the selected base country, globe interaction state
  (auto-rotate paused/resumed), and active overlay filters. Anything
  page-local stays in component state; anything shareable/bookmarkable
  (selected conflict, active tab) lives in the URL via search params.
- **Zod** validates all mock/data-layer records at the boundary
  (`lib/data/*`), so malformed mock data fails loudly instead of silently
  rendering garbage — this is the same boundary real API responses will be
  validated at later.

## Globe

- `components/globe/Globe.tsx` is a client component, dynamically imported
  with `next/dynamic` and `ssr: false`, so it never touches the server
  render and never throws on environments without WebGL.
- Built on `react-globe.gl` (Three.js under the hood). A custom dark-earth
  texture (procedural gradient + subtle landmass overlay, generated as a
  static asset, not a satellite photo) keeps the look intelligence-grade
  rather than "photo-real Earth."
- Conflict hotspots are rendered as custom HTML/Canvas points sized and
  colored by severity, with a restrained pulse animation (CSS/Motion-driven,
  not per-frame JS) capped to a handful of concurrently pulsing points.
- Auto-rotation runs via `requestAnimationFrame` at a slow fixed angular
  velocity, paused on pointer-down, resumed after ~4s of inactivity via a
  debounced timer.
- Arcs (energy/trade corridors) are a separate optional data layer, toggled
  by the bottom "Energy / Trade" segmented control — never rendered together
  with the plain event layer.
- Performance: capped device pixel ratio on mobile, geometry/segment counts
  reduced below a viewport-width threshold, textures kept small (≤2K),
  globe instance disposed on unmount to avoid WebGL context leaks.

## Operational map (`/world`)

- **MapLibre GL JS** (not Mapbox — no proprietary token dependency), vector
  basemap styled to the Vigil dark palette.
- Event markers clustered client-side (supercluster) at low zoom, degrading
  to individual markers at high zoom; a heatmap layer is a toggle, not a
  simultaneous layer.
- Desktop: three-column layout (event feed / map / selected event detail).
  Mobile: full-bleed map with floating controls and a bottom sheet for the
  feed and event detail.
- Basemap raster tiles are a progressive enhancement only: a solid
  background layer sits underneath them in `lib/map/style.ts`, and every
  vector layer (clusters, points, heatmap) is sourced from local GeoJSON,
  so the map stays fully interactive even if the tile CDN is unreachable.
- MapLibre's GeoJSON source processing runs in a module Worker whose
  script URL it derives from `import.meta.url`, which does not resolve
  correctly under Turbopack bundling. `public/maplibre-gl-worker.mjs` and
  `public/maplibre-gl-shared.mjs` (copied verbatim from
  `maplibre-gl/dist/`) are served as static assets, and
  `components/map/world-map.tsx` points `maplibre-gl`'s
  `config.WORKER_URL` at `/maplibre-gl-worker.mjs` directly so the worker
  loads regardless of the bundler. Re-copy both files from
  `node_modules/maplibre-gl/dist/` if the `maplibre-gl` version changes.

## Data model → see `DATA_MODEL.md`

Phase 1 ships the full TypeScript type layer (`lib/types`) and mock data
(`lib/data`) shaped exactly like the Postgres schema in `DATA_MODEL.md`, so
Phase 2 is "point the hooks at Supabase" rather than "redesign the app."

## Backend (Phase 2+, not built in Phase 1)

- **Supabase**: Postgres + PostGIS (event/country geography), Auth (Google /
  Apple / email), Realtime (event feed updates), Storage (source assets).
- **Ingestion pipeline**: scheduled functions pull news/RSS + conflict-data
  APIs into `raw_ingestion_items`, then a classification step promotes
  qualifying items into `events` with `event_sources` attribution.
- **AI pipeline (OpenAI)**: translation, summarization, classification,
  entity/location extraction, geocoding assistance, duplicate detection,
  conflict matching, brief generation, impact-driver explanation. Always
  grounded in stored `events`/`sources` — never a free-standing claim.
- **Market data**: scheduled pulls into `market_prices`, joined against
  active-conflict tags to compute "Geopolitical Pressure" labels (never a
  causal claim).
- **Notifications**: `alerts` + `subscriptions` tables drive a push/email
  dispatcher once a watched threshold is crossed.

## File architecture

```
/app
  /(marketing or root)/page.tsx        → Home ("/")
  /world/page.tsx                      → Operational map
  /conflicts/page.tsx                  → Conflicts list
  /conflict/[slug]/page.tsx            → Conflict detail
  /event/[id]/page.tsx                 → Event detail (Phase 1 stub)
  /for-you/page.tsx                     → (Phase 2 stub route)
  /markets/page.tsx                     → (Phase 2 stub route)
  /intel/page.tsx                       → (Phase 2 stub route)
  /country/[code]/page.tsx              → (Phase 2 stub route)
  layout.tsx, globals.css
/components
  /globe        → Globe, GlobeHotspot, GlobeLoadingState
  /map          → WorldMap, MapFilters, ClusterLayer
  /events       → EventCard, EventFeed, EventDetailPanel, VerificationBadge
  /conflicts    → ConflictCard, ConflictList, SeverityBadge
  /impact       → ImpactScoreDial, ImpactBreakdown, ExposureRadar
  /markets      → MarketCard (Phase 2 stub)
  /layout       → NavBar, MobileTabBar, CommandSearch, BrandMark
  /ui           → shadcn-derived primitives (button, sheet, tabs, badge…)
/lib
  /data         → mock-countries.ts, mock-conflicts.ts, mock-events.ts,
                   mock-markets.ts, mock-impact.ts
  /types        → country.ts, conflict.ts, event.ts, impact.ts, market.ts
  /utils        → formatting, severity/label mapping, geo helpers
/hooks          → useGlobeInteraction, useBaseCountry, useConflictFilters
/public         → globe textures, brand mark, icons
```

## Testing / verification loop

After each milestone: `npm run typecheck`, `npm run lint`, `npm run build`.
No step is considered done with a known type error, lint error, or failed
production build. Visual verification is done with a headless-browser
screenshot of the running dev server at both a desktop and a mobile
viewport.
