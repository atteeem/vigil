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
| 34a | ~~Known gap: published events can't be linked to a `Conflict`~~ — resolved by #39 below (minimum conflict-assignment support). Admin CRUD for conflicts (create/edit new ones from the UI) is still not built — only the one seeded Russia–Ukraine row is selectable. | DONE (minimum) |
| 35 | Local-development account system: `AuthProvider`/`AccountProfile` abstraction (`lib/auth/`), localStorage-backed, SHA-256 password digest (explicitly documented as not secure production auth), profile picture accepted as JPEG/PNG/WebP and downscaled client-side to a small data URI | DONE |
| 36 | Profile page upgrade: logged-out header (Create Account / Sign In) + authenticated header (avatar/name/email, Edit Profile, Sign Out), all existing device preferences kept intact, new "Default map mode" card added alongside the existing "Default globe view" card | DONE |
| 37 | Full responsive/testing pass: `playwright.config.ts` + `tests/` (map, filters, admin Source Manager, admin Incoming Reports publish/reject, profile/account, responsive nav smoke test) across Desktop + Mobile projects. `npm run test`. Scope note: true multi-touch pinch-zoom gesture simulation isn't covered (Playwright's touch emulation doesn't model it well) — mobile viewport rendering/interaction is | DONE |
| 38 | Homepage globe Satellite mode follow-up: tested extensively (repeated Intel/Satellite toggling, fresh reload with Satellite persisted as default, mobile viewport) and the realistic Blue Marble texture, camera preservation, and hotspot positioning were already correct — no reproducible bug found. Added the requested hardening anyway: a mobile-sized texture pair (`earth-blue-marble-mobile.jpg`/`earth-topology-mobile.jpg`, 2x downscaled) selected by measured container width, plus `requestIdleCallback`-deferred preloading of the current device's texture pair (not both sizes) so a first switch to Satellite is instant without wasting mobile bandwidth on the unused desktop size | DONE |

### Phase 2b — First real external-source ingestion proof (BBC World RSS)

Full workflow proved end-to-end against the **live** BBC World feed (not a mock/stub) — see ARCHITECTURE.md "Source ingestion pipeline" and DATA_MODEL.md for the architecture this exercises.

