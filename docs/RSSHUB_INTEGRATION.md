# RSSHub integration (optional external sidecar)

Status: **implemented as an optional configuration hook**; disabled unless `RSSHUB_BASE_URL` is set. No RSSHub code is in Vigil.

## Licence decision
RSSHub is **AGPL-3.0**. Vigil must not copy, vendor or link its source. The only supported use is as a **separate, unmodified service** that Vigil reaches over HTTP and consumes as ordinary RSS. If an operator modifies and publicly hosts RSSHub, the AGPL obligations are theirs. Vigil ships nothing that depends on it.

## Architecture

```
website / platform
   -> RSSHub (sidecar, operator-run)   GET {RSSHUB_BASE_URL}/<route>
   -> normalised RSS 2.0
   -> existing Vigil RSSAdapter (lib/ingestion/rss-adapter.ts)
   -> normal ingestion pipeline (RawIngestionItem -> review -> Event)
```

A source opts in with a feed URL of the form `rsshub://<route>`, e.g. `rsshub://kyodonews/en`. At fetch time the adapter resolves it to `${RSSHUB_BASE_URL}/<route>`:

- `RSSHUB_BASE_URL` unset → the feed is reported as "RSSHub is not configured" (health check fails, poll records a clear error); nothing else changes.
- Optional `RSSHUB_ACCESS_KEY` is appended as `?key=` when RSSHub is deployed with access control.
- The item's `originalUrl` stays the publisher's own article link (RSSHub preserves it); the RSSHub URL is never stored as an article URL.
- Source classification is unchanged: an RSSHub route over a party/state site is still a party source; a route over a social platform is at most a discovery lead.

## Rules (must hold for any route)
1. **No bypassing** authentication, paywalls, anti-bot protections or platform terms. If a publisher answers 401/403/429 to automated readers, that is recorded as `botProtected` and not worked around — RSSHub does not change that.
2. Prefer the publisher's own RSS. Use RSSHub only where a legitimate public route exists and the site has no feed.
3. Never route logged-in scraping (X/Telegram/Facebook cookies) through Vigil. Telegram stays behind the existing credential-gated adapter.
4. The operator, not Vigil, is responsible for the RSSHub instance's compliance with each site's terms.

## Which weak Vigil sources could use a legitimate route
From `TASKS.md` and `data/source-plugin*.json` (verified against the RSSHub `lib/routes` directory list):

| Weak source today | Why weak | RSSHub route available? | Verdict |
|---|---|---|---|
| Kyodo, NHK, CNA, YNA, DW, SCMP, BBC, Al Jazeera | have their own RSS already | yes | no gain; keep native feeds |
| Reuters / AP | AP answers 403 to automated readers; Reuters has no public RSS | yes (`reuters`, `apnews`) | **do not use**: it would circumvent the publisher's automation policy |
| Liveuamap | aggregator; Vigil reads it via the credential-gated Telegram adapter, disabled | yes (`liveuamap`) | only as a discovery lead, and only if its terms allow; leave off by default |
| Telegram public channels | no authorised Telegram access | yes (`telegram/channel`) | not enabled: Vigil policy forbids scraping `t.me` |
| X accounts | no adapter/login | yes (`twitter`) | not enabled: needs credentials/terms review |
| Local sites with no advertised RSS (Hengaw, ICG, MindaNews, Al Arabiya) | 403 to automated requests | some | **do not use** for the same reason as AP |

Net: today there is no source where an RSSHub route is both legitimate and clearly better than what exists. The hook exists so an operator can add such routes deliberately (each still goes through the normal source-verification and review flow).

## Operating it (optional)
Run RSSHub next to Vigil (Docker image `diygod/rsshub`), bind it to a private network, set `RSSHUB_BASE_URL=http://rsshub:1200` (and a key if enabled). Create a source with `type: rss`, `feedUrl: rsshub://<route>`, and the usual classification fields. Cache and rate-limit on the RSSHub side; Vigil's scheduler already applies backoff and `Retry-After`.
