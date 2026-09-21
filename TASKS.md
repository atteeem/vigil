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

### Phase 2e — Stage 1: end-to-end pipeline verification & icon-system hardening

The real ingestion pipeline (scheduler → raw items → review → publish) was
built and tested in isolation in Phase 2d, but no real article had
actually been published yet — hundreds of real fetched articles sat
unreviewed in `/admin/incoming`, so `/world` showed only mock/test data.
This phase closes that loop end-to-end with real content and hardens two
real bugs found doing it.

| # | Task | Status |
|---|---|---|
| 69 | Verified the full real pipeline end-to-end with genuine BBC World articles, publishing them through the actual `/admin/incoming` review UI and API (not inserted directly): confirmed on `/world`, on the event detail page, with correct icon, source attribution, and a working original-source link — see ARCHITECTURE.md "End-to-end pipeline verification" | DONE |
| 70 | Fixed a real classification gap: GDACS Disaster Alerts (324 of ~630 pending real items at the time — the majority of currently-flowing real content) and WHO News had no matching event-type keywords at all ("forest fire notification" ≠ "wildfire", no earthquake/flood/storm/drought/health keywords existed), so effectively all of it fell into "other". Added 5 new categories — `earthquake`, `flood`, `storm`, `humanitarian`, `health` — to `EVENT_TYPES`, with real-wording keyword matches in `lib/ingestion/event-type-keywords.ts`, icons in both `components/events/event-type-icon.tsx` (DOM) and `lib/map/event-icons.ts` (map markers, canvas-drawn SDF), verified live against real GDACS/WHO content | DONE |
| 71 | Fixed a real crash-class bug: `EVENT_TYPE_ICON[event.eventType]` (and the equivalent map-marker/label lookups) assumed every DB row's `eventType` is a valid `EventType` — true only as far as the TypeScript compiler can see, not actually enforced at the SQLite boundary (no enum column type). A stray/legacy value would resolve to `undefined` and crash the render. Added a single safe-fallback path used everywhere: `EventTypeIcon`/`getEventTypeLabel` (components/events/event-type-icon.tsx) fall back to "other"'s icon/label, `createEventIconImageData` (lib/map/event-icons.ts) falls back to "other"'s drawer, and the MapLibre `icon-image` expression (`components/map/world-map.tsx`) falls back to `event-icon-other` for anything not in `EVENT_TYPES` — the UI now never renders a blank/missing event icon | DONE |
| 72 | Added a source-icon system (spec "Fix source icons/logos"): `components/events/source-role-icon.tsx` is the one central mapping from `Source.sourceRole` (the trust-model field from Phase 2d) to an icon, with a generic fallback for sources with no role set — used on `/admin/sources` and the event detail page's Sources list. Consolidated the pre-existing duplicate `SOURCE_ROLE_LABEL` map out of `app/admin/sources/page.tsx` into this one file | DONE |
| 73 | `tests/pipeline-integrity.spec.ts` (6 tests × 2 projects): fetched-article persistence + required review fields, publish → real event → reachable via `/api/events` with the original source URL preserved, known-event-type icon rendering with zero console errors, unrecognized-event-type fallback (a direct regression test for #71, bypassing the TS union the same way a stray DB value would), source-with-no-role fallback icon, and the exact real-world GDACS/WHO wording samples from #70 classifying correctly | DONE |
| 74 | Full re-verification: typecheck / lint / production build clean; full Playwright suite (120 tests) passes 117/117 runnable in one clean run against a freshly reset+reseeded local DB (3 pre-existing mobile-viewport skips, unrelated) | DONE |

### Phase 2f — Stage 2: ingestion reliability hardening

| # | Task | Status |
|---|---|---|
| 75 | Bounded fetch concurrency: `lib/ingestion/scheduler.ts`'s `schedulerTick()` now polls due sources through a small worker pool (`MAX_CONCURRENT_FETCHES = 4`, a free slot immediately picks up the next due source) instead of firing every due source at once. Directly motivated by a real problem seen in Phase 2d/2e: this sandbox's network has limited concurrent-connection headroom, and polling ~9 real sources simultaneously caused several to hit connect timeouts that succeeded individually moments later. Overlap prevention, per-source poll interval, and failure isolation are all unchanged | DONE |
| 76 | HTTP failure handling: `lib/ingestion/errors.ts`'s new `HttpFetchError` carries the response status and a parsed `Retry-After` (delta-seconds or HTTP-date, RFC 9110 §10.2.3); `lib/ingestion/rss-adapter.ts` throws it on any non-2xx response (403/406/429/5xx all handled uniformly — no special-casing per status). `lib/ingestion/poll.ts`'s `applyRetryAfterFloor()` makes a `Retry-After` a floor on the next-poll delay, winning over a shorter backoff-computed one (never over a longer one after repeated failures) | DONE |
| 77 | Exponential backoff kept from Phase 2d, reconfirmed and directly tested this time: 2x/4x/.../8x-capped per `consecutiveFailures`, reset to the plain interval on the next success | DONE |
| 78 | `tests/ingestion-reliability.spec.ts` (6 tests × 2 projects): bounded concurrency (timing-based — a 6-source tick measurably takes two worker-pool "waves," not one), a broken + slow + healthy source together under the bounded scheduler, Retry-After overriding a shorter backoff, exponential backoff growth then reset-on-success, an actual exceeded timeout (not just a slow-but-successful fetch), and overlap prevention + duplicate protection reconfirmed under the new bounded-concurrency code path. `app/api/test-fixtures/rss/[name]/route.ts` gained `?status=`/`?retryAfter=` simulation params alongside the existing `?delayMs=`. `INGESTION_FETCH_TIMEOUT_MS` (`lib/ingestion/poll.ts`) is now configurable via env, set short for the test server process (`playwright.config.ts`) so the timeout test doesn't need to wait out the real 20s default | DONE |
| 79 | Full re-verification: typecheck / lint / production build clean; `ingestion-reliability.spec.ts` passes 12/12 reliably across repeated standalone runs; full Playwright suite passes 119/120 runnable in a combined run, the one failure being the same previously-diagnosed environment-only flakiness pattern (reconfirmed via an immediate isolated rerun of the affected file, 20/20 clean) | DONE |

### Phase 2g — Stage 3: event matching / clustering foundation

The spec asked for a new deterministic candidate-matching service — this
turned out to already exist as the duplicate-candidate engine
(`lib/ingestion/duplicates.ts`, Phase 2c). Rather than build a second,
parallel system, this phase hardens that one against the exact failure
modes the spec calls out by name, so Stage 4's UI (below) can build on
the same engine instead of a redundant one.

| # | Task | Status |
|---|---|---|
| 80 | Event-type compatibility grading: types are grouped (kinetic/military, civil unrest, natural disaster, health/humanitarian, policy/other) in `lib/ingestion/duplicates.ts`. An exact match scores full credit, a different type in the same group gets half credit (airstrike vs. explosion), a cross-group pairing (earthquake vs. explosion) is actively penalized rather than merely contributing zero — closes a real gap where a same-place/same-time pairing of clearly unrelated event kinds could still clear the match threshold on distance+time alone | DONE |
| 81 | Geographic-signal gate: if nothing places two reports anywhere near each other (not close distance ≤500km, not the same region/country, not the same conflict), a real penalty applies instead of leaving distance at a bare 0 contribution — closes a real gap where an identical/near-identical headline with a matching type and similar time-of-day could clear the threshold from title+type+time alone on opposite sides of the planet | DONE |
| 82 | Generic-headline false-positive guard: expanded the title-similarity stopword list (`breaking`, `news`, `update`/`updates`, `latest`, `live`, `watch`, `video`, `says`/`say`) so two unrelated wire-service headlines don't score a false match purely on shared newsroom boilerplate | DONE |
| 83 | `DuplicateCandidateDTO` gained `eventType`/`region`/`countryCode`/`occurredAt` (context for Stage 4's UI), `eventTypeCompatible`, and `reasons: string[]` — short, human-readable explanations for the score (e.g. "0.3 km away", "same conflict", "62% title overlap"), always at least one entry | DONE |
| 84 | `tests/event-matching.spec.ts` (9 tests × 2 projects) proves every scenario the spec names: obvious same event, same location substantially different time, same event type in a different country, same place/time but incompatible event type, similar wording but geographically unrelated, generic-headline false-positive protection, a boundary case just under `MIN_SCORE`, and the no-candidate case. Publishes one reference event via the real publish API, then calls the existing `POST /api/admin/incoming/[id]/duplicates` directly with synthetic candidates | DONE |
| 85 | Full re-verification: typecheck / lint / production build clean; new suite passes 18/18; `classification.spec.ts` + `multi-source-ingestion.spec.ts` (both exercise the same scoring function) re-run clean, 54/54, confirming no regression from the hardening | DONE |

### Phase 2h — Stage 4: admin event-matching UX

| # | Task | Status |
|---|---|---|
| 86 | `/admin/incoming`'s expanded duplicate-candidate view now surfaces the existing event's context, not just a score: `getEventTypeLabel()` + country/region + relative event time (e.g. "Drone · UA · just now"), and every `reasons` entry from `lib/ingestion/duplicates.ts` as a chip row. Heading changed from "Possible duplicate — N%" to "Likely existing event — N%" per the spec's exact example text | DONE |
| 87 | Reviewer actions relabeled/clarified: the existing merge button is now "Attach to this event" (functionality unchanged — still `POST /api/admin/incoming/[id]/merge`), alongside the existing "View existing event" and "Ignore suggestion." "Create new event" is the existing Publish flow, unchanged — both paths were already correct from Phase 2c, this stage is the UI making the choice and its reasoning legible | DONE |
| 88 | `tests/admin-event-matching-ux.spec.ts` (4 tests × 2 projects, serial): publishes a reference event via the real publish workflow, then verifies (1) the enriched candidate display (heading, event type/location/time line, reasons chip), (2) "Attach to this event" retains the incoming report (status `merged`, original URL/title preserved), increments `sourceCount` with no duplicate public event, and appears as a source on the event detail page, (3) "Create new event" remains available and produces a distinct event id for a non-duplicate report | DONE |
| 89 | Fixed a regression in `tests/classification.spec.ts` from the heading-text change ("Possible duplicate" → "Likely existing event"); no other test referenced the old wording | DONE |
| 90 | Fixed a cross-test contamination bug the new suite itself introduced: its "Create new event" test originally published the shared `feed-a` fixture's bakery article under its unmodified original title, which collided with `classification.spec.ts`/`multi-source-ingestion.spec.ts` assertions that that exact title is never published anywhere in the live `/api/events` feed (their own no-auto-publish proof). Fixed by overriding the title before publish, same pattern already used for the Kyiv reference event | DONE |
| 91 | Full re-verification on a reset DB: typecheck / lint clean; `admin-event-matching-ux.spec.ts` (8/8), `classification.spec.ts` (34/34), `multi-source-ingestion.spec.ts` (20/20), `event-matching.spec.ts` (18/18) all pass together, 80/80, with no cross-test interference | DONE |

### Phase 2i — Stage 5: event corroboration metadata

No schema change needed — every field below is derived at read time from
data `Event.sources`/`EventSource` already had (same "compute, don't
store" pattern as `Event.sourceCount`, Phase 1.5's severity/verification
decisions).

| # | Task | Status |
|---|---|---|
| 92 | `EventCorroborationDTO` (`lib/types/db.ts`) + `getEventCorroboration()` (`lib/data/corroboration.ts`, deliberately dependency-free — no Prisma import — so it runs in both server routes and client components without pulling the Prisma client into the browser bundle): supporting-report count (every linked report, including relays), independent-source count (mirrors existing `sourceCount`), distinct source categories represented, earliest-report timestamp, latest-corroboration timestamp (the most recent linked report of *any* kind — a relay still shows the event is still being actively reported) | DONE |
| 93 | New admin-only views: `/admin/events` (published events list — title/type/location/occurred/source count, linking into each) and `/admin/events/[id]` (event summary + a "Corroboration" panel: "N independent sources", "N supporting reports", categories joined as e.g. "News + Official", "Last corroborated Nh ago", "First reported Nh ago", plus an explicit line that this is descriptive metadata, not a truth/credibility score — spec's explicit requirement). "Events" added to the admin nav (`app/admin/layout.tsx`). No changes to the public `/world`/`/event/[slug]` UI — corroboration is admin-only for now, per spec | DONE |
| 94 | `tests/event-corroboration.spec.ts` (4 tests × 2 projects + setup): publishes an event with an originating report, merges a genuinely independent corroborating report from a differently-categorized source, and merges a relay of the same originating source — verifies the admin view shows 2 independent sources / 3 supporting reports / both categories / correct earliest+latest timestamps, that the disclaimer text is present, that the events list links through correctly, and a boundary case (exactly one source) uses singular "source"/"report" wording, not plural | DONE |
| 95 | Full re-verification on a reset DB: typecheck / lint / production build all clean; full Playwright suite (168 tests) run together — 165 passed, 3 skipped (pre-existing, intentional mobile-viewport skips unrelated to this stage), 0 failed | DONE |

### Phase 2j — Event lifecycle management

| # | Task | Status |
|---|---|---|
| 96 | Add nullable `Event.publishedAt` and derived Draft / Published / Unpublished statuses; include all lifecycle states in the admin list | DONE |
| 97 | Manual event creation with source attribution, editing, publish/unpublish, and confirmed deletion; retain supporting reports and return only reports with no remaining event links to the incoming queue | DONE |
| 98 | Validate create/edit inputs; preserve exact timestamps, disputed status, location names, and source attribution during editing; show lifecycle request failures | DONE |
| 99 | Fix repeated-outlet React keys without deduplicating reports; assert no duplicate-key errors through incoming review and public source rendering; verify original article URLs | DONE |
| 100 | Hide and disable homepage layer controls while a conflict preview is open; restore them on close | DONE |
| 101 | Verify lifecycle UI/API, corroboration, matching, pipeline integrity, classification, multi-source ingestion, and overlay behavior on desktop/mobile | DONE |

Verification: 128 distinct checks passed across targeted runs, with two
intentional mobile overlay skips. Tests used a separate SQLite database
under the ignored `playwright/.cache` directory, seeded for classification
coverage, with background polling disabled and browser external DNS blocked.
The live BBC ingestion suite was not run. Desktop/mobile create forms were
also inspected visually. Production build, typecheck, and lint passed (downloaded browser and
test artifacts excluded from lint).

The additive migration leaves historical timestamps null. When an older
published event is unpublished, its creation time becomes a legacy history
marker so it cannot be mislabeled Draft; it is not an independently known
first-publication timestamp. New manual and incoming publications record
their publication time explicitly.

### Phase 2k — Conflict/event heatmap redesign

| # | Task | Status |
|---|---|---|
| 102 | Replace MapLibre's native `heatmap` layer (color coupled to nearby-report density) with two `circle`-based layers (`lib/map/heat-layers.ts`, `components/map/world-map.tsx`): per-event color = severity, opacity = corroboration × recency decay, radius = scope (importance) — report count drives neither color nor the severity signal | DONE |
| 103 | Add a conflict base layer: one wide glow per `conflictId`, centered on the group's centroid, radius scaled by the group's own geographic spread (with a floor so a tight cluster still reads as an area), colored by the group's worst (max) severity, not recency-decayed so it persists through reporting gaps | DONE |
| 104 | `tests/world-map-heat.spec.ts` (16 checks × 2 projects): pure-function coverage of the report-count-never-drives-color guarantee, single-source-severe-stays-red, wide vs. tight spread radius, recency ageHours, corroboration pass-through, no-conflictId exclusion, multi-conflict independence, plus a real-published-events render-with-no-console-errors check | DONE |
| 105 | Full re-verification: typecheck/lint/build clean; full Playwright suite (212 tests) — 207 passed, 5 skipped (pre-existing intentional mobile skips), 0 failed. Manually inspected the Middle East/West Bank area in heatmap mode at desktop viewport width — confirmed a wide, soft, red-to-orange gradient area rather than isolated dots, distinct from the separately-colored Syria conflict's glow nearby | DONE |

### Phase 2l — Heatmap radial gradient, globe cluster counts, globe borders

| # | Task | Status |
|---|---|---|
| 106 | Split each heat feature (per-event and per-conflict-base) into three concentric `circle` layers (`GRADIENT_RINGS` in `world-map.tsx`) instead of one blurred circle — a single `circle-blur`'d shape still composites toward a solid-looking disc wherever several same-severity glows overlap, which is the normal case in a genuinely active area; three rings of decreasing radius/increasing opacity make transparent-edge-to-strong-center unambiguous regardless of overlap | DONE |
| 107 | Globe cluster counts (`lib/globe/event-clusters.ts`): greedy lat/lng-radius clustering of individual events, rendered through the same `htmlElementsData` layer conflict hotspots already use (three-globe exposes only one such layer — `conflict-globe.tsx`'s new `GlobeMarker` union tags each item so one factory dispatches to the existing hotspot renderer or the new `makeClusterEl`). A cluster of one renders as a plain severity-colored dot; 2+ show a count, capped at the display label "99+" (the real count is preserved internally). Clustering radius scales with the camera's own altitude, polled every 300ms and bucketed so pure rotation (which doesn't change distance) never triggers a recompute — zooming out merges a region into fewer/larger clusters, zooming in splits them apart | DONE |
| 108 | Normal-globe borders on by default (`DEFAULT_GLOBE_LAYERS.borders: true`) on the Intel globe specifically, suppressed in Satellite mode regardless of the toggle — the existing pre-decimated dataset (one ~22-point ring/country) measures as a bounded ~0.5–1s one-time cost, not a per-frame cost, which is what keeps this compatible with the original "keep first paint fast" reasoning for defaulting it off. Explicit low `pathPointAlt` keeps it beneath the landmass fill and every marker layer | DONE |
| 109 | Extracted `severityRank`/`maxSeverity` to `lib/utils/severity.ts` (previously a private copy inside `lib/map/heat-layers.ts`) so the new globe-clustering code reuses the same "worst severity, never an average or a count" reduction instead of a second copy | DONE |
| 110 | `tests/globe-clusters.spec.ts` (6 checks × 2 projects): pure-function coverage of merge/split-by-radius, worst-severity-not-average-or-count (both directions — one severe event among many low ones, and many low-severity events alone), 99+ label capping without touching the real count, and altitude-to-radius scaling. `tests/globe-rendering.spec.ts` (2 checks × 2 projects): borders-on-by-default reaches the real UI toggle state, and enabling the Events layer renders real cluster markers with correct count/severity aria-labels, both with zero console errors | DONE |
| 111 | Full re-verification on a reset DB: typecheck/lint/build clean; full Playwright suite (228 tests) — 223 passed, 5 skipped (pre-existing intentional mobile skips), 0 failed. Manually verified in-browser (desktop viewport): the redesigned gradient rings are visibly smoother/more pronounced than the two-layer version: clear bright cores fading to fully transparent edges, no banding; cluster markers show correct counts and re-cluster live as the camera zooms in/out on the Middle East/Sahel region; country border lines are visible on the Intel globe by default | DONE |

### Phase 2m — Structured Event Intelligence

| # | Task | Status |
|---|---|---|
| 112 | New `ExtractedFact` table (`prisma/schema.prisma`, additive migration) — one row per individually extractable field per incoming report, no unique constraint on `(rawIngestionItemId, field)` so conflicting source values (multiple casualty figures, multiple named actors, multiple ambiguous-location candidates) coexist rather than one silently overwriting another | DONE |
| 113 | `lib/ingestion/extract-facts.ts`: deterministic heuristic extractor (event type, title, summary, country/region/location name, lat/lng, occurred-at, actors, casualties killed/injured, infrastructure damage, severity, likely conflict), each fact carrying confidence + source/provenance + observedAt. "Unknown stays unknown" — a field with no supporting evidence produces no fact, never a guessed/defaulted value | DONE |
| 114 | Three new curated-heuristic modules: `lib/ingestion/actors.ts` (alias table collapsing surface forms like "IDF"/"Israeli forces" to one canonical actor), `lib/ingestion/casualties.ts` (regex casualty-figure extraction with explicit-negation bailout), `lib/ingestion/infrastructure-damage.ts` (keyword-phrase damage detection) | DONE |
| 115 | `lib/db/repositories/extracted-facts.ts`: status-aware persistence — re-extraction replaces only still-`"extracted"` facts, leaving admin-accepted/rejected/edited facts untouched; editing a fact preserves the true original extracted value in `originalValue` across repeated edits | DONE |
| 116 | Three new admin API routes: `POST /api/admin/incoming/[id]/extract` (force re-extraction), `GET /api/admin/incoming/[id]/facts` (persisted facts + effective-value resolution + matched-event field diffs, reusing the existing `findDuplicateCandidates()` engine — no second matching system), `PATCH /api/admin/incoming/[id]/facts/[factId]` (accept/reject/edit one fact) | DONE |
| 117 | Automatic extraction wired into `pollSource()` (`lib/ingestion/poll.ts`) alongside the existing suggestion snapshot, same never-block-ingestion error handling; extraction, accept/reject/edit are all admin-side annotations only — nothing in this pipeline auto-publishes or auto-modifies a public `Event` | DONE |
| 118 | `/admin/incoming` "Structured Facts" panel: per-field grouping of (possibly multiple) facts, confidence + status + provenance display, inline edit, accept/reject actions, amber styling for facts below 0.5 confidence, and a "differs from event" / "matches event" badge per field when a duplicate-matched event exists | DONE |
| 119 | `tests/extract-facts.spec.ts` (5 pure-function checks) + `tests/extract-facts-api.spec.ts` (3 API-level checks): clear location/type extraction, missing info stays absent, conflicting casualty figures coexist, multiple actors, ambiguous low-confidence geolocation, provenance preserved across repeated edits, extraction/review never auto-publishes or modifies an event, field-diff comparison against a matched event | DONE |
| 120 | Full re-verification on a reset DB: typecheck/lint/build clean; full Playwright suite (244 tests across Desktop + Mobile) — 239 passed, 5 skipped (pre-existing intentional mobile skips), 0 failed. Manually verified in-browser: Structured Facts panel renders confidence/provenance/status, low-confidence ambiguous-location facts render with distinct amber styling, accept/edit interactions work live against the real API, and the matched-event diff badges correctly show "differs from event (currently: …)" for a changed field and "matches event" for an unchanged one | DONE |

### Phase 2m decisions

- **One fact-claim per row, not one row per report.** Omitting a unique
  constraint on `(rawIngestionItemId, field)` was the whole mechanism
  needed to satisfy "conflicting source values must coexist" — no
  array/JSON column, no conflict-resolution algorithm. Multiplicity is
  simply allowed; `GET .../facts`'s `effectiveValue()` picks a single
  value only where the *caller* (duplicate matching, event-diffing)
  needs one, and even then admin decisions always outrank raw
  suggestions.
- **A second, deliberately separate pipeline from `extractDraft()`,
  not a replacement.** `lib/ingestion/draft.ts` is untouched. The two
  differ in exactly the ways the spec required: field-level (not flat)
  output, multi-value fields, and genuine field omission on no
  evidence — `extractDraft()`'s always-fill-every-field shape exists
  because it feeds a required publish form and has no way to leave a
  field blank; `extractFacts()` has no such constraint.
- **Comparison against a matched event is scoped to columns `Event`
  actually has.** Casualties, actors, and infrastructure damage are
  extracted and stored like any other field, but never appear in
  `fieldDiffs` — `Event` has no such columns, and this milestone
  intentionally adds none, to keep event history/versioning (the next
  milestone) unconstrained by a premature schema decision here.
  Lat/lng comparison uses a ~50m epsilon rather than exact string
  equality, so float-formatting noise between two independently
  computed coordinates doesn't register as a false "differs."
- **Re-extraction must not discard review work.** Persistence deletes
  and recreates only rows still in `status: "extracted"`; anything an
  admin already accepted, rejected, or edited survives a re-extraction
  untouched (e.g. after the admin edits the raw report text and
  re-runs extraction). Editing a fact keeps the *first* extracted
  value in `originalValue` even across a second or third edit
  (`existing.originalValue ?? existing.value`), so the true source
  claim is never lost to provenance.

### Phase 2n — Live Event Updates

| # | Task | Status |
|---|---|---|
| 121 | New `EventUpdateProposal` and `EventHistory` tables (`prisma/schema.prisma`, additive migration), plus nullable `actors`/`casualtiesKilled`/`casualtiesInjured`/`infrastructureDamage` columns on `Event` — populated only through an accepted proposal, never by direct manual entry | DONE |
| 122 | `lib/ingestion/fact-diff.ts` (extracted from the Structured Event Intelligence facts route): shared `pickEffectiveFact()`/`valuesDiffer()` so both the pre-merge candidate preview and the new post-merge proposal generator resolve multi-fact fields and tolerance-compare values identically | DONE |
| 123 | `lib/ingestion/event-update-proposals.ts`: pure `buildProposalDrafts(event, facts)` comparing one report's extracted facts against one event's current state — scalar fields (title/summary/location/coordinates/time/severity/type/conflict) compare one-to-one; actors/infrastructure damage propose any new value not already in the event's array; casualty fields allow multiple simultaneous conflicting proposals per field | DONE |
| 124 | `lib/db/repositories/event-updates.ts`: persistence + `acceptProposal()`/`rejectProposal()`/`acceptAllSafeProposals()` — accept mutates the event and writes an immutable `EventHistory` row in one transaction; reject only flips the proposal's own status, touching neither the event nor history; `hasConflict` computed fresh from sibling pending proposals on every read | DONE |
| 125 | Wired into `POST /api/admin/incoming/[id]/merge` (proposal generation right after attachment) and four new routes: `GET/PATCH .../events/[id]/proposals[/​[proposalId]]`, `POST .../proposals/accept-safe`, `GET .../events/[id]/history` | DONE |
| 126 | `/admin/events/[id]`: new "Supporting Reports", "Pending Updates" (current → proposed, change-type badge, confidence, provenance, conflict warning, Accept/Reject, bulk "Accept all safe"), and "History" panels; inline actors/casualties/damage once accepted; "Updated X ago" driven by the latest `EventHistory` entry, not `Event.updatedAt` (see Decisions) | DONE |
| 127 | Public `/event/[slug]`: "Updated X ago" (same history-driven logic), inline actors/casualties/damage, and an optional concise "Recent Updates" section (last 5 accepted changes) — `EventHistory` rows are safe to show as-is since only accepted changes ever reach that table | DONE |
| 128 | `tests/event-update-proposals.spec.ts` (11 pure-function checks) + `tests/event-update-proposals-api.spec.ts` (7 API-level checks): unchanged/changed/new-value fields, competing casualty figures, rejected facts excluded, effective-fact resolution, epsilon/tolerance compares, provenance passthrough, matching-report attach + proposal generation, safe-metadata auto-update, casualty-requires-approval, accept mutates event + writes history, reject leaves event untouched, competing values flagged conflicting | DONE |
| 129 | Full re-verification on a reset DB: typecheck/lint/build clean; full Playwright suite (280 tests across Desktop + Mobile) — 275 passed, 5 pre-existing skips, 0 failed. Manually verified in-browser: merged two conflicting-casualty reports into a published event, confirmed the Pending Updates panel showed both figures with a conflict badge, accepted a severity change and watched History/`updatedAt`-derived "Updated X ago" update on both the admin and public event pages with zero console errors, then used "Accept all safe" and confirmed only proposals at/above the confidence floor were applied | DONE |

### Phase 2n decisions

- **`Event.updatedAt` is the wrong signal for "Updated X ago."** It
  first appeared to work, then a real bug surfaced during manual
  verification: publishing/unpublishing an event (a lifecycle action,
  not a content change) also bumps Prisma's `@updatedAt`, which made a
  freshly-published, never-edited event show a misleading "Updated just
  now." Fixed by driving the badge from the most recent `EventHistory`
  row instead (`history.length > 0`, timestamp from `history[0]`) on
  both the admin and public pages — history rows are created ONLY by an
  accepted proposal, so the badge now means exactly what the spec asked
  for.
- **`EventHistory` needs no "is this safe to show publicly" filter,
  by construction.** A row is created in exactly one place
  (`acceptProposal()`), and only for an ACCEPTED proposal — a rejected
  proposal never produces one. So "do not expose rejected/unverified
  proposals publicly" is satisfied simply by never querying
  `EventUpdateProposal` from any public-facing code path, not by
  filtering a shared table.
- **Proposals store a snapshot of `currentValue`, not a live
  reference.** If a second, later proposal for the same field gets
  accepted first, an earlier pending proposal's displayed "current
  value" stays as it was when that proposal was created rather than
  silently updating underneath the admin reviewing it — "make it
  obvious what will change" means obvious relative to what's on screen,
  not a value that can drift mid-review.
- **"Accept all safe" is still an admin action, not an automatic
  path.** Every field this milestone proposes is explicitly a "factual
  change" the spec keeps approval-based (casualties, location,
  severity, actors, event type, summary, conflict) — there is no
  unattended auto-apply anywhere in this pipeline. The genuinely
  automatic half of spec §3 (source attachment, corroboration count,
  lastCorroborated) required zero new code, because it was already
  true: `EventSource` links and `lib/data/corroboration.ts`'s
  derive-at-read-time corroboration metadata reflect a new attachment
  immediately, with no proposal or approval step involved at all.
- **List-valued fields (actors, infrastructure damage) needed a
  different comparison shape than scalar fields, not a forced fit.**
  Trying to express "the report named two new actors" as one
  current-value/proposed-value pair would have meant either losing one
  of the actors or inventing an array-diff encoding inside a plain
  string column. Proposing one row per new, not-already-present value
  is simpler and reuses the exact "one fact-claim per row" pattern
  Structured Event Intelligence already established for the same
  reason.

### Phase 2o — Globe readability: visible borders, disputed boundaries, city labels

| # | Task | Status |
|---|---|---|
| 130 | Found and fixed the actual bug behind "borders don't visibly show": `pathColor` was set to the exact same string as the landmass fill's `polygonCapColor`, and rendered at a lower `pathPointAlt` than that fill, so a border was both color-matched to AND visually occluded by the land sitting in front of it — invisible everywhere it crossed land rather than coastline. Fixed by moving borders above the land fill (still below markers/labels) and giving them a distinct, named `BORDER_COLOR` | DONE |
| 131 | Natural Earth's own `TYPE` field on the bundled border dataset ("Disputed" for Palestine, "Indeterminate" for Western Sahara/Somaliland/Antarctica) is now carried through as `GlobePath.disputed` and rendered with a distinct dashed amber color instead of blending in as an ordinary undisputed border | DONE |
| 132 | `lib/globe/city-labels.ts` (NEW): a ~200-entry hand-curated tiered city dataset (no new dependency — none existed anywhere in the project or bundled with three-globe) — tier 1 (capitals/major global cities), tier 2 (regional), tier 3 (close-zoom), reusing the exact tiering convention `getCountryLabels()` already established | DONE |
| 133 | `cityLabelTierForAltitude()` reuses the same camera-altitude polling the event-cluster radius already depends on (no second interval) to reveal more city tiers on zoom-in and hide labels entirely when zoomed too far out; reduced one tier further on mobile and in Satellite mode | DONE |
| 134 | Country-name and city-name labels now share three-globe's single `labelsData` layer via a `GlobeLabel` tagged union, sized/colored so city names read as visually subordinate to country names | DONE |
| 135 | `DEFAULT_GLOBE_LAYERS.labels` flipped to `true` (Labels was the one remaining globe layer still off by default) with a zustand-persist `version`/`migrate()` bump so a returning browser's already-saved `globeLayers` preference doesn't silently keep pinning Borders/Labels off forever just because that was the default when it was first saved | DONE |
| 136 | `lib/globe/globe-colors.ts` (NEW): named `LAND_FILL_COLOR`/`BORDER_COLOR`/`DISPUTED_BORDER_COLOR` constants (replacing inline JSX string literals) plus a `colorDistance()` helper, so the invisibility bug's regression test can assert the colors are actually far apart in RGBA space, not just string-different | DONE |
| 137 | `tests/globe-readability.spec.ts` (10 pure-function checks): border/land-fill color distance, disputed/ordinary color distance, real disputed-territory data presence, city-label tier supersets, tier-0 hides everything, valid coordinates, altitude-to-tier calibration against the globe's own default resting altitude, monotonic tier-vs-altitude behavior. Extended `tests/globe-rendering.spec.ts` test 1 to also assert Labels defaults to checked | DONE |
| 138 | Full re-verification on a reset DB: typecheck/lint/build clean; full Playwright suite (300 tests across Desktop + Mobile) — 295 passed, 5 pre-existing skips, 0 failed (a first full run hit 2 unrelated flaky failures in ingestion/source-fixture tests untouched by this milestone; both passed in isolation and on a clean re-run). Manually verified in-browser across Europe, Middle East, North America, and East Asia: borders clearly visible and readable on the Intel globe, Western Sahara's disputed border renders dashed amber, city names (e.g. Madrid, Beijing, Seattle/Denver/Ottawa) appear and reveal more on zoom-in, no excessive overlap observed, Satellite mode suppresses borders and shows fewer labels at the same zoom, and clicking a conflict hotspot still opens its detail panel — labels do not block interaction. Zero console errors throughout | DONE |

### Phase 2o decisions

- **A toggle being checked is not the same as the thing it controls
  being visible.** The existing "Borders are visible by default" test
  only asserted the Layers popover checkbox was checked — which was
  already true and always passed — while the actual rendered line was
  invisible the whole time because its color exactly matched the
  landmass fill rendered in front of it. Fixed the bug, then fixed the
  gap in what was being verified: color-distance assertions
  (`colorDistance()` in `lib/globe/globe-colors.ts`) now guard the
  specific invariant that broke, and manual in-browser verification
  across four real regions is the ground truth for "actually visible,"
  not a substitute automated check pretending to be one.
- **Overlap prevention for city labels is a data-curation problem here,
  not a runtime one.** three-globe's `labelsData` has no built-in
  collision/declutter system (unlike, say, a Mapbox symbol layer). Rather
  than building screen-space collision detection from scratch — a much
  larger and riskier addition than this fix calls for — the ~200-city
  dataset itself is hand-spaced with real geographic separation within
  each cumulative tier, and the altitude-gated tier system means only a
  fraction of the dataset is ever visible at once.
- **No new geographic dependency.** The spec explicitly allowed a
  lightweight static dataset over a heavy new one if nothing suitable
  already existed — nothing did (checked both this project's `lib/data/
  *` and everything bundled with `three-globe`), so `city-labels.ts` is
  a plain hand-curated TypeScript array, not a geocoding library or a
  fetched dataset.
- **A version bump on the persisted preferences store, not just a
  default-value change.** Flipping `DEFAULT_GLOBE_LAYERS` alone would
  only affect browsers with nothing saved yet — zustand's `persist`
  middleware otherwise trusts whatever a returning user's `localStorage`
  already has for any key present in it. Without the `migrate()` step,
  anyone who'd loaded the app before this fix would have kept seeing
  Borders/Labels off forever, silently, which is exactly the "enabled in
  config but not in a real browser" failure mode the spec called out.

### Phase 2p — Event Version History / Timeline Backbone

| # | Task | Status |
|---|---|---|
| 139 | Found and fixed a real correctness bug before reconstruction could work at all: `acceptProposal()` was writing `EventHistory.oldValue` from the proposal's CREATION-time snapshot (`EventUpdateProposal.currentValue`), which goes stale when a sibling proposal for the same field is accepted first. Fixed by reading the event's TRUE live value at accept time (`currentFieldValueForHistory()`); `EventUpdateProposalDTO.currentValue` is untouched (it still serves its original UI-display purpose) | DONE |
| 140 | `EventSource.createdAt` (additive migration) — attachment timestamp, distinct from the linked report's own publishedAt/receivedAt, needed to answer "known/attached sources at time T" correctly | DONE |
| 141 | `EventHistory.confidence` (additive migration) — carried over from the accepted proposal's own confidence, per spec "confidence/provenance where available" | DONE |
| 142 | `lib/data/event-reconstruction.ts` (NEW, pure): `reconstructEventState(event, history, sources, timestamp)` — rolls back scalar/casualty fields from the current row using EventHistory, accumulates list fields (actors/infrastructure damage) from additive entries, filters sources by attachment time, and derives best-effort publication state at T | DONE |
| 143 | `lib/db/repositories/event-reconstruction.ts` (NEW): `reconstructEventStateAt(eventId, timestamp)` and `listEventIdsKnownAt(timestamp)` — the "historical query foundation" (spec §5), backing two new admin API routes (`GET .../events/[id]/reconstruct?at=`, `GET .../events/known-at?at=`) with no new UI wired to them yet | DONE |
| 144 | `/admin/events/[id]`'s History panel replaced with a merged chronological timeline — synthetic "Event created" and "New source attached" entries alongside real accepted changes, each described in plain language (`lib/data/event-history-description.ts`: "Killed: 4 → 6", "Severity changed: ...", "Location refined", "Conflict association updated") — reused by the public page's "Recent Updates" section too | DONE |
| 145 | `tests/event-reconstruction.spec.ts` (10 pure checks) + `tests/event-history-description.spec.ts` (6 pure checks) + `tests/event-reconstruction-api.spec.ts` (7 API checks): current/earlier-state reconstruction, multiple sequential updates, source-attachment timestamps, casualty/location/severity rollback, list-field accumulation, publication state, the out-of-order-accept staleness fix (reproduced end-to-end), rejected proposals create no history, ordinary manual edits never destroy existing history, known-at-T query correctness, pre-creation timestamp returns 404 | DONE |
| 146 | Full re-verification on a reset DB: typecheck/lint/build clean; full Playwright suite (346 tests across Desktop + Mobile) — 341 passed, 5 pre-existing skips, 0 failed. Manually verified in-browser: merged reports into a published event, accepted severity and casualty proposals, confirmed the admin History panel showed "Event created" → "New source attached" ×2 → "Severity changed: elevated → high" → "Killed: unknown → 7" in correct reverse-chronological order with provenance/confidence; called the reconstruct API directly and confirmed a pre-change timestamp correctly recovered severity "elevated", casualtiesKilled null, only the first attached source, and published:false; confirmed the public event page's "Updated X ago" and "Recent Updates" reflected the same accepted changes with zero console errors | DONE |

### Phase 2p decisions

- **`EventHistory` is the version model — no separate snapshot table.**
  Spec explicitly allowed skipping full-snapshot storage "if a clean
  change-log/version model fits the architecture," and the one built for
  Live Event Updates already does: replaying old/new field diffs
  backward from the current row reconstructs any prior state without
  ever storing a second copy of the event. The only genuinely new
  concept this milestone adds is the replay function itself.
- **A stale `oldValue` isn't just a display quirk once reconstruction
  exists — it corrupts every earlier timestamp.** This was caught
  before it could ship: writing an out-of-order-accept test against the
  reconstruction API surfaced that `EventHistory.oldValue` and
  `EventUpdateProposal.currentValue` had been treated as
  interchangeable, when only the latter is allowed to go stale (by
  original design, for good reason — see Live Event Updates'
  Decisions.md entry). The fix reads the event's live value at the
  moment of accept specifically for the history row, leaving the
  proposal's own display snapshot alone.
- **List-valued fields don't roll back — they're rebuilt by
  accumulation.** Every accepted `actor`/`infrastructureDamage` entry
  is additive by construction (Live Event Updates never proposes
  "replace the actor list," only "add this new actor"), so their state
  at any timestamp T is simply every such entry with `createdAt <= T` —
  no oldValue/rollback logic needed or meaningful for these two fields.
- **`EventSource` needed its own timestamp.** The report's own
  `publishedAt`/`receivedAt` (already used for corroboration's "first
  reported"/"last corroborated" metadata) answers "when was this
  reported," not "when did we learn it belonged to this event" — a
  report can sit in the incoming queue for a while before an admin
  reviews and merges it. Reconstructing "known sources at T" needed the
  latter, so `EventSource.createdAt` was added rather than
  approximating with a timestamp that answers a different question.
- **No new admin/public UI for browsing arbitrary timestamps.** Spec
  explicitly scoped this milestone to backend/data-layer foundation
  (§5) plus the existing history panel's presentation — the two new
  API routes (`known-at`, `[id]/reconstruct`) are deliberately not
  wired into any time-picker or slider; that's the next milestone's
  job, and building it now would be scope creep this spec explicitly
  called out to avoid.

### Phase 2q — Global Timeline / Historical Playback

| # | Task | Status |
|---|---|---|
| 147 | `GET /api/events` gained an optional `?at=<ISO>` query param (backward compatible — omitted, byte-identical to before) that switches from "current published events" to "the world as it was known/published at that moment", via a new `reconstructWorldStateAt()` (`lib/db/repositories/event-reconstruction.ts`) — 2 batched queries regardless of event count, no per-event round-trip | DONE |
| 148 | `reconstructWorldStateAt()` reuses the exact same pure `reconstructEventState()` replay logic Event Version History already built (no second reconstruction implementation), overlays reconstructed field values onto a shallow copy of each event's row, filters `sources` to links attached by T, keeps only events published as of T, and feeds the result through the existing `dbEventToConflictEvent()` converter unchanged | DONE |
| 149 | `lib/utils/world-timeline.ts` (NEW, pure): `resolveTimelineTimestamp()` maps a preset (Live/1H/6H/24H/7D/30D/Custom — 1H-30D reusing the EXISTING `TimeRange` type/values) to an "as of" timestamp or null for Live, rounded down to the minute so repeat preset selections within a session hit the events cache | DONE |
| 150 | `hooks/use-world-timeline.ts` (NEW): all timeline state is a single `asOf: Date \| null` — the "playback foundation" (spec §6) a later Play/Pause feature can drive by just advancing that one value on an interval, with no other state or rendering code needing to change shape | DONE |
| 151 | `hooks/use-world-events.ts` (NEW): the `/world` page's single data source for both modes — 20s polling when Live (identical to the pre-existing `useLiveEvents`), a one-shot fetch per distinct historical timestamp with an in-memory exact-timestamp cache otherwise (spec "do not create expensive per-frame historical queries") | DONE |
| 152 | `components/map/timeline-controls.tsx` (NEW): Live/1H/6H/24H/7D/30D/Custom… control, a persistent "Viewing {timestamp} · Return to Live" banner while historical, always shown in UTC to avoid a timezone hydration mismatch. Deliberately a separate, distinctly-labeled control from the pre-existing recency filter (same 1H/6H/24H/7D button labels, different meaning) — caught and fixed a real `aria-label` substring collision ("Timeline" contains "Time") that broke two pre-existing tests before it shipped | DONE |
| 153 | `/world` page wiring: historical mode swaps in the reconstructed event set (mock events excluded — they have no history to reconstruct from), skips the recency filter (would otherwise filter out nearly everything relative to *now*), adds an accent ring around the map viewport and swaps the sidebar heading to "Historical Event Feed" so historical data can't be mistaken for live — markers, heatmap, and cluster counts update with zero changes to `WorldMap` itself, since they were already pure functions of the `events` array | DONE |
| 154 | `tests/world-timeline.spec.ts` (6 pure checks) + `tests/world-timeline-api.spec.ts` (7 API checks) + `tests/world-timeline-ui.spec.ts` (3 real-browser checks): preset resolution/monotonicity/rounding, historical timestamps hiding future events, publication-state-at-T, field/source reconstruction correctness, Live restoring current state unaffected by prior historical queries, invalid and far-future timestamps handled cleanly, the two time controls operating independently, and the custom date/time picker end-to-end | DONE |
| 155 | Full re-verification on a reset DB: typecheck/lint/build clean; full Playwright suite (378 tests across Desktop + Mobile) — 370 passed, 8 pre-existing skips, 0 failed. Manually verified in-browser: selected historical presets and a custom timestamp, confirmed reconstructed severity/source-count changed correctly across a real merge+accept sequence, confirmed clicking a map marker in historical mode opens the inline detail panel with reconstructed (not live) data, confirmed cluster counts visibly differ between historical and Live, and confirmed Return to Live restores the full current feed — zero console errors throughout | DONE |
| 156 | Follow-up fix: the custom-timestamp picker test was intermittently failing — it filled a value a few minutes ahead of "now" to safely clear event creation, but the picker's own `max` attribute capped it at "now", so the browser silently rejected the out-of-range fill. The `max` clamp was UX-only (a future custom timestamp already degrades harmlessly to current state, per its own API-level test), so it was removed rather than making the test fight it; the test's timestamp construction was also moved to run inside the browser page instead of the separate test-runner process, so its timezone offset can never mismatch what the input parses it back with. Re-ran the fixed test 3× standalone plus the full suite clean | DONE |

### Phase 2q decisions

- **Extend the existing public endpoint, don't add a parallel one.**
  `GET /api/events` already returns exactly the shape the map needs;
  adding an optional `?at=` param keeps `hooks/use-world-events.ts` from
  needing two different response shapes to handle, and every existing
  caller (which never passes `at`) is unaffected byte-for-byte.
- **The two time controls needed to be visibly and semantically
  distinct, not merged.** The pre-existing recency filter ("only show
  events from the last N hours," relative to now) and this milestone's
  new timeline ("show me the world as it was N hours ago," a fixed past
  moment) share the same button labels by coincidence of both using
  1H/6H/24H/7D, but answer different questions — conflating them into
  one control would give it two meanings. Keeping them separate is also
  what caught a real bug before shipping: an `aria-label="Timeline"`
  turned out to be a substring of the pre-existing group's
  `aria-label="Time"`, which broke two unrelated tests via Playwright's
  substring name matching. Renamed to `"Playback"` rather than papering
  over it with `exact: true` in the existing tests, since the
  underlying ambiguity (two controls a screen reader user could
  genuinely confuse) was the real problem.
- **Historical mode excludes mock events entirely, rather than treating
  them as always-present.** Mock/seed events have no `createdAt` or
  history to replay — including them in "the world as it was at T"
  would be presenting fabricated-consistency data with no real
  historical grounding. Live mode still merges them with published DB
  events exactly as before; only the historical branch is stricter.
- **The recency filter is skipped, not disabled, while historical.**
  It's still there and still works the instant the user returns to
  Live — it just doesn't apply to a historical query, because "only
  show events from the last N hours relative to right now" is close to
  meaningless when "right now" isn't what's being viewed.
- **No animated playback was built.** Spec explicitly scoped this to a
  foundation a LATER Play/Pause feature can build on without a redesign
  — `asOf: Date | null` being the entire piece of driving state is that
  foundation. Building the animation loop itself now would be the kind
  of scope creep the spec's own "do not build... unless trivial"
  called out.

### Phase 2r — Animated Global Timeline Playback

| # | Task | Status |
|---|---|---|
| 157 | `lib/utils/world-timeline.ts` gained pure playback math: `playbackStepMs()` (step size scales with the range's own span — `max(60s, span/60)`), `advancePlaybackTimestamp()` (one step/tick, clamped to the range), `clampToPlaybackRange()`, `playbackProgress()`/`timestampAtProgress()` (0-1 fraction ↔ timestamp, inverse of each other), plus `PLAYBACK_SPEEDS = [0.5,1,2,4]` and a fixed `PLAYBACK_TICK_MS = 500` — the previously-private `roundDownToMinute()` was exported so callers share one rounding convention | DONE |
| 158 | `hooks/use-world-timeline.ts` extended (not replaced) with `rangeStart`/`rangeEnd`/`isPlaying`/`speed`/`play`/`pause`/`stepForward`/`stepBackward`/`setSpeed`/`scrubTo`/`scrubToProgress`/`previewNextAsOf` — the range is implicit from whatever preset/custom selection is active (no new range-picker UI), ticking runs on a fixed 500ms `setInterval` reading a "latest asOf" ref (not `asOf` itself, to avoid tearing the interval down every tick) so tick FREQUENCY never changes with speed, only how far each tick jumps | DONE |
| 159 | `hooks/use-world-events.ts` upgraded from the prior milestone's "ignore late results via a `cancelled` flag" to a real per-fetch `AbortController`, aborted on cleanup — an `asOf` change mid-flight genuinely cancels the in-flight request now. Added a second, independent effect that prefetches `previewNextAsOf` into the same cache Map (own `AbortController`, never touches displayed `events`/`loading`/`error` state) | DONE |
| 160 | `components/map/timeline-controls.tsx`: Play/Pause toggle, step forward/backward, 4 speed buttons, a progress-percentage label, and a drag-to-scrub range input — rendered only when a historical range is active, all with stable `data-testid`s for testing | DONE |
| 161 | `app/world/page.tsx` wiring: `useWorldEvents(timeline.asOf, timeline.previewNextAsOf)`; a new `selectEvent()` pauses playback before setting the selected event (spec "opening event details during playback must show data for the current historical timestamp") — resolved by pausing rather than keeping a live-syncing reference, avoiding the "event no longer exists at the new asOf" case entirely; all `TimelineControls` playback props wired through | DONE |
| 162 | `tests/world-playback.spec.ts` (NEW, 15 pure checks): step sizing for short vs. long ranges, zero/negative-span safety, forward/backward advancement and speed proportionality, clamping at both range boundaries, progress/timestampAtProgress round-trip and out-of-range clamping | DONE |
| 163 | `tests/world-playback-ui.spec.ts` (NEW, 8 real-browser checks, desktop-only): play advances/pause holds exactly, step forward/backward symmetry, 4x advances further than 1x over the same wait, Return to Live stops playback and removes the controls, dragging the scrubber pauses cleanly with no drift, network request count stays bounded (<20) over a 3s playback window, rapid preset-switching settles on the last selection with no late-arriving stale overwrite, zero console errors across a full play/speed/pause/step/return cycle | DONE |
| 164 | Found and fixed a real rounding-consistency bug during test development: `rangeEnd` was captured via raw (unrounded) `new Date()` while `rangeStart` was already minute-rounded, so `rangeEnd − rangeStart` wasn't a clean multiple of 60,000ms — combined with each step's own minute-rounding, this produced asymmetric drift (forward/forward/backward not landing back where naive percentage math predicted). Fixed at the source by exporting `roundDownToMinute()` and applying it to `rangeEnd`'s capture in both `selectPreset` and `selectCustomTimestamp`, not by loosening the test's tolerance | DONE |
| 165 | Full re-verification on a reset DB: typecheck/lint/build clean; full Playwright suite run; targeted 46-test re-run (all timeline/playback/map/event specs together) passed 46/46. Manually verified in-browser: Play/Pause/step/speed/scrub/Return to Live all behave correctly, markers/heatmap/cluster counts/event feed update smoothly during playback, zero console errors | DONE |

### Phase 2r decisions

- **Fixed tick rate, speed-scaled step size — not the other way around.**
  Speed (0.5/1/2/4x) only changes how far `asOf` jumps per tick;
  `PLAYBACK_TICK_MS = 500` never changes. This single choice satisfies
  both "avoid per-frame backend calls" and "prevent request buildup at
  higher speeds" at once — the fetch rate is capped by a constant no
  matter how fast playback runs, with no separate throttling code
  needed.
- **No new range-picker UI.** Spec explicitly said to preserve the
  existing Live/1H/6H/24H/7D/30D/Custom controls; the playback range is
  derived from whichever of those is already selected (`rangeStart` =
  its resolved timestamp, `rangeEnd` = "now" frozen at selection time),
  rather than adding a second way to pick a time window.
- **Pause-on-select over a live-syncing event reference.** Keeping a
  selected event in sync with a still-advancing `asOf` would need to
  handle "the event no longer exists at the new asOf" as a real case.
  Pausing playback the instant an event is selected sidesteps that
  entirely — `asOf` stops moving, so the already-captured event snapshot
  stays correct by construction. Simpler and more robust than the
  alternative, chosen deliberately over it.
- **Real `AbortController` cancellation over the prior "ignore stale
  results" flag.** The prior milestone's boolean-flag approach let a
  superseded request complete and simply discarded its result; playback
  ticks fire often enough (every 500ms while playing) that genuinely
  cancelling the in-flight request, not just its eventual response,
  matters more here than it did before.
- **Rounding bug fixed at its source, not with a looser test tolerance.**
  When a specific test's expected progress value was off by ~1%, the
  cause (mismatched rounding granularity between `rangeStart` and
  `rangeEnd`) was root-caused and fixed in `lib/utils/world-timeline.ts`
  / `hooks/use-world-timeline.ts` rather than widening the assertion —
  consistent with this project's established practice of fixing real
  bugs found by tests instead of loosening the tests around them.

### Phase 2s — Territorial Control Mode

| # | Task | Status |
|---|---|---|
| 166 | `prisma/schema.prisma`: new `ConflictActor` (per-conflict, stable palette color) and `ConflictTerritory` (versioned by whole-row supersession — `validFrom`/`validTo`, `validTo: null` = active) models; migration `20260918122108_territorial_control` | DONE |
| 167 | `lib/data/territorial-control.ts` (pure): `deriveDisplayStatus()` derives "recently_changed" at read time from how close `validFrom` is to the timestamp being viewed (never stored); `isValidTerritorialGeometry()`/`parseTerritorialGeometry()` validate/parse GeoJSON Polygon/MultiPolygon | DONE |
| 168 | `lib/db/repositories/territorial-control.ts`: `listTerritoriesAt(timestamp)` — the public "state as of T" query, a single indexed `validFrom`/`validTo` bound (Live = T=now, historical = any past T, playback = every tick) — plus full draft CRUD (`createTerritoryDraft`/`updateTerritoryDraft`/`deleteTerritoryDraft`, draft-only), `publishTerritory`, and `supersedeTerritory` (one transaction: closes the current row's `validTo`, creates the new published row) | DONE |
| 169 | `GET /api/territorial-control` (public, `?at=` mirrors `/api/events`) and the `/api/admin/territorial-control` + `/api/admin/actors` CRUD/publish/supersede routes | DONE |
| 170 | `components/map/world-map.tsx`: `territory-fill`/`territory-contested-hatch`/`territory-outline`/`territory-outline-dashed`/`territory-recently-changed-highlight` layers, added FIRST so they render beneath markers/heat; status encoded via fill-opacity + a generated diagonal-hatch `fill-pattern` (`lib/map/territorial-pattern.ts`) + dashed/dotted outline texture, never color alone; a click-priority guard yields to markers stacked on top | DONE |
| 171 | `components/map/map-filters.tsx` + `app/world/page.tsx`: an independent "Territorial Control" toggle (not a third `viewMode` value) that composes with either Markers or Heatmap — Heatmap + ON is spec's "Both"; `hooks/use-territorial-control.ts` mirrors `use-world-events.ts`'s live-poll/historical-cache/AbortController/prefetch design exactly, driven by the same `timeline.asOf` | DONE |
| 172 | `components/map/territory-legend.tsx` (actor names actually on screen, plus a status key) and `components/map/territory-detail-panel.tsx` (click-to-inspect, reads straight off the clicked feature's own properties — no second fetch — shows status/confidence/effective-since/last-updated/source, with an explicit "not a legal determination of sovereignty" line) | DONE |
| 173 | `app/admin/territorial-control/page.tsx`: create/edit(draft-only)/publish/supersede/delete(draft-only) admin workflow; geometry entered as GeoJSON in a textarea with a live preview map (`components/admin/territory-geometry-preview.tsx`) rather than a full drawing tool (deferred — see decisions below) | DONE |
| 174 | `tests/territorial-control.spec.ts` (13 pure), `tests/territorial-control-api.spec.ts` (11 API/reconstruction), `tests/territorial-control-ui.spec.ts` (8 real-browser: mode toggle, legend, click-to-inspect, marker-priority-over-polygon, future-hidden, historical control-change reconstruction, Both mode, status key), `tests/admin-territorial-control.spec.ts` (5: create/publish/supersede/delete/action-visibility) | DONE |
| 175 | Dev/test-only `window.__vigilMap` hook in `world-map.tsx` (outside production builds) so Playwright can compute exact click pixels via `map.project()` and confirm paint-readiness via `queryRenderedFeatures()` before clicking — floating overlay panels made canvas-coordinate guessing unreliable | DONE |
| 176 | Full re-verification on a reset DB: typecheck/lint/build clean; targeted territorial suite 37/37 (Desktop) + 24/24 pure+API (Mobile, 13 UI tests correctly skipped); full regression pass across existing map/timeline/playback/admin specs — 58/58, no regressions. Manually verified in-browser: mode toggle, Both mode, hatch/highlight/dash patterns rendering correctly, click-to-inspect panel, admin create → publish → supersede workflow, and historical playback correctly reconstructing a control change before/after | DONE |

### Phase 2s decisions

- **Versioned by whole-row supersession, not a field-diff change-log.**
  Unlike Event Version History's `EventHistory`, a control change is
  naturally "this whole polygon/actor/status is superseded by that one,"
  not a per-field diff — so `validFrom`/`validTo` bounds on each row make
  "reconstruct at T" a single indexed query, simpler and a better fit
  than replaying a ledger.
- **A published territory version is immutable — supersede, don't edit.**
  `PATCH`/`DELETE` are scoped to drafts only; the only way to change a
  published, currently-active row's control is `supersedeTerritory`,
  which creates a new row and closes the old one's `validTo` in one
  transaction. This is what makes "preserve previous historical state"
  a guarantee of the data model, not a convention admins have to follow.
- **Territorial Control is an independent toggle, not a third `viewMode`.**
  Spec listed "Heatmap / Territorial Control / Both" as three modes, but
  also said "preserve existing Heatmap, markers... behavior" and "keep
  these layers architecturally independent" — squeezing a third value
  into the existing binary `viewMode` would have broken that
  independence and forced a choice between Markers+Territorial and
  Heatmap+Territorial. A standalone boolean composes with either.
- **"Recently changed" is derived at read time, never stored.** Storing
  it as an assignable status would require a background job to expire it
  and would desync from what's actually true "as of T" during historical
  playback; deriving it from `validFrom` vs. the viewed timestamp means
  it replays correctly automatically — playback shows the same brief
  highlight a change had when it actually happened.
- **No drawing tool for admin geometry entry — a GeoJSON textarea with a
  live preview instead.** Spec's own phrasing ("prefer... if compatible")
  was a preference, not a requirement; integrating a full draw tool
  (e.g. mapbox-gl-draw) was judged out of proportion to this milestone's
  scope. The preview map still gives a concrete, honest "preview" step
  before publish — flagged as a follow-up enhancement, not silently
  dropped.
- **Public detail panel reads the clicked feature's own properties —
  no second fetch.** Since `listTerritoriesAt` already decides which
  version is historically correct for the active `asOf` before the
  FeatureCollection ever reaches the map, the feature the user clicked
  IS the correct version already; fetching it again by id would be
  redundant and could theoretically race a fast playback tick.
- **A dev/test-only `window.__vigilMap` hook was added to `world-map.tsx`.**
  Floating overlay panels (timeline/filters/legend) cover enough of the
  canvas at common viewport sizes that guessing click coordinates from a
  screenshot proved unreliable during test development; exposing the
  live map instance (guarded to non-production) let tests compute exact
  pixels via `map.project()` and confirm a feature is actually paintable
  via `queryRenderedFeatures()` before clicking — eliminating an entire
  category of click-timing flakiness, not just Territorial Control's own
  tests.

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

### Phase 2e decisions

- **New disaster/health event types, not a rename of existing ones.**
  The exact category names requested for this pass (`armed_clash`,
  `missile_attack`, `drone_attack`, etc.) are mostly renamed variants of
  categories that already exist (`ground_clash`, `missile`, `drone`) —
  renaming stored `EventType` values would be a wide, purely-cosmetic
  breaking change (seed data, every component, every test) for no
  behavioral benefit. Only the categories with no existing equivalent at
  all — `earthquake`, `flood`, `storm`, `humanitarian`, `health` — were
  added, justified directly by real content (GDACS, WHO) already flowing
  through the pipeline with nowhere meaningful to classify into.
- **A safe fallback belongs at every render site, not just at the data
  boundary.** SQLite has no enum column type (see DATA_MODEL.md), so
  `event.eventType` is a plain string validated only by convention, not
  by the database. Rather than trying to guarantee "this can never be an
  unrecognized value" (impossible to fully close off with a schemaless
  column and a direct-write API route), every icon/label lookup now
  degrades to the same "other" fallback a genuinely-unclassified event
  already uses — cheap, and turns a potential crash into an identical
  no-worse-than-today render.
- **Source icon is driven by the trust-model `sourceRole` field, not the
  older free-text `sourceCategory`.** `sourceRole` is already a clean,
  small controlled vocabulary (Phase 2d); `sourceCategory` is
  free text with inconsistent casing across the seeded sources ("News"
  vs "official" vs "emergency"). Building the icon lookup on the messier
  field would have meant normalizing that casing too, for no benefit
  over using the field already built for exactly this kind of
  classification.

### Phase 2f decisions

- **A worker pool, not fixed-size batching, for bounded concurrency.**
  Batching (wait for all N sources in a batch, then start the next N)
  wastes slots idle whenever one source in a batch is slower than its
  batch-mates. A worker pool where a freed slot immediately claims the
  next due source keeps all `MAX_CONCURRENT_FETCHES` slots busy until
  the due-list is exhausted, which matters directly for the "one slow/
  failing source must not indefinitely block unrelated sources"
  requirement.
- **`Retry-After` is a floor, not the delay outright.** A server asking
  for a 10-minute wait after one failure shouldn't get polled again in 2
  minutes just because that's the plain backoff figure — but a source
  that's failed several times running already has a longer backoff than
  a single `Retry-After` might request, and that shouldn't get
  shortened either. `applyRetryAfterFloor()` takes the max of the two,
  never the `Retry-After` value outright.
- **`INGESTION_FETCH_TIMEOUT_MS` is configurable, not hardcoded, purely
  for test determinism.** Real local dev keeps the 20s default; the
  Playwright test server process runs with a much shorter one so
  `tests/ingestion-reliability.spec.ts`'s timeout test doesn't need to
  wait out 20 real seconds to prove a timeout is handled correctly.

### Phase 2g decisions

- **Hardened the existing duplicate-candidate engine rather than
  building a second, parallel matching service.** The spec's "Event
  Matching / Clustering Foundation" describes almost exactly what
  `lib/ingestion/duplicates.ts` already did — geographic proximity,
  temporal proximity, event-type compatibility, title similarity, a
  ranked score, never auto-merging. Building a separate system would
  mean two subtly-different scoring functions and two places for
  Stage 4's UI to potentially disagree with each other. The real gaps
  (incompatible types scoring the same as "no signal," no floor on
  geographic relevance, generic headlines inflating title similarity)
  were fixed in place instead.
- **Event-type compatibility is graded (exact / same-group / cross-group
  penalty), not a flat same/different boolean.** A flat boolean either
  ignores genuinely related types (airstrike vs. explosion) or fails to
  actively discourage genuinely unrelated ones (earthquake vs.
  explosion) — grading by group does both without hand-listing every
  type pair.
- **A missing geographic/conflict signal is penalized, not left at
  zero.** Leaving distance at a bare 0 contribution when nothing at all
  places two reports near each other allows title+type+time to clear
  the match threshold on their own — geographic proximity is the
  spec's first-listed signal precisely because it has to gate the
  result, not just be one more additive term among several.

### Phase 2h decisions

- **The admin UI is a thin, legible layer over Phase 2g's scoring
  engine, not a new decision-maker.** Every field the expanded
  candidate view shows (event type, location, time, score, reasons)
  already existed on `DuplicateCandidateDTO`; Stage 4 added no new
  scoring logic, only display and the two reviewer actions the spec
  named. "Attach to this event" / "Create new event" were already the
  merge/publish endpoints from Phase 2c — nothing about the underlying
  audit trail, source counting, or duplicate-public-event prevention
  changed.
- **Test fixtures shared across suites must not publish their exact
  original title as a real event.** `tests/admin-event-matching-ux.spec.ts`
  reuses the `feed-a` fixture's bakery article (already used by
  `classification.spec.ts`/`multi-source-ingestion.spec.ts`) to exercise
  "Create new event." Because `/api/events` is a single global,
  cross-test feed, publishing that article under its unmodified title
  would permanently satisfy those other suites' "this exact title is
  never published" assertions for the rest of the shared DB's
  lifetime. Any future test that publishes a shared fixture's article
  as a real event must override its title first (as already done for
  the Kyiv reference event) to avoid this class of cross-test
  contamination.

### Phase 2i decisions

- **Corroboration metadata needed zero schema changes.** Every field
  (supporting-report count, independent-source count, categories,
  earliest/latest timestamps) is derivable from `Event.sources` at read
  time — the same "compute, don't store" pattern Phase 1.5 established
  for severity/verification. `getEventCorroboration()` lives in its own
  module (`lib/data/corroboration.ts`) with zero server-only
  dependencies specifically so it's safe to call from client components
  too, without pulling Prisma into the browser bundle.
- **A relay's timestamp still extends "last corroborated."** Only
  independent sources count toward `independentSourceCount`, but
  *any* linked report — relay included — updates
  `latestCorroborationAt`. A relay proves the event is still being
  actively reported/discussed even though it isn't a new independent
  witness; conflating "last reported at all" with "last independently
  confirmed" would understate how current an event's coverage is.
- **A brand-new `/admin/events` view, not an extension of the public
  `/event/[slug]` page.** The spec explicitly scoped this to "admin
  event view first, don't redesign the entire public UI yet" — adding
  the panel to the public page would have been a public UI change by
  definition, however small.
- **The corroboration panel states outright that it isn't a
  credibility score.** Spec requirement, not a suggestion: "3
  independent sources" / "Official + local media" describe how many
  reports and what kinds back an event, never whether it's true — the
  panel's own copy says this explicitly, the same information-ethics
  posture Phase 1's market/briefing pages already follow (non-causal,
  descriptive language only).

## Territorial Drawing & Editing Tools

| # | Task | Status |
|---|---|---|
| T1 | Visual territory editor in `/admin/territorial-control` (`components/admin/territory-editor-map.tsx`): draw Polygon, draw a further polygon for MultiPolygon, select, move / add / remove vertices, delete polygon, clear geometry, Save Draft / Preview / Publish / Revert / Cancel. Advanced GeoJSON box kept for import/export and stays in sync with the map | DONE |
| T2 | Pure geometry library (`lib/territory/geometry.ts`): deep validation (type, closure, ranges, self-intersection, zero area, non-empty), boolean split via `polygon-clipping`, and the vertex-edit operations the editor is built from | DONE |
| T3 | Validation on every write path (create, edit, supersede, publish, candidate apply) with one clear message per problem; invalid geometry can never be published | DONE |
| T4 | Split / partial control change: draft with `splitFromId` (migration `territory_split_lineage`); publishing carves the drawn area out of the active version — old version closed at `validFrom`, affected area to the new controller, remainder keeps the old controller/status/source. History and playback unchanged | DONE |
| T5 | Territorial-change candidate hand-off: "Open in territory editor" from a review; shows current vs proposed, admin draws only the affected area, preview, explicit confirmation (`apply-geometry` requires `confirm: true`). Pending-geometry state kept; no geometry is ever generated from prose | DONE |
| T6 | Tests: `territory-geometry`, `territory-split-api`, `territory-editor-ui` specs; existing admin specs updated for the confirmation step | DONE |

### Territorial editor decisions

- **Split is a draft with lineage, not a new table.** A draft carrying
  `splitFromId` means "carve this area out of that active version when
  published"; on published rows the same column records where the row was
  split from. Whole-polygon supersede is unchanged.
- **The drawn area is clipped to the polygon being changed.** Anything
  drawn outside it is ignored (previewed as a warning), so a split can never
  silently add territory.
- **Publishing is always explicit**: an inline confirmation checkbox in the
  editor, `window.confirm` for the table's publish action, `confirm: true`
  in the candidate API.
- **Custom editor, not a draw library.** The interaction layer is ~400 lines
  over MapLibre; all geometry rules live in the pure library so they are
  unit-tested without a map.

### Deferred (not caused by this milestone; logged, not fixed)

- Editor limitations: no hole-drawing tool (holes survive edits and JSON
  import but can't be drawn), no multi-level undo, no touch-drag on phones,
  no snapping to existing borders. The drawing tools are a desktop workflow.
- DB-backed conflict scoring (`lib/db/repositories/scoring.ts`) still treats
  every country in `Conflict.countries` as "war inside" that country; only the
  mock conflict data was corrected (see the exposure milestone).
- `lib/data/mock-markets.ts` and `mock-events.ts` still use seeded
  pseudo-random values (mock data, not presented as scored intelligence).
- Globe HTML markers can draw over the translucent right-hand card on narrow
  views.
- Without a MapTiler key the fallback map style has no glyphs, so map text
  labels (report counts included) do not render.

## Global Conflict Registry & Coverage System

| # | Task | Status |
|---|---|---|
| R1 | Canonical registry on `Conflict`: status active / reduced / dormant / ended (legacy resolved/archived read as ended), start/end dates, `fullScaleWar`, classification confidence + note, finer `regions`, family link, provenance rows. Migration `global_conflict_registry` (backfills legacy `countries` into fighting geography, flagged `legacy_countries`) | DONE |
| R2 | Geography split: `fightingCountries` (where fighting occurs) / `participantCountries` / `supporterCountries`. Scoring (DB-backed `scoreConflict` and the mock `computeImpact`) reads fighting geography only, so participants and supporters never trigger the same-country (100) or bordering (>= 75) floors | DONE |
| R3 | Registry data audit (`data/conflict-registry.json`): 14 existing conflicts kept (name/severity/intensity untouched) and enriched, 18 added; tensions recorded as dormant + uncertain classification rather than forced into "active armed conflict"; no global total asserted. Idempotent seed | DONE |
| R4 | Conflict families (`ConflictFamily`): Sahel (Mali / Burkina Faso / Niger), Kurdish fronts, Israel regional — members stay separate records | DONE |
| R5 | Central actor registry (`data/actor-registry.json`, `lib/actors/registry.ts`): one canonical name + aliases (country-scoped where needed); `findOrCreateMilitaryUnit`, report-text actor detection and territorial-change extraction all resolve through it; `ConflictParticipant` links actors to conflicts | DONE |
| R6 | Source coverage (`lib/registry/coverage.ts`): dedicated / specialist-local / general / aggregator sources per conflict (explicit links, country match, or having contributed events); health healthy / weak / stale / no_source / inactive. Aggregators/relays count as one independent source | DONE |
| R7 | `/admin/conflict-coverage`: summary cards, filters (region, status, severity, health, dedicated, territorial), per-conflict detail (geography roles, family, actors, sources, provenance, candidates) | DONE |
| R8 | Candidate-source backlog (`SourceCandidate`, `/api/admin/source-candidates`): candidate / approved / integrated / rejected. Never fetched or scraped | DONE |
| R9 | Tests: `conflict-registry` (pure), `conflict-registry-api` (DB, scoring, coverage, filters, candidates, actors, dashboard) | DONE |

### Registry decisions

- **Curated, not authoritative.** The registry is the audit starting point. Every
  entry has a classification confidence and note, provenance rows cite public
  trackers (UCDP, ACLED, CrisisWatch, RULAC, CFR), and statuses for the 14
  pre-existing conflicts are the admin's own — review them against current
  reporting (notably Israel–Gaza after the late-2025 ceasefire arrangements and
  Syria after the transition).
- **`countries` is legacy.** It still feeds the draft-extraction conflict
  suggestion; it no longer means anything to scoring.
- **Existing conflicts are not overwritten.** Only Korean Peninsula and Taiwan
  Strait had their status corrected (to dormant): they were recorded as active
  fighting, but the registry classifies them as tension with no fighting venue.

### Deferred (not caused by this milestone)

- Registry status, severity and intensity for the 18 added conflicts are
  curated estimates, not derived from ingested events; they need periodic review.
- The mock UI data (homepage, for-you, conflict pages) still ships as mock
  conflicts; only its geography/status now comes from the registry. Moving those
  pages onto the database registry is a larger change.
- Candidate-source URLs were not verified for RSS/API availability or reuse terms.
- Coverage does not yet weigh source language/regional fit beyond country match.

## Coverage-Driven Source Expansion

Goal: use the Registry/Coverage dashboard to improve real-world source coverage for under-covered active conflicts, without redesigning ingestion.

- [x] Gap prioritisation from `/admin/conflict-coverage` (no source → weak diversity → stale → no local/specialist; high-severity active first). Baseline snapshot kept in `data/coverage-baseline.json` (22 of 32 conflicts had no source, 2 had a dedicated source).
- [x] Source tiers (`lib/registry/source-tiers.ts`): official / local-originating / specialist-research / global media / aggregator-discovery, derived from `Source.sourceRole` (new role `specialist_research`). Tier diversity, not volume, drives coverage quality; aggregators never contribute tier diversity.
- [x] 36 public RSS sources + disabled `@liveuamap` Telegram source in `data/source-expansion.json`, seeded idempotently by `seedSourceExpansion()` (match by URL/handle; never renames an existing source; conflict links by slug / family).
- [x] Source→conflict relevance: explicit `SourceConflictLink` (`/api/admin/source-links` accepts conflictId | conflictSlugs | familySlug), country match, or derived only after `COVERAGE_THRESHOLDS.minContributedEvents` (3) published events. Multi-conflict specialists carry no `country`.
- [x] Coverage activity: `latestReportAt` (ingested items from dedicated/country-matched sources) counts beside published events, so real feeds can make a conflict healthy before anything is published; an aggregator alone can never be healthy.
- [x] Aggregator independence: `independentSourceCount` (aggregator + relays = one voice), merge route forces aggregator links to `relay`, aggregator-only territorial evidence cannot approve/apply geometry (`assertIndependentEvidence`, 409), aggregator candidate confidence capped at 0.3, candidate `sourceRole` stored (migration `territorial_candidate_source_role`).
- [x] Provenance: original URL, publication time, author kept; aggregator posts keep `upstreamSource` / `upstreamUrl` / `aggregatorUrl` (`lib/ingestion/upstream.ts`).
- [x] RSS adapter fixes found during real-feed verification: empty `<guid>` no longer collapses a feed (falls back to link), `dc:date` fallback, numeric character references decoded.
- [x] Dashboard: improvement report + still-undercovered list (`/api/admin/conflict-coverage/improvements`), tier labels and tier diversity per conflict/source.
- [x] Real-source verification (`scripts/verify-source-expansion.mjs` → `data/source-verification.json`): 36/36 pass (≥1 real item, original URL on publisher domain, valid publish time, role classification, conflict association, no duplicates on re-fetch, single source record). Article pages that answer 401/403/429 to automated readers are recorded as `botProtected`, never worked around; only feed excerpts are ingested.
- [x] Liveuamap Telegram: feasible only through the existing credential-gated Telegram adapter (no scraping of t.me). Seeded as `@liveuamap`, role aggregator, **disabled** (no authorised Telegram credentials). Pipeline is exercised end-to-end with a fixture channel (`TELEGRAM_FIXTURES=true`, test server only): timestamp, t.me permalink, Liveuamap URL, upstream and dedupe verified.
- [x] Tests: `tests/source-expansion.spec.ts` (roles/tiers, relevance, aggregator independence, coverage improvement, provenance, duplicate protection, disabled credential source, data integrity, dashboard). Updated `conflict-registry*.spec.ts` for post-expansion state (Haiti etc. are now covered; a single contributed event is not coverage; "No events or reports" wording).

Decisions: a source's tier comes from its role, never from volume; `specialist_research` counts as grounded coverage; aggregator posts are discovery leads (relay links, capped confidence, never sole territorial evidence).

Remaining coverage gaps: `kurdish-turkey-pkk` (no feed found), `kurdish-iran` (thin), `ecuador` (InSight Crime only), `cameroon`, `northeast-india`, `libya`, `philippines-insurgencies` (single source), `somalia` and `niger` (no local source), `israel-lebanon` / `persian-gulf-iran` thin. Liveuamap stays disabled until authorised Telegram credentials exist. Coverage "healthy" in production needs the scheduler to ingest these feeds for a while (the test DB has no ingestion history).

## Continuous Global Conflict Heatmap

Goal: replace the isolated heat circles with one continuous conflict-intensity surface over the world's land, as the main Heatmap mode on the flat map and a Heat layer on the globe.

- [x] Model (`lib/heat/field.ts`): 0.5-degree world grid (720x360). Value = "observed conflict intensity / conflict pressure", never a probability, personal danger or legal status. Baseline 8 (bottom of the scale, no invented events). Two layers in one field: sustained conflict base (severityScore from the central scoring engine — active full-scale war = 100 — over the conflict's fighting-country cells within reach of its anchors, then gaussian decay by geodesic distance) and recent incidents (event severity x 30 h half-life recency, radius from importance/location precision, dropped after 7 days).
- [x] Combination: strongest contribution wins; other contributions add a saturating lift capped at 35% of the dominant one and 20% of the headroom, so many low values never dilute or pile up into red. Deterministic (sorted contributors, fixed arithmetic), clamped 0-100.
- [x] Report/article count is never an input to intensity. Confidence (from the existing engine) only nudges saturation (<=18%) and opacity (<=14%).
- [x] Geography: land mask and country footprints rasterized from the existing Natural Earth topology; 5x5 chamfer geodesic distance transform (round isolines), windowed per conflict, cached.
- [x] Colour scale (`lib/heat/scale.ts`): one centralized stop table, deep cool blue -> blue -> blue-grey -> yellow -> orange -> red -> deep red; shared by both renderers and the legend.
- [x] Flat map: field rasterized to a Web-Mercator image (bicubic resample, vector land clip so oceans are transparent), one image source + raster layer beneath territory/markers/labels; own country borders + coastline lines on top; old circle layers/sources and `lib/map/heat-layers.ts` removed. Report-count labels kept.
- [x] Globe: same field rasterized equirectangularly onto one sphere between the land fill and the borders (no cells, no seams); `Heat` toggle in the Layers popover (persisted, store v2 migration adds it, default on); shared legend.
- [x] Timeline: `/world` passes the timeline's asOf as the reference time; historical mode drops the curated (current-state) conflicts and derives bases from the timeline's own events; events after asOf are excluded; ages quantized to whole hours so playback ticks reuse the cached field.
- [x] Legend with info tooltip (colour = observed intensity, not a prediction, blue is not "safe", report counts do not set colour).
- [x] Tests: `tests/heat-field.spec.ts` (grid/land/ocean, baseline, decay, full-scale war, dilution, incidents/recency, asOf, determinism, colour scale, report count) and `tests/world-map-heat.spec.ts` (surface layer, legend, tooltip, labels, timeline, globe toggle). `three` is now a direct dependency (was transitive via react-globe.gl) with a `three.d.ts` shim.

Deferred / notes:
- The homepage globe has no timeline, so it always shows the live state; it is fed by the curated mock conflicts/events only (no live DB events yet).
- Territorial-control polygons do not yet feed the field (the conflict's footprint is its fighting countries near its anchors). Deriving footprint from published control polygons is a natural follow-up.
- First enable costs ~100 ms of field compute plus ~1 s to encode the map image on the main thread; a worker would remove it if it ever matters (not needed yet).
- The basemap's own graticule lines (pre-existing) still show through on the flat map.

## Public Data Unification & Real Conflict Intelligence Pages

Goal: the public Vigil experience reads the same database, scoring, registry, sources, territorial control and timeline systems as admin — no mock data in production paths.

- [x] Build check first: production build against `4269b21` passed (no heatmap regressions).
- [x] One public data layer (`lib/public/*`): `conflicts.ts` (DB row -> UI `Conflict`, single severity derivation, real event counts + latest event in one grouped query), `events.ts` (bounded, published-only reads with a cursor; event detail with actors, related events and approved territorial changes), `overview.ts` (bounded homepage/globe/For You/heat payload + freshness), `conflict-detail.ts` (registry geography, scoring engine, coverage, territory, actors, history), `territory.ts`, `actors.ts`, `search.ts`. Client: `hooks/use-public-overview.ts` (one shared fetch/poll), `/api/public/overview`, `/api/public/search`, bounded `/api/events` (`limit`, `before` cursor, 45-day window).
- [x] Mock data removed from production: `lib/data/mock-*.ts`, `situation-brief` and the seeded PRNG moved to `lib/dev-fixtures/` (test-only; `tests/public-data.spec.ts` fails if any production file imports it, or contains example.com / localhost / seeded-random / MOCK_* references). Country reference data moved to `lib/reference/countries.ts`. Markets pages now say "unavailable" (no market feed). The RSS test-fixture route 404s unless `TEST_FIXTURES=true` (set only by the Playwright server). `MOCK_NOW` no longer drives any production timestamp: relative times use the real clock after mount (`RelativeTime`), server render shows absolute UTC.
- [x] Homepage: real conflicts/events for cards, feed, globe pins and the heat field; global status is `null` (and says so) with no active conflicts; freshness line shows real last-event and last-source-fetch stamps with a stale flag; latest approved territorial changes widget; selected-country impact via the centralized engine.
- [x] For You / conflicts list / country / intel / search read the same real data; impact and exposure functions now take the conflict list (no hidden global); an active registry full-scale war is scored "extreme" => 100 everywhere (`effectiveSeverityLabel`).
- [x] Conflict page: overview (status, start date, full-scale-war flag, severity, classification confidence, freshness), geography (fighting vs participants vs supporters kept apart), scores with reasons, recent events, actors (linked), territorial control + latest changes, sources + coverage state (healthy/weak/stale/no-source), latest reports with original links, monthly history, on-demand map. Empty sections show empty states.
- [x] Event page: event vs supporting reports, location precision, evidence summary (independent sources vs reports), actor links, territorial-change relationship, related events, update history. New `/actor/[ref]` page (aliases, conflicts, events, parent/child, equipment/commanders, provenance).
- [x] Source-link integrity: audited feed -> raw item -> event source -> API -> rendered link. No fallback URL exists anywhere in the chain; the only gap was `""` being passed to the UI for a missing URL — now `null` => "Source unavailable" with no `<a>`. Duplicate article URLs (normalized: scheme/host case, `www.`, tracking params, trailing slash) count as one piece of evidence and are flagged. Tests prove RSS (`https://fixture.test/...`) and Telegram permalinks survive to the public event page with publication time and source name.
- [x] Tests: `tests/public-data.spec.ts` plus updated `exposure`, `conflict-registry`, `heat-field`, `report-counts`, `globe-rendering` specs.

Deferred / notes:
- `/api/events?at=` (historical reconstruction) still loads every event created by T before trimming to the 45-day window; a windowed query in `reconstructWorldStateAt` is the follow-up.
- `lib/registry/conflict-registry.ts` still carries a `mockSlug` field (used only by the dev fixtures).
- `components/markets/*` are now unused; remove when a market feed is designed.
- Conflict-level confidence (`scoreConflict`) still approximates evidence by event count; a per-source rollup would be better.
- The territorial-control map itself is unchanged; the conflict page summarizes published areas and links to /world.

## Social / Specialist Source Plug-in (exact supplied URLs)

- [x] Source identity kept apart (migration `source_identity_verification`): `canonicalSourceUrl`, `feedUrl`, `socialProfileUrl`, `platform`, `platformHandle`, plus `verificationStatus` (verified | needs_verification | inaccessible | inactive | rejected), `verifiedAt`, `verificationNotes`, `independenceClass`, `claimPolicy` (party_claim | discovery_only). Each article/post still keeps its own URL in `RawIngestionItem.originalUrl` (the "originalItemUrl"); an item with no `<link>` stores null, never the feed/site URL. `url` remains the polled feed for existing adapters (`feedUrl` mirrors it for RSS). Backfill uses only what rows already state.
- [x] `data/source-plugin.json` holds the supplied entries verbatim (47 sources, 12 NEEDS_VERIFICATION placeholders with no URL, 16 references). `scripts/verify-source-plugin.mjs` checks each exact URL once (site, the feeds the site itself advertises, and the public t.me page — no message content; X is not fetched) → `data/source-plugin-verification.json`. `prisma/seed-source-plugin.mjs` seeds from both; matches existing sources by exact feed/handle/site key (no duplicates, no renames, never enables an existing source).
- [x] Enable rule: only `verified` AND an RSS 2.0 feed that parsed AND same-site confirmed. Result: 11 RSS sources enabled (Al Jazeera, Rappler matched existing; Teleamazonas, Mimi Mefo Info, Journal du Cameroun, EastMojo, Ukhrul Times, Libya Herald, Air Info Agadez, Lebanese Army, Bulatlat). `scripts/verify-plugin-ingestion.mjs` fetched all 11 through the app: 11/11 stored items with their own article URLs, valid publication times, no duplicates on re-fetch (`data/source-plugin-ingestion.json`).
- [x] Left disabled: every Telegram account (public page exists, but Vigil has no authorised Telegram access), every X account (no adapter/login), sites answering 403 to automated requests (Hengaw, ICG x2, AP, Al Arabiya, MindaNews — recorded `inaccessible`, not worked around), sites with no advertised RSS (reference only), El Universo (the supplied `/rss/` URL is an HTML index, not a feed — its advertised feed is stored as a source candidate, not auto-selected), and all placeholders.
- [x] Classification: `independenceClass` per the supplied labels; `party_claim` (state/official/aligned/representative) and `discovery_only` sources are non-independent evidence everywhere — independent-source counts, territorial-change evidence guard and candidate confidence cap use `evidenceRoleOf`. Cameroon Tribune classified state_media (government-owned public daily) by decision, disabled.
- [x] References (articles, posts, HRW/CFR/ICG pages) stored as source candidates with exact URLs; the Arab News article is attached to `nigeria-insurgencies`, not Niger.
- [x] Tests: `tests/source-plugin.spec.ts`.

Open follow-ups: get authorised Telegram credentials to verify and enable the Telegram channels; decide on El Universo's advertised feed; resolve the NEEDS_VERIFICATION placeholders (PDKI, Kuki Inpi, Libya Al Ahrar/Al Hadath/Review/Ean Libya, Sahel Monitor, KHRN/Mimi Mefo/CENTCOM/Lebanese Army/Faytuks social accounts); the RSS adapter reads RSS 2.0 only (Atom-only sites need an adapter); admin Sources UI does not yet display the new identity/verification fields.

## Public Data Unification & Real Intelligence Experience (trust, claims, ranking)

Builds on `4493249` (one DB-backed public layer, mock data isolated to `lib/dev-fixtures`, source-link integrity) and `3ff01d9` (source identity/verification).

- [x] Audit re-run: production paths contain no mock conflicts/events, seeded randomness, example.com/localhost links or MOCK_* references (enforced by `tests/public-data.spec.ts`).
- [x] Source trust presentation (`lib/sources/trust.ts`): stored `independenceClass` + `claimPolicy` -> Independent / Strong Verification, Independent / Perspective, Party / Aligned Claim (badge PARTY CLAIM), Discovery lead, or "not yet classified"; a new `Source.perspective` ("Israeli military", "Kurdish human-rights reporting") is shown beside the label. No internal enum is rendered publicly.
- [x] Independence groups: an outlet counts once however many reports it files; the same article, relays and discovery leads never add; party claims are counted separately. `independentSourceCount` (stored event count) and the public evidence line use the same grouping ("4 independent sources · 1 strongly verified · 3 perspectives · 1 party claim").
- [x] Party-claim setting: Profile -> Sources -> Show Party / Aligned Claims (default OFF, persisted, store v3). Off: party cards are hidden from event and conflict source lists with "N party claims hidden"; On: shown separately as PARTY CLAIM cards. Storage, ingestion and admin unchanged.
- [x] Claims vs facts: event pages have separate Event / Reports and sources / Claims sections. A party report is worded "<source> reports: “<its headline>”" with Status: Uncorroborated / Corroborated by N independent sources; with no independent support the page says "No independent confirmation" and accepted casualty figures are prefixed "Claimed (uncorroborated)". Territorial claims from two different actors on one place render as CONFLICTING CLAIMS with no conclusion (`lib/public/claims.ts`; only reviewed approved/uncertain candidates are public).
- [x] Freshness on events: Event occurred / First source published / Data last updated; nothing is called "live" because a page loaded.
- [x] Homepage: `IntelOverview` — major active conflicts (severity 70% / most significant recent event 20% / recency 10%), significant events of the last 7 days (severity x importance, faded by age, +-15% by independent-outlet confidence — never article count), latest verified updates; selected-country ranking now uses `rankConflictsForCountry` (`lib/data/priority.ts`): own-country then bordering full-scale-war floors first, then impact/severity/recent significance/confidence/freshness, deterministic, with reasons shown on For You. Globe and /world share `selectHeatConflicts` (one conflict universe).
- [x] Conflict page additions: family, actor roles, conflicting-claims section, trust labels + perspective on source cards, party-claim hiding in latest reports, "No dedicated source" state.
- [x] Actor page: territorial-control relationship for units that also hold territory; search resolves commanders through the unit they lead.
- [x] Tests: `tests/public-intelligence.spec.ts`; `public-data.spec.ts` wording updated.

Deferred: equipment has no public page (not in search); perspective text exists only for sources seeded from `data/source-plugin.json`; territory geometry itself is still viewed on /world; claims are derived from source classification and reviewed territorial candidates (no NLP claim extraction from report text).

## Military & Actor Intelligence Knowledge Layer

Strategic public-intelligence level only: no coordinates, live positions, movement routes or readiness analysis anywhere in the layer.

- [x] Canonical model: `MilitaryUnit` is the one actor/unit entity (no parallel table). Added descriptive `entityType` (state_military, armed_group, militia, political_military_group, security_force, military_unit, coalition, peacekeeping_force, other; never a legal designation), `country`, `nativeName`; `EntityAlias` (canonical/native/abbreviation/transliteration/historical/source-specific, optional country/source scope), `UnitParentHistory`, `ActorRelationship` (explicit + sourced only, never inferred from a shared event), `EventEquipmentLink` / `EventCommanderLink` ("observed in this event", distinct from "known operator"), `EntityMatchReview`; provenance (observedAt/confidence/lastConfirmedAt/validFrom/validTo) on appointments, unit-equipment and participant rows. Migration `20260920093812_military_knowledge_layer`.
- [x] Alias resolution (`lib/military/aliases.ts`): exact match after diacritic/case/punctuation folding, never fuzzy; ambiguous -> review queue, no link. `prisma/entity-text.mjs` mirrors the normaliser for the seed (parity tested).
- [x] Extraction (`lib/military/link-entities.ts`, `extract-entities.ts`): canonical 0.95 / alias 0.85 / registry 0.95 / pattern 0.6 (stub); link rows keep matched text, method, confidence; links propagate to the event on merge/publish.
- [x] History: parent changes close the previous `UnitParentHistory` row (cycle-safe); commander appointments close the previous one; nothing overwritten.
- [x] Public pages: `/actor/[ref]` (units redirect to `/unit/[id]`), `/unit/[id]`, `/commander/[id]`, `/equipment/[id]` from one data function (`lib/public/entities.ts`) with provenance, trust label, freshness ("Last observed 2 hours ago" / "last confirmed 4 months ago" / "last sourced <date>", stale > 180 days) — "last observed" is a last sourced appearance, not a deployment.
- [x] Search resolves aliases to the canonical entity (units, commanders, equipment); conflict/event/territory pages link entities.
- [x] MilitaryLand Phase 2: backfill over the Phase 1 seed (`prisma/seed-military-knowledge.mjs`, one transaction, idempotent): aliases, types, parent history, sourced participant links, observation dates. No new fetching, no protected imagery.
- [x] Admin: /admin/military "Intelligence audit" tab (filters: type, country, source, name/alias, flags stale / missing provenance / unresolved aliases / untyped), review queue (link/dismiss), `military-units/[id]/relationships` inspect + correct (set parent, alias, sourced relationship, commander, conflict link, type).
- [x] Tests: `tests/military-knowledge.spec.ts` (26); `public-intelligence` commander search now expects `/commander/[id]`. Normaliser fix found by tests: leading whitespace before "The".

Unrelated failures observed (not fixed): `source-plugin.spec.ts` "no feed URL is shared" fails when `territorial-changes.spec.ts` fixtures (duplicate fixture feed URLs) ran earlier against the same test DB; `public-data.spec.ts` mobile-only homepage/world visibility tests failed intermittently in multi-spec runs.

Deferred: no graph view (sections only, by design); no relationship editing beyond the single-entity actions; ActorRelationship only enters via admin/seed sources; test DB prep now takes ~3 min on this machine (source seeds), near the 240 s web-server timeout.

## Live Global Data Layers v1 (earthquakes, fires, weather, volcanoes)

Structured, non-news datasets on the existing map/timeline/source architecture. `/world` was not redesigned; the four layers are one compact "Natural hazards" group in the existing filter card, off by default.

- [x] Generic pipeline (not four one-offs): `Source(type "structured", platform = provider key)` -> `lib/hazards/registry.ts` provider adapter (`fetch` + pure `parse*`) -> `lib/hazards/store.ts` `ingestGlobalEvents` -> `GlobalEvent`. `pollSource` dispatches structured sources to `lib/hazards/poll.ts`, which reuses the news pipeline's bookkeeping exactly (IngestionLog row, lastAttemptedAt/lastError/consecutiveFailures, exponential backoff, Retry-After floor; backoff helpers moved to `lib/ingestion/backoff.ts`). Scheduler/instrumentation unchanged.
- [x] Data model (migration `20260920131813_live_global_data_layers`): `GlobalEvent` (origin, category, layer, subtype, provider + providerEventId unique, domain severity value/label/domain, `prominence` 0-100 display rank, provider confidence label/value, geometry JSON + bbox columns, locationPrecision, observedAt/providerUpdatedAt/effectiveAt/expiresAt/endedAt, sourceUrl, metadata JSON, revision, contentHash), `GlobalEventRevision` (snapshot per provider revision), `GlobalEventAggregate` (archive tier), `HazardZone` (zone/volcano geometry cache); `Event.origin` (default `conflict_news`). The conflict `Event` table was deliberately not reused.
- [x] Origins: conflict_news, official_alert, sensor, scientific_observation, humanitarian, infrastructure, other; shown on every hazard panel ("Sensor / satellite detection", "Scientific observation"...) and as "Structured provider data, not a news report".
- [x] Domain severity kept separate: earthquake_magnitude, fire_radiative_power_mw, wildfire_area_acres, cap_severity, volcano_alert_level, gdacs_alert_level. `prominence` (lib/hazards/significance.ts) ranks within a domain only (marker size, homepage cut-off); nothing feeds conflict severity or the heat surface.
- [x] Providers (all keyless, fetched and inspected 2026-09-20): USGS earthquakes (5 min), NASA FIRMS VIIRS Global_24h CSV (3 h; thermal_detection only), NASA EONET wildfires (1 h; confirmed_wildfire = agency incident reports) and volcanoes (6 h), USGS HANS elevated volcanoes (1 h; alert levels; absence = back to normal), NWS CAP alerts (10 min; US), GDACS cyclones/floods (1 h; global). Registered by `prisma/seed-live-data.mjs` as verified, authorised sources with classes scientific_official / sensor_provider / government_alert / humanitarian_monitor.
- [x] Trust: those classes render "Independent / Strong Verification" with an explicit scope note (authoritative for the measurements/alerts they issue, not for unrelated events) and never count as independent evidence for a conflict event.
- [x] Idempotency/revisions/withdrawal/expiry: unique (provider, providerEventId); changed content -> in-place update + revision snapshot (observedAt never moves; out-of-order older copies ignored); complete-snapshot providers withdraw absent events (`endedAt`); CAP `references` supersede; alerts leave the active set at `expiresAt`.
- [x] Timeline: `/api/hazards?at=` and `/api/hazards/[id]?at=` reconstruct from provider revisions; same `asOf`/prefetch as events and territory (no second timeline). Earthquake/thermal recency windows (72 h / 24 h) are relative to the viewed moment.
- [x] Map: layer sources/layers added below the conflict layers; quakes = violet rings sized by magnitude + "M6.4" labels, client-clustered <= zoom 5; thermal = amber diamonds, server-aggregated to counted cells below zoom 7; wildfire incidents = flame-notched diamonds; volcanoes = triangles (faded when stale); weather = teal dashed alert areas + warning marker. Viewport-bounded, zoom-aggregated, per-layer capped API; conflict markers keep click priority.
- [x] Retention: thermal detections live 7 days raw, then daily 0.5 degree aggregates (`runHazardRetention`, every 6 h from the poller); expired alerts/cyclones/floods/incidents deleted 60 days after ending; earthquakes and volcano records kept.
- [x] Search: major earthquakes (prominence >= 45), named volcanoes, significant active weather; never thermal detections. Homepage: restrained "Global events" list (prominence >= 65, current, hidden when empty). `/hazard/[id]` page.
- [x] Tests: `tests/live-data-layers.spec.ts` (37 per project): normalisers, idempotency, revisions, expiry, withdrawal, retention, health/Retry-After, aggregation, UI toggles/click/timeline/heat-unchanged, and a real-network verification test.

Provider findings: FIRMS Global_24h had ~77k rows/day (10% low confidence dropped; strongest 12,000 kept per poll); NWS returned 244 active alerts, 211 without inline geometry (zone geometry is resolved from `affectedZones`, 20 lookups/poll, cached); HANS `getElevatedVolcanoes` carries no coordinates (resolved via `getVolcano/{vnum}`, cached); EONET volcano records can be months old (flagged stale after 60 days, never shown as current activity); GDACS EVENTS4APP also lists EQ/WF/DR (only TC/FL used).

Deferred: FIRMS per-area API (needs MAP_KEY) and other satellites (MODIS, VIIRS S-NPP) not added; GDACS cyclone track/flood polygons not fetched (points only); non-US CAP feeds (Meteoalarm etc.) not added; NWS zone geometry is per-county MultiPolygon (no union/simplification beyond 2-decimal rounding); no per-user alerts/notifications for hazards; hazard events are not in the conflict live feed sidebar or heat surface (by design); shipping/aviation not started.

Unrelated failures seen in the regression sweep (not fixed, not caused by this milestone): `source-expansion.spec.ts` "aggregator post plus the upstream report it cites are ONE independent source" (expects 2 independent sources from two items of the same local outlet; the outlet-grouping rule from 7581f65 counts one); `world-map-heat.spec.ts` "Globe heat layer" (homepage globe `data-heat-peak` 8, expects >= 90); `source-plugin.spec.ts` "no feed URL is shared" (duplicate fixture feed URLs left by `territorial-changes.spec.ts` in the shared test DB); `public-data.spec.ts` mobile-only homepage/world visibility tests; `admin.spec.ts` add/disable/delete a source (failed once in the sweep, passes alone).

## Live Global Data Layers v2 (aviation, maritime, energy, internet)

Built on the v1 pipeline (`Source(type structured)` -> provider adapter -> `ingestGlobalEvents` -> `GlobalEvent` + revisions), the same `/api/hazards` read path, viewport/zoom bounding, timeline `asOf`, retention and source health. Nothing was duplicated; `/world` layout is unchanged (the layer button became "Live data layers" with three groups: Natural hazards / Transport / Infrastructure; every layer OFF by default).

- [x] Schema (`live_global_data_layers_v2`): `GlobalEvent.status` (domain operating status, revised through revisions), `entityKey` (ICAO / chokepoint id / country / asset: the stable watchlist key, `watchKey = category:entityKey`), `countryCode`; `GlobalEventLink` (event <-> conflict/event; proposed|confirmed|rejected; basis admin_review|source_relation; never proximity), `GlobalEventClaim` (party claims beside an event; never alter status).
- [x] Categories: airport_status, airspace_event, port_disruption, chokepoint_status, maritime_incident, energy_disruption, internet_disruption. Domain scales: airport status, airspace event type, port/chokepoint status, maritime incident type, electricity MW, gas MW-equivalent, internet anomaly score. Prominence is per domain (`lib/hazards/significance.ts`), never conflict severity or article counts.
- [x] Providers (verified 2026-09-20): FAA NAS Status (keyless XML, US airports only), FAA NOTAM API (credentials FAA_NOTAM_CLIENT_ID/SECRET; NOT verified live, fixture-tested, seeded disabled), IMF PortWatch (keyless ArcGIS REST: chokepoint daily transit counts + hazard-derived port disruptions; ~1 week lag), NGA broadcast navigation warnings (keyless JSON; NAVAREA IV/XII + HYDROLANT/PAC/ARC only), Elexon REMIT (keyless; UK unplanned unavailability), ENTSOG UMM (keyless; EU gas capacity unavailability), IODA (keyless; `api.ioda.inetintel.cc.gatech.edu`, the old hostname is dead; (c) Georgia Tech, shown with attribution), Cloudflare Radar (token CLOUDFLARE_RADAR_TOKEN; endpoint confirmed to demand auth; not verified live; seeded disabled).
- [x] Not integrated on purpose: UKMTO (no API; site behind an anti-bot challenge — not scraped), NGA ASAM (`/api/publications/asam` returns 404 now), OpenSky and any AIS provider (would be aircraft/vessel tracking), Eurocontrol (credentials), ENTSO-E and EIA (need API keys — deferred), EASA CZIBs (HTML only).
- [x] Safety limits: no aircraft or vessel positions anywhere; NGA exercise/firing/gunnery/warship notices are excluded; chokepoint status is an AGGREGATE transit-volume deviation vs a 90-day baseline and never derives "closed" (`closed_restricted` is reserved for an explicit official source); airport status comes only from the authority, never from flight volume; internet events are "observed network anomaly" with `intentionalShutdownConfirmed:false`, and a provider-reported cause is labelled as the provider's classification.
- [x] Credentialed providers stay idle and report "Credentials not configured: set ..." (no unauthenticated attempt); admin shows `needs_credentials`.
- [x] Map: one `hz-ops` source; aviation = plane markers + dashed airspace areas, maritime = chokepoint rings (faint when normal), port squares, incident hexagons; energy = bolts, one counted disc per country when zoomed out; internet = broken-ring markers. Zoom-dependent minimum prominence (world 60 / regional 35 / close 0) keeps routine items off the world view.
- [x] Timeline: same `asOf`; revision "known from" time now falls back to the recorded time when a later revision carries no newer provider timestamp, so re-measured statuses reconstruct correctly.
- [x] Homepage Global events and search extended (closed major airports, disrupted chokepoints, national blackout/outage; hazard-derived port impacts excluded from the homepage); routine delays/notices are neither listed nor indexed.
- [x] Retention: lifecycle categories keep history for 365 days after they end (`runLifecycleRetention`); revisions preserved; chokepoint measurements are stored as status revisions, not raw daily counts.
- [x] Admin: `/admin/live-data` (+ `/api/admin/live-data`, `/api/admin/global-events`): status, health, backoff, event counts, access requirement, raw provider metadata; `/api/admin/global-events/[id]/links|claims`.
- [x] Tests: `tests/live-data-layers-v2.spec.ts` (34 per project incl. a real-network verification test).

Deferred: ENTSO-E / EIA / national TSO feeds (keys), pipeline/refinery/LNG operator feeds, global airport status beyond the FAA (Eurocontrol needs credentials), airspace closures from EASA/national AIPs (no structured public feed found), regional (sub-national) internet outages and Cloudflare Radar live verification, chokepoint history backfill from PortWatch daily series, port operating status (no keyless official source found), automatic conflict-relationship rules (none enabled by design), notification delivery (only stable event ids/`watchKey` are provided).

Unrelated failures seen in the v2 regression sweep (not fixed): `admin.spec.ts` Mobile "manual submission -> publish" (the incoming-report location-picker map canvas intercepts the Publish click at phone width; reproducible with the admin nav change reverted); `source-expansion.spec.ts` aggregator test and the `public-data.spec.ts` mobile pair (already logged above).

## Watchlists, Notifications & Intelligence Alert Rules (in-app v1)

One centralized alert service reads DEVELOPMENTS (meaningful state changes) from the existing systems and matches them to generic watches. No new event pipeline, no new ingestion layer; no email/SMS/push (in-app only).

- [x] Identity: there are no server accounts, so a `Watcher` is a per-device profile whose random client id (localStorage, `x-vigil-client` header) is its bearer secret; every `/api/me/*` route only touches rows owned by it. A real account can later be attached to a Watcher without touching watches/notifications.
- [x] Generic model (migration `watchlists_notifications`): `Watch(watcherId, entityType, entityKey, label, mode major|important|custom, rules JSON, muted, pausedUntil)` unique per watcher+entity and indexed on (entityType, entityKey) — the matching path; one table for country | conflict | actor | unit | airport | port | chokepoint | volcano | watchkey (any GlobalEvent watchKey: energy asset, internet country...) | layer (event category). `Notification` (persistent, unread/read/dismissed/archived, priority, reason JSON, snapshot JSON, fingerprint unique per watcher, suppressedCount). `AlertState` (state ledger + material version). `AlertRecord` (inspector rows, 30-day retention). Notifications and watches are retained independently of raw provider observations.
- [x] Rules per entity type (`lib/alerts/types.ts` RULE_SCHEMA): conflict (severity, impact, escalation, event importance, territorial change, conflicting claims, new actor, status change), country (impact, importance, magnitude, tsunami, weather severity, volcano level, airport closure, energy MW, national internet, restoration), airport, port, chokepoint, volcano, watchkey, layer (earthquakes magnitude/tsunami, weather severity+certainty, ...). Unknown/foreign rules are rejected (400). Modes: "Major only" / "All important" defaults, or "Custom" (exactly what the user set; edits survive switching modes).
- [x] Developments (`lib/alerts/developments.ts`): conflict events (first sight, party -> independently reported, severity band up, deaths up substantially AND >= 2 independent groups), conflict escalation (severity band/score jump), conflict status change, new actor, APPROVED territorial change, conflicting territorial claims (never announced as "captured"), earthquakes (magnitude revision >= 0.3 or tsunami newly set), weather alerts (severity/certainty up, ended), volcano alert-level changes, reported wildfires, airport status, airspace, chokepoint status (first non-normal sighting alerts), ports, maritime incidents, energy outage lifecycle, internet outage lifecycle, party claims. Raw thermal detections are dropped before any watch lookup. Expiry-based resolutions come from a sweep after each provider poll.
- [x] Deduplication: ledger state + material version -> deterministic fingerprint `kind:key|alertType|state|vN`; repeated sources, dependent repeats and irrelevant provider revisions produce no development; the same fingerprint per watcher is unique (concurrent duplicates fall back to suppressedCount); one development = one notification per watcher even when several of their watches match (`merged_watch`).
- [x] Party claims: hidden by default (`party_claim_hidden`); delivered as "X claims: ..." (priority capped at MEDIUM) when the watcher enabled party claims (same setting as Profile -> Sources) or a CUSTOM watch explicitly includes them; independent corroboration later produces its own verified notification. A claim about a GlobalEvent never changes its status.
- [x] Priority (LOW..CRITICAL, explainable factors stored): 45% development significance, 25% impact on the user's selected country, 20% how directly the thing is followed, 10% confirmation (independent groups, capped); own-country war -> CRITICAL; resolutions and party claims capped at MEDIUM. Report counts never enter.
- [x] UI: bell with unread badge + feed + "Why you received this" + deep links (`/world?layers=&hazard=&focus=&at=`; the same map, layer, selection and historical timestamp), `/watchlist` page (follow picker, mode, custom rule editor, mute, pause, unfollow, preferences, recent alerts), Follow buttons on country/conflict/actor/unit/airport/chokepoint/volcano/infrastructure pages (`FollowButton`, one implementation).
- [x] Admin: `/admin/alerts` inspector (decisions, fingerprints, rules, priority, suppressed duplicates, engine counters) and read-only simulator (`POST /api/admin/alerts/simulate`, incl. synthetic hypothetical GlobalEvents).
- [x] Also fixed: a provider event that was withdrawn and then re-listed with identical content stayed ended (store treated it as unchanged) — closed -> reopened -> closed now round-trips; reference countries: any named country is followable (impact scoring still only for the reference list).
- [x] Tests: `tests/watchlists-alerts.spec.ts`; playwright web-server timeout raised to 480 s (test-DB prep now ~4-5 min on this machine).

Deferred: email/SMS/push delivery and quiet-hours enforcement (flag only, UTC), account-linked (synced) watchlists, region/geometry watches, per-user "important" thresholds beyond the listed rules, casualty-based alerts for events that arrive only through the incoming queue before publication, alerting on party-claim *denials* ("Side B denies it"), port watches by exact LOCODE (name-based only), notification grouping/digests, `at=` deep link for events (only GlobalEvent snapshots).

Unrelated failures seen in the alerts regression sweep (not fixed): `events.spec.ts` "event type filter narrows the feed" fails when run in a subset without the earlier specs that leave published events behind (it depends on residue, not on this milestone); `admin.spec.ts` Mobile incoming publish (location-picker map canvas intercepts the click, see earlier note); `public-data.spec.ts` mobile pair and `source-plugin.spec.ts` shared-feed-URL check (known cross-spec test-DB pollution).

## Global Intelligence Briefings & Emerging Developments

Briefs summarise DEVELOPMENTS (material state changes between T0 and T1), never articles. Built entirely on existing state: no second ingestion pipeline, no external provider, no email/SMS/push, no LLM (all text is template-generated from stored facts).

- [x] Persistence (migration `briefings_transitions_snapshots`): `StateTransition` (old -> new, appended by the existing alert state ledger `stepLedger` and the new-actor path; 120-day retention) so windows can be answered for statuses that only keep their current value; `BriefSnapshot` (development ids + compact text + source refs; personal briefs owner-only).
- [x] Development model (`lib/brief/types.ts`, `collect.ts`): conflict events (canonical, deduplicated by independence groups; late-published <= 24h), material updates from accepted `EventHistory` (severity, or deaths backed by >= 2 independent groups), conflict status changes, new actors, escalation/de-escalation assessments, approved territorial changes, "under review" (uncertain) and conflicting claims (never "captured"), earthquakes (M >= 5.5 or tsunami), severe weather, volcano WATCH+, airport closures/partial closures, chokepoint major disruption, energy outages (>= 500 MW), national internet outages, plus resolutions (reopening/restoration only when the prior bad state was in the ledger). Routine observations are excluded with a recorded reason (visible in the inspector).
- [x] Significance (`scoring.ts`): magnitude 40% / state change 20% / kind weight 20% / scope 10% / novelty 5% / recency 5%, scaled by confidence (never added); threshold 50; territory/trend/registry items come from thresholded detectors and are always kept. Confidence from independence groups, strong verification, official providers, disputes, conflicting claims, freshness; party claims and dependent repeats never count.
- [x] Escalation engine (`activity.ts`): canonical incidents vs the conflict's own previous 7 days (severe-incident frequency, mean severity, new geography, high-importance incidents, corroborated casualties, infrastructure incidents, approved territorial changes, status/severity-band/actor transitions); trend escalating | stable | de-escalating | uncertain, signed score, confidence and reasons. Reporting volume cannot enter (sources only affect confidence).
- [x] Emerging hotspots: frequency z-score against the area's own 7-day baseline (a permanently busy front scores ~0), severity delta, new geography, reviewed territorial claims, infrastructure incidents, new actors; labelled "Emerging activity" / "Increased conflict activity" / "Rapid escalation" (never "emerging war"); party claims never feed it.
- [x] Scopes: global, country (inside the country; conflicts through the central `impactScore`, >= 40; local hazards/infrastructure), conflict, watchlist (per-device, needs `x-vigil-client`), and country + watchlist for For You. Party claims hidden by default (counted) and shown as labelled claims only with `claims=1` (Profile setting).
- [x] API: `GET /api/brief` (window 1h|6h|12h|24h|3d|7d|custom, from/to, asOf, country, conflict, watchlist, claims), `POST/GET /api/brief/snapshots`, `GET /api/brief/snapshots/[id]`, `GET /api/admin/briefings`.
- [x] Caching: one world-wide "universe" per window keyed by data revision (event/history/transition/territory/conflict/structured-event/claim aggregates + an in-process bump on material alert developments); live entries also expire after 2 min so the window edge moves. A duplicate report from an already-counted outlet changes nothing and stays cached.
- [x] UI: `/brief`, `/brief/country/[code]`, conflict page "Brief", `/world` "What changed" panel (selecting an item enables the layer, selects the record / territory, centres the same map), "Brief my watchlist", For You brief, `/admin/briefings`, nav links, saved-brief view (`/brief?snapshot=`).
- [x] Tests: `tests/briefings.spec.ts` (28 per project).

Deferred: morning/evening scheduled digests and delivery (the 24h manual brief uses the same deterministic result), LLM summarisation layer (not built by design), non-conflict-linked infrastructure -> conflict relations beyond confirmed `GlobalEventLink`, per-incident location "fighting geography" for hotspots finer than a 0.5 degree grid, impact scoring for non-reference countries, historical (`asOf`) reconstruction of registry status beyond the transition ledger and accepted event history.