| # | Task | Status |
|---|---|---|
| 39 | Seeded `BBC World` RSS source (`prisma/seed.mjs`) exactly per spec: `https://feeds.bbci.co.uk/news/world/rss.xml`, language `en`, sourceCategory `News`, reliabilityTier `A`, enabled + auto-ingest true, permissionStatus `authorized`. Seeded a minimum-viable `Conflict` row (`russia-ukraine`, matching `lib/data/mock-conflicts.ts`'s entry) so publishing can assign a real conflict | DONE |
| 40 | "Fetch Now" — `lib/ingestion/poll.ts` refactored into a shared `pollSource()` used by both the background poller and a new per-source `POST /api/admin/sources/[id]/fetch` route; `/admin/sources` shows a Fetch Now button (RSS sources only) and the exact "N fetched · N already known · N new · N errors" result format from spec, updates `lastSuccessfulIngestion`/`lastError`, never publishes | DONE |
| 41 | Admin Incoming Reports: added a Conflict picker (`GET /api/admin/conflicts`) to the review form, wired into the publish payload | DONE |
| 42 | `/event/[slug]` now falls back to a DB lookup (`getDbEventBySlug`) when a slug isn't a mock event, so a freshly published RSS-sourced event has a working detail page (not just its `/world` preview) | DONE |
| 43 | Source attribution block (`EventDetailPanel`) now shows explicit "Source type: X" / "Published: [timestamp]" labels, an "Originating report" badge on the first source, and prefers a source's own `sourceCategory` (e.g. "News") over the generic per-adapter-type label | DONE |
| 44 | Added `itemsToday` (raw items received today) to the Source Manager table/API, alongside the existing last-fetch/last-error health display | DONE |
| 45 | Fixed two real bugs surfaced by testing against a real, freshly-published event (not caught by mock data, whose timestamps are static): (a) `formatAbsoluteTime`'s `timezone="auto"` resolved to the *runtime's* local zone via `Intl.DateTimeFormat(undefined,...)`, differing between the Node SSR process and the browser — fixed with a mount-gated "UTC until hydrated" fallback in `EventDetailPanel`; (b) `Intl.DateTimeFormat(undefined, ...)` (ambient locale) rendered `02:01` in Chrome vs `02.01` in Node for the *same* explicit UTC zone — fixed by pinning locale to `"en-US"` always. Both were genuine SSR/client hydration mismatches on `/event/[slug]`, confirmed fixed via a fresh, cold browser tab (zero console errors) | DONE |
| 46 | `tests/rss-ingestion.spec.ts`: 8 tests against the live BBC feed proving the full spec §13 checklist (source config, Fetch Now, dedup on a second fetch, queue display, review/edit/conflict-assignment/publish, map+feed integration, event-detail source attribution, reject behavior, live refresh without reload). Passes on both Desktop and Mobile Playwright projects | DONE |

### Phase 2c — Classifiable & manageable at scale (conflict management, duplicate detection, automated drafts, geocoding)

Full spec: milestone message "Make incoming reports intelligently
classifiable and manageable at scale." See ARCHITECTURE.md's "Conflict
management" / "Automated draft extraction" / "Geocoding abstraction" /
"Duplicate-candidate engine" / "Merge" entries and DATA_MODEL.md's
`conflicts` (local schema) / `sources.auto_processing` / "Automated draft
extraction & duplicate candidates" entries for the architecture this
exercises. Explicit constraints honored: no unrelated frontend features,
no auto-publishing, no Telegram, no Supabase.

| # | Task | Status |
|---|---|---|
| 47 | Admin Conflict Management (`/admin/conflicts`): full CRUD (create/edit/enable-disable via status/archive/delete-only-when-safe/linked-event-count), seeded with exactly the 14 named conflicts (`prisma/seed.mjs`); `GET /api/admin/conflicts?selectable=true` feeds both the incoming-report review form and the event editor from one DB-backed list | DONE |
| 48 | Duplicate-candidate engine (`lib/ingestion/duplicates.ts`): weighted distance/time/event-type/region/conflict/title-similarity scoring against published events in a ±14-day window, top-5 ranked ≥35/100, rendered as "Possible duplicate — N% / title / N min apart / N km away"; View existing event / Merge into event / Ignore suggestion actions; never auto-merges | DONE |
| 49 | Merge (`POST /api/admin/incoming/[id]/merge`): attaches the raw item as an additional `EventSource` on the *existing* event (never a second public event), preserves original source metadata, `relationship: "relay"` vs `"corroborating"` choice controls independent-source counting | DONE |
| 50 | Automated Draft Extraction (`lib/ingestion/draft.ts`): rule-based (not AI/LLM — no processing provider configured) suggestion of event type/location/conflict/title/summary/verification/severity/duplicates per incoming report, computed on demand (never persisted, never stale), gated per-source by the new `Source.autoProcessing` flag; review UI clearly separates "Source Data" from "Automated Suggestion — not source data, review before publishing," every suggested field is a normal editable form field | DONE |
| 51 | Geocoding abstraction (`lib/geocoding/`): `GeocodingProvider` interface behind `getGeocodingProvider()`; gazetteer (fast/deterministic, also used for auto-detecting place names in report text) + OpenStreetMap Nominatim (real, free, keyless) fallback; ambiguous place names (exact spec example: "Novoselivka," 3 oblasts) never silently resolved — `locationSource: "ambiguous"` + candidate list surfaced for a human to pick, `components/admin/location-picker.tsx` (search, candidate list, manual lat/lng, embedded MapLibre marker preview) | DONE |
| 52 | Source independence: `Event.sourceCount` (`lib/data/world-events.ts`) now counts only sources with `isOriginatingSource: true` — a `relationship: "relay"` merge attaches real provenance without inflating the independent-source count; verified via a corroborating merge (+1) followed by a relay merge (+0) against the same event | DONE |
| 53 | Review UI upgrade (`/admin/incoming`): each report shows Source/Published time/Original title+text/Original link (Source Data) plus Event type/Location(+ambiguous flag)/Conflict/Suggested title/Verification/Duplicate probability (Automated Suggestion); Publish/Edit/Merge/Reject actions; `LocationPicker` embedded in the publish form | DONE |
| 54 | Deterministic local RSS fixtures + core test suite: `app/api/test-fixtures/rss/[name]/route.ts` + `lib/testing/rss-fixtures.ts` serve a static feed with fixed guids/titles/pubDates so ingestion tests never depend on the live BBC feed or network state; `tests/classification.spec.ts` (34 tests × 2 projects) covers conflict CRUD, conflict assignment, duplicate suggestion, merge, source-count-after-merge (both relay and corroborating), ambiguous-location handling, automated draft creation, human overrides, no-auto-publish, rejection, and deterministic RSS ingestion+dedup; `tests/rss-ingestion.spec.ts` kept as-is, now documented as a manual/smoke test against the live feed, not part of the deterministic gate | DONE |
| 55 | Full re-verification: typecheck / lint / production build clean; 88/88 Playwright checks pass across 3 consecutive full runs (Desktop + Mobile), aside from pre-existing live-BBC-feed flakiness in the smoke test unrelated to this milestone's code | DONE |

### Phase 2d — Real multi-source live ingestion

Full spec: milestone message "REAL MULTI-SOURCE LIVE INGESTION." See
ARCHITECTURE.md's "Source scheduler" / "Source health" / "Telegram
architecture" / "Source trust model" / "Duplicate handling in the
incoming queue" entries and DATA_MODEL.md's `sources` (scheduler +
trust-model fields) / `ingestion_logs` / `raw_ingestion_items` (suggestion
snapshot) entries. Explicit constraints honored: no UI redesign beyond
what this milestone itself asks for, no auto-publishing, no Supabase
migration.

