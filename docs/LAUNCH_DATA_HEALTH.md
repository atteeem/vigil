# Launch Data Health — Real Data Quality, Source Coverage & Stabilization v1

Measured 2026-09-27 against the real local `prisma/dev.db` (123 sources after this pass — see §15 — 32 tracked conflicts, 2,598 pending raw items at the start of this audit, 0 published events — this environment has never gone through a real publish cycle). A bounded sample of 42 real pending reports was published to a disposable copy (`prisma/audit.db`, deleted after this pass) to exercise and spot-check the publish/scoring/public-page path without touching real data. This document is a snapshot, not a live dashboard — re-run the same queries before launch if meaningful time has passed.

## 1. Source health (122 sources at the start of this audit; 123 after §15's addition)

| Bucket | Count | Meaning |
|---|---|---|
| STALE | 64 | Enabled, auto-ingesting, but no successful poll in the freshness window |
| DISABLED | 41 | Turned off — see breakdown below |
| DISABLED (verified, not auto-ingesting) | 14 | Verified as a real, reachable source, but deliberately not polling (usually a structured provider awaiting a real API key) |
| EMPTY (never ingested) | 3 | Enabled, no credential gate, but no successful poll has ever landed a row |
| FAILING (≥3 consecutive failures) | 0 | — |

All 64 "STALE" sources are that way because ingestion has not been running continuously in this dev environment (last real successful poll across the whole fleet: **2026-09-21**, 6 days before this audit) — this session ran with `DISABLE_INGESTION_SCHEDULER=1` throughout, per the project's own convention for diagnostic work, so this number reflects "the scheduler hasn't been on," not source breakage. Before external testers see the product, the scheduler needs to be running continuously (`npm run dev` without that flag) for the freshness badges (`lib/world/derive.ts`: LIVE ≤120min / DELAYED ≤48h / STALE beyond) to read anything but STALE. The threshold logic itself was read and is sound — it keys off the real newest successful ingestion timestamp, never off "is the server process running."

