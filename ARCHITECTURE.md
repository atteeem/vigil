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
- **Event cluster markers** (`lib/globe/event-clusters.ts`, spec "globe
  cluster counts"): three-globe's `pointsData` layer (`pointsMerge: true`)
  is a single merged mesh for performance, which is exactly why it can't
  show a per-point count label — there's no per-point DOM/HTML there to
  put text on. Individual events are clustered instead (`clusterEvents`,
  a greedy lat/lng-radius grouping — a display-density heuristic, not a
  precise geospatial partition) and rendered through the SAME
  `htmlElementsData` layer conflict hotspots already use (three-globe
  only exposes one such layer; `conflict-globe.tsx`'s `GlobeMarker` union
  tags each item so one `htmlElement` factory dispatches to
  `makeHotspotEl` or the new `makeClusterEl`). A cluster of one event
  renders as a plain severity-colored dot (matching the old merged-points
  look); two or more show a count overlay, capped at the display label
  "99+" (never the real count, which `EventCluster.count` still carries
  internally). The clustering radius scales with the camera's own
  altitude (`clusterRadiusForAltitude`, polled every 300ms off
  `globeRef.current.pointOfView()` rather than a per-frame subscription,
  bucketed to one decimal so unrelated camera motion — e.g. pure
  rotation, which doesn't change distance — doesn't trigger a
  recompute), so zooming out merges a region into fewer/larger clusters
  and zooming in splits them apart.
- **Borders** (`lib/globe/country-borders.ts`, `lib/globe/globe-colors.ts`,
  spec "normal globe borders" / "Globe readability"): on by default
  (`DEFAULT_GLOBE_LAYERS.borders` in `hooks/use-app-store.ts`) on the
  Intel globe specifically — suppressed in Satellite mode regardless of
  the toggle state, since photographic imagery doesn't need line-art
  country outlines overlaid. Still lazy-imported only once a session
  actually needs it (Intel is the default view mode, so this now happens
  on first paint rather than only when a user opts in), and still capped
  to one ~22-point ring per country (pre-existing decimation) — the
  measured cost is a bounded ~0.5–1s one-time hit, not a per-frame cost,
  which is what makes defaulting it on compatible with the "keep first
  paint fast" reasoning that originally justified leaving it off (see
  Decisions.md). **Fixed a real invisibility bug** (spec "verify borders
  are actually visible in-browser, not just enabled in config"): borders
  were on by default but rendered in the exact same color as the
  landmass fill's cap color sitting on top of them (`polygonAltitude`
  0.006 vs. the border's old `pathPointAlt` 0.002 — the fill was both
  color-matched AND literally in front), so a border was invisible
  everywhere it crossed land instead of coastline, which is the common
  case for a political border. Now rendered at `pathPointAlt` 0.0065
  (above the land fill, still well below `htmlElements`/labels at
  0.011–0.012) in a named, distinct `BORDER_COLOR`
  (`lib/globe/globe-colors.ts`, plus a `colorDistance()` helper the test
  suite uses to assert the fill and border colors are actually far apart
  in RGBA space — a regression guard a plain string-inequality check
  wouldn't catch). **Disputed/indeterminate boundaries** (Natural
  Earth's own `TYPE` field on the bundled dataset — "Disputed" for
  Palestine, "Indeterminate" for Western Sahara/Somaliland/Antarctica,
  genuinely relevant to a conflict-tracking app) render with a distinct
  dashed amber `DISPUTED_BORDER_COLOR` instead of blending in as an
  ordinary undisputed border (`GlobePath.disputed`, set once in
  `getCountryBorderPaths()`); dashing uses `pathDashLength`/
  `pathDashGap` per-path accessors, which three-globe implements as a
  shader uniform on its plain (non-fat-line) `THREE.Line` renderer, so it
  costs nothing extra over a solid line.
- **City labels** (`lib/globe/city-labels.ts`, spec "Globe readability" §2):
  no populated-places dataset existed anywhere in this project or bundled
  with `three-globe` (only country polygons), so this is a small
  hand-curated static list (~200 entries, no new dependency) rather than
  a geocoding-grade gazetteer — tiered exactly like `getCountryLabels()`'s
  existing `labelRank` filtering, but by hand: tier 1 (capitals + major
  global cities, world zoom), tier 2 (major regional cities), tier 3
  (further notable cities, close zoom). `cityLabelTierForAltitude()`
  maps the same camera-altitude value the event-cluster radius already
  polls (see above) to a max tier, calibrated so the globe's own default
  resting altitude (~2.15 desktop / ~2.6 mobile) lands in the
  tier-1-only bucket, zooming in reveals tiers 2 then 3, and zooming out
  far enough (>3.2) hides city labels entirely. Reduced by one tier on
  mobile and in Satellite mode. Shares three-globe's single `labelsData`
  layer with the pre-existing country-name labels via a `GlobeLabel`
  tagged union (`{kind:"country"}` / `{kind:"city"}`) — country names
  render larger/brighter (they name a whole region); city names are
  smaller, subtler point labels, one size step down again per deeper
  tier, so the busiest close-zoom tier doesn't visually compete with
  tier-1 capitals. Both label kinds render via three-globe's canvas-
  sprite text layer, which has no click handler wired up
  (`onLabelClick` is never set) — labels are structurally non-
  interactive and live in a different render layer from the
  `htmlElementsData` marker buttons entirely, so they can never intercept
  a click meant for a conflict hotspot or event cluster regardless of
  z-order. **Overlap** is handled by curation, not runtime collision
  detection: three-globe has no built-in label-declutter system for
  `labelsData`, so each tier's city list was hand-spaced with real
  geographic separation rather than left to chance — this is why the
  dataset is static/curated instead of pulled from a denser source that
  would need that machinery.
