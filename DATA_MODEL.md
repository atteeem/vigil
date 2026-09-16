# DATA_MODEL.md — Vigil

Phase 1 implements this as TypeScript types + mock data (`lib/types`,
`lib/data`). Phase 2 implements it as Postgres tables (Supabase) with
PostGIS geography columns where noted. Field names are shared between both
so the migration is mechanical.

## `countries`
| field | type | notes |
|---|---|---|
| code | text (PK) | ISO 3166-1 alpha-2 |
| name | text | |
| region | text | Europe / Middle East / Africa / Asia / Americas |
| centroid | geography(Point) | PostGIS; lat/lng in mock layer |
| population | integer | |
| flag_emoji | text | display only |

## `conflicts`
| field | type | notes |
|---|---|---|
| id | uuid (PK) | |
| slug | text (unique) | e.g. `russia-ukraine` |
| name | text | |
| region | text | |
| status | enum | `active` / `dormant` / `resolved` |
| severity | enum | Stable/Elevated/High/Severe/Extreme |
| intensity | integer 0–100 | |
| intensity_change_24h | integer | signed |
| started_at | date | |
| centroid | geography(Point) | for globe hotspot placement |
| bounding_region | geography(Polygon) | optional, for map framing |
| primary_effects | text[] | e.g. `["Security","Trade","Energy"]` |
| summary | text | short neutral description |

## `events`
| field | type | notes |
|---|---|---|
| id | uuid (PK) | |
| slug | text (unique) | |
| title | text | |
| summary | text | neutral, attribution-preserving |
| event_type | enum | the full 21-category set in `lib/types/severity.ts` `EVENT_TYPES` (airstrike, drone, missile, explosion, artillery, ground, ground_clash, naval, air_defense, protest, civil_unrest, fire, security, terrorism, cyber, border, diplomacy, sanctions, infrastructure, conflict, other) — see `lib/map/event-icons.ts` for the matching icon per category |
| latitude / longitude | double | mirrored into `location geography(Point)` |
| country_code | text (FK → countries) | |
| region | text | |
| conflict_id | uuid (FK → conflicts, nullable) | implemented in the local schema — see "sources, raw_ingestion_items, event_sources, conflicts" above |
| occurred_at | timestamptz | |
| created_at / updated_at | timestamptz | |
| severity | enum | Stable/Guarded/Elevated/High/Severe/Extreme (event-local) |
| importance | integer 0–100 | ranking signal |
| verification_status | enum | mock-data UI uses 5 states (Unverified/Reported/Multiple Sources/Confirmed/Official Claim) + a separate `disputed: boolean`; the local DB schema uses Decisions.md's 6-state vocabulary instead, with `disputed` as its own status rather than a separate flag — `lib/data/world-events.ts`'s `toUiVerification()` maps one onto the other for display |
| source_count | integer | denormalized count of `event_sources` |
| published | boolean | |
| raw_metadata | jsonb | ingestion passthrough |

## `sources`, `raw_ingestion_items`, `event_sources`, `conflicts` — implemented (Phase 2, local SQLite/Prisma)

Unlike the rest of this file, these four tables are **not** aspirational —
they're the actual schema in `prisma/schema.prisma`, running today against
SQLite (temporary local-development infrastructure per Decisions.md; see
ARCHITECTURE.md's "Source ingestion pipeline" for the full flow these
support). They're richer than the original sketch below them in this file
needed to support the admin Source Manager (ingest scheduling, health
tracking) and the review/publish workflow — this section supersedes the
earlier plain `sources`/`event_sources` shapes. SQLite has no native enum
type, so every enum-shaped field is a plain `String`, validated at the
TypeScript boundary instead (`lib/types/db.ts`) — the field *names* still
match this doc's convention so a future Postgres migration stays close to
mechanical.

### `sources`
| field | type | notes |
|---|---|---|
| id | text (PK, cuid) | |
| name | text | e.g. "BBC World" |
| type | text | `rss` \| `telegram` \| `manual` |
| url | text, nullable | feed URL for `rss` |
| telegram_handle | text, nullable | |
| country | text, nullable | |
| region | text, nullable | |
| language | text, nullable | e.g. `en` |
| source_category | text, nullable | e.g. "News" — shown as the source's displayed type on event detail pages, preferred over a generic per-`type` label |
| reliability_tier | text, nullable | e.g. `A` |
| source_role | text, nullable | trust-model classification (spec "Source Trust Model") — `originating` \| `relay` \| `official` \| `local_media` \| `eyewitness_community` \| `aggregator`. Complements, doesn't replace, `source_category`/`reliability_tier` |
| permission_status | text | `authorized` \| `unauthorized` \| `pending` — Telegram sources default `unauthorized` until real credentials exist |
| enabled | boolean | |
| auto_ingest | boolean | polled by the scheduler when true; "Fetch Now" works regardless |
| auto_processing | boolean, default true | gates automated draft extraction (spec "Automated Draft Extraction") per source — independent of `auto_ingest`, which only gates *fetching*. `false` means the review screen shows source data only, no automated-suggestion panel |
| poll_interval_minutes | integer, default 5 | per-source scheduler interval (spec "Source Scheduler") — not a single interval shared by every source |
| next_poll_at | timestamp, nullable | when the scheduler will next consider this source due; advanced after every attempt (`lib/ingestion/poll.ts`), with exponential backoff (capped) on failure |
| last_attempted_at | timestamp, nullable | set at the start of every poll attempt, success or failure — distinct from `last_successful_ingestion` below |
| consecutive_failures | integer, default 0 | drives the backoff multiplier; reset to 0 on success |
| last_successful_ingestion | timestamp, nullable | |
| last_error | text, nullable | |
| created_at / updated_at | timestamp | |

