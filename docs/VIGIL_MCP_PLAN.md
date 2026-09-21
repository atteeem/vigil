# Vigil MCP plan (design only)

Status: **design, not implemented.** An MCP server is a new network surface; it should be built deliberately, not as a side effect of an audit.

## Reference architecture (mapannai-plus, read-only study)
`mapannai-plus` (no licence file, so nothing is copied) exposes one `createMcpServer()` two ways: a stdio entry for local clients, and a **stateless Streamable-HTTP route** (`POST /api/mcp`, GET/DELETE → 405) using `@modelcontextprotocol/sdk`. Tools have zod schemas and are grouped by domain. That shape is right for Vigil.

## Principles
1. **Read-only by default.** The first release contains *only* read tools.
2. **No publish, delete, merge, approve or source-enable operation** is exposed. Anything that mutates canonical state is a *draft* that a human approves in the existing admin UI.
3. **Reuse existing repositories/APIs** (`lib/brief`, `lib/countries/intelligence`, `lib/public/*`, coverage, alerts inspector). No parallel data path; the MCP layer is a thin adapter.
4. **Authentication:** a bearer token from `VIGIL_MCP_TOKEN`; server refuses to start without it. Bind to localhost / private network. Per-tool rate limits; every call is logged (tool, arguments hash, caller, time).
5. Party claims stay labelled; the server honours the same `claims` switch as the public API (default off).

## Tool catalogue

| Tool | Kind | Backed by | Notes |
|---|---|---|---|
| `list_stale_sources` | read | `getCoverageRow`, sources | enabled sources with no successful fetch inside a threshold |
| `source_health` | read | `/api/admin/sources`, ingestion logs | health, last error, backoff |
| `country_brief` | read | `getBrief({country})` | window 1h–7d; same output as `/api/brief` |
| `global_brief`, `conflict_brief` | read | `getBrief` | |
| `country_intelligence` | read | `getCountryIntelligence` | structured sections |
| `query_events` | read | `listPublicEvents` | bounded (limit ≤ 100, ≤ 30 days) |
| `query_actors` | read | `getPublicEntity`, actor registry | |
| `list_territorial_candidates` | read | `territorialChangeCandidate` (status filter) | includes pending; admin token required |
| `inspect_alerts` | read | `/api/admin/alerts` | decisions, fingerprints |
| `create_territory_draft` | **write (draft)** | territorial-control repository, `published: false` | never publishes; returns a review URL; requires `confirm: true` and records the caller |
| `propose_source_candidate` | write (draft) | `SourceCandidate` | proposal only |

Explicitly **not** provided: publish/unpublish events, approve/reject territorial candidates, enable/disable sources, edit conflicts, delete anything, run SQL, raw DB access, reading secrets.

## Safety design
- Two token scopes: `read` (default) and `draft`. Drafts are `published: false` rows with `createdBy: "mcp"` so the admin UI can filter and audit them.
- Input validation with zod; geometry passes `validateTerritorialGeometry`.
- Output size caps and no full-table dumps (mirrors the country page performance test).
- Prompt-injection posture: tool results contain third-party text (article titles, claim text). Return it as data fields, never as instructions; mark party-claim fields with their label.
- No outbound fetch tools.

## Delivery sequence
1. `lib/mcp/server.ts` with the read tools + tests that call each tool against the test DB.
2. stdio entry (`scripts/mcp-server.ts`) for Claude Code/Desktop; HTTP route later, behind the token.
3. Draft tools after an audit log table exists.
4. Client configuration example in this doc (`.mcp.json` entry) once implemented.