- A returning browser's already-persisted `globeLayers` preference
  (zustand `persist`, `hooks/use-app-store.ts`) does not automatically
  pick up a later change to `DEFAULT_GLOBE_LAYERS` — the persisted value
  wins over the code's default for any key it already contains. The
  Borders/Labels-on-by-default fix ships with `version: 1` and a
  `migrate()` that forces `borders`/`labels` to `true` for any persisted
  state saved under the previous (unversioned) state, so this exact class
  of "the config says true but a real user's browser still shows it off"
  bug can't quietly persist for anyone who used the app before this fix.
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
- **Heatmap mode** (`lib/map/heat-layers.ts`) is `circle` layers with heavy
  `circle-blur`, not MapLibre's native `heatmap` layer type — that type's
  `heatmap-density` is a spatial sum of nearby weighted points, so color is
  structurally coupled to how many reports are nearby (more reports in an
  area pushes it toward red regardless of their individual severity). Two
  feature groups separate that out:
  - `events-heat` (per event): color = `severity` directly (the same
    `SEVERITY_COLOR_MATCH` match expression the marker layers use), radius
    = `importance` (geographic/significance scope, wider range than the
    old fixed 26px), opacity = independent source count (corroboration) ×
    an age-based decay curve (recency) — multiplied, not summed, so
    neither factor alone can force full strength.
  - `conflict-base-heat` (per conflict, underneath): one wide glow per
    `conflictId` group, centered at the group's centroid, radius scaled by
    the group's own geographic spread (haversine `distanceKm` from
    `lib/utils/geo.ts`, with a floor so even a tight cluster reads as an
    area, not a point), colored by the group's *worst* (max-ranked)
    severity — never an average or a count — and NOT recency-decayed, so
    an active conflict's footprint persists through temporary reporting
    gaps. Events with no `conflictId` (one-off incidents) get no base
    layer, only their own event-hotspot.
  Both are built by `eventsToHeatGeoJSON`/`conflictBaseGeoJSON` against
  the same "now" reference (`MOCK_NOW`) the rest of the mixed mock+live
  event set already uses for relative-time display, kept in their own
  GeoJSON sources (`events-heat`, `conflict-bases`) separate from the
  clustered `events` source marker-mode uses, and toggle visibility
  together with the existing Markers/Heatmap control — no new UI.
  Each feature group renders as **three concentric `circle` layers**
  (`-outer`/`-mid`/`-core` suffixes, `GRADIENT_RINGS` in
  `world-map.tsx`) sharing one radius/opacity/color expression scaled by
  a per-ring multiplier, rather than one blurred circle — a single
  `circle-blur`'d shape still composites toward a fairly solid-looking
  disc wherever several same-severity glows overlap (the normal case in
  a genuinely active area), with only the outermost boundary reading as
  soft; three rings of decreasing radius/increasing opacity make the
  transparent-edge-to-strong-center gradient unambiguous regardless of
  how many neighboring glows overlap it.

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
  typical feeds; sends an explicit `Accept` header, since at least one
  real feed — ReliefWeb — does content negotiation and 406s a request
  without one), `manual` (never auto-fetches; human-submitted items go
  through the same normalize→dedupe path via `POST
  /api/admin/incoming/manual`), and `telegram` (a real MTProto
  integration via `teleproto`, entirely credential-gated — see "Telegram
  architecture" below; `fetchLatest`/`healthCheck` report disabled until
  `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION` are all set,
  never falling back to scraping or any other unauthorized method).
- **Deduplication**: `raw_ingestion_items` has a unique constraint on
  `(sourceId, externalId)` (`prisma/schema.prisma`). The RSS adapter sets
  `externalId` to the feed item's GUID, falling back to its link URL, then
  to a synthesized `sourceId:title` key if both are absent — see
  `lib/ingestion/rss-adapter.ts`. `createRawIngestionItemIfNew`
  (`lib/db/repositories/raw-ingestion-items.ts`) checks-then-creates
  against that constraint and returns whether it actually inserted, so a
  re-fetch of an already-seen feed is a guaranteed no-op, not just an
  unlikely collision.