### `ingestion_logs`
Append-only, one row per poll attempt (spec "Source Health": last
attempted fetch, errors today, new items today) —
`lib/db/repositories/ingestion-logs.ts`. `sources`' own
`last_attempted_at`/`last_successful_ingestion`/`last_error` stay as fast
denormalized "current state" reads; this table is what lets the admin UI
show today's aggregate counts (a dedup-guaranteed-unique raw-items count
alone can't distinguish "seen again" from "genuinely new," and never
records a failed attempt at all).

| field | type | notes |
|---|---|---|
| id | text (PK, cuid) | |
| source_id | text (FK → sources) | |
| attempted_at | timestamp, default now | |
| fetched | integer | items the adapter returned this attempt |
| new_count | integer | of those, how many were actually new (not already known) |
| already_known | integer | `fetched - new_count` |
| success | boolean | |
| error_message | text, nullable | |

### `raw_ingestion_items`
| field | type | notes |
|---|---|---|
| id | text (PK, cuid) | |
| source_id | text (FK → sources) | |
| external_id | text | GUID, or a stable fallback (link URL, then `sourceId:title`) — see ARCHITECTURE.md |
| original_url / original_title / original_text | text, nullable | stored for internal review only — public event summaries must be independently paraphrased, never a republish of this text |
| language | text, nullable | |
| published_at | timestamp, nullable | |
| received_at | timestamp | |
| media_urls | text, nullable | JSON-encoded `string[]` (SQLite has no array type) |
| processing_status | text | `pending` \| `published` \| `rejected` \| `merged` |
| raw_metadata | text, nullable | JSON-encoded, adapter-specific passthrough — Telegram items store `{channel, messageId}` here |
| suggested_event_type / suggested_conflict_id / suggested_region / suggested_country_code / suggested_location_name / suggested_lat / suggested_lng / suggested_severity / suggested_importance / location_source | various, all nullable | automated-suggestion SNAPSHOT (spec "Processing") — computed once at ingestion time when the source has `auto_processing: true`, for queue filtering/sorting only. **Not** what the review screen shows: `GET /api/admin/incoming/[id]/draft` always recomputes fresh from current data. Duplicate likelihood is deliberately not part of this snapshot — see ARCHITECTURE.md's "Duplicate handling in the incoming queue" |
| processed_at | timestamp, nullable | when the snapshot above was computed; null if never (source has `auto_processing: false`, or not yet processed) |

Unique constraint: `(source_id, external_id)` — the deduplication rule; see ARCHITECTURE.md.

### `event_sources` (join)
| field | type | notes |
|---|---|---|
| id | text (PK, cuid) | |
| event_id | text (FK → events) | |
| raw_ingestion_item_id | text (FK → raw_ingestion_items) | |
| relationship | text | `originating` \| `relay` \| `corroborating` |
| is_originating_source | boolean | a relay of the same originating source is not an independent confirmation — see Decisions.md § Source verification |

Unique constraint: `(event_id, raw_ingestion_item_id)`. `relationship:
"relay"` sets `is_originating_source: false` on create (see
`lib/ingestion/duplicates.ts`'s caller in the merge route) — a relay of
the same originating report is never counted as independent confirmation,
even though it's still attached to the event as a source row (spec
"Source Independence").

### Automated draft extraction & duplicate candidates — computed, not stored
Spec §3/§4's "Automated Suggestion" (event type, location, conflict,
title, summary, verification, severity, duplicate candidates) and §2's
duplicate-candidate list are **never persisted** — both are recomputed on
every `GET /api/admin/incoming/[id]/draft` / `POST
/api/admin/incoming/[id]/duplicates` call (`lib/ingestion/draft.ts`,
`lib/ingestion/duplicates.ts`), specifically so they can never go stale
relative to conflicts/events that changed after a raw item first arrived.
A rule-based heuristic (keyword matching + a curated gazetteer + a
weighted distance/time/type/region/conflict/title-similarity score) —
deliberately not an AI/LLM call, since no external processing provider is
configured for this project. See ARCHITECTURE.md "Automated draft
extraction" and "Duplicate-candidate engine."