| # | Task | Status |
|---|---|---|
| 56 | Per-source polling scheduler (`lib/ingestion/scheduler.ts`): each enabled+auto-ingest source polls on its own `pollIntervalMinutes` (default 5 for RSS) via `nextPollAt`, not one blanket interval; in-memory in-flight guard prevents overlapping polls of the same source; exponential backoff (capped 8x) on repeated failures, reset on success; `POST /api/admin/scheduler/tick` (optionally scoped to specific source ids) runs one pass on demand — used by both the admin "Run scheduler now" action and the deterministic test suite | DONE |
| 57 | Source Health upgrade (`/admin/sources`): Live/Error/Disabled badge, last successful fetch, last attempted fetch, next scheduled fetch, items received today, new items today, errors today (new `IngestionLog` append-only table for the latter two, since a dedup-only raw-items count can't distinguish "seen again" from "new" or capture failed attempts); Fetch Now works for every source type, not just RSS | DONE |
| 58 | 9 new real RSS sources seeded alongside BBC World — every URL verified to be a real, currently-live, publicly reachable RSS 2.0 feed before seeding (no scraping): Al Jazeera English, The Guardian World, UN News, ReliefWeb Updates, WHO News, GDACS Disaster Alerts (emergency/government), Times of Israel, Middle East Eye, Africanews (regional) — covering the spec's international-news/official-authority/emergency/regional-news categories | DONE |
| 59 | Real ingestion reliability fixes found and fixed via live testing (not caught by fixtures): (a) Node's `fetch()` tried an IPv6 address first for several dual-stack hosts (who.int, gdacs.org), reliably hitting a 10s connect timeout while curl against the identical URL at the identical time succeeded in under a second — fixed with `dns.setDefaultResultOrder("ipv4first")` in `instrumentation.ts`, a documented Node API for exactly this failure mode; (b) ReliefWeb's feed does content negotiation and 406s a request with no explicit `Accept` header — fixed by sending one from `lib/ingestion/rss-adapter.ts` | DONE |
| 60 | `TelegramAuthorizedSourceAdapter` completed as a real MTProto integration (`teleproto`, an actively-maintained GramJS fork) behind `TELEGRAM_API_ID`/`TELEGRAM_API_HASH`/`TELEGRAM_SESSION` env vars — `fetchLatest`/`healthCheck` stay fully disabled (never scrape, never fall back to an unauthorized method) until all three are set. The three pre-registered channels (`@lumsrc`, `@dnipro_now`, `@huyovy_kharkiv`) are unchanged/kept, still `enabled: false`. **Not verified against live Telegram** — no credentials are available in this environment; this is the expected state per the spec's own framing ("so it can later operate when valid credentials... are supplied") | DONE (integration code); credentials still needed for live verification |
| 61 | Processing snapshot at ingestion time: `RawIngestionItem` gained `suggested*`/`locationSource`/`processedAt` columns, populated once by `lib/ingestion/poll.ts` right after a new item is created (when `autoProcessing: true`) by calling the existing `extractDraft()` heuristic — powers queue filtering/sorting without an N-way live recompute per list request. The review screen's own `GET .../draft` call is untouched and still always recomputes fresh, so nothing a human actually reviews is ever served from this snapshot | DONE |
| 62 | Source Trust Model: new `Source.sourceRole` controlled vocabulary (`originating` / `relay` / `official` / `local_media` / `eyewitness_community` / `aggregator`, `lib/types/db.ts` `SOURCE_ROLES`) alongside the existing free-text `sourceCategory`/`reliabilityTier` fields — not a trusted/untrusted boolean, per spec. Applied to every seeded source (e.g. UN News/WHO/GDACS → `official`, the two Ukrainian Telegram channels → `eyewitness_community`) | DONE |
| 63 | Incoming Queue filters + sorting (`/admin/incoming`): Source / Conflict / Region / Event type / Processing status / Duplicate likelihood / Age filters, Newest / Oldest / Highest importance / Highest duplicate probability sort — DB-level for the snapshot-backed fields, computed at list-read time for duplicate likelihood (never snapshotted — see ARCHITECTURE.md for why) | DONE |
| 64 | Duplicate handling shown prominently: a "Possible duplicate — N%" badge now renders directly on each collapsed incoming-report card (not just after clicking Review), computed from a live per-item duplicate check against the item's suggested location | DONE |
| 65 | Live map refresh reconfirmed unchanged: `/world` still merges published/merged events via `hooks/use-live-events.ts`'s existing 20s `/api/events` poll — no full-reload dependency, verified end-to-end through the new scheduler → ingest → publish path | DONE |
| 66 | Rate limiting / failure handling: per-fetch 20s timeout (`lib/ingestion/poll.ts`), exponential backoff on repeated failures, every attempt (success or failure) logged to `IngestionLog`, one source's failure/timeout never blocks another in the same scheduler tick (`Promise.allSettled`) | DONE |
| 67 | Deterministic tests: `tests/multi-source-ingestion.spec.ts` (10 tests × 2 projects) covers scheduled polling (due/not-due), multiple independent sources in one tick, per-source failure isolation, overlap prevention (a slow fixture + staggered concurrent ticks), processing-after-ingestion (with and without `autoProcessing`), source health reporting, source independence via the scheduler path (relay merge), no-auto-publishing, and live map refresh after publish — all against local fixture feeds (`lib/testing/rss-fixtures.ts` gained a second feed, and a `?delayMs=` param for the overlap test), scoped away from this project's real live sources via an optional `sourceIds` filter on the scheduler-tick test endpoint so running the suite never hammers external feeds | DONE |
| 68 | Full re-verification: typecheck / lint / production build clean; `multi-source-ingestion.spec.ts` passes 20/20 reliably standalone and as the lead file in a combined run. A combined 108-test run showed occasional transient failures only after several minutes of continuous execution against an ever-growing local SQLite DB on this sandbox's flagged "slow filesystem" — root-caused to environment I/O contention, not application logic (the specific failing call was independently reproduced as succeeding via a direct HTTP request, and isolated reruns of the affected spec pass consistently) | DONE |

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

### Phase 2c decisions

- **Automated processing stays rule-based, not AI/LLM.** No LLM API key
  is configured for this project, and the spec didn't ask for one —
  keyword matching, a curated gazetteer, Jaccard title similarity, and
  haversine distance are all deterministic, free, and fully testable
  without network access. If a real classification/geocoding provider is
  added later, `lib/ingestion/draft.ts` and `lib/geocoding/` are the two
  seams to swap.
- **"Ignore suggestion" is deliberately UI-only, not a database write.**
  It's a same-session dismissal (spec's third duplicate action alongside
  View/Merge) — re-checking or reloading can surface the same candidate
  again, which is correct: the underlying event data hasn't changed, only
  the reviewer's momentary judgment about this one report.