- **Source scheduler** (`lib/ingestion/scheduler.ts`, spec "Source
  Scheduler"): each enabled+auto-ingest source polls on its own
  `pollIntervalMinutes` (default 5 for RSS, editable per source in
  `/admin/sources`), not one blanket interval shared by every source. A
  source is "due" once its `nextPollAt` has passed (or was never set —
  a brand-new source). `schedulerTick()` runs far more often than any
  source's own interval (`SCHEDULER_TICK_INTERVAL_MS`, default 30s,
  started once per server process from `instrumentation.ts`) — the tick
  itself is cheap (one indexed query when nothing is due); it's what
  lets each source's own interval take effect promptly. An in-memory
  `Set` of currently-polling source ids stops the same source being
  polled twice if a tick fires again before a slow fetch finishes (no
  cross-process locking needed — this is a single-process local-dev
  server per Decisions.md). Due sources within one tick are polled
  through a bounded-concurrency worker pool (`MAX_CONCURRENT_FETCHES = 4`
  — a free slot immediately claims the next due source, rather than
  fixed-size batching that would leave slots idle whenever one source is
  slower than its batch-mates), so one source's failure or hang (bounded
  by `pollSource`'s own fetch timeout, `INGESTION_FETCH_TIMEOUT_MS`,
  default 20s) never blocks another (spec "A failed source must not
  break other sources"), and firing every due source in the same instant
  never happens regardless of how many are due at once — a real problem
  found live (see Decisions.md "Source polling"): this sandbox's network
  has limited concurrent-connection headroom, and polling ~9 real
  sources simultaneously caused several to hit connect timeouts that
  succeeded individually moments later. Repeated failures back off
  exponentially (capped at 8x the normal interval), reset to normal on
  the next success — and a `429`/`5xx` response's `Retry-After` header
  (parsed in `lib/ingestion/errors.ts`, RFC 9110 §10.2.3 delta-seconds or
  HTTP-date) is a *floor* on that delay: it wins over a shorter
  backoff-computed one, but never shortens a longer one from several
  prior failures. `lib/ingestion/rss-adapter.ts` throws a typed
  `HttpFetchError` (status + parsed `Retry-After`) uniformly for any
  non-2xx response — 403/406/429/5xx are all handled the same way, no
  per-status special-casing.
- **Two ways to trigger a poll**: (1) the scheduler above, for due
  sources; (2) an explicit admin "Fetch Now" button per source (any
  type, not just RSS — `POST /api/admin/sources/[id]/fetch`) that polls
  that one source immediately regardless of due status. Both call the
  same `pollSource()` function (`lib/ingestion/poll.ts`), so they behave
  identically — same dedup, same health-tracking
  (`lastSuccessfulIngestion`/`lastError`/`lastAttemptedAt`/
  `nextPollAt`/an `IngestionLog` row), same automated-processing
  trigger, same "never publishes."
- **Source health** (`/admin/sources`, spec "Source Health"): Live /
  Error / Disabled status, last successful fetch, last attempted fetch,
  next scheduled fetch (all read straight off the `Source` row), plus
  items received / new items / errors "today" — the latter two need
  aggregation across the day's individual poll attempts (not just a
  dedup-guaranteed-unique raw-items count, which can't tell "seen again"
  from "genuinely new" or see failed attempts at all), so they're
  computed from `IngestionLog`, an append-only row per attempt
  (`lib/db/repositories/ingestion-logs.ts`).
- **Source trust model** (spec "Source Trust Model" — deliberately not a
  trusted/untrusted boolean): `Source.sourceRole` is a controlled
  vocabulary — `originating` / `relay` / `official` / `local_media` /
  `eyewitness_community` / `aggregator` (`lib/types/db.ts`
  `SOURCE_ROLES`) — alongside the existing free-text `sourceCategory`
  (e.g. "News") and `reliabilityTier` (e.g. "A") fields. Per-event
  verification (`Event.verificationStatus`) stays separate and
  event-specific, unaffected by a source's role.
- **Telegram architecture** (spec "Telegram architecture"):
  `TelegramAuthorizedSourceAdapter` (`lib/ingestion/telegram-adapter.ts`)
  is a real MTProto integration via `teleproto` (an actively-maintained
  fork of GramJS — `npm install telegram` resolves to the archived,
  vulnerability-flagged original package, which its own deprecation
  notice points at teleproto as the replacement), entirely gated behind
  `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` / `TELEGRAM_SESSION` env vars
  (never committed — `.env.local` only). Until all three are set,
  `fetchLatest()` returns `[]` and `healthCheck()` reports disabled,
  exactly like the old placeholder — there is still no generic
  unauthorized scraping path. Once credentials exist, `fetchLatest()`
  calls `client.getMessages(handle, {limit: 20})` and preserves, per
  message: channel + message id (the dedup `externalId`), a
  `https://t.me/<channel>/<id>` message URL, timestamp, and original
  text. The three pre-registered channels (`@lumsrc`, `@dnipro_now`,
  `@huyovy_kharkiv`, `prisma/seed.mjs`) are unchanged and still
  `enabled: false` — this integration is **not verified against live
  Telegram** in this environment (no credentials available); validating
  it is the first thing to do once real credentials are configured.
- **Duplicate handling in the incoming queue** (spec §7/§8): a
  "Possible duplicate — N%" badge renders directly on each collapsed
  report card in `/admin/incoming`, not only after clicking Review — the
  list endpoint (`GET /api/admin/incoming`) computes each pending item's
  top duplicate candidate live (via `findDuplicateCandidates()`, reusing
  its persisted suggested-location snapshot), never snapshotting the
  score itself (an event published after an item arrived could newly
  duplicate it — a stale "no duplicate" reading would be actively
  unsafe, unlike the other snapshot fields below). The queue also
  supports filtering by Source / Conflict / Region / Event type /
  Processing status / Duplicate likelihood / Age, and sorting by
  Newest / Oldest / Highest importance / Highest duplicate probability
  — the first group filters at the DB level against the suggestion
  snapshot below; duplicate likelihood/sort apply in memory after the
  live per-item computation.
- **Admin event-matching UX** (spec's "event-matching UX" stage,
  building on the duplicate-candidate engine above): opening Review and
  expanding a candidate shows "Likely existing event — N%" (the
  collapsed card's own badge keeps the shorter "Possible duplicate —
  N%" wording — they're two different UI surfaces, only the expanded
  one was in scope for the wording spec named), plus the matched
  event's type/country-or-region/relative time on one line (e.g. "Drone
  · UA · just now", via `getEventTypeLabel()`) and every entry of
  `DuplicateCandidateDTO.reasons` as its own chip. The two reviewer
  actions are "Attach to this event" (same `POST .../merge` endpoint
  Phase 2c built — retains the incoming report with `processingStatus:
  "merged"`, its original URL/title, links it to the existing event as
  a new `EventSource`, increments `sourceCount`, creates no second
  public event) and "Create new event" (the existing Publish flow,
  unchanged). Neither action is ever taken automatically from the
  score alone.