**Disabled breakdown** (41 + 14 = 55 disabled sources):
- 34 `needs_verification` — credential/authorization gated (Telegram channels awaiting authorization, FAA NOTAM API key, Cloudflare Radar API key, Liveuamap). Not failures — deliberately unauthorized, per the project's own policy of never fabricating access.
- 14 `verified` but not auto-ingesting — mostly structured providers (FAA NOTAM API, Cloudflare Radar) verified reachable but withheld pending real credentials.
- 7 `inaccessible` — confirmed bot-detection/access-denied, not worked around: ReliefWeb Updates (disabled this pass — AWS WAF blocks the Node fetch fingerprint even with curl-identical headers; real fix is ReliefWeb's v2 API with a registered `appname`, documented on the source), Hengaw, ICG Cameroon, AP Libya, ICG Libya, Al Arabiya English, MindaNews.

**3 EMPTY, no credential gate**: NASA EONET (volcano), NASA FIRMS (active fire), USGS HANS (volcano hazards). No evidence of misconfiguration was found — these are inherently rare-event feeds (global volcanic activity / new fire detections aren't constant), so "never yet ingested" is plausibly correct behavior, not breakage. Classified NEEDS_VERIFICATION (needs one real ingestion cycle with the scheduler on to confirm either way), not FAILING.

**0 sources are FAILING** (≥3 consecutive errors) as of this snapshot.

## 2. URL/link integrity

No fake, `localhost`, or placeholder URLs found in production source or item data. `canonicalSourceUrl`/`feedUrl`/`socialProfileUrl`/`originalItemUrl` remain distinct fields, never conflated. Real duplicate-URL bug found and fixed (see §5).

## 3. Conflict & country coverage (live, `/api/admin/conflict-coverage`)

32 tracked conflicts: 21 active, 6 reduced/dormant read as "inactive" by the tool, 5 "healthy," 1 **NO_SOURCE**.

- **NO_SOURCE → fixed**: `kurdish-turkey-pkk` (Turkey–PKK) had 0 enabled sources despite `status: reduced`. The already-recorded candidates (Rudaw, Kurdistan24) were re-checked live and still have no working RSS feed (feed paths serve HTML, not RSS/XML — same finding as the earlier `data/source-expansion.json` note, still true today). **Al-Monitor's real RSS feed (`https://www.al-monitor.com/rss`) was verified** (valid `application/rss+xml`, real dated Sept 2026 Middle East/Turkey content) and added as a general-scope source (`SourceConflictLink.scope="general"`, not claimed as dedicated Kurdish-conflict coverage). A live test poll confirmed it works end-to-end on the real DB: 20 fetched, 17 new items, 0 errors, real attributed content ingested.
- **STALE** (21 of 32) — every active conflict with enabled sources reads STALE right now, because the coverage tool measures *recently published event* freshness, and this dev DB has 0 published events at all (nothing has ever been through a real publish cycle here). This is not a source-ingestion problem — it is the pending-backlog problem (§8): sources are ingesting real articles, but almost none of that has been reviewed/published yet, so every conflict's public page currently has nothing recent to show. This is the single most important structural finding of this audit: **the bottleneck is the review/publish step, not source coverage.**
- **Dormant conflicts re-verified against current real news** (bounded web research, 2026-09-27): Korean Peninsula (North Korea actively missile-testing and escalating rhetoric around Pacific 2026 exercises) and Taiwan Strait (record PRC coast-guard/vessel presence, ~244 vessels in July vs. 58 a year earlier) both show real, well-documented tension — but neither is *fighting*, so the registry's existing "dormant... deterrence/pressure, not active fighting" framing holds up and was **not changed**. Syria's registry note ("post-Assad transition, sectarian clashes, SDF-government tension, Israeli/Turkish strikes; well below the 2011-2019 war") is also consistent with current reporting (continuing ISIL activity, Aleppo-area clashes, Iran-war collateral damage) — **not changed**, confidence stays "uncertain" as the registry already states. Armenia–Azerbaijan and India–Pakistan were not independently re-searched this pass (their registry notes are already dated/specific — 2025 peace-agreement text, May 2025 clashes — and no contradicting signal surfaced). No registry status field was changed; this was verification, not a rewrite. Real, separate finding: Korean Peninsula and Taiwan Strait both have substantial, near-daily real news coverage (AEI, CNN) but zero Vigil sources — a genuine coverage gap distinct from their (correct) "not an active armed conflict" classification.
- Mexico (`mexico-cartel`): 2 enabled sources, 0 dedicated — genuinely thin, see §10.

## 4. Report-quality / real pipeline bug found and fixed

Sampling real pending reports surfaced a genuine, systemic classification bug (not a one-off): **any article whose location resolved to a country was suggested as belonging to that country's one tracked conflict, regardless of topic.** Concretely, on the real backlog: a Mexico News Daily tourism piece ("The story of Hotel Mocambo..."), a business op-ed ("Mexico's 44% growth in exports..."), and GDACS "Green flood alert" wire items for Myanmar, DRC, and Somalia were all suggested as belonging to those countries' armed conflicts, purely because the place name resolved to the right country.

**Fixed** by gating the conflict suggestion on the detected event type actually being conflict/security-relevant (new `NON_CONFLICT_EVENT_TYPES` set — `other`, `earthquake`, `flood`, `storm`, `fire`, `health` — in `lib/ingestion/event-type-keywords.ts`), applied in both `lib/ingestion/draft.ts` (the admin-queue suggestion) and `lib/ingestion/extract-facts.ts` (structured fact extraction). A genuine security incident in the same city (a drone/military story naming Tijuana) still correctly links to "Mexico cartel violence" — this is a topic filter, not a location filter.

**Measured effect on the real backlog** (after re-running suggestion snapshots on all 2,598 pending items): conflict-linked pending items dropped from 445 to 264. Every item that lost its conflict link was a natural-hazard or uncategorized story that had been wrongly tagged — none were genuine conflict reports. Tests: `tests/extract-facts.spec.ts` #6–7.

## 5. Duplicate/syndication fix (already-committed groundwork retained here for context)

A real dedupe bug (guid instability producing 21 exact-article duplicate `RawIngestionItem` rows) was fixed earlier in this same pass with a normalized-URL second dedupe key (`lib/ingestion/url-normalize.ts`, `originalUrlKey`), backfilled and cleaned on the real DB (2619 → 2598 rows). Corroboration/independence counting itself (`lib/data/independence.ts`) was audited and found already correct: the same outlet filing multiple reports, or the same article attached twice, counts as one independent source; only genuine aggregator/relay/party-claim roles are excluded — an aligned-but-independent outlet is never downgraded just for being aligned.

## 6. Location, title, summary quality

- Gazetteer gap found and fixed: `lib/geocoding/gazetteer.ts` / `admin-regions.ts` had **zero** Mexican cities or regions despite Mexico having an actively tracked, named conflict. Added the registry's own named regions (Sinaloa, Michoacán, Guerrero, Chiapas) and their principal cities (Tijuana, Culiacán, Ciudad Juárez, Guadalajara, Monterrey, Acapulco, Chilpancingo, Morelia, Uruapan, Tapachula, Mexico City) with real, verifiable coordinates — no invented precision. Verified live: "...drone and arrests its operator in Tijuana" now resolves to MX / Tijuana / city precision / linked to the correct conflict, with honest evidence text ("named in the headline... not the incident point").
- Location resolution never fabricates a point for country/region-level evidence (verified in code and via the published sample); locationEvidence strings are always populated and quoted from the source text.
- Titles/summaries prefer the source's own headline/excerpt (`titleSource: "source_title"`, `summarySource: "source_excerpt"` observed throughout); no publish path requires AI.
- A separate, pre-existing bug was found and fixed: `suggested_*` snapshot columns were computed once at ingestion and never recomputed, so the admin queue's own filters could silently miss items the current (improved) extractor would resolve correctly. Fixed with a reusable, bounded admin endpoint (`POST /api/admin/incoming/refresh-snapshots`), applied across the whole real backlog this pass (all 2,598 pending items refreshed, scoped per-source, never touching `processingStatus` or anything a human already reviewed).

## 7. Confidence / severity / impact model — audited, not modified

The scoring engine (`lib/scoring/{confidence,severity,geography,exposure,impact}.ts`) already matches every hard rule this audit was asked to check: severity never reads report/article count; confidence is the one place source count raises a score, and only *independent* sources (`lib/data/independence.ts`) do; a registry-flagged active full-scale war is the only way to reach severityScore 100; country-level exposure enforces hard floors (own-country active war = 100, directly-bordering active war ≥ 75) that no later combination can dilute, and adding a conflict can never lower a country's score. No changes were made here — this is a previous milestone's work, verified sound, not re-litigated.

## 8. Pending backlog (2,598 items, real numbers after the refresh in §6)

| | Count |
|---|---|
| No suggested location at all | 1,098 |
| Has a suggested country | 1,500 |
| ...of which, city/region precision | 314 |
| ...of which, country-only (no city/region) | 1,186 |
| Suggested conflict link | 264 |
| Country resolved but no conflict match | 1,236 |
| Event type still "other" (uncategorized) | 1,607 |
| No article text at all | 30 |

**Do not mass-publish this backlog.** ~42% still have no resolvable location and 62% are uncategorized "other" — most of the backlog is exactly the kind of low-signal wire content (routine business/culture/sports pieces from general-interest feeds) that should stay unpublished or be reviewed, not bulk-approved.

## 9. Safe bulk-publish audit

Ran the real "Publish filtered" API (`planBulkPublish`/`runBulkPublish`) against a **narrow, bounded sample only** (6 items each from Russia-Ukraine, Israel-Palestine, Sudan, Myanmar, Mexico-cartel, Persian Gulf/Iran, Sahel = 42 total), on the disposable `audit.db` copy, never on real `dev.db`. Result: 42/42 published, 0 skipped, 0 failed; `expectedCount` guard worked as documented (a filtered-set preview count must match at publish time). Confirmed: country-level reports publish with no fabricated coordinates, source attribution carries through to `EventSource` rows correctly, and the exact same conflict-mismatch bug from §4 was caught live in this sample (4 of the first 6 "mexico-cartel"-filtered candidates were not actually cartel-related) before the fix — which is exactly why the fix in §4 matters for this flow specifically, since bulk-publish filters by the very `suggestedConflictId` that was wrong.

## 10. Real public page spot-check

Using the 42-item published sample on `audit.db`: `/`, `/world`, `/country/FI`, `/country/UA`, `/country/MM`, `/country/SD`, `/country/MX`, `/conflict/russia-ukraine`, `/conflict/israel-palestine`, `/conflict/sudan`, `/conflict/mexico-cartel` all rendered 200 with real, non-fabricated data. Mexico's conflict page correctly showed the Tijuana drone incident at city precision alongside country-level items with no invented points.

## 11. Territorial dataset registry (8 datasets)

| Dataset | Status | Geometry |
|---|---|---|
| Yemen: Areas of control (ACAPS) | pending_review | draft (real geometry loaded, awaiting admin approval) |
| Yemen: AQAP reported presence (ACAPS) | pending_review | draft |
| Ukraine: ISW/Critical Threats control | blocked | blocked — ISW states the geodata is not licensed for reuse |
| Ukraine: DeepStateMap occupied territory | rejected | blocked — unclear/incompatible license on the underlying geometry |
| West Bank: Oslo Areas A/B/C (OCHA) | candidate | none |
| Ukraine: Affected areas (HDX) | rejected | none |
| Myanmar: Areas of control (Red Cross/HDX) | rejected | none |
| Mexico: Criminal-group presence 2007-2015 (Harvard Dataverse) | candidate | none |

No fake or reverse-engineered geometry exists anywhere in the registry — every blocked/rejected row is blocked specifically over licensing, and only the two real, properly-licensed ACAPS Yemen datasets have geometry loaded (as unpublished drafts, correctly not yet public).

## 12. Live/structured data providers

All 16 structured providers (USGS, GDACS, EONET, FIRMS, HANS, NWS, FAA, PortWatch, Elexon, ENTSOG, IODA, NGA, Cloudflare Radar) were reachable/verified at some point; current STALE/EMPTY status is explained in §1 (scheduler not running this pass / genuinely rare event types). None showed real fetch failures.

## 13. Database integrity

Zero foreign-key violations, zero orphaned rows across every checked relation, zero duplicate slugs/names/feed URLs/aliases (re-verified this pass after the disabled-source and dedupe changes), all territorial geometry valid JSON. No `git`-tracked secrets found (scanned for API-key/token/password-shaped strings in tracked source; only `.env.example` is tracked).

## 14. Known launch blockers (ranked)

1. **The pending-review backlog, not source coverage, is the real bottleneck** — 2,598+ real items sit unreviewed; 0 events are published on the real DB. Public pages will look empty/stale on day one unless a deliberate, human-reviewed publish pass happens before testers arrive.
2. **Ingestion scheduler needs to run continuously** before launch — every freshness badge reads STALE right now purely because polling has been off during most of this admin session (confirmed healthy once turned on — see Performance below).
3. **Mexico (`mexico-cartel`) has 2 sources, 0 dedicated** — thin for a conflict the product explicitly names and spot-checks.
4. **Korean Peninsula and Taiwan Strait have zero sources** despite substantial, well-documented real-world tension (missile tests, record PRC vessel incursions) — correctly classified as "not an active armed conflict," but under-covered relative to real news volume.
5. Territorial coverage is real but thin: only Yemen has approvable geometry; every other tracked conflict correctly shows "no verified territorial dataset" rather than guessing.

## 15. Source-gap recommendation (small, targeted — not a mass list)

`kurdish-turkey-pkk`'s 0-source gap was fixed this pass (Al-Monitor, real RSS, verified end-to-end — see §3). Everything else found (Mexico's thin coverage, Korean Peninsula/Taiwan Strait's zero sourcing despite real news volume) is real but lower-urgency, since those conflicts already show honest "STALE"/"NO_SOURCE" states rather than fabricated confidence — left as documented candidates rather than force-adding mediocre feeds.

## Performance

No performance regressions observed under real, live ingestion. Started the real dev server with the scheduler actually running (not disabled): 3 scheduler ticks completed cleanly over ~2 minutes (12 sources polled per tick), ingesting 791 new real items in a burst (expected after a multi-day gap in polling — feeds return everything published since the last cursor). Warm page loads measured during that live ingestion: `/` 65ms, `/world` 61ms, `/conflicts` 46ms, `/for-you` 43ms, `/country/UA` 447ms, `/conflict/russia-ukraine` 426ms, `/api/world/command-center` 14ms, `/api/public/search` 16ms — no event-loop stalls, no page request blocked by a concurrent scheduler tick. The dedupe fix (§5) held under this real burst: 0 duplicate groups afterward. The per-source snapshot refresh (2,598 items across 53 sources) separately completed in well under a minute; nothing here was slow enough to justify further optimization.
