# Territorial data sources (research, 2026-09-25)

What legitimately reusable territorial data exists for the conflicts Vigil tracks, what each source actually measures,
and why it is or is not integrated. The machine-readable registry is `data/territorial-datasets.json` (seeded into
`territorial_datasets`); this note is the reasoning behind it.

Rules applied: only data with a clear reuse licence is imported; nothing is traced from map images or screenshots; no
polygons are invented; every import lands as **unpublished drafts** that a human approves in `/admin/territorial-control`
(coverage → Publish). CONTROL, PRESENCE and INFLUENCE are separate dataset types and are never inferred from attacks,
incidents, arrests, sightings or news volume.

## Integrated

| Conflict | Source | Measures | Detail | Updates / history | Licence |
|---|---|---|---|---|---|
| Yemen / Red Sea | [ACAPS Yemen Analysis Hub — Yemen: Areas of control](https://data.humdata.org/dataset/yemen-areas-of-control) (HDX) | De facto **control**: every Admin-2 district is classed DFA (Ansar Allah / Houthis) or IRG | District level; dissolved to one area per actor and simplified to ~200 m (strategic level) | Dated snapshots, roughly quarterly; 2021-02 to 2026-04 published | CC BY 4.0 (attribution shown with every area) |

Import: `npm run territory:import-yemen` (HDX API → shapefile → dissolve → simplify → `data/territorial/acaps-yemen-areas-of-control.json`),
then `npm run territory:seed` (or the full `db:seed`) loads it as drafts. Only snapshots in the current single-file schema
(`areas_of_c`) are imported: the older 2021–2024 snapshots use separate per-actor files with a different taxonomy (STC as
its own controller, "AQAP Presence" as a presence layer), and merging those into DFA / IRG would manufacture changes.
The timeline therefore shows the ACAPS state from 2026-04-08 on and nothing before it.

## Candidates (registered, not imported)

| Conflict | Source | Measures | Why not imported |
|---|---|---|---|
| Yemen | ACAPS per-actor snapshots 2021–2024 | Control (DFA, IRG, STC) + **AQAP presence** | Reusable (CC BY) but a different taxonomy; import as its own dataset, with AQAP as a separate PRESENCE dataset |
| Russia–Ukraine | [ISW / CTP Assessed control of terrain](https://www.arcgis.com/home/item.html?id=9f04944a2fe84edab9da31750c2b15eb) | Control, advances, claims (daily polygons) | **Blocked**: ISW states the geodata is its exclusive IP and requires written consent |
| Russia–Ukraine | [DeepStateMap](https://deepstatemap.live/license-en.html) | Occupied territory (daily MultiPolygon) | **Blocked**: licence agreement; API by approval, redistribution prohibited. GitHub mirrors grant no rights |
| Myanmar | [British Red Cross — Myanmar Areas of Control](https://data.humdata.org/dataset/myanmar-areas-of-control) (HDX) | Control, single 2025-03-08 raster | GeoTIFF traced from a Wikipedia image: vectorising it is image tracing, and the CC0 label conflicts with its CC BY-SA origin |
| Myanmar | [Wikipedia Module: Myanmar Civil War detailed map](https://en.wikipedia.org/wiki/Module:Myanmar_Civil_War_detailed_map) | Settlement control **points** | Points, not areas; CC BY-SA share-alike; would need a point layer |
| Syria | [Wikipedia Module: Syrian Civil War detailed map](https://en.wikipedia.org/wiki/Module:Syrian_Civil_War_detailed_map) | Settlement control points | As above; control changed fundamentally after December 2024 |
| Mexico | [Coscia & Rios 2012](https://www.michelecoscia.com/?page_id=1032) | Web mentions of cartels per municipality | Activity → at most **PRESENCE**; no licence stated; data ends ~2010 |
| Mexico | [OCVED](https://www.ocved.mx/) | Criminal-group presence per municipality | **PRESENCE** only; licence not stated |

## Searched, nothing reusable found

Israel–Palestine (no open area-of-control layer on HDX; Oslo Area A/B/C boundaries are administrative, not de facto
control, and no licensed copy was found), Sudan, Somalia, Sahel, Libya, DRC: the maps that exist (Sudan War Monitor,
Critical Threats, PolGeoNow, Liveuamap, ISW Africa File) are proprietary analysis maps. ACLED and UCDP GED are **event**
data: they record incidents, which must never be turned into control or presence areas.