- **Automated processing at ingestion time** (spec "Processing"): for
  sources with `autoProcessing: true`, `pollSource()` calls
  `extractDraft()` once for every newly created item and persists the
  result as `RawIngestionItem`'s `suggested*`/`locationSource`/
  `processedAt` columns — a snapshot purely so the queue above can
  filter/sort by conflict/region/event type/importance without
  recomputing a full draft for every pending item on every list request.
  The review screen's own `GET .../draft` call is untouched and still
  always recomputes fresh from current data (see the next bullet) —
  nothing a human actually reviews is ever served from this snapshot.
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
- **Event corroboration metadata** (spec "Event corroboration metadata",
  admin-only for now): `/admin/events` (list) and `/admin/events/[id]`
  (detail) surface, for each published event, its supporting-report
  count (every linked `EventSource`, relays included), independent-source
  count (mirrors `Event.sourceCount` — relays excluded), the distinct
  source categories represented (e.g. "News + Official"), and the
  earliest/most-recent linked-report timestamps ("First reported" /
  "Last corroborated"). All four are computed fresh from `Event.sources`
  by `getEventCorroboration()` (`lib/data/corroboration.ts`) — no new
  schema, same "derive, don't store" pattern as `sourceCount` itself.
  That module has zero server-only dependencies (no Prisma import) so it
  can run identically in an API route or directly in a client component.
  The panel states outright that this is descriptive metadata, not a
  credibility or truth score (spec's explicit requirement) — multiple
  sources reporting the same thing corroborates that it was reported,
  not that it happened. Deliberately admin-only: the public `/world`/
  `/event/[slug]` UI is unchanged, per the spec's "don't redesign the
  entire public UI yet" scope for this stage.
- **Conflict management** (`/admin/conflicts`): full CRUD over the
  `Conflict` table — create/edit/enable-disable (status)/archive/
  delete-only-when-safe, plus each row's linked-event count
  (`lib/db/repositories/conflicts.ts`). Seeded with exactly 14 conflicts
  (`prisma/seed.mjs`) — see DATA_MODEL.md. `GET
  /api/admin/conflicts?selectable=true` (active/dormant only) feeds both
  the incoming-report review form and the event editor's conflict picker,
  so both surfaces always draw from the same DB-backed list rather than a
  hardcoded one. Delete is refused (409, `deleteConflictIfSafe()`) while
  any event still references the conflict — archive it via the status
  dropdown instead.
- **Automated draft extraction** (`lib/ingestion/draft.ts`, spec §3): for
  sources with `autoProcessing: true`, `extractDraft()` computes a
  suggestion — event type (`lib/ingestion/event-type-keywords.ts`'s
  keyword table), a resolved/ambiguous/none location (see "Geocoding"
  below), a suggested conflict (via the resolved location's country code
  → `findConflictByCountryCode()`), title, a starting-point summary,
  severity/importance, and duplicate candidates (only once a location is
  resolved) — computed fresh on every `GET
  /api/admin/incoming/[id]/draft` call (what the review screen actually
  shows), never auto-published. A separate, best-effort snapshot of the
  non-duplicate fields is also persisted once at ingestion time purely
  for queue filtering — see "Automated processing at ingestion time"
  above; the review screen never reads that snapshot. It's a
  deterministic rule-based heuristic (keyword matching + gazetteer
  lookup), not an AI/LLM call — no external processing provider is
  configured for this project. `/admin/incoming`'s
  review card renders this in a visually distinct "Automated Suggestion —
  not source data, review before publishing" panel, separate from the
  "Source Data" section above it; every field in it maps 1:1 to an
  editable form field the human can override before publishing (spec
  "Human can override everything").
- **Structured Event Intelligence** (`lib/ingestion/extract-facts.ts`,
  spec "Structured Event Intelligence"): a separate, field-level
  extraction pipeline from `extractDraft()` above — same deterministic
  heuristic philosophy (keyword/gazetteer matching, no AI/LLM call), but
  three deliberate differences. (1) **Field-level granularity**:
  `extractFacts()` returns `ExtractedFactDraft[]` — one row per
  individually extractable field (event type, title, summary, country,
  region, location name, lat/lng, occurred-at, actor, casualties killed/
  injured, infrastructure damage, severity, likely conflict), each
  carrying its own `confidence` (0-1), `source` (provenance — what
  evidence produced the claim), `status`, and `observedAt`, persisted in
  a new `ExtractedFact` table (`prisma/schema.prisma`) via
  `lib/db/repositories/extracted-facts.ts`. (2) **A field can have
  multiple simultaneous facts.** `ExtractedFact` has no unique constraint
  on `(rawIngestionItemId, field)` — every actor named, every distinct
  casualty figure reported, every candidate for an ambiguous location
  becomes its own row and all coexist (spec "conflicting source values
  must coexist rather than silently overwrite each other"); no
  array/JSON column or special conflict-resolution mechanism was needed,
  multiplicity is just allowed. (3) **"Unknown stays unknown" for real**:
  a field with no supporting evidence produces no fact at all — e.g.
  `eventType` is omitted entirely (not defaulted to `"other"`) when no
  keyword matches, unlike `extractDraft()`'s always-fill-every-field
  `DraftSuggestionDTO`, which feeds a required publish form and has to
  default something. `extractFacts()` reuses `detectEventType`/
  `suggestSeverityAndImportance` (`lib/ingestion/event-type-keywords.ts`)
  and the gazetteer (`lib/geocoding/gazetteer.ts`) directly, plus three
  new curated-heuristic modules: `lib/ingestion/actors.ts` (alias table
  mapping surface forms like "IDF"/"Israeli forces" to one canonical
  actor name, so the same actor named two ways in one report doesn't
  produce two facts), `lib/ingestion/casualties.ts` (regex-based killed/
  injured figure extraction, explicit numbers only, bails out entirely on
  an explicit negation like "no casualties reported"), and
  `lib/ingestion/infrastructure-damage.ts` (keyword-phrase damage
  detection). Runs automatically alongside the existing suggestion
  snapshot at ingestion time for `autoProcessing: true` sources
  (`computeAndStoreFacts()` in `lib/ingestion/poll.ts`, same
  never-block-ingestion error handling as `computeAndStoreSnapshot()`),
  and on demand via `POST /api/admin/incoming/[id]/extract` for any item
  regardless of source config. Persistence is **status-aware**:
  `replaceExtractedFacts()` deletes and recreates only facts still in
  `status: "extracted"` on re-extraction, leaving anything an admin has
  already `accepted`/`rejected`/`edited` untouched, so re-running
  extraction after an admin edits the raw text never discards review
  work already done. Editing a fact's value (`PATCH
  /api/admin/incoming/[id]/facts/[factId]`, `action: "edit"`) preserves
  the *original* extracted value in `originalValue` even across repeated
  edits (`existing.originalValue ?? existing.value`), so provenance back
  to the true source claim is never lost. `GET
  /api/admin/incoming/[id]/facts` additionally resolves each field's
  "effective value" (an admin's own accept/edit decision wins over a raw
  suggestion; among undecided suggestions the highest-confidence one
  wins; a rejected fact is never picked) and reuses the *existing*
  `findDuplicateCandidates()` engine (no second matching system) to find
  a matched event, then diffs the effective values against that event's
  own columns for every field that actually exists on `Event`
  (`eventType`, `title`, `countryCode`, `region`, `latitude`,
  `longitude`, `severity`, `conflictId` — casualties/actors/
  infrastructure damage are deliberately excluded from this comparison,
  since `Event` has no such columns and this milestone adds none) —
  lat/lng compares with a ~50m epsilon tolerance to ignore float-
  formatting noise, not exact string equality. This never writes to
  `Event`; it only computes and returns `differs: boolean` per field for
  the review UI to render (spec "if an existing event match exists, show
  which fields differ from the current event"). Nothing in this pipeline
  auto-publishes or auto-modifies a public event — extraction, accept,
  reject, and edit are all admin-side annotations on `ExtractedFact`
  rows only, same "never publishes without a human" invariant as the
  rest of the ingestion pipeline. Admin UX lives in `/admin/incoming`'s
  review card as a "Structured Facts — extracted, not verified" panel,
  directly below the existing "Automated Suggestion" box: each field
  groups its (possibly multiple) facts, shows value/confidence/status/
  provenance, an inline edit control, accept/reject buttons, a
  "differs from event" / "matches event" badge per field when a match
  exists, and low-confidence facts (below 0.5) render with distinct
  amber/warning styling. Designed to compare cleanly against future
  event state without needing a schema change for event history/
  versioning — the next milestone this unblocks.
- **Live Event Updates** (`lib/ingestion/event-update-proposals.ts`,
  `lib/db/repositories/event-updates.ts`, spec "Live Event Updates"): the
  milestone that actually uses Structured Event Intelligence's extracted
  facts to keep a published event current. Triggered from the existing
  "attach this report to an existing event" action (`POST
  /api/admin/incoming/[id]/merge`) — attachment itself is unchanged
  (still just an `EventSource` link), but right after it, the just-
  attached report's extracted facts are compared field-by-field against
  the event's current state and any real difference becomes a pending
  `EventUpdateProposal` row. Two-table design, kept deliberately apart:
  `EventUpdateProposal` (mutable — pending/accepted/rejected) holds
  proposed changes nothing has acted on yet; `EventHistory` (append-only,
  nothing ever updates or deletes a row) holds only changes an admin has
  actually accepted. Because rejected proposals never reach
  `EventHistory`, that table is *already* exactly what's safe to show on
  the public page (spec "do not expose rejected/unverified proposals
  publicly") — no extra filtering needed. Comparison logic
  (`buildProposalDrafts()`) is pure — takes a plain `Event` object and an
  `ExtractedFactDTO[]`, returns draft objects, touches no database —
  which is also what makes it directly unit-testable and keeps "proposals
  separate from accepted event state" true at the module level, not just
  by convention. Three field shapes, three comparison strategies:
  - **Scalar fields** (title, summary, location, coordinates, event
    time, severity, event type, conflict): one current value on `Event`,
    one proposed value per report via `pickEffectiveFact()` (moved out of
    the Structured Event Intelligence facts route into shared
    `lib/ingestion/fact-diff.ts` so both features pick the same
    admin-decision-wins-else-highest-confidence value the same way), one
    proposal if they differ (`valuesDiffer()`, also shared — lat/lng get
    a ~50m epsilon, occurredAt a 5-minute tolerance, everything else
    exact equality).
  - **List fields** (actors, infrastructure damage): genuinely multi-
    valued on `Event` (JSON-encoded `string[]` columns, same convention
    as `RawIngestionItem.mediaUrls` — SQLite has no array type). Every
    distinct non-rejected fact value NOT already in the event's array
    becomes its own "new" proposal; accepting one appends into the array
    rather than replacing it.
  - **Casualty fields** (killed, injured): one current figure on `Event`,
    but a report can carry more than one distinct reported number — every
    distinct non-rejected value that differs from the current figure
    becomes its own proposal, so two reports (or one report's two
    conflicting sentences) can produce two simultaneously pending
    proposals rather than one silently picked (spec "if sources
    disagree... preserve competing values... do not automatically choose
    one solely by report count"). `hasConflict` (true when another still-
    pending proposal on the same event+field has a different value) is
    computed fresh on every read, never stored, since sibling proposals
    resolve independently and a stored flag would go stale the moment one
    does.
  - Every field this milestone proposes is a "factual change" the spec
    keeps approval-based — there is no automatic-apply path in this
    codebase yet. "Automatically allow low-risk metadata updates" (new
    source attached, corroboration count, lastSeen/lastCorroborated) is
    already true with zero new code: source attachment is the pre-
    existing `EventSource` link, and corroboration metadata
    (`lib/data/corroboration.ts`) is computed fresh from `Event.sources`
    at read time, so it reflects a new attachment immediately without
    ever going through the proposal table. "Accept all safe/high-
    confidence updates" (`POST /api/admin/events/[id]/proposals/accept-
    safe`) is a bulk convenience for the admin — still an explicit click,
    accepting every pending proposal at or above a 0.8 confidence floor
    (comfortably above this heuristic's routine "real signal found"
    confidences and above its honest-uncertainty ones for ambiguous
    locations/no-strong-signal severity) — never an unattended background
    job.
  - Accepting a proposal (`PATCH /api/admin/events/[id]/proposals/
    [proposalId]`) mutates the event and writes the `EventHistory` row in
    one transaction, so a proposal can never end up "accepted" without a
    matching history entry or vice versa. Rejecting only flips the
    proposal's own status — the event and history table are untouched.
  - Admin UX (`/admin/events/[id]`): a "Pending Updates" panel (current →
    proposed value, change-type badge, confidence, provenance, a
    "Conflicting with another pending update" warning, Accept/Reject per
    row, "Accept all safe" bulk button) and a "History" panel (every
    accepted change, oldest fields first are still visible since nothing
    is ever overwritten), plus a compact "Supporting Reports" list (the
    milestone's own "new supporting reports" requirement) and inline
    actors/casualties/damage once any have been accepted. "Updated X ago"
    (both admin and public `/event/[slug]`) is driven by the most recent
    `EventHistory` entry, not `Event.updatedAt` directly — that column
    also moves on lifecycle actions like publish/unpublish that aren't
    content changes, which would otherwise show a misleading "Updated"
    label. The public page's "Recent Updates" section (spec "optionally
    show a concise update history") reuses the same `EventHistory` data,
    capped at 5 rows, through `getDbEventBySlug()`.
- **Geocoding abstraction** (`lib/geocoding/`, spec §4): `GeocodingProvider`
  is a one-method interface (`search(query): Promise<GeocodeCandidate[]>`)
  behind `getGeocodingProvider()`, so the concrete provider can change
  later without touching callers. Two implementations: a curated
  in-repo gazetteer (`gazetteer.ts`, fast/deterministic/no network — also
  what `extractDraft()` scans report text against to auto-detect a place
  name) and OpenStreetMap Nominatim (`nominatim.ts`, real free/keyless
  geocoding, used as the fallback for anything not in the gazetteer).
  `GEOCODING_PROVIDER=fixture` forces gazetteer-only, set in
  `playwright.config.ts`'s `webServer.env` so the automated Playwright
  suite never depends on live network geocoding. The gazetteer
  deliberately includes an ambiguous entry — three different
  "Novoselivka, [Oblast], Ukraine" candidates — matching spec §4's exact
  example, and the pipeline never silently picks one: `extractDraft()`
  reports `locationSource: "ambiguous"` with `latitude`/`longitude: null`
  whenever a place name resolves to more than one candidate, and
  `components/admin/location-picker.tsx` shows all candidates for a human
  to pick from (plus a search box for any other place name, manual
  lat/lng inputs, and an embedded MapLibre marker preview).
- **Duplicate-candidate / event-matching engine** (`lib/ingestion/duplicates.ts`,
  spec §2 and "Event Matching / Clustering Foundation"):
  `findDuplicateCandidates()` scores every already-published event within
  a ±14-day window of the candidate's `occurredAt` against a weighted sum
  of distance (haversine, decaying to 0 past 25km), time-apart (decaying
  to 0 past 12h), event-type compatibility, same country/region, same
  conflict, and title similarity (Jaccard over stopword-filtered tokens)
  — returns the top 5 candidates scoring ≥35/100, descending, each with a
  `reasons: string[]` explaining the score in plain terms (e.g. "0.3 km
  away", "same conflict", "62% title overlap"). Never merges anything
  automatically. Two hardening rules beyond plain weighted addition:
  - **Event-type compatibility is graded, not binary.** Types are grouped
    (kinetic/military, civil unrest, natural disaster, health/
    humanitarian, policy/other). An exact match gets full credit, a
    different type in the *same* group gets half credit (an airstrike
    very plausibly produces an explosion someone else reports
    independently), and a genuinely cross-group pairing (e.g. earthquake
    vs. explosion) is actively penalized rather than merely scoring zero
    for that component — otherwise a same-place/same-time pairing of
    clearly unrelated event kinds could still clear the threshold on
    distance+time alone.
  - **No geographic or conflict corroboration at all is itself
    penalized.** Geographic proximity is the first-listed signal, and
    treating it as just one more additive component lets an identical
    headline (e.g. republished wire copy) with a matching type and
    similar time-of-day clear the threshold from title+type+time alone
    on opposite sides of the planet. If nothing places the two reports
    anywhere near each other — not close distance (≤500km), not the same
    region/country, not the same conflict — a real penalty applies
    instead of leaving distance at a bare 0 contribution.

  The review UI shows each as "Likely existing event — N%" plus the
  matched event's title, an event type/country-or-region/relative time
  line, and every `reasons` entry as a chip (e.g. "12 min apart", "0.3
  km away", "same event type", "62% title overlap") — see the admin
  event-matching UX bullet above — with three actions: **View existing
  event** (opens `/event/[slug]`), **Attach to this event** (`POST
  /api/admin/incoming/[id]/merge`), and **Ignore suggestion**
  (client-side only — removes it from that review session's list without
  touching the database, so a re-check or page reload can surface it
  again). Re-scoring after a manual edit (location, type, conflict) goes
  through the same function via `POST
  /api/admin/incoming/[id]/duplicates`, so "Re-check" in the UI reflects
  whatever the human has currently typed, not just the original
  auto-detected draft.
- **Merge**: attaches the raw item to an *existing* event as an
  additional `EventSource` (`relationship` defaults to `"corroborating"`
  for a genuinely independent second report, or `"relay"` when the admin
  identifies it as a repost of the same originating source) and sets that
  raw item's `processingStatus` to `"merged"` — it never creates a second
  public `Event`. `Event.sourceCount` (`lib/data/world-events.ts`) counts
  only sources with `isOriginatingSource: true` (set for every
  relationship except `"relay"`), so a wire relay of an already-counted
  report attaches real provenance without inflating the displayed
  independent-source count (spec "Source Independence").
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
  source's name, its role icon (see "Source icon" below), an "Originating
  report" badge on the first (originating, non-relay) source, its type
  (preferring the source's own configured category, e.g. "News", over a
  generic per-adapter label), an absolute "Published:" timestamp, and the
  clickable original URL.

### End-to-end pipeline verification (Phase 2e)

The scheduler/ingestion pipeline (Phase 2d) was built and tested against
fixtures, but no real article had been published through it yet — real
content accumulated in `/admin/incoming` (hundreds of pending items from
the seeded RSS sources) while `/world` kept showing only mock/test data,
which read as "the real pipeline doesn't work" even though every stage
up to Publish was already correct. This phase closes the loop: real BBC
World / GDACS articles were reviewed and published through the actual
`/admin/incoming` UI and publish API (never inserted directly), and
confirmed to appear on `/world`, render a full event detail page, and
link back to the genuine original article — see TASKS.md Phase 2e for
the specific articles and confirmed slugs.

Two real bugs surfaced by that verification, both fixed:

- **Real disaster-source content had nowhere to classify into.** GDACS
  Disaster Alerts (the majority of real pending content at the time) and
  WHO News use wording
  (`lib/ingestion/event-type-keywords.ts`'s comments have the exact
  examples: "forest fire notification", "flood alert", "earthquake
  (Magnitude...)", "tropical cyclone", "Drought is on going in...",
  "World Health Assembly") that had no matching keywords and no matching
  `EventType` category at all — it all fell into "other". Five
  categories were added — `earthquake`, `flood`, `storm`, `humanitarian`,
  `health` (`lib/types/severity.ts` `EVENT_TYPES`) — each with real-
  wording keyword matches and both a DOM icon
  (`components/events/event-type-icon.tsx`) and a map-marker icon
  (`lib/map/event-icons.ts`, canvas-drawn SDF, matching the existing
  style).
- **An unrecognized `eventType` would crash the render, not just look
  wrong.** SQLite has no enum column type (DATA_MODEL.md), so a DB row's
  `eventType` is a plain `String` — validated by application convention
  (the admin UI's `<select>` only offers real `EventType` values,
  `extractDraft()`'s heuristic only ever returns one), never enforced by
  the database or by any runtime check on the publish route. A stray/
  legacy value would make a direct object-index lookup like
  `EVENT_TYPE_ICON[eventType]` return `undefined`, and React throws
  rendering `undefined` as a component. Every lookup site now has a safe
  fallback to "other"'s icon/label instead: `EventTypeIcon`/
  `getEventTypeLabel` (components/events/event-type-icon.tsx),
  `createEventIconImageData` (lib/map/event-icons.ts), and the MapLibre
  `icon-image` layout expression (`components/map/world-map.tsx`, a
  `case`/`in` expression rather than a bare `concat`). Regression-tested
  directly in `tests/pipeline-integrity.spec.ts` by publishing an event
  with a deliberately bogus `eventType` via the API (bypassing the
  TypeScript union the same way a stray DB value would) and confirming
  the page still renders, with the "other" fallback visible, and zero
  console errors.

### Source icon (Phase 2e)

`components/events/source-role-icon.tsx` is the one central mapping from
a source's `sourceRole` (the trust-model field from Phase 2d — see
"Source trust model" above) to an icon, with a generic fallback
(`Radio`) for any source with no role set or an unrecognized value —
used on `/admin/sources`'s table and the event detail page's Sources
list, so a source never renders a blank icon. This also absorbed a small
pre-existing duplication: `app/admin/sources/page.tsx` had its own local
copy of the `sourceRole` → display-label map; that's now imported from
this one file instead.

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

**`tests/rss-ingestion.spec.ts` is a manual/smoke test, not part of the
deterministic core** — it hits the real, live BBC World feed on purpose
(that's the point of a *real* ingestion proof), so a feed change, network
hiccup, or BBC republishing a headline can fail it without any code
regression; that's expected, not a bug to chase. `tests/classification.spec.ts`
is the deterministic core suite for conflict management, automated draft
extraction, geocoding, the duplicate-candidate engine, merge, source
independence, and the review UI — it never touches the live BBC feed.
Instead it points a throwaway `Source` at a static RSS payload served by
`app/api/test-fixtures/rss/[name]/route.ts` (content defined in
`lib/testing/rss-fixtures.ts`), so it's immune to external feed/network
changes, and `playwright.config.ts`'s `webServer.env` sets
`GEOCODING_PROVIDER=fixture` so its geocoding assertions never depend on
live Nominatim either. Because both suites share one un-reset SQLite DB
and this repo's two Playwright projects (Desktop/Mobile) run the whole
suite twice in sequence, `classification.spec.ts`'s tests that need to
refer back to "the event this test just published" capture that event's
id directly from the publish/duplicate-check response (`kyivEventId`,
`duplicate-candidate-${eventId}` test ids) rather than searching
`/api/events` by title — titles alone aren't unique once a run has
happened more than once against the same database.

**`tests/multi-source-ingestion.spec.ts`** is the deterministic suite for
the scheduler, source health, per-source failure isolation, automated
processing-at-ingestion, and the scheduler-driven variant of source
independence — same fixture-feed pattern as `classification.spec.ts`
(never touches a real external source), plus a second fixture feed and a
`?delayMs=` param on the fixture route for the overlap-prevention test.
Two additions specifically for this suite:
`playwright.config.ts`'s `webServer.env` also sets
`DISABLE_BACKGROUND_SCHEDULER=true` (checked in `instrumentation.ts`) so
the real always-on scheduler never fires mid-test and races the suite's
own explicit, deterministic `POST /api/admin/scheduler/tick` calls; and
that endpoint accepts an optional `sourceIds` array so a test-scoped tick
never touches this project's real live sources (BBC World, Al Jazeera,
etc.) as a side effect of running the suite. Real sources are exercised
manually — see the milestone's final report for their live-tested status,
not something the automated suite asserts on.

**`tests/pipeline-integrity.spec.ts`** covers the "real article visibly
works end-to-end" guarantee and its two icon-fallback regressions (see
"End-to-end pipeline verification" above): fetched-article persistence
and required review fields, publish → reachable via the public
`/api/events` path with the original source URL intact, a known event
type's icon/label rendering with zero console errors, an unrecognized
`eventType` (sent directly via the API, bypassing the TypeScript union)
falling back to "other" instead of crashing the page, a source with no
configured role rendering the generic fallback icon, and the exact
real-world GDACS/WHO wording samples that originally fell through to
"other" now classifying correctly. Same fixture-only pattern as the
other deterministic suites.

Local-DB hygiene: none of these suites reset the database themselves,
so repeated manual verification (publishing real articles, running the
suite many times in one long session) accumulates real and test data in
the same local `prisma/dev.db` over time. That's expected and harmless
for correctness, but on this sandbox's flagged "slow filesystem" it can
produce transient full-suite-only flakiness under heavy accumulated load
(distinct from the live-BBC-feed flakiness `rss-ingestion.spec.ts`
already documents) — if a combined run shows an isolated, non-reproducing
failure, try `rm prisma/dev.db* && npm run db:migrate && npm run db:seed`
before concluding it's a real regression.

**`tests/ingestion-reliability.spec.ts`** covers bounded scheduler
concurrency, HTTP failure handling, and Retry-After/backoff — see
"Source scheduler" above. `app/api/test-fixtures/rss/[name]/route.ts`
gained `?status=N` (simulates any HTTP status instead of serving the
fixture feed) and `?retryAfter=N` (adds a `Retry-After` header to that
simulated response) alongside the existing `?delayMs=`.
`playwright.config.ts`'s `webServer.env` sets
`INGESTION_FETCH_TIMEOUT_MS=8000` for the test server process so the
timeout test sees a real timeout in seconds rather than the real 20s
default; the spec's own `beforeAll` sends a few warm-up requests to the
fixture route first, since this sandbox's dev-mode Turbopack can take
several seconds to compile a route on its very first hit after an edit —
without the warm-up, that one-time cost could itself trip the shortened
test timeout for reasons unrelated to the scheduler logic being tested.
The concurrency test asserts a generous lower bound on elapsed time (two
worker-pool "waves" measurably takes longer than one would) and only a
loose upper bound (a hang-guard, not a performance assertion — this
sandbox's per-request latency is too variable to assert tightly on).

**`tests/event-matching.spec.ts`** covers the duplicate/event-matching
engine's hardening described under "Duplicate-candidate / event-matching
engine" above — the exact scenarios named in the spec: an obvious same
event (close in time and space), the same location days apart (should
score much lower, not necessarily zero — nothing here ever auto-merges
regardless of score), the same event type in a different country
(geographic-signal gate), an incompatible event type at the same place/
time (compatibility-group penalty), similar wording but geographically
unrelated, generic/boilerplate headlines that share only wire-service
filler words, a boundary case just under `MIN_SCORE`, and the empty-
result case. Publishes one reference event via the real publish API,
then calls `POST /api/admin/incoming/[id]/duplicates` directly with
synthetic candidate reports — no fixture RSS feed involved, since this
stage is about the scoring function itself, not ingestion.
