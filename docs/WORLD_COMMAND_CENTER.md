# World Command Center (`/world`)

The `/world` page is a command-center layout over the same map, timeline, layers and record pages. It adds no new
data store: every number and row is derived from the canonical conflict registry, the brief system (state changes
between two moments, party claims excluded by default) and the public freshness stamps.

## Aggregation

`GET /api/world/command-center[?claims=1]` (`lib/world/command-center.ts`) returns one payload:
`status`, `ticker`, `pulse`, `whatChanged`, `topEntities` (1h / 6h / 24h), `globalSignals` and `conflicts` (the
active-conflict markers). It reads the registry once, the cached 24 h and 6 h brief universes and the freshness
stamps. The client (`hooks/use-command-center.ts`) issues **one** request and **one** 60 s poll (paused by
TanStack Query in hidden tabs); no module polls on its own. `claims=1` is sent only when the existing Profile ->
Sources "Show party claims" setting is on.

Selection context is fetched on demand, never polled: `GET /api/world/conflict?slug=&country=` (severity, impact
for the user country, confidence, latest developments, territory summary, participants, corroborating sources) and
the existing `GET /api/countries/{code}/intelligence` for a selected country.

## Status counters

| Counter | Definition |
|---|---|
| ACTIVE CONFLICTS | Conflicts whose registry status is `active`. |
| HIGH TENSION | Active conflicts with severity score >= **70** (the "high" band of `severityFromScore`), computed by the central scoring engine from the registry label (a registry-flagged full-scale war scores 100), intensity, event count and trend. Report/article count never enters. |
| NEW DEVELOPMENTS | Significant, de-duplicated developments in the last 24 h from the brief system (state changes, territorial changes, hazards, infrastructure...), party claims excluded. Not an article count. |
| LIVE | From the newest successful source ingestion: **LIVE** <= 2 h, **DELAYED** <= 48 h, **STALE** older, **NO DATA** when nothing was ever fetched. It never claims LIVE without fresh data. |

## Ticker and Pulse

Ticker: developments with significance >= 60, no party claims, de-duplicated (same id; same type and normalised
headline; same conflict, type and place), newest first, at most 12. Minor RSS items and routine thermal detections
are not developments in the brief system, so they cannot appear. One pass across the strip, paused on hover/focus;
under `prefers-reduced-motion` it is static and scrollable.

Pulse: the same developments (all of them, up to 60) as rows with time, headline, place, source, confidence,
category and badges (VERIFIED, PARTY CLAIM, OFFICIAL, UPDATED, TERRITORY, HAZARD). Party claims appear only when the
setting above is on, always badged. Selecting a row (or ticker item / rail item) enables its layer, centres the
same map, and opens the event, hazard or conflict context.

Confidence is shown as High/Medium/Low (+ %) with the tooltip "Confidence reflects evidence/corroboration. It does
not represent severity." A party claim is never labelled or counted as corroborated.

## Top entities methodology

Entities are conflicts and the countries where developments are located. For each window (1h, 6h, 24h) every
distinct development contributes its significance **once** (the brief system already collapses syndicated copies
of a story into one development), so ranking follows the number and weight of meaningful developments, never raw
article frequency; a story republished by ten outlets counts as one. Party claims do not count. Ties break on
development count, then name.

## Live View

Opt-in button in the status bar (never auto-started; disabled when there is nothing to show). It cycles the ticker
queue (no party claims, no minor RSS/thermal, no duplicates, significance >= 60) every 12 s (override with
`NEXT_PUBLIC_LIVE_VIEW_STEP_MS`, used by tests): fly to the development, enable its layer, open its card. Pause /
Resume in the bar; any manual interaction (map press or wheel, a Pulse / ticker / rail click) pauses it; Resume
continues with the next item. Under `prefers-reduced-motion` the camera jumps instead of flying.

## Markers

Active conflicts get one situation-level marker each (severity colour, name, heavier ring when the conflict had a
development in the last 24 h) below the event clusters and hidden once zoomed in (zoom 7+), where individual events
take over. Conflict markers are not derived from events, so there are no duplicate event markers.

## Safety

No live military positions, tactical routes or live military aircraft/naval tracking are added. Aviation and
maritime signals are the existing structured operator/provider status feeds.