### `conflicts` (local schema)
Now a full admin-managed table (`/admin/conflicts`, spec "Admin Conflict
Management") — superset of the target `conflicts` table below: `id`,
`slug` (unique), `name`, `short_name` (text, nullable — used as the
display name in the admin table/dropdowns when present), `region`,
`status`, `countries` (JSON-encoded `string[]` of ISO alpha-2 codes — used
by `findConflictByCountryCode()` to suggest a conflict from a resolved
location), `severity`, `intensity`, `intensity_change_24h`, `started_at`,
`lat`, `lng`, `primary_effects` (JSON-encoded `string[]`), `summary`,
`created_at`/`updated_at`. Seeded with exactly the 14 conflicts the spec
named: Russia–Ukraine, Israel–Palestine, Israel–Lebanon, Syria, Persian
Gulf / Iran, Yemen / Red Sea, Sudan, DRC, Somalia, Sahel, Myanmar,
India–Pakistan, Korean Peninsula, Taiwan Strait (`prisma/seed.mjs`).
Delete is refused (409) while any `Event.conflict_id` still references the
row — `archived`/`resolved` status is the correct way to retire one
instead (`deleteConflictIfSafe()` in `lib/db/repositories/conflicts.ts`).
Only `active`/`dormant` conflicts appear in the incoming-report review and
event-editor picker (`GET /api/admin/conflicts?selectable=true`) —
`archived`/`resolved` ones stay visible in `/admin/conflicts` itself so
history isn't lost.

## `market_assets`
| field | type | notes |
|---|---|---|
| id | uuid (PK) | |
| symbol | text | e.g. `BRENT`, `XAU`, `EURUSD`, `BTC` |
| name | text | |
| asset_class | enum | Energy/Metal/FX/Crypto/Equity Index |

## `market_prices`
| field | type | notes |
|---|---|---|
| id | uuid (PK) | |
| asset_id | uuid (FK) | |
| price | numeric | |
| change_pct_24h | numeric | |
| geopolitical_pressure | enum | Low/Moderate/High/Severe |
| relevant_conflict_ids | uuid[] | |
| recorded_at | timestamptz | |

## `impact_scores`
| field | type | notes |
|---|---|---|
| id | uuid (PK) | |
| country_code | text (FK) | the *viewer's* country |
| conflict_id | uuid (FK, nullable) | null = overall country exposure |
| score | integer 0–100 | "Impact Score" |
| change_24h | numeric | |
| computed_at | timestamptz | |

## `impact_components`
| field | type | notes |
|---|---|---|
| id | uuid (PK) | |
| impact_score_id | uuid (FK) | |
| dimension | enum | Security/Energy/Trade/Finance/Food & Supply |
| value | integer 0–100 | |
| drivers | jsonb | `[{label, contribution, description}]` — powers "Why this score?" |

## `country_risk_scores`
| field | type | notes |
|---|---|---|
| country_code | text (FK) | |
| global_status | integer 0–100 | this country's read of the Global Status metric |
| label | enum | Stable/Elevated/High/Severe/Extreme |
| change_24h | numeric | |
| recorded_at | timestamptz | |

## `alerts` / `subscriptions` (Phase 2+)
`alerts`: id, user_id, kind (`conflict`/`country`/`topic`), target_id,
min_severity, min_impact_score, created_at.
`subscriptions`: id, user_id, plan, status, renewed_at (future monetization
scaffold only — not built in Phase 1).

## `ai_briefings` (Phase 2+)
id, conflict_id, window (`6h`/`24h`), body_md, grounded_event_ids (uuid[]),
generated_at, model_version.

## `raw_ingestion_items` — superseded, see above

This original sketch (id, source_url, fetched_at, raw_payload jsonb,
processing_status, promoted_event_id) is superseded by the actual
implemented schema documented earlier in this file under "sources,
raw_ingestion_items, event_sources, conflicts — implemented" — kept here
only so old links/references don't 404.

## Relationships

```
countries 1─* events
countries 1─* impact_scores
countries 1─* country_risk_scores
conflicts 1─* events
conflicts 1─* impact_scores (nullable FK)
events    *─* sources   (via event_sources)
impact_scores 1─* impact_components
market_assets 1─* market_prices
```

## PostGIS notes

`events.location`, `countries.centroid`, and `conflicts.centroid` are
`geography(Point, 4326)` columns in Phase 2, enabling radius queries
("major event within 500km") directly in Postgres for the alerts feature.
The mock layer stores plain `{ lat, lng }` and a small geo-distance helper
(`lib/utils/geo.ts`) approximates the same query in-memory.