- **`Source.autoProcessing` is a separate flag from `Source.autoIngest`.**
  Ingest (fetching into `raw_ingestion_items`) and automated processing
  (generating a draft suggestion) are independent decisions — a source
  can be trusted enough to auto-fetch but not to auto-classify, or vice
  versa.
- **Deterministic test fixtures over a full DB reset.** Following the
  existing suite's convention (`playwright.config.ts`'s comment: "does
  not seed/reset the DB itself"), `tests/classification.spec.ts` captures
  IDs directly from API responses (e.g. the event id returned by
  Publish) rather than re-querying by title, so it stays correct even
  when the shared SQLite DB accumulates near-identical fixture data
  across repeated local runs or the Desktop/Mobile Playwright projects.

### Phase 2d decisions

- **A suggestion snapshot is persisted at ingestion time, deliberately
  breaking with Phase 2c's "never persist a draft" rule — but only for
  filtering, never for review.** Queue-wide filtering/sorting by conflict/
  region/event type/importance needs that data to exist on every pending
  item without recomputing it per request; the review screen's own `GET
  .../draft` call is untouched and still always recomputes fresh, so nothing
  a human actually reviews is ever served from a stale snapshot. Duplicate
  likelihood is the one field deliberately NOT snapshotted, because an
  event published after an item arrived can make it newly duplicate
  something — a stale "no duplicate" snapshot would be actively unsafe,
  so it's recomputed live at list-read time instead.
- **The scheduler tick is a separate concept from a source's poll
  interval.** The tick (default 30s, `SCHEDULER_TICK_INTERVAL_MS`) is just
  "how often to check what's due" — cheap, and unrelated to how often any
  given source actually gets polled (`Source.pollIntervalMinutes`, default
  5min for RSS, editable per source). Conflating the two would mean every
  source shares one interval, which the spec explicitly asked to move away
  from.
- **`teleproto` over `telegram` (GramJS) for the Telegram adapter.**
  `npm install telegram` resolved to the actual GramJS package, which npm
  flagged as archived/deprecated (4 high-severity transitive
  vulnerabilities) with an explicit migration notice pointing at
  `teleproto`, a largely-compatible actively-maintained fork. Swapped
  before writing any adapter code against it, not after.
- **`dns.setDefaultResultOrder("ipv4first")` over per-host workarounds.**
  Multiple real, working feeds (who.int, gdacs.org) failed reliably with
  Node's `fetch()` and only Node's `fetch()` — curl against the identical
  URL at the identical time succeeded — because Node's default DNS
  ordering tried an IPv6 address first on a network where it's
  unreachable. This is a documented Node-level fix for exactly that
  failure class, applied once in `instrumentation.ts`, rather than special
  -casing affected hostnames.
- **Scheduler ticks triggered by tests are scoped to test-created source
  ids (`POST /api/admin/scheduler/tick`'s optional `sourceIds`).** An
  unscoped tick call also polls every real enabled+auto-ingest source —
  fine for the real "Run scheduler now" admin action, but a test suite
  that did this would both be nondeterministic (racing the real
  always-on background scheduler for the same sources) and would hammer
  this project's live RSS feeds on every test run. The background
  scheduler itself is disabled entirely for the Playwright process
  (`DISABLE_BACKGROUND_SCHEDULER=true`, `playwright.config.ts`) for the
  same reason.
