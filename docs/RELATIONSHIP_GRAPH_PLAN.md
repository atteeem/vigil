# Relationship graph plan (AntV G6 prototype, design only)

Status: **design.** Not built in this milestone: it needs a new graph query endpoint and a ~1 MB dependency for an optional view. AntV G6 (MIT, v5) is the candidate renderer.

## Goal
An optional "Relationships" view on actor/conflict/country pages, drawn from the **existing** graph, with provenance one click away. It does not replace the actor/unit pages.

## Data (no duplicate storage)
Nodes and edges are derived at request time from:

| Edge | Table | Provenance already stored |
|---|---|---|
| Conflict — Actor/Unit | `ConflictParticipant` (role, validFrom/validTo) | sourceName, sourceUrl, observedAt, confidence |
| Unit — parent Unit | `MilitaryUnit.parentUnitId`, `UnitParentHistory` | validFrom/validTo, provenance |
| Actor — Actor | `ActorRelationship` (type, conflict) | provenance |
| Unit — Commander | `CommanderAppointment` | source, observedAt, confidence, lastConfirmedAt |
| Unit — Equipment | `MilitaryUnitEquipment` | source, confidence |
| Event — Unit/Commander/Equipment | `MilitaryUnitEvent`, `EventCommanderLink`, `EventEquipmentLink` | via the event's sources |
| Conflict — Territorial claim | `TerritorialChangeCandidate` (approved only) | claim confidence, source |

No relationship is created for the view; an edge exists only if a row exists. **No inferred alliances, no proximity edges.**

## API
`GET /api/public/graph?focus=<conflict|actor|country>:<key>&depth=1|2&types=participant,parent,commander,equipment,event&at=<iso>`

- Server builds `{ nodes: [{id, kind, label, href}], edges: [{id, source, target, type, validFrom, validTo, provenance:{sourceName, sourceUrl, observedAt, confidence}}] }`.
- **Bounded:** depth ≤ 2, ≤ 60 nodes (the busiest per edge type first), `truncated: true` with counts when capped — the guard against giant unreadable graphs.
- `at` reuses the timeline: only rows valid at that moment.
- Party/aligned provenance labelled as such.

## UI
- Lazy-loaded client component (`dynamic(..., { ssr: false })`) so G6 is not in the main bundle.
- G6 `force` layout, node colours by kind (conflict/actor/unit/commander/equipment/event) with text labels (not colour-only), edge label = relationship type.
- Node click opens the existing entity page; edge click opens a side panel showing provenance (source link, observed, confidence, validity).
- Filter chips per edge type; default depth 1; "expand" adds one level.
- Mobile: list-first, graph behind a "Show graph" button.

## Prototype steps
1. Server function `buildRelationshipGraph()` + unit tests (bounded, only real edges, provenance present, `at` filter).
2. Route + a `/actor/[ref]` "Relationships" section behind the button.
3. Add `@antv/g6` only in step 2; measure bundle impact (must not load unless opened).

## Why not now
Adds a dependency and an endpoint for an optional view; the audit's higher-value items (map fixes, territorial editor, glyphs, RSSHub hook) come first.
