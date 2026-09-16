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
| event_type | enum | Airstrike/Drone/Ground/Naval/Terrorism/Civil Unrest/Cyber/Diplomacy/Sanctions/Conflict(general) |
| latitude / longitude | double | mirrored into `location geography(Point)` |
| country_code | text (FK → countries) | |
| region | text | |
| conflict_id | uuid (FK → conflicts, nullable) | |
| occurred_at | timestamptz | |
| created_at / updated_at | timestamptz | |
| severity | enum | Stable/Elevated/High/Severe/Extreme (event-local) |
| importance | integer 0–100 | ranking signal |
| verification_status | enum | Unverified/Reported/Multiple Sources/Confirmed/Official Claim (+ `disputed: boolean`) |
| source_count | integer | denormalized count of `event_sources` |
| published | boolean | |
| raw_metadata | jsonb | ingestion passthrough |

## `sources`
| field | type | notes |
|---|---|---|
| id | uuid (PK) | |
| name | text | publisher / outlet / official body |
| source_type | enum | Wire / Official / Local News / OSINT / Social / NGO |
| url | text | |
| published_at | timestamptz | |
| reliability_note | text | optional |

## `event_sources` (join)
| field | type | notes |
|---|---|---|
| event_id | uuid (FK) | |
| source_id | uuid (FK) | |
| note | text | how this source's account differs, if it does |

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

## `raw_ingestion_items` (Phase 2+)
id, source_url, fetched_at, raw_payload jsonb, processing_status
(`pending`/`classified`/`discarded`/`promoted`), promoted_event_id.

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
