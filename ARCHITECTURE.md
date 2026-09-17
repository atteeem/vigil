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
