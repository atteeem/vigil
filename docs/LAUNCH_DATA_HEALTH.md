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

## 14. Known launch blockers (ranked, superseded — see §16 for current state)

1. ~~The pending-review backlog, not source coverage, is the real bottleneck~~ — **addressed 2026-09-28, see §16**: 820 real reports now published via a evidence-gated, conservatively-scoped two-batch rollout.
2. **Ingestion scheduler needs to run continuously** before launch — every freshness badge reads STALE right now purely because polling has been off during most of this admin session (confirmed healthy once turned on — see Performance below).
3. **Mexico (`mexico-cartel`) has 2 sources, 0 dedicated** — thin for a conflict the product explicitly names and spot-checks.
4. **Korean Peninsula and Taiwan Strait have zero sources** despite substantial, well-documented real-world tension (missile tests, record PRC vessel incursions) — correctly classified as "not an active armed conflict," but under-covered relative to real news volume.
5. Territorial coverage is real but thin: only Yemen has approvable geometry; every other tracked conflict correctly shows "no verified territorial dataset" rather than guessing.
6. **~2,866 pending reports remain** (mostly NEEDS_REVIEW, dominated by real location-resolution gaps — see §16) — a genuine, ongoing human-review workload, not a bug.

## 15. Source-gap recommendation (small, targeted — not a mass list)

`kurdish-turkey-pkk`'s 0-source gap was fixed this pass (Al-Monitor, real RSS, verified end-to-end — see §3). Everything else found (Mexico's thin coverage, Korean Peninsula/Taiwan Strait's zero sourcing despite real news volume) is real but lower-urgency, since those conflicts already show honest "STALE"/"NO_SOURCE" states rather than fabricated confidence — left as documented candidates rather than force-adding mediocre feeds.

## 16. Backlog Triage, Conflict Attribution & Safe Publication v1 (2026-09-28)

**Root cause fixed.** The previous milestone's country+eventType gate was still too permissive: any article whose location resolved to a tracked-conflict country, with an eventType outside a small hazard/health blocklist, still got linked — a diplomatic/economic/cultural story using an incidental "security"-flavored word could still slip through. Replaced with a central, evidence-based matcher (`lib/ingestion/conflict-match.ts`) used everywhere a conflict gets suggested (`draft.ts`, `extract-facts.ts`): a report is linked to a conflict only on real evidence — an explicit conflict name/alias (~0.9), a named conflict actor alongside a conflict-relevant event type (~0.85), a conflict-relevant event type alone in the conflict's own fighting geography (~0.6), a named actor alone (~0.55), or the conflict's own dedicated source (~0.45, always below the auto-ready threshold). Country association alone is never sufficient; `matchConfidence` and `matchReasons` are stored with every suggestion, never an opaque link.

**A second false-positive class was found and fixed during the matcher's own sample audit**: several conflicts are literally named after their country (`Libya`, `Haiti gang conflict`'s short name `Haiti`) or have a bare single-word curated alias (`Gaza`) — a naive substring match on `conflict.name`/`shortName`/aliases treated an NFL player's tribute to a slain Palestinian girl, a routine diplomatic meeting in Benghazi, and a Haitian football club's cup win as high-confidence (0.9) conflict events, purely because the text said "Gaza"/"Libya"/"Haiti". Fixed by requiring a matched name/alias to be a specific multi-word phrase (`isSpecificEnough` in `conflict-match.ts`) — a real conflict name/alias is always distinctive ("Gaza war", "Mexican drug war"); a bare place name is exactly the weak, country-name-alone evidence the matcher must reject.

