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

## Source ingestion pipeline (Phase 2, local development)

Real, working local-development infrastructure — parallel to the mock-data
UI above, not a replacement for it. SQLite/Prisma per Decisions.md
("Current backend strategy"); this is temporary until the Supabase
migration described later in this file.

**Flow**: `Source` → adapter (`fetchLatest`/`normalize`/`healthCheck`) →
`RawIngestionItem` (deduplicated) → human review in `/admin/incoming` →
`Event` (+ `EventSource` attribution) → merged into `/world`'s live feed.
**Nothing publishes automatically** — publish is always a human action.

- **Adapters** (`lib/ingestion/`): a `SourceAdapter` interface
  (`fetchLatest`, `normalize`, `healthCheck`), implemented for `rss` (a
  dependency-free regex-based RSS 2.0 parser — no XML library needed for
  typical feeds), `manual` (never auto-fetches; human-submitted items go
  through the same normalize→dedupe path via `POST
  /api/admin/incoming/manual`), and `telegram` (placeholder only —
  `fetchLatest`/`healthCheck` always report disabled; real Telegram
  ingestion is explicitly out of scope until authorized credentials
  exist).
- **Deduplication**: `raw_ingestion_items` has a unique constraint on
  `(sourceId, externalId)` (`prisma/schema.prisma`). The RSS adapter sets
  `externalId` to the feed item's GUID, falling back to its link URL, then
  to a synthesized `sourceId:title` key if both are absent — see
  `lib/ingestion/rss-adapter.ts`. `createRawIngestionItemIfNew`
  (`lib/db/repositories/raw-ingestion-items.ts`) checks-then-creates
  against that constraint and returns whether it actually inserted, so a
  re-fetch of an already-seen feed is a guaranteed no-op, not just an
  unlikely collision.
- **Two ways to trigger ingestion**: (1) a background poll loop
  (`lib/ingestion/poll.ts`'s `runIngestionPass`, started once per server
  process from `instrumentation.ts`, default 60s /
  `INGESTION_POLL_INTERVAL_MS`) that polls every `enabled && autoIngest`
  source; (2) an explicit admin "Fetch Now" button per RSS source
  (`POST /api/admin/sources/[id]/fetch`) that polls that one source
  immediately regardless of its auto-ingest flag. Both call the same
  `pollSource()` function, so they behave identically — same dedup, same
  health-tracking (`lastSuccessfulIngestion`/`lastError`), same "never
  publishes."
- **Review & publish** (`/admin/incoming`, `app/api/admin/incoming/`):
  every field (event type, conflict, country/region/location name,
  lat/lng, occurred-at, title, summary, severity, importance,
  verification status) is manually set or corrected by a human before
  publishing — there is no automatic geocoding or AI classification. The
  admin is expected to write an independently paraphrased `Event.summary`
  rather than republish the raw source text verbatim. Publish creates the
  `Event`, links the originating
  `RawIngestionItem` via `EventSource` (`relationship: "originating"`),
  and sets `processingStatus: "published"` on the raw item — the raw item
  is never deleted, preserving the audit trail back to the original
  source.
- **Rejection**: `Reject` sets `processingStatus: "rejected"` on the raw
  item. Rejected items stay in the database (audit/history) but are
  excluded from `/admin/incoming`'s default pending view, never create an
  `Event`, and therefore never appear on the public map.
- **Conflict assignment**: minimum viable support — one `Conflict` row
  (`russia-ukraine`, seeded in `prisma/seed.mjs`, matching
  `lib/data/mock-conflicts.ts`'s entry) is selectable from a dropdown in
  the review form (`GET /api/admin/conflicts`) and stored as the
  published event's `conflictId`. There's no admin CRUD yet for creating
  additional conflicts from the UI.
- **Live refresh**: `/world` merges mock events with published DB events
  fetched via `hooks/use-live-events.ts`, which polls `GET /api/events`
  every 20s (chosen over SSE deliberately — one plain endpoint, no
  transport/reconnect logic, trivially swappable for SSE later if the
  interval becomes a real latency concern; see the map-upgrade commit's
  reasoning, same trade-off). A newly published event reaches the map
  without a manual browser reload.
- **Event detail page** (`app/event/[slug]/page.tsx`): checks mock events
  first, then falls back to a DB lookup (`getDbEventBySlug` in
  `lib/data/world-events.ts`) for a published admin-review event — a
  freshly published RSS-sourced event has a fully working detail page,
  not just a `/world` preview panel. The Sources section shows each
  source's name, an "Originating report" badge on the first
  (originating, non-relay) source, its type (preferring the source's own
  configured category, e.g. "News", over a generic per-adapter label),
  an absolute "Published:" timestamp, and the clickable original URL.

## Backend (Phase 2+, not built in Phase 1)

- **Supabase**: Postgres + PostGIS (event/country geography), Auth (Google /
  Apple / email), Realtime (event feed updates), Storage (source assets).
- **Ingestion pipeline (post-Supabase-migration)**: the local pipeline
  above, migrated onto Supabase — scheduled functions instead of an
  in-process poll loop, `raw_ingestion_items` as a real Postgres table.
  Same flow and dedup rule, different infrastructure underneath.
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

**Phase 2 addition**: a committed Playwright E2E suite (`playwright.config.ts`,
`tests/`) covers the map, filters, admin Source Manager, admin Incoming
Reports (publish/reject), profile/local account, and a responsive nav
smoke test, running under both a Desktop and a Mobile (touch-emulated)
project — `npm run test`. It shares the local SQLite DB rather than
resetting it per run, so assertions avoid depending on exact record
counts where other specs' fixture data could affect them. True
multi-touch pinch-zoom gesture simulation is out of scope (Playwright's
touch emulation doesn't model it usefully) — mobile viewport rendering
and tap interaction are covered instead.