**Quality sample** (per the milestone's own explicit sampling requirement): manually reviewed a random 50-item READY sample plus all 84 items in the "strong" (≥0.8) confidence band that the fix made eligible for auto-publish. After the alias fix: **zero observed false positives in the strong band** (every match reason checked out — real drone/missile/actor evidence, or a genuinely conflict-relevant development like "War in Sudan has devastated the economy" or a real terrorist attack in Kohat correctly matched via the TTP actor). A handful of borderline-but-defensible cases exist (conflict-context economic/political developments rather than hard kinetic-incident news) — acceptable, not false positives. NEEDS_REVIEW is dominated (1,517 of 2,006, ~75%) by items with **no resolvable location at all** — a pre-existing gazetteer/location-extraction coverage gap, not a conflict-attribution issue; correctly deferred to review rather than guessed. One minor, non-blocking data nit: `Iran`'s actor-registry entry lists the bare capital `tehran` as a "military-flavored" alias, which is nearly as weak as a bare country name — flagged, not fixed (never crosses the auto-ready threshold, so it only adds harmless NEEDS_REVIEW noise).

**Classification + readiness** (`lib/ingestion/publish-readiness.ts`, persisted as `suggestedClassification`/`suggestedReadiness`/`suggestedReadinessReasons`/`suggestedConflictConfidence` snapshot columns, combined with a live duplicate-likelihood signal at read/publish time — the same staleness-safe pattern the project already used for duplicate detection, never a stale "not a duplicate" snapshot). Reprocessed the full real backlog (3,686 pending items at the time) after the fix:

| Readiness | Count | | Classification (all) | Count |
|---|---|---|---|---|
| READY | 1,621 | | CONFLICT_EVENT | 676 |
| NEEDS_REVIEW | 2,006 | | COUNTRY_DEVELOPMENT | 1,420 |
| BLOCKED | 59 | | OTHER (no location) | 1,517 |
| | | | INSUFFICIENT | 59 |
| | | | PARTY_CLAIM | 14 |

**Dry-run → two controlled publication batches**, both on the real `dev.db` via the extended "Publish READY filtered" bulk action (`classifications` breakdown added to `planBulkPublish`'s preview):
- Batch 1: 220 READY reports, spread across 19 conflicts and >100 countries (81 CONFLICT_EVENT, 139 COUNTRY_DEVELOPMENT). 220/220 published, 0 skipped, 0 failed.
- Inspected batch 1 before proceeding (public pages, event distribution, alerts, timeline) — see below. Looked correct.
- Batch 2: 600 more READY reports (oldest-first). 600/600 published, 0 skipped, 0 failed, in 17s.
- **Total: 820 real reports published this pass.** ~2,866 remain pending (mostly NEEDS_REVIEW). Nothing NEEDS_REVIEW or BLOCKED was touched.

**Events/corroboration**: all 820 published events are singletons (1 source each) — expected, since this DB had 0 events before this pass, so there was nothing to corroborate against, and the existing architecture deliberately never auto-merges duplicate reports into one event ("Do NOT automatically merge" — a prior, considered decision, not revisited here). A targeted scan for same-conflict/same-country/same-day pairs found 39 clusters; nearly all are genuinely distinct stories. **One real near-duplicate was found**: two separate events about the same Novoshakhtinsk refinery drone strike (different outlets, both worded distinctly enough that live duplicate-detection — which only compares against already-published events, not other items in the same batch — didn't catch the second one against the first from earlier in the same batch). Rate: 1 pair / 820 events (~0.2%). Left for a human to merge via the existing admin merge tooling; not auto-fixed, consistent with the "never auto-merge" policy.

**Map/report-count verification**: `/api/report-counts` returns real, sensible per-conflict counts (1-4 per conflict in the last 24h across 7 active conflicts) after publication. `/api/events` returns all 820 with real `occurredAt` values spanning 2026-08-21 to 2026-09-28 — genuinely historical, not clustered at publish time.

**Brief/alert/timeline safety — verified, not just assumed**: `alert_records` stayed at **0** after both batches (733 `alert_states` ledger rows were written, i.e. state was tracked, but nothing crossed the "material change" bar the existing alert engine already enforces — a first-ever observation of a fact isn't itself a change to alert on). The World Command Center's `whatChanged`/`ticker` arrays were **empty** after 820 publishes; `pulse` showed only 3 genuinely current items. `runBulkPublish` already threads `occurredAt` from the report's own `publishedAt` (never the publish moment) into the created `Event` — confirmed with a dedicated integration test that backdates a report 10 days and asserts the resulting event keeps that date. **No false "breaking now" signal was produced by this backlog publish.**

**Admin queue**: added Readiness / Classification / Conflict-match-confidence filters to `/admin/incoming` (reusing the existing filter-bar pattern, no new page) and a readiness+classification badge per item. Review prioritization (§12) was intentionally NOT built as a new bespoke sort — the new filters let an admin already construct the described priority view (e.g. `readiness=NEEDS_REVIEW&conflictMatchLevel=medium&sort=importance`) without inventing an opaque ranking function.

**Tests**: `tests/conflict-match.spec.ts` (14 tests: the matcher's evidence tiers, the bare-alias fix, readiness/classification derivation, duplicate downgrading, party-claim handling) and `tests/backlog-publish.spec.ts` (end-to-end "Publish READY filtered" + historical-timestamp preservation), plus 2 pre-existing `extract-facts.spec.ts` assertions updated for the new (more descriptive) match-reason wording.

**Performance**: the 600-item batch published in 17s with no reported failures; the full-backlog reprocessing (3,686 items across 54 sources) completed the same way as the previous milestone's refresh (well under a minute per source, bounded, yielding between items).

## 17. Location Resolution & Review-Queue Reduction v1 (2026-09-28)

**Measured first.** Sampled 250 real NEEDS_REVIEW reports before changing any code: 194 (77.6%) had no location resolved at all, 54 (21.6%) had an ambiguous conflict match, 2 party claims. Manually read ~40 of the no-location reports to find the real, recurring failure patterns rather than guessing — three systemic causes emerged, in rough order of volume:

1. **A real country-name substring collision bug**: `"Guinea"` is a genuine, word-boundary-delimited word inside `"Papua New Guinea"`, `"Guinea-Bissau"` and `"Equatorial Guinea"` — three *different* countries — so a report naming only "Papua New Guinea" scored as naming two ambiguous countries and was left completely unresolved. `lib/geocoding/location-scope.ts`'s country matcher had no overlap-exclusion logic at all (unlike its own region/city matchers, which already had it). Fixed the same way: when one match's span sits entirely inside a longer match's span, only the longer, more specific one counts.
2. **The lead-only design (headline + first 200 chars) was too strict for country-level fallback specifically.** Many real reports (wire-service "Morning recap" digests, generic headlines) only name their country in the article body. Added a second, explicit fallback pass — `countryFromBody` — that runs *only* when the lead itself resolved nothing, scans the *full* article text, and *only* ever resolves to country scope (never city/region/point) — a country the whole article is about is safe to infer from anywhere in the text; a specific incident location is not, and that stricter lead-only rule for city/region precision is untouched. Every result now carries `locationEvidenceSource: "lead" | "body"` so this is always visible, never silent.
3. **Real gazetteer/admin-region gaps**, concentrated in countries the previous milestones hadn't touched: Libya had **zero** cities (added Tripoli, Benghazi, Misrata, Zawia, Sirte, Tobruk); Iran and Pakistan had **zero** admin regions despite being tracked conflicts (added Sistan and Baluchestan, Khuzestan, Balochistan, Khyber Pakhtunkhwa, Sindh — all found in the actual failing sample, not guessed); DRC, Somalia, Niger, Burkina Faso, Yemen gained a handful of real, sample-grounded cities (Inongo, Kenge, Kismayo, Baidoa, Agadez, Bobo-Dioulasso, Dédougou, Taiz, Marib). A transliteration gap (`Naypyitaw` for Myanmar's `Naypyidaw`) and a short-code gap (`UK`/`US` were already aliased but filtered out by a blanket "no short aliases" rule to avoid colliding with ordinary lowercase words) were also fixed — the short-code fix matches case-sensitively against the source's own original text, never the lowercased form, so it only fires when the source itself wrote "UK" upper-case. `Punjab` was deliberately **not** added (it's a real region in both India and Pakistan — adding it unscoped to one country would have been exactly the kind of guess §8 warns against).
4. A fourth, narrower pattern — two countries named with nothing to prefer between them (`"Russia attacks Ukraine..."`) — got a conflict-geography disambiguation helper (`disambiguateCountryByConflictGeography`): when both named countries belong to the *same* tracked conflict and the registry's own `fightingCountries` list is asymmetric (one fights there, the other doesn't), the fighting country wins. This does **not** help the single highest-volume case (Russia and Ukraine are *both* listed as fighting countries in the registry — a real, symmetric fact, not a bug), so that specific pattern is left correctly unresolved rather than force-picking a side from headline word order, which would be real guessing.

**Readiness rule review (§2 of this milestone's brief)**: audited `deriveReadinessSnapshot` and confirmed no bug exists — a `COUNTRY_DEVELOPMENT` classification (country known, no conflict) already falls through to READY with no city/region required. The bottleneck was never the readiness rule; it was country resolution itself failing for ~78% of the no-location backlog, addressed above.

**Before/after** (2,866 pending items unchanged in count — no publishing happened until after these fixes):

| | Before this pass | After |
|---|---|---|
| READY | 801 | 985 (+184, −9.2% of the review queue) |
| NEEDS_REVIEW | 2,006 | 1,822 |
| BLOCKED | 59 | 59 |

Within the remaining NEEDS_REVIEW pool, the no-location share dropped from 77.6% (sampled before) to 70.9% (1,291 of 1,822, full count after) — real, measured, partial progress; a long tail of genuinely rare place names and non-spatial content remains, correctly deferred rather than guessed.

**Sample quality** (per this milestone's explicit requirement): manually reviewed 50 random READY country-scope items and 50 READY city/region-scope items after the fixes. **Zero false locations or over-stated precision found** — every reviewed item's assigned country/city genuinely appeared in its own text, region-scope items correctly carried centroid coordinates with region (not city) precision, and no coordinate was invented beyond what the source actually said.

**Second publication wave**: published 270 more READY reports (17 CONFLICT_EVENT, 253 COUNTRY_DEVELOPMENT, spread across 7 conflicts and 87 countries) — 270/270 published, 0 failed, in 13.6s. Total published across both milestones: **1,090 real events**. Public pages (Overview, World, country/conflict pages) verified healthy afterward.

**Event clustering**: still 100% singleton events (1,090/1,090, 1 source each) even after this second wave. Investigated per this milestone's own explicit caution ("if everything remains singleton... investigate") and concluded this is expected, not a bug: this is a first-ever backlog catch-up on a previously-empty database, corroboration only emerges as new real-time reports arrive about an *already-published* incident, and the product's existing architecture deliberately never auto-merges within a single publish batch (a considered decision from an earlier milestone, not revisited). No clustering was forced.

**Brief/alert/timeline safety reconfirmed**: `alert_records` stayed at 0 through both this pass's snapshot refresh and the 270-item publish; the events span 2024-04-12 to 2026-09-28 with real, varied timestamps, not clustered at publish time.

**Deferred, not built**: a dedicated "Publish as country-level" quick action (§18 of this milestone's brief) — the existing single-item review screen already lets an admin change `locationScope` to `country` and publish through the normal flow, so the functional need is already met; a new bulk-specific button was judged not worth the added surface given "do not build a map editor" and the review queue's now-smaller size. Admin review-priority sorting (§12) remains filter-composition-based (see §16 above), not a new ranking function.

**Tests**: `tests/location-resolution.spec.ts` (8 tests: the collision fix, the short-code case-sensitivity fix, the body-fallback country resolution and its lead-priority rule, the two-country-ambiguous-but-undisambiguated case, region-centroid precision, non-spatial content staying unresolved, and the conflict-geography disambiguator's two real branches).

**Performance**: full-backlog reprocessing (2,866 items across 53 sources) completed in 33s; the 270-item publish batch in 13.6s. No CPU-heavy synchronous loops; no external network calls added to the hot path (the body-fallback pass reuses already-fetched `originalText`, never fetches anything).

## 18. Event Clustering, Corroboration & Final READY Publication v1 (2026-09-28)

**Root cause confirmed by real analysis, not assumption.** Scored every one of the 1,090 published events against every other with the exact existing duplicate scorer (`lib/ingestion/duplicates.ts`, no new heuristic) — 2,414 candidate pairs at score ≥35, 73 at score ≥65. The real answer to this milestone's primary question: **the 100% singleton rate was a genuine bug** — `publishRawItem` never checked for an existing matching event before creating a new one. Confirmed genuine same-incident pairs stayed permanently separate (e.g. two reports of the same Sumy Oblast car-strike 31 minutes apart, score 90; two identical "Netanyahu tours tunnels..." headlines 17 minutes apart, score 100).

**A second, equally important finding from the same manual read**: weak/medium signals alone are dangerously insufficient for *automatic* merging. Two completely unrelated Kherson Oblast reports — a shelling-injury story and a prisoner-repatriation story — scored **86/100** on time+place+type+conflict coincidence alone, with **zero** title overlap. That's far above the "likely duplicate" review threshold (35), proving the existing scorer (correctly tuned for a *human reviewer's* warning) is not by itself safe for an *unattended* merge.

**Canonical matcher built** (`lib/ingestion/event-match.ts`), wired into the real publish path so every caller (single Publish, review form, bulk) gets it: requires a high score (≥80), the *exact* same event type, real title/fact overlap (≥20%), and an event-type-specific time window. The window was tightened by a real finding: a naive 3-hour window pulled in a Syrian ammunition depot's "massive explosions" report 3 hours after the initial blast — plausibly a genuinely separate secondary explosion — so kinetic types now use 90 minutes, not 180. `"other"` and policy/diplomatic types never auto-merge at all.

A match attaches the report the same way the pre-existing manual "Merge" action already did (reused, not duplicated): `relationship: "relay"` for aggregator/relay sources, `"corroborating"` for independent ones; the report's status becomes `"merged"`; disagreeing extracted facts become **pending `EventUpdateProposal`** rows, never a silent overwrite. The readiness pipeline now only `BLOCKED`s a high duplicate score when it does *not* also clear this stricter bar.

**Retroactive dry run** (live-merge criteria, not a looser stand-in): found 5 real same-incident groups (11 events). Manually reviewed all 5 (fewer than 50 existed) — 4 unambiguous, 1 plausible-but-uncertain. Applied all 5: unpublished (never deleted) the 5 redundant events, attached their reports to the canonical event, producing 27 pending `EventUpdateProposal` rows.

**Final READY publication**, recalculated live at each step: 597 READY → published 250 (248 new + 2 merged) → 345 READY remaining → published all 345 (344 new + 1 merged). **1,685 total reports across 1,677 published events** (1,669 singleton, 8 multi-source). 0 skipped, 0 failed.

**Verified, not assumed**: real public pages render with a genuine `LIVE` freshness badge under live ingestion; `/api/status/freshness` returned `{"state":"live"}`. **No loading-hang reproduced** across repeated navigation through Overview/World/Conflicts/For You/Finland/Ukraine/Russia-Ukraine/Mexico/Search/Settings — zero console errors. Report counts and map markers reflect unique reports, not events.

**Tests**: `tests/event-clustering.spec.ts` (6 end-to-end tests: independent-source merge, relay merge with correct independence flag, distinct-incident non-merge, incompatible-type non-merge, party-claim attachment, contested-casualty proposal).

**Performance**: 250-item batch in 27.3s, 345-item batch in 26.4s, retroactive dry run (1,090×1,090 candidate scoring, reusing the existing indexed ±14-day query) in 9.8s.

## Performance

No performance regressions observed under real, live ingestion. Started the real dev server with the scheduler actually running (not disabled): 3 scheduler ticks completed cleanly over ~2 minutes (12 sources polled per tick), ingesting 791 new real items in a burst (expected after a multi-day gap in polling — feeds return everything published since the last cursor). Warm page loads measured during that live ingestion: `/` 65ms, `/world` 61ms, `/conflicts` 46ms, `/for-you` 43ms, `/country/UA` 447ms, `/conflict/russia-ukraine` 426ms, `/api/world/command-center` 14ms, `/api/public/search` 16ms — no event-loop stalls, no page request blocked by a concurrent scheduler tick. The dedupe fix (§5) held under this real burst: 0 duplicate groups afterward. The per-source snapshot refresh (2,598 items across 53 sources) separately completed in well under a minute; nothing here was slow enough to justify further optimization.
